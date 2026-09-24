import { createHash } from "node:crypto";
import { getSql, persistentDatabaseAvailable, type Sql } from "./db";
import { eventScore, getEventDetail, marketFamily } from "./sportybet";
import type { TicketPick } from "./types";

export type RecordStatus = "unavailable" | "not_gradeable" | "insufficient_history" | "qualified" | "below_average";
export type RecordStats = { won: number; lost: number };
export type RecordRow = RecordStats & { sport: string; family: string; band: string };
export type RecordSummary = { status: RecordStatus; settled: number; hitRate?: number; baseline?: number };
export type RecordSnapshot = { available: boolean; rows: RecordRow[] };

export const oddsBand = (odds: number): string => odds < 1.5 ? "short" : odds < 2 ? "medium" : "long";
const MIN_BASELINE = 60;
const MIN_GROUP = 25;

export function evaluateRecord(pick: TicketPick, snapshot: RecordSnapshot): RecordSummary {
  if (!snapshot.available) return { status: "unavailable", settled: 0 };
  if (!gradeable(pick)) return { status: "not_gradeable", settled: 0 };
  const family = marketFamily(pick.sporty?.marketId, pick.market);
  const comparable = snapshot.rows.filter((r) => r.sport === pick.sport && r.band === oddsBand(pick.odds ?? 0));
  const group = comparable.find((r) => r.family === family);
  const total = comparable.reduce((n, r) => n + r.won + r.lost, 0);
  const count = (group?.won ?? 0) + (group?.lost ?? 0);
  if (total < MIN_BASELINE || count < MIN_GROUP)
    return { status: "insufficient_history", settled: count };
  const baseline = comparable.reduce((n, r) => n + r.won, 0) / total;
  const hitRate = group!.won / count;
  return { status: hitRate > baseline ? "qualified" : "below_average", settled: count, hitRate, baseline };
}

export async function loadRecord(sqlProvider: () => Promise<Sql> = getSql, available = persistentDatabaseAvailable()): Promise<RecordSnapshot> {
  if (!available) return { available: false, rows: [] };
  try {
    const sql = await sqlProvider();
    const rows = await sql<{ sport: string; family: string; band: string; won: number; lost: number }>`
      select sport, family,
        case when odds < 1.5 then 'short' when odds < 2 then 'medium' else 'long' end as band,
        count(*) filter (where result = 'won')::integer as won,
        count(*) filter (where result = 'lost')::integer as lost
      from recommendation_record
      where result in ('won', 'lost') and settled_at >= now() - interval '365 days'
      group by sport, family, band
    `;
    return { available: true, rows: rows.map((r) => ({ ...r, won: Number(r.won), lost: Number(r.lost) })) };
  } catch (error) {
    console.error("[slipcut.record] load failed", error instanceof Error ? error.name : "unknown");
    return { available: false, rows: [] };
  }
}

export type RecordedSelection = Pick<TicketPick, "sport" | "market" | "selection" | "odds" | "kickoff" | "sporty">;

// Only outcomes provable from a final full-time score enter the track record.
export function gradeable(pick: RecordedSelection): boolean {
  const family = marketFamily(pick.sporty?.marketId, pick.market);
  const selection = pick.selection.toLowerCase().trim();
  if (pick.sport === "football" && family === "dc")
    return /^(home or draw|draw or away|home or away|1x|x2|12)$/.test(selection);
  if (pick.sport === "football" && family === "gg") return /^(yes|no)$/.test(selection);
  if ((pick.sport === "football" || pick.sport === "basketball") && family === "ou")
    return /^(over|under)(?:\s+\d+(?:\.\d+)?)?$/.test(selection) &&
      extractLine(pick) !== null;
  return false;
}

function extractLine(pick: RecordedSelection): number | null {
  const raw = pick.sporty?.specifier ?? pick.market;
  const m = raw.match(/(?:total=|\b)(\d+(?:\.\d+)?)/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function settleRecorded(pick: RecordedSelection, home: number, away: number): "won" | "lost" | null {
  if (!gradeable(pick)) return null;
  const family = marketFamily(pick.sporty?.marketId, pick.market);
  const s = pick.selection.toLowerCase().trim();
  if (family === "ou") {
    const line = extractLine(pick)!;
    const total = home + away;
    if (total === line) return null; // push or ambiguous settlement: do not count
    return (s.startsWith("over") ? total > line : total < line) ? "won" : "lost";
  }
  if (family === "gg") return ((home > 0 && away > 0) === (s === "yes")) ? "won" : "lost";
  const win = s === "1x" || s === "home or draw" ? home >= away
    : s === "x2" || s === "draw or away" ? away >= home : home !== away;
  return win ? "won" : "lost";
}

export async function recordRecommendations(picks: TicketPick[], sqlProvider: () => Promise<Sql> = getSql, available = persistentDatabaseAvailable()): Promise<number> {
  if (!available) return 0;
  const sql = await sqlProvider();
  let saved = 0;
  for (const pick of picks) {
    const id = pick.sporty;
    const kickoff = pick.kickoff;
    if (!id || !kickoff || kickoff <= Date.now() || !pick.odds || !gradeable(pick)) continue;
    const key = createHash("sha256").update(JSON.stringify([id.eventId, id.marketId, id.outcomeId, id.specifier ?? "", kickoff])).digest("hex");
    const family = marketFamily(id.marketId, pick.market);
    const timestamp = new Date(kickoff).toISOString();
    const rows = await sql<{ id: string }>`
      insert into recommendation_record
      (id, event_id, market_id, outcome_id, specifier, sport, family, market, selection, odds, kickoff)
      values (${key}, ${id.eventId}, ${id.marketId}, ${id.outcomeId}, ${id.specifier ?? ""},
        ${pick.sport}, ${family}, ${pick.market}, ${pick.selection}, ${pick.odds}, ${timestamp})
      on conflict (id) do nothing returning id
    `;
    saved += rows.length;
  }
  return saved;
}

export async function gradeRecommendations(sqlProvider: () => Promise<Sql> = getSql, detail = getEventDetail, available = persistentDatabaseAvailable()): Promise<{ checked: number; settled: number }> {
  if (!available) return { checked: 0, settled: 0 };
  const sql = await sqlProvider();
  const rows = await sql<ArrayRow>`
    select id, event_id, market_id, outcome_id, specifier, sport, market, selection, odds,
      (extract(epoch from kickoff) * 1000)::bigint as kickoff
    from recommendation_record where result = 'pending'
      and kickoff < now() - interval '3 hours' and kickoff > now() - interval '14 days'
      and (checked_at is null or checked_at < now() - interval '6 hours')
    order by kickoff asc limit 24
  `;
  const ids = [...new Set(rows.map((r) => r.event_id))];
  const details = new Map<string, Awaited<ReturnType<typeof detail>>>();
  for (let i = 0; i < ids.length; i += 4) {
    await Promise.all(ids.slice(i, i + 4).map(async (id) => details.set(id, await detail(id))));
  }
  let settled = 0;
  for (const row of rows) {
    await sql`update recommendation_record set checked_at = now()
      where id = ${row.id} and result = 'pending'`;
    const detailRow = details.get(row.event_id) ?? null;
    // Full-time markets are normally graded at 90 minutes; an AET/AP score
    // cannot safely establish their result without the regulation-time score.
    if (/\b(AET|AP|PENALTIES|EXTRA TIME)\b/i.test(String(detailRow?.matchStatus ?? ""))) continue;
    const score = eventScore(detailRow);
    if (!score?.finished) continue;
    const result = settleRecorded({ ...row, kickoff: Number(row.kickoff), sporty: {
      eventId: row.event_id, marketId: row.market_id, outcomeId: row.outcome_id, specifier: row.specifier,
    } }, score.home, score.away);
    if (!result) continue;
    await sql`update recommendation_record set result = ${result}, settled_at = now()
      where id = ${row.id} and result = 'pending'`;
    settled++;
  }
  return { checked: rows.length, settled };
}

type ArrayRow = { id: string; event_id: string; market_id: string; outcome_id: string; specifier: string; sport: TicketPick["sport"]; market: string; selection: string; odds: number; kickoff: number };
