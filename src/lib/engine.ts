import { accuracyFilter, loadAccuracy } from "./accuracy";
import { researchPicks } from "./research";
import {
  cookablePick,
  listUpcomingPicks,
  mintShare,
  sportyOf,
  type CookWindow,
} from "./sportybet";
import { getSetting, listChats, loadOddsBand, loadRecentEventIds, recordSlip, rememberEventIds, setSetting, studyCode } from "./study";
import { combinedOdds, formatOdds, uniqueEvents } from "./workbench";
import { applyBand } from "./intent";
import type { BookSport, TicketPick } from "./types";

/** Five cards, short to long. A longer card is a longer shot. */
export const ENGINE_LADDER = [2, 3, 5, 8, 12] as const;

export type EngineLeg = {
  home: string;
  away: string;
  market: string;
  selection: string;
  odds?: number;
  sport: string;
};

export type EngineCard = {
  n: number;
  code: string;
  url: string;
  odds: number | null;
  games: number;
  legs?: EngineLeg[];
  hit?: boolean;
  graded?: boolean;
};

function watDay(offset = 0) {
  const d = new Date(Date.now() + 3_600_000 + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function keyFor(day: string) {
  return `engine_${day}`;
}

export async function loadEngineDay(day = watDay()): Promise<EngineCard[] | null> {
  const raw = await getSetting(keyFor(day));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((c): c is EngineCard => c && typeof c.code === "string");
  } catch {
    return null;
  }
}

async function saveEngineDay(day: string, cards: EngineCard[]) {
  await setSetting(keyFor(day), JSON.stringify(cards));
}

export async function gradeEngineDay(day: string): Promise<EngineCard[] | null> {
  const cards = await loadEngineDay(day);
  if (!cards?.length) return null;
  let dirty = false;
  for (const card of cards) {
    if (card.graded) continue;
    const report = await studyCode(card.code);
    if ("error" in report || report.pending > 0) continue;
    card.graded = true;
    card.hit = report.hit;
    dirty = true;
  }
  if (dirty) await saveEngineDay(day, cards);
  return cards;
}

async function discoverEngineMarkets(
  window: CookWindow,
  skip: string[],
): Promise<TicketPick[]> {
  const sports: BookSport[] = ["football", "basketball"];
  const batches = await Promise.all(
    sports.map((sport) => listUpcomingPicks(sport, 42, window, "any", skip)),
  );
  return batches.flatMap((batch) => ("error" in batch ? [] : batch));
}

async function poolForEngine(): Promise<TicketPick[] | { error: string }> {
  const skip = await loadRecentEventIds();
  let listed = await discoverEngineMarkets("today" as CookWindow, skip);

  // A five-card ladder only needs twelve distinct events when cards may share
  // strong selections. If today is thin, widen to upcoming instead of leaving
  // the entire engine empty.
  if (uniqueEvents(listed).picks.length < ENGINE_LADDER[ENGINE_LADDER.length - 1]) {
    const upcoming = await discoverEngineMarkets("upcoming" as CookWindow, skip);
    const seen = new Set(listed.map((pick) => pick.id));
    listed = [...listed, ...upcoming.filter((pick) => !seen.has(pick.id))];
  }

  if (!listed.length) {
    return { error: "No eligible football or basketball events are available right now." };
  }

  const acc = await loadAccuracy();
  const gated = accuracyFilter(listed.filter(cookablePick), acc);
  if (!gated.kept.length) {
    return { error: "No market passed the engine accuracy gate right now." };
  }

  const band = await loadOddsBand();
  const pool = applyBand(gated.kept, band);
  const researched = await researchPicks(pool, 24);
  const ranked = uniqueEvents(researched.keep).picks;
  if (ranked.length < 2) {
    return { error: "The engine did not find enough reviewed events to issue a card." };
  }
  return ranked;
}

export async function buildEngineCards(): Promise<EngineCard[] | { error: string }> {
  const ranked = await poolForEngine();
  if ("error" in ranked) return ranked;
  const cards: EngineCard[] = [];
  for (const n of ENGINE_LADDER) {
    // Cards are separate products, so a strong event may appear on more than
    // one ladder card. Requiring disjoint cards needed 30 unique events and was
    // the main reason the daily engine often issued nothing.
    const take = ranked.slice(0, n);
    if (take.length < n) continue;
    const selections = sportyOf(take);
    if (selections.length !== take.length) continue;
    const minted = await mintShare(selections, "ng");
    if ("error" in minted) continue;
    await recordSlip(minted.shareCode, take);
    await rememberEventIds(take.map((p) => p.sporty?.eventId).filter((id): id is string => Boolean(id)));
    cards.push({
      n,
      code: minted.shareCode,
      url: minted.shareURL,
      odds: combinedOdds(take),
      games: take.length,
      legs: take.map((pick) => ({
        home: pick.home,
        away: pick.away,
        market: pick.market,
        selection: pick.selection,
        odds: pick.odds,
        sport: pick.sport,
      })),
    });
  }
  if (!cards.length) return { error: "Engine could not mint cards from today's pool." };
  return cards;
}

export async function todayEngineCards(): Promise<EngineCard[] | { error: string }> {
  const day = watDay();
  const existing = await loadEngineDay(day);
  if (existing?.length) return existing;

  const lockKey = `engine_build_lock_${day}`;
  const lockRaw = await getSetting(lockKey);
  const lockAt = Number(lockRaw);
  if (Number.isFinite(lockAt) && Date.now() - lockAt < 2 * 60_000) {
    return { error: "Engine cards are being prepared. Refresh again in a moment." };
  }

  await setSetting(lockKey, String(Date.now()));
  try {
    await gradeEngineDay(watDay(-1));
    const built = await buildEngineCards();
    if ("error" in built) return built;
    await saveEngineDay(day, built);
    return built;
  } finally {
    await setSetting(lockKey, "0");
  }
}

export function engineIntro(accSample: number, average: number) {
  const rate = accSample > 0 ? `${Math.round(average * 100)}%` : "still learning";
  return [
    "<b>Engine Accumulators</b>",
    "",
    "The engine builds these itself. It may only use sports and prediction types whose settled record beats its own average hit rate.",
    "Draws and straight home wins do not make the cut. Double chance and the goal lines usually do.",
    "",
    `Five cards go out daily. Settled hit rate: <b>${rate}</b> · ${accSample} legs.`,
    "Nothing here is advice — a longer card is a longer shot.",
  ].join("\n");
}

export function formatEngineCard(card: EngineCard, i: number) {
  const odds = card.odds ? ` · ${formatOdds(card.odds)}` : "";
  const grade = card.graded ? (card.hit ? " · hit" : " · missed") : "";
  return `Card ${i + 1} · ${card.games} games${odds}${grade}`;
}

export async function sendEngineToChats(
  send: (chatId: number, html: string, extra?: Record<string, unknown>) => Promise<unknown>,
  chats?: string[],
) {
  const cards = await todayEngineCards();
  const ids = chats ?? (await listChats());
  if ("error" in cards) {
    for (const id of ids) {
      const chatId = Number(id);
      if (!Number.isFinite(chatId)) continue;
      await send(chatId, cards.error);
    }
    return { sent: 0, error: cards.error };
  }
  const acc = await loadAccuracy();
  const intro = engineIntro(acc.sampleCount, acc.average);
  let sent = 0;
  for (const id of ids) {
    const chatId = Number(id);
    if (!Number.isFinite(chatId)) continue;
    await send(chatId, intro, { parse_mode: "HTML" });
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i]!;
      await send(chatId, `<code>${card.code}</code>\n${formatEngineCard(card, i)}`, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Copy", copy_text: { text: card.code } },
              { text: "Open", url: card.url },
              { text: "Study", callback_data: `y:${card.code}` },
            ],
          ],
        },
      });
    }
    sent += 1;
  }
  return { sent, cards: cards.length };
}
