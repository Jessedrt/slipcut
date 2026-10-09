import { mintReviewedSlip } from "./book-slip";
import { listUpcomingPicks } from "./sportybet";
import { getSetting, recordSlip, setSetting } from "./study";
import { buildToOdds, combinedOdds } from "./workbench";
import type { TicketPick } from "./types";

export type LongshotSport = "football" | "basketball";
export const LONGSHOT_LADDER = [25, 50, 100, 250] as const;
const LONGSHOT_MAX_LEGS = 15;
const LONGSHOT_POLICY_VERSION = "longshot-v3-fast-price-model";

type RankedLongshotPick = TicketPick & {
  modelScore: number;
  probability: number;
};

export type LongshotLeg = {
  home: string;
  away: string;
  market: string;
  selection: string;
  odds?: number;
  sport: string;
};

export type LongshotCard = {
  id: string;
  targetOdds: number;
  targetReached: boolean;
  code?: string;
  url?: string;
  odds: number | null;
  games: number;
  averageScore: number | null;
  weakestScore: number | null;
  legs: LongshotLeg[];
};

type StoredLongshotCard = {
  card: LongshotCard;
  picks: RankedLongshotPick[];
};

type StoredLongshotDay = {
  cards: StoredLongshotCard[];
};

function watDay() {
  return new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
}

function cacheKey(day: string, sport: LongshotSport) {
  return `longshot_${LONGSHOT_POLICY_VERSION}_${sport}_${day}`;
}

function stableId(targetOdds: number, signature: string) {
  let hash = 2166136261;
  const input = `${targetOdds}|${signature}`;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${targetOdds}x-${(hash >>> 0).toString(36)}`;
}

function eventKey(pick: TicketPick) {
  return pick.sporty?.eventId ?? `${pick.sport}:${pick.home}:${pick.away}:${pick.kickoff ?? 0}`;
}

async function loadStored(
  day: string,
  sport: LongshotSport,
): Promise<StoredLongshotDay | null> {
  const raw = await getSetting(cacheKey(day, sport));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredLongshotDay;
    if (!parsed || !Array.isArray(parsed.cards)) return null;
    return {
      cards: parsed.cards.filter(
        (entry) =>
          Boolean(entry?.card?.id) &&
          Array.isArray(entry?.picks) &&
          entry.picks.length >= 4,
      ),
    };
  } catch {
    return null;
  }
}

async function saveStored(day: string, sport: LongshotSport, stored: StoredLongshotDay) {
  await setSetting(cacheKey(day, sport), JSON.stringify(stored));
}

function aggressivePriceAllowed(sport: LongshotSport, pick: TicketPick) {
  if (typeof pick.odds !== "number" || !Number.isFinite(pick.odds)) return false;
  if (sport === "football") return pick.odds >= 1.16 && pick.odds <= 1.7;
  return pick.odds >= 1.16 && pick.odds <= 2.75;
}

async function discoverLongshotPool(sport: LongshotSport): Promise<TicketPick[] | { error: string }> {
  // One SportyBet discovery pass only. The old Longshot path ran the full
  // analysis pipeline after hydrating dozens of fixtures and could exceed a
  // serverless request window. Longshot now ranks the live market catalogue
  // directly and refreshes exact selections only when the user asks for a code.
  const listed = await listUpcomingPicks(sport, LONGSHOT_MAX_LEGS, "upcoming", "any", []);
  if ("error" in listed) return { error: listed.error };

  const eligible = listed.filter((pick) => aggressivePriceAllowed(sport, pick));
  const eventCount = new Set(eligible.map(eventKey)).size;
  if (eventCount < 4) {
    return { error: `Not enough distinct ${sport} fixtures are available for a Longshot card.` };
  }
  return eligible;
}

function targetAwareEventPool(
  picks: TicketPick[],
  targetOdds: number,
  priorUses: ReadonlyMap<string, number>,
): RankedLongshotPick[] {
  const grouped = new Map<string, TicketPick[]>();
  for (const pick of picks) {
    const key = eventKey(pick);
    const list = grouped.get(key) ?? [];
    list.push(pick);
    grouped.set(key, list);
  }

  const eventCount = Math.min(LONGSHOT_MAX_LEGS, grouped.size);
  // This is the average per-leg price that would reach the target if every
  // available event were used. It is a target-shaping value, not a claim that
  // each leg has the same probability.
  const idealOdds = Math.max(1.16, Math.min(2.75, targetOdds ** (1 / eventCount)));
  const selected: RankedLongshotPick[] = [];

  for (const options of grouped.values()) {
    let best: RankedLongshotPick | null = null;
    let bestUtility = -Infinity;
    for (const pick of options) {
      const odds = pick.odds;
      if (typeof odds !== "number" || odds <= 1) continue;
      const impliedProbability = Math.min(0.94, Math.max(0.2, 1 / odds));
      const targetFit = Math.exp(-4 * Math.abs(Math.log(odds / idealOdds)));
      const reusePenalty = Math.min(0.12, (priorUses.get(pick.id) ?? 0) * 0.03);
      // Longshot's fast score intentionally uses only observable live-price
      // mathematics: bookmaker-implied probability plus how efficiently the
      // price helps reach this specific target. It does not invent historical
      // certainty when no per-selection evidence has been fetched.
      const utility = 0.74 * impliedProbability + 0.26 * targetFit - reusePenalty;
      const modelScore = Math.round(Math.max(0, Math.min(100, utility * 100)));
      const ranked: RankedLongshotPick = {
        ...pick,
        probability: impliedProbability,
        modelScore,
      };
      if (
        utility > bestUtility ||
        (Math.abs(utility - bestUtility) < 0.0001 && (ranked.odds ?? 99) < (best?.odds ?? 99))
      ) {
        best = ranked;
        bestUtility = utility;
      }
    }
    if (best) selected.push(best);
  }

  return selected.sort(
    (a, b) => b.modelScore - a.modelScore || (a.odds ?? 99) - (b.odds ?? 99),
  );
}

function scoreSummary(picks: RankedLongshotPick[]) {
  const scored = picks
    .map((pick) => pick.modelScore)
    .filter((score) => Number.isFinite(score) && score > 0);
  if (!scored.length) return { averageScore: null, weakestScore: null };
  return {
    averageScore: Math.round(scored.reduce((sum, score) => sum + score, 0) / scored.length),
    weakestScore: Math.round(Math.min(...scored)),
  };
}

export async function buildLongshotCards(
  sport: LongshotSport,
): Promise<StoredLongshotCard[] | { error: string }> {
  const discovered = await discoverLongshotPool(sport);
  if ("error" in discovered) return discovered;

  const cards: StoredLongshotCard[] = [];
  const priorUses = new Map<string, number>();
  const signatures = new Set<string>();

  for (const targetOdds of LONGSHOT_LADDER) {
    const pool = targetAwareEventPool(discovered, targetOdds, priorUses);
    const take = buildToOdds(pool, targetOdds).slice(0, LONGSHOT_MAX_LEGS) as RankedLongshotPick[];
    if (take.length < 4) continue;

    const signature = take.map((pick) => pick.id).sort().join("|");
    if (signatures.has(signature)) continue;

    signatures.add(signature);
    for (const pick of take) priorUses.set(pick.id, (priorUses.get(pick.id) ?? 0) + 1);

    const odds = combinedOdds(take);
    const targetReached =
      odds !== null && Math.abs(Math.log(odds / targetOdds)) <= Math.log(1.08);
    const scores = scoreSummary(take);

    cards.push({
      card: {
        id: stableId(targetOdds, signature),
        targetOdds,
        targetReached,
        odds,
        games: take.length,
        ...scores,
        legs: take.map((pick) => ({
          home: pick.home,
          away: pick.away,
          market: pick.market,
          selection: pick.selection,
          odds: pick.odds,
          sport: pick.sport,
        })),
      },
      picks: take,
    });
  }

  if (!cards.length) {
    return { error: "Longshot markets were found, but no distinct target cards could be assembled." };
  }
  return cards;
}

export async function todayLongshotCards(
  sport: LongshotSport,
): Promise<LongshotCard[] | { error: string }> {
  const day = watDay();
  const existing = await loadStored(day, sport);
  if (existing?.cards.length) return existing.cards.map((entry) => entry.card);

  const lockKey = `longshot_build_lock_${LONGSHOT_POLICY_VERSION}_${sport}_${day}`;
  const lockRaw = await getSetting(lockKey);
  const lockAt = Number(lockRaw);
  if (Number.isFinite(lockAt) && Date.now() - lockAt < 75_000) {
    return { error: "Longshot cards are being prepared. Refresh again in a moment." };
  }

  await setSetting(lockKey, String(Date.now()));
  try {
    const built = await buildLongshotCards(sport);
    if ("error" in built) return built;
    const stored = { cards: built } satisfies StoredLongshotDay;
    await saveStored(day, sport, stored);
    return stored.cards.map((entry) => entry.card);
  } finally {
    await setSetting(lockKey, "0");
  }
}

export async function mintLongshotCard(
  sport: LongshotSport,
  cardId: string,
): Promise<LongshotCard | { error: string }> {
  const day = watDay();
  let stored = await loadStored(day, sport);
  if (!stored?.cards.length) {
    const generated = await todayLongshotCards(sport);
    if ("error" in generated) return generated;
    stored = await loadStored(day, sport);
  }
  const entry = stored?.cards.find((item) => item.card.id === cardId);
  if (!entry) return { error: "That Longshot card is no longer available. Refresh the Longshot screen." };
  if (entry.card.code && entry.card.url) return entry.card;

  const minted = await mintReviewedSlip(entry.picks, "ng", undefined, { acceptOddsChanges: false });
  if (!minted.ok) {
    return {
      error:
        minted.error ||
        "The Longshot selections changed before booking. Refresh the card and try again.",
    };
  }

  await recordSlip(minted.shareCode, entry.picks);
  entry.card.code = minted.shareCode;
  entry.card.url = minted.shareURL;
  entry.card.odds = minted.combinedOdds;
  await saveStored(day, sport, stored!);
  return entry.card;
}
