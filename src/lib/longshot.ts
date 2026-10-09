import { rankDistinctSelections } from "./rank-selections";
import { buildSlip } from "./build-slip";
import { mintReviewedSlip } from "./book-slip";
import { listUpcomingPicks, type CookWindow } from "./sportybet";
import { getSetting, recordSlip, setSetting } from "./study";
import { buildToOdds, combinedOdds, uniqueEvents } from "./workbench";
import type { TicketPick } from "./types";

export type LongshotSport = "football" | "basketball";
export const LONGSHOT_LADDER = [25, 50, 100, 250] as const;
const LONGSHOT_MAX_LEGS = 15;
const LONGSHOT_POLICY_VERSION = "longshot-v2-on-demand-booking";

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
  picks: TicketPick[];
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
  if (typeof pick.odds !== "number") return false;
  if (sport === "football") return pick.odds >= 1.16 && pick.odds <= 1.7;
  return pick.odds >= 1.16 && pick.odds <= 2.75;
}

async function discoverLongshotPool(sport: LongshotSport): Promise<TicketPick[] | { error: string }> {
  const discover = async (window: CookWindow) => {
    // Match the normal Engine's discovery scale. Longshot should not multiply
    // provider calls just because its combined target is larger.
    const listed = await listUpcomingPicks(sport, 42, window, "any", []);
    if ("error" in listed) return [];
    return listed.filter((pick) => aggressivePriceAllowed(sport, pick));
  };

  let listed = await discover("today");
  if (uniqueEvents(listed).picks.length < LONGSHOT_MAX_LEGS) {
    const upcoming = await discover("upcoming");
    const seen = new Set(listed.map((pick) => pick.id));
    listed = [...listed, ...upcoming.filter((pick) => !seen.has(pick.id))];
  }

  if (!listed.length) {
    return { error: `No eligible ${sport} markets are available for Longshot right now.` };
  }

  const built = await buildSlip(
    {
      sport,
      mode: "games",
      games: LONGSHOT_MAX_LEGS,
      risk: "aggressive",
      window: "upcoming",
    },
    {
      discover: async () => listed,
      // Discovery already contains the exact live SportyBet selections. The
      // final code request refreshes bookability once, on demand.
      refresh: async (picks) => ({ available: picks, unavailable: [] }),
    },
  );

  if (!built.ok) return { error: built.error };

  const ranked = [...built.selections].sort(
    (a, b) =>
      Number(b.analysisBasis === "mathematical_projection") -
        Number(a.analysisBasis === "mathematical_projection") ||
      b.modelScore - a.modelScore ||
      (b.trackRecord.hitRate ?? -1) - (a.trackRecord.hitRate ?? -1) ||
      (a.odds ?? 99) - (b.odds ?? 99),
  );

  if (ranked.length < 4) {
    return { error: `Not enough distinct ${sport} selections qualified for a Longshot card.` };
  }
  return ranked;
}

function scoreSummary(picks: TicketPick[]) {
  const scored = picks
    .map((pick) => Number(pick.modelScore))
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
  const ranked = await discoverLongshotPool(sport);
  if ("error" in ranked) return ranked;

  const cards: StoredLongshotCard[] = [];
  const priorUses = new Map<string, number>();
  const signatures = new Set<string>();

  for (const targetOdds of LONGSHOT_LADDER) {
    const ordered = rankDistinctSelections(ranked, priorUses);
    const take = buildToOdds(ordered, targetOdds).slice(0, LONGSHOT_MAX_LEGS);
    if (take.length < 4) continue;

    const signature = take
      .map((pick) => pick.sporty?.eventId ?? pick.id)
      .sort()
      .join("|");
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
    return { error: "Longshot selections qualified, but no distinct target cards could be assembled." };
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
  if (Number.isFinite(lockAt) && Date.now() - lockAt < 90_000) {
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
    return { error: minted.error || "The analysed Longshot prices changed before booking. Refresh and try again." };
  }

  await recordSlip(minted.shareCode, entry.picks);
  entry.card.code = minted.shareCode;
  entry.card.url = minted.shareURL;
  await saveStored(day, sport, stored!);
  return entry.card;
}
