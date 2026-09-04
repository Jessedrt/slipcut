import { getSql } from "./db";
import { eventScore, getEventDetail, marketFamily } from "./sportybet";
import type { TicketPick } from "./types";

export type LegResult = "won" | "lost" | "void" | "pending";

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

type StoredPick = {
  home: string;
  away: string;
  market: string;
  selection: string;
  league: string;
  sport: string;
  eventId?: string;
  family: string;
  kickoff?: number;
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

function lineFromMarket(market: string, selection: string): number | null {
  const fromSel = selection.match(/(\d+(?:\.\d+)?)/);
  if (fromSel) return Number(fromSel[1]);
  const fromMkt = market.match(/(\d+(?:\.\d+)?)/);
  return fromMkt ? Number(fromMkt[1]) : null;
}

function settleFootball(pick: StoredPick, home: number, away: number, finished: boolean): { result: LegResult; note: string } {
  const total = home + away;
  const sel = pick.selection.toLowerCase();
  const fam = pick.family;
  const line = lineFromMarket(pick.market, pick.selection);

  if (fam === "ou" && line != null) {
    const over = !sel.includes("under");
    if (over) {
      if (total > line) return { result: "won", note: `${home}-${away} over ${line}` };
      if (finished) return { result: "lost", note: `${home}-${away} died under ${line}` };
      return { result: "pending", note: `${home}-${away} still under ${line}` };
    }
    if (total > line) return { result: "lost", note: `${home}-${away} busted under ${line}` };
    if (finished) return { result: "won", note: `${home}-${away} held under ${line}` };
    return { result: "pending", note: `${home}-${away} still under ${line}` };
  }

  if (fam === "gg") {
    const yes = !/^no\b/.test(sel) && !sel.includes("ng");
    const both = home > 0 && away > 0;
    if (yes) {
      if (both) return { result: "won", note: `${home}-${away} both scored` };
      if (finished) return { result: "lost", note: `${home}-${away} no GG` };
      return { result: "pending", note: `${home}-${away} waiting on GG` };
    }
    if (both) return { result: "lost", note: `${home}-${away} both scored` };
    if (finished) return { result: "won", note: `${home}-${away} NG` };
    return { result: "pending", note: `${home}-${away} NG so far` };
  }

  if (!finished) return { result: "pending", note: `${home}-${away} still in play` };

  const homeWin = home > away;
  const awayWin = away > home;
  const draw = home === away;

  if (fam === "dc") {
    if (sel.includes("home") && sel.includes("away")) {
      return homeWin || awayWin
        ? { result: "won", note: `${home}-${away} 12` }
        : { result: "lost", note: `${home}-${away} draw killed 12` };
    }
    if (sel.includes("home") && sel.includes("draw")) {
      return homeWin || draw
        ? { result: "won", note: `${home}-${away} 1X` }
        : { result: "lost", note: `${home}-${away} away win` };
    }
    if (sel.includes("draw") && sel.includes("away")) {
      return awayWin || draw
        ? { result: "won", note: `${home}-${away} X2` }
        : { result: "lost", note: `${home}-${away} home win` };
    }
  }

  if (fam === "dnb") {
    if (draw) return { result: "void", note: `${home}-${away} DNB void` };
    if (sel.includes("away")) {
      return awayWin ? { result: "won", note: `${home}-${away} away DNB` } : { result: "lost", note: `${home}-${away} home won` };
    }
    return homeWin ? { result: "won", note: `${home}-${away} home DNB` } : { result: "lost", note: `${home}-${away} away won` };
  }

  if (sel.includes("draw")) {
    return draw ? { result: "won", note: `${home}-${away} draw` } : { result: "lost", note: `${home}-${away} no draw` };
  }
  if (sel.includes("away")) {
    return awayWin ? { result: "won", note: `${home}-${away} away` } : { result: "lost", note: `${home}-${away} away lost` };
  }
  if (sel.includes("home")) {
    return homeWin ? { result: "won", note: `${home}-${away} home` } : { result: "lost", note: `${home}-${away} home lost` };
  }
  return { result: "pending", note: `${home}-${away} could not map market` };
}

function settleBasket(pick: StoredPick, home: number, away: number, finished: boolean): { result: LegResult; note: string } {
  const total = home + away;
  const sel = pick.selection.toLowerCase();
  const fam = pick.family;
  const line = lineFromMarket(pick.market, pick.selection);
  if (fam === "ou" && line != null) {
    const over = !sel.includes("under");
    if (!finished && ((over && total <= line) || (!over && total <= line))) {
      return { result: "pending", note: `${home}-${away} live total ${total}` };
    }
    if (over) {
      return total > line
        ? { result: "won", note: `${home}-${away} over ${line}` }
        : finished
          ? { result: "lost", note: `${home}-${away} under ${line}` }
          : { result: "pending", note: `${home}-${away} live` };
    }
    return total < line
      ? finished
        ? { result: "won", note: `${home}-${away} under ${line}` }
        : { result: "pending", note: `${home}-${away} live` }
      : { result: "lost", note: `${home}-${away} over ${line}` };
  }
  if (!finished) return { result: "pending", note: `${home}-${away} live` };
  if (sel.includes("away")) {
    return away > home ? { result: "won", note: `${home}-${away} away` } : { result: "lost", note: `${home}-${away} away lost` };
  }
  return home > away ? { result: "won", note: `${home}-${away} home` } : { result: "lost", note: `${home}-${away} home lost` };
}

function settleTennis(
  pick: StoredPick,
  home: number,
  away: number,
  finished: boolean,
  setScore?: string,
): { result: LegResult; note: string } {
  const parts = [...String(setScore ?? "").matchAll(/(\d+)\s*[:\-]\s*(\d+)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
  let setsH = home;
  let setsA = away;
  let gamesH = 0;
  let gamesA = 0;
  if (parts.length >= 2) {
    setsH = 0;
    setsA = 0;
    for (const [h, a] of parts) {
      gamesH += h;
      gamesA += a;
      if (h > a) setsH += 1;
      else if (a > h) setsA += 1;
    }
  }
  const fam = pick.family;
  const sel = pick.selection.toLowerCase();
  const line = lineFromMarket(pick.market, pick.selection);
  if (fam === "ou" && line != null && gamesH + gamesA > 0) {
    const total = gamesH + gamesA;
    const over = !sel.includes("under");
    if (over) {
      if (total > line) return { result: "won", note: `${total} games over ${line}` };
      if (finished) return { result: "lost", note: `${total} games under ${line}` };
      return { result: "pending", note: `${total} games so far` };
    }
    if (total > line) return { result: "lost", note: `${total} games busted under ${line}` };
    if (finished) return { result: "won", note: `${total} games under ${line}` };
    return { result: "pending", note: `${total} games so far` };
  }
  if (!finished) return { result: "pending", note: `${setsH}-${setsA} still on court` };
  if (sel.includes("away")) {
    return setsA > setsH
      ? { result: "won", note: `${setsH}-${setsA} away` }
      : { result: "lost", note: `${setsH}-${setsA} away lost` };
  }
  return setsH > setsA
    ? { result: "won", note: `${setsH}-${setsA} home` }
    : { result: "lost", note: `${setsH}-${setsA} home lost` };
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

export async function formatBankroll(): Promise<string> {
  try {
    const sql = await getSql();
    const rows = await sql<{ stake: number; combo: number | null; returned: number | null }>`
      select stake, combo, returned from desk_ledger order by created_at desc limit 40
    `;
    if (!rows.length) return "No stakes yet. Say: stake 2000";
    const inAmt = rows.reduce((s, r) => s + Number(r.stake || 0), 0);
    const settled = rows.filter((r) => r.returned != null);
    const outAmt = settled.reduce((s, r) => s + Number(r.returned || 0), 0);
    const open = rows.length - settled.length;
    const pl = outAmt - settled.reduce((s, r) => s + Number(r.stake || 0), 0);
    const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
    return [
      `Staked ${naira(inAmt)}`,
      `Returned ${naira(outAmt)}`,
      settled.length ? `P/L ${naira(pl)} on settled` : "Nothing settled yet",
      open ? `${open} still open` : "",
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    return "Bankroll empty.";
  }
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
    if (!rows.length) return `This week empty.\n\n${money}`;
    const finished = rows.filter((r) => r.studied);
    const hits = finished.filter((r) => r.hit === 1).length;
    const cuts = finished.filter((r) => r.hit === 0).length;
    const lines = rows.slice(0, 10).map((r) => {
      const tag = !r.studied ? "open" : r.hit === 1 ? "HIT" : "CUT";
      return `${r.code}  ·  ${tag}`;
    });
    return ["This week", `HIT ${hits}  ·  CUT ${cuts}  ·  ${rows.length - finished.length} open`, "", ...lines, "", money].join("\n");
  } catch {
    return "No recap yet.";
  }
}

export async function formatBook(): Promise<string> {
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
      order by created_at desc
      limit 12
    `;
    if (!rows.length) return "Your book empty. Cook or load a code first.";
    const finished = rows.filter((r) => r.studied);
    const hits = finished.filter((r) => r.hit === 1).length;
    const cuts = finished.filter((r) => r.hit === 0).length;
    const pending = rows.length - finished.length;
    const worst = await sql<{ family: string; n: number }>`
      select family, count(*)::int as n from study_lessons
      where result = 'lost'
      group by family
      order by n desc
      limit 3
    `;
    const famLabel: Record<string, string> = {
      hcp: "handicap",
      ou1h: "1st half O/U",
      ou: "over/under",
      gg: "GG",
      dc: "double chance",
      dnb: "DNB",
      win: "winner",
    };
    const lines = rows.map((r, i) => {
      const tag =
        !r.studied ? "open" : r.hit === 1 ? "HIT" : "CUT";
      const score =
        r.studied && r.won != null && r.lost != null ? ` · ${r.won}-${r.lost}` : "";
      return `${i + 1}. ${r.code} · ${tag}${score}`;
    });
    const cutNote = worst.length
      ? `Markets wey dey cut you: ${worst.map((w) => `${famLabel[w.family] ?? w.family} (${w.n})`).join(", ")}`
      : "";
    const money = await formatBankroll();
    return [
      "Your book",
      `HIT ${hits} · CUT ${cuts} · still dey ${pending}`,
      "",
      ...lines,
      cutNote ? `\n${cutNote}` : "",
      "",
      money,
    ]
      .filter((l, i, arr) => l !== "" || arr[i - 1] !== "")
      .join("\n");
  } catch {
    return "I no fit open the book now. Try study a code first.";
  }
}

type LessonRow = { result: string; family: string; league: string };

function boostFromLessons(pick: TicketPick, rows: LessonRow[]): number {
  if (!rows.length) return 0;
  const family = marketFamily(pick.sporty?.marketId, pick.market);
  const league = (pick.league ?? "").toLowerCase();
  let n = 0;
  for (const row of rows) {
    const lost = row.result === "lost";
    const won = row.result === "won";
    if (row.family === family) n += won ? 4 : lost ? -8 : 0;
    if (league && row.league && league === row.league.toLowerCase()) n += won ? 2 : lost ? -6 : 0;
  }
  return Math.max(-30, Math.min(20, n));
}

async function loadLessons(): Promise<LessonRow[]> {
  try {
    const sql = await getSql();
    return await sql<LessonRow>`
      select result, family, league from study_lessons order by created_at desc limit 80
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
  const head = report.cut
    ? `📉 ${report.code} CUT — e no hit`
    : report.hit
      ? `✅ ${report.code} HIT — we good`
      : `⏳ ${report.code} still dey play`;
  const lostLines = report.legs
    .filter((l) => l.result === "lost")
    .slice(0, 12)
    .map((l, i) => `${i + 1}. ❌ ${l.home} vs ${l.away}\n   ${l.market} — ${l.selection}\n   ${l.note}`);
  const wonLines = report.legs
    .filter((l) => l.result === "won")
    .slice(0, 6)
    .map((l) => `✅ ${l.home} vs ${l.away} — ${l.selection}`);
  return [
    head,
    `Win ${report.won} · Cut ${report.lost} · Still dey ${report.pending}${report.voided ? ` · Void ${report.voided}` : ""}`,
    "",
    lostLines.length ? "The ones wey cut:" : "",
    ...lostLines,
    wonLines.length ? "\nThe ones wey hit:" : "",
    ...wonLines,
    "",
    `📓 ${report.lesson}`,
  ]
    .filter((line, i, arr) => line !== "" || arr[i - 1] !== "")
    .join("\n")
    .slice(0, 3900);
}
