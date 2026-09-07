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
import type { TicketPick } from "./types";

/** Five cards, short to long. A longer card is a longer shot. */
export const ENGINE_LADDER = [2, 3, 5, 8, 12] as const;

export type EngineCard = {
  n: number;
  code: string;
  url: string;
  odds: number | null;
  games: number;
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

async function poolForEngine(): Promise<TicketPick[] | { error: string }> {
  const skip = await loadRecentEventIds();
  const listed = await listUpcomingPicks("football", 42, "today" as CookWindow, "any", skip);
  if ("error" in listed) return listed;
  const acc = await loadAccuracy();
  const gated = accuracyFilter(listed.filter(cookablePick), acc);
  if (!gated.kept.length) return { error: "No football market passed the accuracy gate right now." };
  const band = await loadOddsBand();
  const pool = applyBand(gated.kept, band);
  const researched = await researchPicks(pool, 24);
  return uniqueEvents(researched.keep).picks;
}

export async function buildEngineCards(): Promise<EngineCard[] | { error: string }> {
  const ranked = await poolForEngine();
  if ("error" in ranked) return ranked;
  const cards: EngineCard[] = [];
  const used = new Set<string>();
  for (const n of ENGINE_LADDER) {
    const take = ranked.filter((p) => !used.has(p.sporty?.eventId ?? p.id)).slice(0, n);
    if (take.length < Math.min(2, n)) continue;
    const selections = sportyOf(take);
    if (!selections.length) continue;
    const minted = await mintShare(selections, "ng");
    if ("error" in minted) continue;
    for (const p of take) used.add(p.sporty?.eventId ?? p.id);
    await recordSlip(minted.shareCode, take);
    await rememberEventIds(take.map((p) => p.sporty?.eventId).filter((id): id is string => Boolean(id)));
    cards.push({
      n,
      code: minted.shareCode,
      url: minted.shareURL,
      odds: combinedOdds(take),
      games: take.length,
    });
  }
  if (!cards.length) return { error: "Engine could not mint cards from today's pool." };
  return cards;
}

export async function todayEngineCards(): Promise<EngineCard[] | { error: string }> {
  const day = watDay();
  const existing = await loadEngineDay(day);
  if (existing?.length) return existing;
  await gradeEngineDay(watDay(-1));
  const built = await buildEngineCards();
  if ("error" in built) return built;
  await saveEngineDay(day, built);
  return built;
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
