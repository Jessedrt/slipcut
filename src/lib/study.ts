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
      pick.sport === "basketball"
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
        !r.studied ? "⏳ still dey" : r.hit === 1 ? "✅ HIT" : "📉 CUT";
      const score =
        r.studied && r.won != null && r.lost != null ? ` · ${r.won}-${r.lost}` : "";
      return `${i + 1}. ${r.code} · ${tag}${score}`;
    });
    const cutNote = worst.length
      ? `Markets wey dey cut you: ${worst.map((w) => `${famLabel[w.family] ?? w.family} (${w.n})`).join(", ")}`
      : "";
    return [
      "📓 Your book",
      `HIT ${hits} · CUT ${cuts} · still dey ${pending}  (last ${rows.length})`,
      "",
      ...lines,
      cutNote ? `\n${cutNote}` : "",
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
