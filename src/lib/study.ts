import { getSql } from "./db.ts";
import {
  brier,
  fitPlatt,
  historyBias,
  reliability,
  NEUTRAL_PLATT,
  type Outcome,
  type Platt,
  type ReliabilityBin,
} from "./odds.ts";
import { eventScore, getEventDetail, marketFamily } from "./sportybet.ts";
import { settleBasket, settleFootball, settleTennis, type LegResult, type StoredPick } from "./settle.ts";
import type { TicketPick } from "./types.ts";
import { RULE, cap, doc, esc, head, leg, stats, subhead, table, tail } from "./tg-format.ts";

export type { LegResult, StoredPick };

export type StudiedLeg = {
  home: string;
  away: string;
  market: string;
  selection: string;
  league: string;
  sport: string;
  family: string;
  result: LegResult;
  note: string;
};

export type StudyReport = {
  code: string;
  cut: boolean;
  hit: boolean;
  pending: number;
  won: number;
  lost: number;
  voided: number;
  legs: StudiedLeg[];
  lesson: string;
};

function compactPicks(picks: TicketPick[]): StoredPick[] {
  return picks.map((p) => ({
    home: p.home,
    away: p.away,
    market: p.market,
    selection: p.selection,
    league: p.league ?? "",
    sport: p.sport,
    eventId: p.sporty?.eventId,
    family: marketFamily(p.sporty?.marketId, p.market),
    kickoff: p.kickoff,
  }));
}

export async function recordSlip(code: string, picks: TicketPick[]) {
  const payload = JSON.stringify(compactPicks(picks));
  try {
    const sql = await getSql();
    await sql`
      insert into study_slips (code, picks_json, studied)
      values (${code}, ${payload}, 0)
      on conflict (code) do update set picks_json = excluded.picks_json
    `;
  } catch {
    // preview / cold db — skip quietly
  }
}

async function loadStored(code: string): Promise<StoredPick[] | null> {
  try {
    const sql = await getSql();
    const rows = await sql<{ picks_json: string }>`
      select picks_json from study_slips where code = ${code} limit 1
    `;
    if (rows[0]?.picks_json) return JSON.parse(rows[0].picks_json) as StoredPick[];
  } catch {
    /* fall through */
  }
  return null;
}

async function saveLessons(code: string, legs: StudiedLeg[]) {
  try {
    const sql = await getSql();
    for (const leg of legs) {
      if (leg.result === "pending") continue;
      await sql`
        insert into study_lessons (code, family, league, selection, sport, result, note)
        values (${code}, ${leg.family}, ${leg.league}, ${leg.selection}, ${leg.sport}, ${leg.result}, ${leg.note})
      `;
    }
    const won = legs.filter((l) => l.result === "won").length;
    const lost = legs.filter((l) => l.result === "lost").length;
    const hit = lost === 0 && won > 0 ? 1 : 0;
    await sql`update study_slips set studied = 1, hit = ${hit}, lost = ${lost}, won = ${won} where code = ${code}`;
    await sql`
      update desk_ledger
      set returned = case when ${hit} = 1 then stake * coalesce(combo, 1) else 0 end
      where code = ${code} and returned is null
    `;
  } catch {
    /* ignore */
  }
}

function buildLesson(legs: StudiedLeg[]): string {
  const lost = legs.filter((l) => l.result === "lost");
  if (!lost.length) return "E no cut. I go hold this same market mix for the next one.";
  const famCount: Record<string, number> = {};
  const leagueCount: Record<string, number> = {};
  for (const l of lost) {
    famCount[l.family] = (famCount[l.family] ?? 0) + 1;
    const key = l.league.trim() || "unknown league";
    leagueCount[key] = (leagueCount[key] ?? 0) + 1;
  }
  const worstFam = Object.entries(famCount).sort((a, b) => b[1] - a[1])[0];
  const worstLg = Object.entries(leagueCount).sort((a, b) => b[1] - a[1])[0];
  const famLabel: Record<string, string> = {
    hcp: "handicap",
    ou1h: "1st half over/under",
    gg: "GG",
    dc: "double chance",
    dnb: "draw no bet",
    win: "1X2 / winner",
  };
  const bits = ["For the next slip I go wise up:"];
  if (worstFam) bits.push(`I go reduce ${famLabel[worstFam[0]] ?? worstFam[0]} — na im cut ${worstFam[1]} times`);
  if (worstLg && worstLg[1] >= 2) bits.push(`${worstLg[0]} dey catch us, I go dey careful`);
  bits.push("I go chase the markets wey dey land.");
  return bits.join(". ") + ".";
}

export async function studyCode(code: string, picks?: TicketPick[]): Promise<StudyReport | { error: string }> {
  const stored = picks?.length ? compactPicks(picks) : await loadStored(code);
  if (!stored?.length) return { error: "I no get that slip. Send the booking code first." };

  const ids = [...new Set(stored.map((p) => p.eventId).filter(Boolean))] as string[];
  const details = await Promise.all(ids.map((id) => getEventDetail(id)));
  const byId = new Map<string, (typeof details)[number]>();
  ids.forEach((id, i) => byId.set(id, details[i] ?? null));

  const legs: StudiedLeg[] = stored.map((pick) => {
    const ev = pick.eventId ? byId.get(pick.eventId) : null;
    const score = eventScore(ev ?? null);
    if (!score) {
      return {
        ...pick,
        result: "pending" as const,
        note: "No score yet",
      };
    }
    const settled =
      pick.sport === "tennis"
        ? settleTennis(pick, score.home, score.away, score.finished, ev && "setScore" in ev ? String(ev.setScore ?? "") : "")
        : pick.sport === "basketball"
          ? settleBasket(pick, score.home, score.away, score.finished)
          : settleFootball(pick, score.home, score.away, score.finished);
    return { ...pick, ...settled };
  });

  const won = legs.filter((l) => l.result === "won").length;
  const lost = legs.filter((l) => l.result === "lost").length;
  const voided = legs.filter((l) => l.result === "void").length;
  const pending = legs.filter((l) => l.result === "pending").length;
  const cut = lost > 0;
  const hit = lost === 0 && pending === 0 && won > 0;
  if (pending === 0) await saveLessons(code, legs);
  // Feed the calibration loop: what we predicted vs what actually landed.
  await settlePredictions(code, legs);
  return {
    code,
    cut,
    hit,
    pending,
    won,
    lost,
    voided,
    legs,
    lesson: buildLesson(legs),
  };
}

export async function rememberChat(chatId: number | string) {
  try {
    const sql = await getSql();
    const id = String(chatId);
    await sql`
      insert into tg_chats (chat_id) values (${id})
      on conflict (chat_id) do nothing
    `;
  } catch {
    /* ignore */
  }
}

/**
 * Record a Telegram update_id as seen.
 *
 * Returns **true when this is the first time we have handled it**. Telegram
 * retries a webhook until it gets a 200, and the bot's long cook jobs can
 * outlast its retry window — without this the desk would cook the same slip
 * twice and message the user twice.
 */
export async function markUpdateSeen(updateId: number): Promise<boolean> {
  try {
    const sql = await getSql();
    const rows = await sql<{ update_id: number }>`
      insert into desk_updates (update_id) values (${updateId})
      on conflict (update_id) do nothing
      returning update_id
    `;
    if (!rows.length) return false;
    if (updateId % 50 === 0) {
      await sql`delete from desk_updates where seen_at < now() - interval '1 day'`;
    }
    return true;
  } catch {
    // Database down: fall back to the in-memory set rather than drop updates.
    return true;
  }
}

export async function listChats(): Promise<string[]> {
  try {
    const sql = await getSql();
    const rows = await sql<{ chat_id: string }>`select chat_id from tg_chats`;
    return rows.map((r) => r.chat_id);
  } catch {
    return [];
  }
}

export async function latestUnstudiedCode(): Promise<string | null> {
  try {
    const sql = await getSql();
    const rows = await sql<{ code: string }>`
      select code from study_slips where studied = 0 order by created_at desc limit 1
    `;
    return rows[0]?.code ?? null;
  } catch {
    return null;
  }
}

export async function latestCode(): Promise<string | null> {
  try {
    const sql = await getSql();
    const rows = await sql<{ code: string }>`
      select code from study_slips order by created_at desc limit 1
    `;
    return rows[0]?.code ?? null;
  } catch {
    return null;
  }
}

export async function addBlock(value: string) {
  const v = value.trim().toLowerCase();
  if (v.length < 3) return;
  try {
    const sql = await getSql();
    await sql`insert into desk_blocks (value) values (${v}) on conflict (value) do nothing`;
  } catch {
    /* ignore */
  }
}

export async function removeBlock(value: string) {
  const v = value.trim().toLowerCase();
  try {
    const sql = await getSql();
    await sql`delete from desk_blocks where value = ${v}`;
  } catch {
    /* ignore */
  }
}

export async function listBlocks(): Promise<string[]> {
  try {
    const sql = await getSql();
    const rows = await sql<{ value: string }>`select value from desk_blocks order by value`;
    return rows.map((r) => r.value);
  } catch {
    return [];
  }
}

export async function saveOddsBand(min: number, max: number) {
  try {
    const sql = await getSql();
    await sql`insert into desk_settings (key, value) values ('odd_min', ${String(min)}) on conflict (key) do update set value = excluded.value`;
    await sql`insert into desk_settings (key, value) values ('odd_max', ${String(max)}) on conflict (key) do update set value = excluded.value`;
  } catch {
    /* ignore */
  }
}

export async function loadOddsBand(): Promise<{ min: number; max: number } | null> {
  try {
    const sql = await getSql();
    const rows = await sql<{ key: string; value: string }>`
      select key, value from desk_settings where key in ('odd_min', 'odd_max')
    `;
    const min = Number(rows.find((r) => r.key === "odd_min")?.value);
    const max = Number(rows.find((r) => r.key === "odd_max")?.value);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { min, max };
  } catch {
    return null;
  }
}

export function blockedBy<T extends TicketPick>(picks: T[], blocks: string[]): T[] {
  if (!blocks.length) return picks;
  return picks.filter((p) => {
    const hay = `${p.home} ${p.away} ${p.league ?? ""}`.toLowerCase();
    return !blocks.some((b) => hay.includes(b));
  });
}

export function allowedBy<T extends TicketPick>(picks: T[], allows: string[]): T[] {
  if (!allows.length) return picks;
  return picks.filter((p) => {
    const hay = `${p.home} ${p.away} ${p.league ?? ""}`.toLowerCase();
    return allows.some((a) => hay.includes(a));
  });
}

export async function addAllow(value: string) {
  const v = value.trim().toLowerCase();
  if (v.length < 3) return;
  try {
    const sql = await getSql();
    await sql`insert into desk_allows (value) values (${v}) on conflict (value) do nothing`;
  } catch {
    /* ignore */
  }
}

export async function clearAllows() {
  try {
    const sql = await getSql();
    await sql`delete from desk_allows`;
  } catch {
    /* ignore */
  }
}

export async function listAllows(): Promise<string[]> {
  try {
    const sql = await getSql();
    const rows = await sql<{ value: string }>`select value from desk_allows order by value`;
    return rows.map((r) => r.value);
  } catch {
    return [];
  }
}

export async function setSetting(key: string, value: string) {
  try {
    await ensureAccessSchema();
    const sql = await getSql();
    await sql`
      insert into desk_settings (key, value) values (${key}, ${value})
      on conflict (key) do update set value = excluded.value
    `;
    const rows = await sql<{ value: string }>`select value from desk_settings where key = ${key} limit 1`;
    return rows[0]?.value === value;
  } catch {
    return false;
  }
}

async function ensureAccessSchema() {
  const sql = await getSql();
  await sql.query(
    "create table if not exists desk_settings (key text primary key, value text not null)",
  );
  await sql.query(
    "create table if not exists desk_access (user_id text primary key, username text not null default '', role text not null default 'guest')",
  );
}

export async function getSetting(key: string): Promise<string | null> {
  try {
    await ensureAccessSchema();
    const sql = await getSql();
    const rows = await sql<{ value: string }>`select value from desk_settings where key = ${key} limit 1`;
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

type AccessRow = { user_id: string; username: string; role: string };

export async function accessLocked(): Promise<boolean> {
  return (await getSetting("access_lock")) === "1";
}

export async function listAccess(): Promise<AccessRow[]> {
  try {
    await ensureAccessSchema();
    const sql = await getSql();
    return await sql<AccessRow>`select user_id, username, role from desk_access order by role, username`;
  } catch {
    return [];
  }
}

export async function hasAccess(user: { id: number; username?: string }): Promise<boolean> {
  if (!(await accessLocked())) return true;
  const id = String(user.id);
  const name = (user.username ?? "").toLowerCase();
  try {
    await ensureAccessSchema();
    const sql = await getSql();
    const rows = await sql<AccessRow>`select user_id, username, role from desk_access`;
    if (!rows.length) return false;
    return rows.some(
      (r) => r.user_id === id || (name && r.username.toLowerCase() === name),
    );
  } catch {
    return false;
  }
}

export async function isOwner(user: { id: number; username?: string }): Promise<boolean> {
  const id = String(user.id);
  const name = (user.username ?? "").toLowerCase();
  try {
    await ensureAccessSchema();
    const sql = await getSql();
    const rows = await sql<AccessRow>`select user_id, username, role from desk_access where role = 'owner'`;
    if (!rows.length) return true;
    return rows.some(
      (r) => r.user_id === id || (name && r.username.toLowerCase() === name),
    );
  } catch {
    return true;
  }
}

export async function grantAccess(
  userId: string,
  username: string,
  role: "owner" | "guest" = "guest",
) {
  await ensureAccessSchema();
  const sql = await getSql();
  await sql`
    insert into desk_access (user_id, username, role)
    values (${userId}, ${username.toLowerCase()}, ${role})
    on conflict (user_id) do update set username = excluded.username, role = excluded.role
  `;
}

export async function revokeAccess(token: string) {
  const t = token.replace(/^@/, "").toLowerCase();
  await ensureAccessSchema();
  const sql = await getSql();
  await sql`delete from desk_access where user_id = ${t} or lower(username) = ${t}`;
}

export async function lockDesk(owner: { id: number; username?: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    await ensureAccessSchema();
    await grantAccess(String(owner.id), owner.username ?? "", "owner");
    await setSetting("access_lock", "1");
    const locked = await accessLocked();
    const rows = await listAccess();
    if (!locked || !rows.length) {
      return { ok: false, error: "Lock no save. Database no dey ready on Vercel." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Lock no save. Database no dey ready on Vercel." };
  }
}

export async function unlockDesk() {
  await setSetting("access_lock", "0");
}

export async function recordStake(code: string, stake: number, combo: number) {
  try {
    const sql = await getSql();
    await sql`
      insert into desk_ledger (code, stake, combo)
      values (${code}, ${stake}, ${combo})
    `;
  } catch {
    /* ignore */
  }
}

export type BookRow = {
  code: string;
  status: "hit" | "cut" | "open";
  won: number | null;
  lost: number | null;
};

export type BookSummary = {
  rows: BookRow[];
  hit: number;
  cut: number;
  open: number;
};

/** Settled and open slips, newest first. Also what `/book` renders. */
export async function bookSummary(limit = 12): Promise<BookSummary> {
  try {
    const sql = await getSql();
    const rows = await sql<{
      code: string;
      studied: number;
      hit: number | null;
      won: number | null;
      lost: number | null;
    }>`
      select code, studied, hit, won, lost
      from study_slips
      order by created_at desc
      limit ${limit}
    `;
    const out: BookRow[] = rows.map((r) => ({
      code: r.code,
      status: !r.studied ? "open" : r.hit === 1 ? "hit" : "cut",
      won: r.won,
      lost: r.lost,
    }));
    return {
      rows: out,
      hit: out.filter((r) => r.status === "hit").length,
      cut: out.filter((r) => r.status === "cut").length,
      open: out.filter((r) => r.status === "open").length,
    };
  } catch {
    return { rows: [], hit: 0, cut: 0, open: 0 };
  }
}

export type BankrollSummary = {
  staked: number;
  returned: number;
  pl: number;
  open: number;
  settled: number;
};

/** Money in, money back, and what that nets. Null when nothing is recorded. */
export async function bankrollSummary(): Promise<BankrollSummary | null> {
  try {
    const sql = await getSql();
    const rows = await sql<{ stake: number; returned: number | null }>`
      select stake, returned from desk_ledger order by created_at desc limit 200
    `;
    if (!rows.length) return null;
    const settled = rows.filter((r) => r.returned != null);
    const staked = rows.reduce((s, r) => s + Number(r.stake || 0), 0);
    const returned = settled.reduce((s, r) => s + Number(r.returned || 0), 0);
    return {
      staked,
      returned,
      pl: returned - settled.reduce((s, r) => s + Number(r.stake || 0), 0),
      open: rows.length - settled.length,
      settled: settled.length,
    };
  } catch {
    return null;
  }
}

function naira(n: number) {
  return `\u20a6${Math.round(n).toLocaleString("en-NG")}`;
}

export async function formatBankroll(): Promise<string> {
  const summary = await bankrollSummary();
  if (!summary) return doc(head("bankroll"), "No stakes yet. Say: stake 2000");
  const rows: Array<[string, string]> = [
    ["staked", naira(summary.staked)],
    ["returned", naira(summary.returned)],
  ];
  if (summary.settled) rows.push(["P/L", naira(summary.pl)]);
  if (summary.open) rows.push(["open", String(summary.open)]);
  return doc(head("bankroll"), stats(rows));
}

export async function formatRecap(): Promise<string> {
  try {
    const sql = await getSql();
    const rows = await sql<{
      code: string;
      studied: number;
      hit: number | null;
      lost: number | null;
      won: number | null;
    }>`
      select code, studied, hit, lost, won
      from study_slips
      where created_at > now() - interval '7 days'
      order by created_at desc
      limit 20
    `;
    const money = await formatBankroll();
    if (!rows.length) return doc(head("recap"), "This week empty.", money);
    const finished = rows.filter((r) => r.studied);
    const hits = finished.filter((r) => r.hit === 1).length;
    const cuts = finished.filter((r) => r.hit === 0).length;
    const lines = rows.slice(0, 12).map((r, i) =>
      leg(i + 1, r.code, !r.studied ? "open" : r.hit === 1 ? "hit" : "cut"),
    );
    return cap(
      doc(
        head("recap", "last 7 days"),
        stats([
          ["hit", String(hits)],
          ["cut", String(cuts)],
          ["open", String(rows.length - finished.length)],
        ]),
        RULE,
        lines.join("\n"),
        money,
      ),
    );
  } catch {
    return doc(head("recap"), "No recap yet.");
  }
}

export async function formatBook(): Promise<string> {
  const book = await bookSummary(12);
  if (!book.rows.length) {
    return doc(head("book"), "Your book empty.", "Cook a slip or send a code first.");
  }
  const worst = await worstFamilies();
  const lines = book.rows.map((r, i) => {
    const score = r.won != null && r.lost != null ? `${r.won}-${r.lost}` : "";
    return leg(i + 1, r.code, r.status, undefined, score);
  });
  const cutNote = worst.length
    ? `Markets wey dey cut you: ${worst.map((w) => `${w.label} (${w.n})`).join(", ")}`
    : "";
  return cap(
    doc(
      head("book", "last 12"),
      stats([
        ["hit", String(book.hit)],
        ["cut", String(book.cut)],
        ["open", String(book.open)],
      ]),
      RULE,
      lines.join("\n"),
      cutNote ? tail(cutNote) : null,
      await formatBankroll(),
    ),
  );
}

/** The markets that have cut you most, for the warning under /book. */
async function worstFamilies(): Promise<Array<{ label: string; n: number }>> {
  const famLabel: Record<string, string> = {
    hcp: "handicap",
    ou1h: "1st half O/U",
    ou: "over/under",
    gg: "GG",
    dc: "double chance",
    dnb: "DNB",
    win: "winner",
  };
  try {
    const sql = await getSql();
    const rows = await sql<{ family: string; n: number }>`
      select family, count(*)::int as n from study_lessons
      where result = 'lost'
      group by family
      order by n desc
      limit 3
    `;
    return rows.map((r) => ({ label: famLabel[r.family] ?? r.family, n: r.n }));
  } catch {
    return [];
  }
}

type LessonRow = { result: string; family: string; league: string };

function boostFromLessons(pick: TicketPick, rows: LessonRow[]): number {
  if (!rows.length) return 0;
  const family = marketFamily(pick.sporty?.marketId, pick.market);
  const league = (pick.league ?? "").trim().toLowerCase();
  let famWon = 0;
  let famLost = 0;
  let lgWon = 0;
  let lgLost = 0;
  for (const row of rows) {
    if (row.result !== "won" && row.result !== "lost") continue;
    const won = row.result === "won" ? 1 : 0;
    const lost = row.result === "lost" ? 1 : 0;
    if (row.family === family) {
      famWon += won;
      famLost += lost;
    }
    if (league && row.league && league === row.league.trim().toLowerCase()) {
      lgWon += won;
      lgLost += lost;
    }
  }
  const total = Math.max(-18, Math.min(14, historyBias(famWon, famLost) + historyBias(lgWon, lgLost, { k: 14, scale: 22 })));
  return Math.round(total);
}

async function loadLessons(): Promise<LessonRow[]> {
  try {
    const sql = await getSql();
    return await sql<LessonRow>`
      select result, family, league from study_lessons order by created_at desc limit 120
    `;
  } catch {
    return [];
  }
}

export async function applyLessonScores<T extends TicketPick & { probability?: number }>(
  picks: T[],
): Promise<T[]> {
  const rows = await loadLessons();
  if (!rows.length) return picks;
  return picks.map((p) => ({
    ...p,
    probability: Math.max(4, Math.min(95, (p.probability ?? 50) + boostFromLessons(p, rows))),
  }));
}

// ---- calibration: does a "70% leg" really land 70% of the time? ----------

export function pickKey(pick: {
  home?: string;
  away?: string;
  selection?: string;
  market?: string;
}): string {
  return [pick.home, pick.away, pick.selection ?? "", pick.market ?? ""]
    .map((s) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim())
    .join("|");
}

/**
 * Store what the desk believed when it minted a slip.
 *
 * Without this the bot has no memory of its own confidence — it can say a leg
 * was 74% and never find out it lands 55% of the time. These rows are the
 * training set for `loadCalibration()`.
 */
export async function recordPredictions(
  code: string,
  picks: Array<
    TicketPick & {
      probability?: number;
      marketProb?: number | null;
      modelProb?: number | null;
    }
  >,
) {
  const rows = picks.filter((p) => Number.isFinite(Number(p.probability)));
  if (!rows.length) return;
  try {
    const sql = await getSql();
    for (const p of rows) {
      const finalP = Math.max(0.01, Math.min(0.99, Number(p.probability) / 100));
      await sql`
        insert into desk_predictions
          (code, pick_key, family, league, sport, odds, market_p, model_p, final_p)
        values (
          ${code},
          ${pickKey(p)},
          ${marketFamily(p.sporty?.marketId, p.market)},
          ${p.league ?? ""},
          ${p.sport},
          ${p.odds ?? null},
          ${p.marketProb == null ? null : p.marketProb / 100},
          ${p.modelProb == null ? null : p.modelProb / 100},
          ${finalP}
        )
        on conflict (code, pick_key) do update set
          final_p = excluded.final_p,
          market_p = excluded.market_p,
          model_p = excluded.model_p,
          odds = excluded.odds
      `;
    }
  } catch {
    /* db unavailable — the desk still works, it just does not learn */
  }
}

/** Mark stored predictions won/lost once a slip has been studied. */
async function settlePredictions(code: string, legs: StudiedLeg[]) {
  try {
    const sql = await getSql();
    for (const leg of legs) {
      if (leg.result === "pending") continue;
      const key = pickKey(leg);
      await sql`
        update desk_predictions set result = ${leg.result}
        where code = ${code} and pick_key = ${key} and result is null
      `;
    }
  } catch {
    /* ignore */
  }
}

type PredictionRow = { final_p: number; result: string | null; odds: number | null };

/**
 * Fit the desk's own calibration curve from settled predictions.
 *
 * Every probability the bot prints is passed through this scaler, so a desk
 * that has been over-confident automatically starts quoting tighter numbers.
 */
export async function loadCalibration(): Promise<Platt> {
  try {
    const sql = await getSql();
    const rows = await sql<PredictionRow>`
      select final_p, result, odds from desk_predictions
      where result is not null
      order by created_at desc
      limit 400
    `;
    const outcomes: Outcome[] = rows
      .filter((r) => r.result === "won" || r.result === "lost")
      .map((r) => ({ p: Number(r.final_p), won: r.result === "won" }));
    return fitPlatt(outcomes);
  } catch {
    return NEUTRAL_PLATT;
  }
}

export type CalibrationReport = {
  n: number;
  brier: number | null;
  bins: ReliabilityBin[];
  platt: Platt;
  verdict: string;
};

/** Human-readable calibration, for the /calibration command. */
export async function calibrationReport(): Promise<CalibrationReport> {
  const empty: CalibrationReport = {
    n: 0,
    brier: null,
    bins: [],
    platt: NEUTRAL_PLATT,
    verdict: "No settled legs yet. Study a few slips and I go show you how sharp I really be.",
  };
  try {
    const sql = await getSql();
    const rows = await sql<PredictionRow>`
      select final_p, result, odds from desk_predictions
      where result is not null
      order by created_at desc
      limit 400
    `;
    const outcomes: Outcome[] = rows
      .filter((r) => (r.result === "won" || r.result === "lost") && Number.isFinite(Number(r.final_p)))
      .map((r) => ({ p: Number(r.final_p), won: r.result === "won" }));
    if (outcomes.length < 10) {
      return {
        ...empty,
        n: outcomes.length,
        verdict: `${outcomes.length} settled legs so far. I need about 25 before I fit my own curve.`,
      };
    }
    const platt = fitPlatt(outcomes);
    const score = brier(outcomes);
    const bins = reliability(outcomes, 4);
    const optimistic = bins
      .filter((b) => b.n >= 5)
      .some((b) => b.meanP - b.hitRate > 0.12);
    const pessimistic = bins
      .filter((b) => b.n >= 5)
      .some((b) => b.hitRate - b.meanP > 0.12);
    const verdict = optimistic
      ? "I dey overconfident — I don pull my numbers back toward the market."
      : pessimistic
        ? "I dey too shy — I don let my numbers breathe small."
        : "Calibration dey hold. My numbers match how the legs dey land.";
    return { n: outcomes.length, brier: score, bins, platt, verdict };
  } catch {
    return empty;
  }
}

export function formatCalibration(report: CalibrationReport): string {
  if (!report.n) return doc(head("calibration"), report.verdict);
  const rows: Array<[string, string]> = [["legs", String(report.n)]];
  if (report.brier != null) rows.push(["brier", report.brier.toFixed(3)]);
  rows.push(["scale", `a=${report.platt.a.toFixed(2)} b=${report.platt.b.toFixed(2)}`]);
  const buckets = report.bins.length
    ? table(
        ["bucket", "said", "landed", "legs"],
        report.bins.map((b) => [
          `${Math.round(b.low * 100)}-${Math.round(b.high * 100)}%`,
          `${Math.round(b.meanP * 100)}%`,
          `${Math.round(b.hitRate * 100)}%`,
          String(b.n),
        ]),
      )
    : null;
  return cap(
    doc(
      head("calibration", `${report.n} settled legs`),
      stats(rows),
      tail("brier 0.25 = coin flip"),
      buckets,
      report.verdict,
    ),
  );
}

export async function improvePicks<T extends TicketPick>(picks: T[]): Promise<T[]> {
  const rows = await loadLessons();
  if (!rows.length) return picks;
  return picks
    .map((p) => ({ p, boost: boostFromLessons(p, rows) }))
    .filter((row) => row.boost > -22)
    .sort((a, b) => b.boost - a.boost)
    .map((row) => row.p);
}

export function formatStudy(report: StudyReport): string {
  const verdict = report.cut ? "cut" : report.hit ? "hit" : "still open";
  const lost = report.legs.filter((l) => l.result === "lost").slice(0, 10);
  const won = report.legs.filter((l) => l.result === "won").slice(0, 6);
  const rows: Array<[string, string]> = [
    ["won", String(report.won)],
    ["cut", String(report.lost)],
    ["open", String(report.pending)],
  ];
  if (report.voided) rows.push(["void", String(report.voided)]);
  const lostLines = lost.map(
    (l, i) =>
      `${leg(i + 1, `${l.home} v ${l.away}`, `${l.market} \u2014 ${l.selection}`, "\u00d7")}\n     ${esc(l.note)}`,
  );
  return cap(
    doc(
      head("settle", report.code, verdict),
      stats(rows),
      lostLines.length ? doc(RULE, subhead("cut am"), lostLines.join("\n")) : null,
      won.length
        ? doc(
            RULE,
            subhead("hit"),
            won
              .map((l) => `\u2013 ${esc(l.home)} v ${esc(l.away)} \u2014 ${esc(l.selection)}`)
              .join("\n"),
          )
        : null,
      RULE,
      tail(report.lesson),
    ),
  );
}
