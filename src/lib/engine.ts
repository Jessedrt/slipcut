import { rankDistinctSelections } from "./rank-selections";
import { buildSlip } from "./build-slip";
import { mintReviewedSlip } from "./book-slip";
import { automaticMarketAllowed, canonicalMarket, riskOddsAllowed } from "./selection-policy";
import { accuracyFilter, loadAccuracy } from "./accuracy";
import { listUpcomingPicks, sportyOf, type CookWindow } from "./sportybet";
import { getSetting, listChats, recordSlip, setSetting, studyCode } from "./study";
import { buildToOdds, combinedOdds, formatOdds, uniqueEvents } from "./workbench";
import type { BookSport, TicketPick } from "./types";

/** Independent target-odds cards, from short to long. */
export const ENGINE_LADDER = [2, 3, 5, 10, 20, 50] as const;
const ENGINE_MAX_LEGS = 15;
const ENGINE_POLICY_VERSION = "odds-target-ladder-v7";

export type EngineMarketKind = "first_half_over" | "second_half_over" | "quarter_over" | "team_over" | "full_time_over" | "btts" | "draw" | "home_or_away" | "corners" | "cards" | "supported_single";

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
  targetOdds: number;
  targetReached: boolean;
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

export type EngineSport = "football" | "basketball";
type EngineScope = EngineSport | "all";

function keyFor(day: string, sport: EngineScope = "all") {
  // Sport-specific caches let the Mini App switch between pure football and
  // pure basketball ladders without reusing mixed cards.
  return `engine_${ENGINE_POLICY_VERSION}_${sport}_${day}`;
}

async function loadEngineRecentEventIds(sport: EngineScope): Promise<string[]> {
  const raw = await getSetting(`engine_recent_events_${ENGINE_POLICY_VERSION}_${sport}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string" && value.length > 3)
      : [];
  } catch {
    return [];
  }
}

async function rememberEngineEventIds(sport: EngineScope, ids: string[]) {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return;
  const previous = await loadEngineRecentEventIds(sport);
  const next = [...clean, ...previous.filter((id) => !clean.includes(id))].slice(0, 140);
  await setSetting(`engine_recent_events_${ENGINE_POLICY_VERSION}_${sport}`, JSON.stringify(next));
}

export async function loadEngineDay(
  day = watDay(),
  sport: EngineScope = "all",
): Promise<EngineCard[] | null> {
  const raw = await getSetting(keyFor(day, sport));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((c): c is EngineCard => c && typeof c.code === "string");
  } catch {
    return null;
  }
}

async function saveEngineDay(day: string, cards: EngineCard[], sport: EngineScope = "all") {
  await setSetting(keyFor(day, sport), JSON.stringify(cards));
}

export async function gradeEngineDay(
  day: string,
  sport: EngineScope = "all",
): Promise<EngineCard[] | null> {
  const cards = await loadEngineDay(day, sport);
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
  if (dirty) await saveEngineDay(day, cards, sport);
  return cards;
}

export function engineMarketKind(pick: TicketPick): EngineMarketKind | null {
  if (!automaticMarketAllowed(pick)) return null;
  const c = canonicalMarket(pick);
  if (c.family === "team_total") return "team_over";
  if (c.family === "total") {
    if (c.period === "first_half") return "first_half_over";
    if (c.period === "second_half") return "second_half_over";
    if (c.period.startsWith("q")) return "quarter_over";
    return "full_time_over";
  }
  if (c.family === "btts" || c.family === "corners" || c.family === "cards") return c.family;
  if (c.family === "winner" && c.outcome === "draw") return "draw";
  if (c.family === "double_chance" && c.outcome === "12") return "home_or_away";
  return "supported_single";
}

export function enginePriceAllowed(pick: TicketPick): boolean {
  return automaticMarketAllowed(pick) && riskOddsAllowed(pick.odds, "conservative");
}

export function selectDiversifiedEngineCard(ranked: TicketPick[], n: number, priorUses: ReadonlyMap<string, number> = new Map()): TicketPick[] {
  // Input has already been evidence-ranked: preserve merit, not artificial variety.
  return rankDistinctSelections(ranked.filter((p) => automaticMarketAllowed(p)), priorUses).slice(
    0,
    Math.max(0, n),
  );
}

async function discoverEngineMarkets(
  window: CookWindow,
  skip: string[],
  sport: EngineScope,
): Promise<TicketPick[]> {
  const sports: BookSport[] = sport === "all" ? ["football", "basketball"] : [sport];
  const batches = await Promise.all(
    sports.map((item) => listUpcomingPicks(item, 42, window, "any", skip)),
  );
  return batches.flatMap((batch) => ("error" in batch ? [] : batch));
}

async function poolForEngine(
  sport: EngineScope = "all",
): Promise<TicketPick[] | { error: string }> {
  const skip = await loadEngineRecentEventIds(sport);
  let listed = await discoverEngineMarkets("today" as CookWindow, skip, sport);

  // A 50x Conservative target normally needs roughly 12-15 distinct events.
  // If today is thin, widen to upcoming instead of leaving the engine empty.
  if (uniqueEvents(listed).picks.length < ENGINE_MAX_LEGS) {
    const upcoming = await discoverEngineMarkets("upcoming" as CookWindow, skip, sport);
    const seen = new Set(listed.map((pick) => pick.id));
    listed = [...listed, ...upcoming.filter((pick) => !seen.has(pick.id))];
  }

  if (!listed.length) {
    return {
      error:
        sport === "all"
          ? "No eligible football or basketball events are available right now."
          : `No eligible ${sport} events are available right now.`,
    };
  }

  const results = await Promise.all(
    (sport === "all" ? (["football", "basketball"] as const) : [sport]).map(async (item) => {
      const built = await buildSlip(
        { sport: item, mode: "games", games: ENGINE_MAX_LEGS, risk: "conservative", window: "upcoming" },
        {
          discover: async () => listed.filter((p) => p.sport === item),
          // listUpcomingPicks already hydrated these exact live SportyBet markets.
          // Avoid downloading every fixture a second time just to re-read the
          // same prices. mintReviewedSlip still performs the final bookability
          // check immediately before a card is created.
          refresh: async (picks) => ({ available: picks, unavailable: [] }),
        },
      );
      return built;
    }),
  );
  const ranked = results
    .flatMap((r) =>
      r.ok ? r.selections.filter((p) => p.analysisBasis === "mathematical_projection") : [],
    )
    .sort((a, b) => b.modelScore - a.modelScore);
  const failures = results.flatMap((r) => (r.ok ? [] : [r.error]));
  if (ranked.length < 2) {
    return {
      error: failures.length
        ? [...new Set(failures)].join(" ")
        : "Insufficient evidence-qualified Conservative selections for engine cards.",
    };
  }

  // Settled accuracy remains the first ranking gate, but it is no longer an
  // all-or-nothing blocker. Proven-above-bar families lead the pool; other
  // evidence-qualified mathematical selections may fill longer target cards.
  // This prevents a 63% rolling bar from reducing an otherwise valid day to a
  // single 2-leg card, while still preferring the engine's best track record.
  const gated = accuracyFilter(ranked, await loadAccuracy());
  const preferredIds = new Set(gated.kept.map((pick) => pick.id));
  const ordered = [
    ...gated.kept,
    ...ranked.filter((pick) => !preferredIds.has(pick.id)),
  ];
  return ordered;
}

export async function buildEngineCards(
  sport: EngineScope = "all",
): Promise<EngineCard[] | { error: string }> {
  const ranked = await poolForEngine(sport);
  if ("error" in ranked) return ranked;
  const cards: EngineCard[] = [];
  const priorUses = new Map<string, number>();
  const seenCards = new Set<string>();

  for (const targetOdds of ENGINE_LADDER) {
    // Each target is an independent product. Strong selections may appear on
    // several cards, but prior-use ranking encourages variety when strength is
    // comparable. buildToOdds finds the nearest subset instead of treating the
    // ladder numbers as leg counts.
    const ordered = selectDiversifiedEngineCard(ranked, ranked.length, priorUses);
    const take = buildToOdds(ordered, targetOdds);
    if (take.length < 2) continue;

    const signature = take
      .map((pick) => pick.sporty?.eventId ?? pick.id)
      .sort()
      .join("|");
    if (seenCards.has(signature)) continue;

    const selections = sportyOf(take);
    if (selections.length !== take.length) continue;
    const minted = await mintReviewedSlip(take, "ng", undefined, { acceptOddsChanges: false });
    if (!minted.ok) continue;
    await recordSlip(minted.shareCode, take);
    seenCards.add(signature);
    for (const pick of take) priorUses.set(pick.id, (priorUses.get(pick.id) ?? 0) + 1);
    await rememberEngineEventIds(
      sport,
      take.map((p) => p.sporty?.eventId).filter((id): id is string => Boolean(id)),
    );

    const odds = combinedOdds(take);
    const targetReached =
      odds !== null && Math.abs(Math.log(odds / targetOdds)) <= Math.log(1.05);
    cards.push({
      n: take.length,
      targetOdds,
      targetReached,
      code: minted.shareCode,
      url: minted.shareURL,
      odds,
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
  if (!cards.length) {
    return {
      error:
        "Qualified engine selections could not be booked at their analysed prices.",
    };
  }
  return cards;
}

export async function todayEngineCards(
  sport: EngineScope = "all",
): Promise<EngineCard[] | { error: string }> {
  const day = watDay();
  const existing = await loadEngineDay(day, sport);
  if (existing?.length) return existing;

  const lockKey = `engine_build_lock_${sport}_${day}`;
  const lockRaw = await getSetting(lockKey);
  const lockAt = Number(lockRaw);
  if (Number.isFinite(lockAt) && Date.now() - lockAt < 2 * 60_000) {
    return { error: "Engine cards are being prepared. Refresh again in a moment." };
  }

  await setSetting(lockKey, String(Date.now()));
  try {
    await gradeEngineDay(watDay(-1), sport);
    const built = await buildEngineCards(sport);
    if ("error" in built) return built;
    await saveEngineDay(day, built, sport);
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
    "The engine builds separate 2×, 3×, 5×, 10×, 20× and 50× target cards from evidence-qualified Conservative selections.",
    "Settled hit rate prioritises stronger market families first; other mathematically qualified selections can fill longer cards when needed.",
    "Cards use 1.20–1.40 per leg. Each fixture appears once inside a card; strong selections may repeat across different target cards.",
    "",
    `Settled hit rate: <b>${rate}</b> · ${accSample} legs.`,
    "Nothing here is advice — higher target odds remain longer shots.",
  ].join("\n");
}

export function formatEngineCard(card: EngineCard, i: number) {
  const odds = card.odds ? ` · actual ${formatOdds(card.odds)}` : "";
  const target = ` · target ${formatOdds(card.targetOdds)}`;
  const grade = card.graded ? (card.hit ? " · hit" : " · missed") : "";
  return `Card ${i + 1} · ${card.games} games${target}${odds}${grade}`;
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
