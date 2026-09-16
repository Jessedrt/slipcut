import type { NormalizedMarket, Sport } from "../types/index.js";

/** Map SportyBet market id/desc → category. Explorer keeps ALL markets open. */
export function categorizeMarket(marketId: string, desc: string, sport: Sport): string {
  const d = `${marketId} ${desc}`.toLowerCase();
  if (sport === "basketball") {
    if (/moneyline|winner|match result|\b219\b|\b186\b/.test(d)) return "Moneyline";
    if (/spread|handicap|\b223\b|\b14\b|\b187\b/.test(d)) return "Point Spread";
    if (/total|over\/under|\b225\b|\b18\b|\b188\b|\b189\b/.test(d) && !/team/.test(d))
      return "Game Total";
    if (/1st half|first half|\b68\b|\b66\b/.test(d)) return "First Half";
    if (/2nd half|second half|\b62\b/.test(d)) return "Second Half";
    if (/quarter|q1|q2|q3|q4|1st quarter|2nd quarter/.test(d)) return "Quarter";
    if (/team total|\b227\b|\b228\b/.test(d)) return "Team Total";
    if (/odd\/even/.test(d)) return "Odd/Even";
    if (/winning margin|race to/.test(d)) return "Specials";
    return "Other";
  }
  // football — full board
  if (/\b1x2\b|match result|^1$|full time result|winner/.test(d) && !/half/.test(d))
    return "Match Result";
  if (/double chance|\b10\b/.test(d)) return "Double Chance";
  if (/draw no bet|\b11\b|\bdnb\b/.test(d)) return "Draw No Bet";
  if (/both teams|btts|gg\/ng|\b29\b/.test(d)) return "BTTS";
  if (/over\/under|total goals|\b18\b|\b225\b/.test(d) && !/corner|card|team|half/.test(d))
    return "Over/Under Goals";
  if (/asian handicap|\b16\b/.test(d)) return "Asian Handicap";
  if (/european handicap|\b14\b|\b223\b/.test(d)) return "European Handicap";
  if (/1st half|first half|\b68\b|\b63\b|\b64\b|\b66\b/.test(d)) return "First Half";
  if (/2nd half|second half|\b62\b/.test(d)) return "Second Half";
  if (/corner|\b166\b/.test(d)) return "Corners";
  if (/card|booking|yellow|red/.test(d)) return "Cards";
  if (/correct score|winning margin/.test(d)) return "Score Markets";
  if (/team total|\b227\b|\b228\b|\b69\b|\b70\b/.test(d)) return "Team Totals";
  if (/odd\/even|\b8\b/.test(d)) return "Odd/Even";
  if (/clean sheet|next goal|goal time|exact goals|multi goal/.test(d)) return "Specials";
  if (/half time|ht\/ft|result\/total/.test(d)) return "Combo";
  return "Other";
}

export function impliedProbability(odds: number): number {
  if (!odds || odds <= 1) return 0;
  return 1 / odds;
}

/** Priority families when building a cook pool (still includes all others). */
export const FOOTBALL_COOK_FAMILIES = [
  "Match Result",
  "Double Chance",
  "Draw No Bet",
  "BTTS",
  "Over/Under Goals",
  "Asian Handicap",
  "European Handicap",
  "First Half",
  "Second Half",
  "Corners",
  "Cards",
  "Team Totals",
  "Odd/Even",
  "Combo",
  "Specials",
  "Score Markets",
  "Other",
] as const;

export const BASKETBALL_COOK_FAMILIES = [
  "Moneyline",
  "Point Spread",
  "Game Total",
  "Team Total",
  "First Half",
  "Second Half",
  "Quarter",
  "Odd/Even",
  "Specials",
  "Other",
] as const;

export function rankMarkets(markets: NormalizedMarket[]): NormalizedMarket[] {
  return [...markets].sort((a, b) => scoreMarket(b) - scoreMarket(a));
}

function scoreMarket(m: NormalizedMarket): number {
  const imp = impliedProbability(m.odds);
  let s = imp;
  // Prefer usable mid-range prices for multi-leg slips
  if (m.odds >= 1.2 && m.odds <= 2.2) s += 0.06;
  if (m.odds > 2.2 && m.odds <= 3.5) s += 0.02;
  if (m.status !== "open") s -= 2;
  // Slight boost to high-liquidity families
  const cat = m.category;
  if (
    /Match Result|Double Chance|Draw No Bet|BTTS|Over\/Under Goals|Moneyline|Point Spread|Game Total/.test(
      cat,
    )
  ) {
    s += 0.04;
  }
  // Keep corners/cards/handicaps competitive so pool is not 1X2-only
  if (/Corners|Cards|Asian Handicap|European Handicap|Team Total|First Half/.test(cat)) {
    s += 0.03;
  }
  return s;
}

/**
 * Diversify cook candidates: take top N per category so the bot has
 * Match Result, Goals, BTTS, Handicap, Corners, Cards, etc. — not only 8 odds-ranked rows.
 */
export function diversifyForCook(
  markets: NormalizedMarket[],
  sport: Sport,
  opts?: { perCategory?: number; maxTotal?: number; marketPreference?: string },
): NormalizedMarket[] {
  const perCategory = opts?.perCategory ?? 3;
  const maxTotal = opts?.maxTotal ?? 24;
  let open = markets.filter((m) => m.status === "open" && m.odds > 1);

  const pref = (opts?.marketPreference || "").toLowerCase();
  if (pref) {
    open = filterByMarketPreference(open, pref);
  }

  const families =
    sport === "basketball" ? [...BASKETBALL_COOK_FAMILIES] : [...FOOTBALL_COOK_FAMILIES];

  const byCat = new Map<string, NormalizedMarket[]>();
  for (const m of open) {
    const list = byCat.get(m.category) || [];
    list.push(m);
    byCat.set(m.category, list);
  }
  for (const [k, list] of byCat) {
    byCat.set(k, rankMarkets(list));
  }

  const picked: NormalizedMarket[] = [];
  const seen = new Set<string>();
  const key = (m: NormalizedMarket) => `${m.providerMarketId}:${m.providerSelectionId}`;

  // Round-robin across families so every market type gets slots
  for (let n = 0; n < perCategory; n++) {
    for (const fam of families) {
      const list = byCat.get(fam) || [];
      const m = list[n];
      if (!m) continue;
      const k = key(m);
      if (seen.has(k)) continue;
      seen.add(k);
      picked.push(m);
      if (picked.length >= maxTotal) return picked;
    }
  }

  // Fill remainder with best remaining
  for (const m of rankMarkets(open)) {
    const k = key(m);
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push(m);
    if (picked.length >= maxTotal) break;
  }
  return picked;
}

export function filterByMarketPreference(
  markets: NormalizedMarket[],
  pref: string,
): NormalizedMarket[] {
  const p = pref.toLowerCase();
  if (/goal|over\/under|o\/u|totals?/.test(p) && !/team/.test(p)) {
    return markets.filter((m) =>
      /Over\/Under|Game Total|BTTS|Team Totals/.test(m.category),
    );
  }
  if (/btts|both teams|gg/.test(p)) {
    return markets.filter((m) => /BTTS/.test(m.category));
  }
  if (/handicap|spread|ah|eh/.test(p)) {
    return markets.filter((m) => /Handicap|Point Spread/.test(m.category));
  }
  if (/corner/.test(p)) return markets.filter((m) => /Corners/.test(m.category));
  if (/card|booking/.test(p)) return markets.filter((m) => /Cards/.test(m.category));
  if (/1x2|match result|moneyline|winner/.test(p)) {
    return markets.filter((m) => /Match Result|Moneyline|Double Chance|Draw No Bet/.test(m.category));
  }
  if (/first half|1h|1st half/.test(p)) {
    return markets.filter((m) => /First Half/.test(m.category));
  }
  if (/quarter/.test(p)) return markets.filter((m) => /Quarter/.test(m.category));
  if (/team total/.test(p)) return markets.filter((m) => /Team Total/.test(m.category));
  // No match → keep all
  return markets;
}

export const FOOTBALL_CATEGORY_BUTTONS = [
  "Match Result",
  "Goals",
  "BTTS",
  "Handicap",
  "First Half",
  "Corners",
  "Cards",
  "Team Markets",
  "More",
] as const;

export const BASKETBALL_CATEGORY_BUTTONS = [
  "Moneyline",
  "Point Spread",
  "Game Total",
  "Team Total",
  "First Half",
  "Quarter",
  "More",
] as const;
