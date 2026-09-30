import type { TicketPick } from "./types";

export type SelectionRisk = "conservative" | "balanced" | "aggressive";
export const SELECTION_POLICIES = {
  conservative: {
    label: "Conservative",
    minOdds: 1.2,
    maxOdds: 1.4,
    minModelScore: 50,
    minSample: 1,
    minHitRate: 0.5,
    maxVariation: 0.25,
    explanation:
      "1.20–1.40 per selection; minimum analysis score 50 and low variance. History sample size contributes to the score instead of acting as a hard gate.",
  },
  balanced: {
    label: "Balanced",
    minOdds: 1.4,
    maxOdds: 1.8,
    minModelScore: 45,
    minSample: 1,
    minHitRate: 0.45,
    maxVariation: 0.45,
    explanation:
      "1.40–1.80 per selection; minimum analysis score 45, allowing moderate variance. History sample size contributes to the score instead of acting as a hard gate.",
  },
  aggressive: {
    label: "Aggressive",
    minOdds: 1.16,
    maxOdds: 2.75,
    minModelScore: 45,
    minSample: 8,
    minHitRate: 0.45,
    maxVariation: 0.6,
    explanation: "Wider prices with historical evidence still required.",
  },
} as const;
export function riskOddsAllowed(odds: unknown, risk: SelectionRisk) {
  const p = SELECTION_POLICIES[risk];
  return (
    typeof odds === "number" && Number.isFinite(odds) && odds >= p.minOdds && odds <= p.maxOdds
  );
}
export type CanonicalMarket = {
  family:
    | "total"
    | "team_total"
    | "corners"
    | "cards"
    | "btts"
    | "winner"
    | "double_chance"
    | "draw_no_bet"
    | "handicap"
    | "other";
  period: "match" | "first_half" | "second_half" | "q1" | "q2" | "q3" | "q4" | "unknown";
  scope: "match" | "home" | "away" | "unknown";
  outcome: string;
  line?: number;
  single: boolean;
};
const text = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[–—_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** Recompute from native labels, never trust client supplied normalizedMarket. */
export function canonicalMarket(pick: TicketPick): CanonicalMarket {
  const m = text(pick.market ?? "");
  const s = text(pick.selection ?? "");
  const spec = pick.sporty?.specifier ?? "";
  const id = pick.sporty?.marketId;
  const all = `${m} ${s}`;
  const namedHome = Boolean(pick.home && ` ${m} `.includes(` ${text(pick.home)} `));
  const namedAway = Boolean(pick.away && ` ${m} `.includes(` ${text(pick.away)} `));
  let outcome = s;
  if (/\bunder\b|^u\s*\d/.test(s)) outcome = "under";
  else if (/\bover\b|^o\s*\d/.test(s) || /\bo\d/.test(m)) outcome = "over";
  else if (/^(1x|home or draw|home draw)$/.test(s)) outcome = "1x";
  else if (/^(x2|draw or away|draw away)$/.test(s)) outcome = "x2";
  else if (/^(12|home or away|home away)$/.test(s)) outcome = "12";
  else if (/^(1|home|home win|home team|straight home win)$/.test(s)) outcome = "home";
  else if (/^(2|away|away win|away team|straight away win)$/.test(s)) outcome = "away";
  else if (/^(x|draw|tie)$/.test(s)) outcome = "draw";
  else if (/^(yes|gg|btts yes)$/.test(s)) outcome = "yes";
  else if (/^(no|ng|btts no)$/.test(s)) outcome = "no";
  let family: CanonicalMarket["family"] = "other";
  if (/draw no bet|\bdnb\b/.test(all) || id === "11") family = "draw_no_bet";
  else if (
    /double chance|\bdc\b/.test(m) ||
    ["10", "63"].includes(id ?? "") ||
    ["1x", "x2", "12"].includes(outcome)
  )
    family = "double_chance";
  else if (/handicap|spread|\bhcp\b/.test(m) || ["16", "14", "223", "66"].includes(id ?? ""))
    family = "handicap";
  else if (/corner/.test(m)) family = "corners";
  else if (/card|booking/.test(m)) family = "cards";
  else if (/both teams.*score|btts|gg\s*\/\s*ng/.test(m) || ["29", "64"].includes(id ?? ""))
    family = "btts";
  else if (
    /team total|individual total|(?:home|away).*total|(?:home|away).*goals.*(?:over|total)/.test(
      m,
    ) ||
    ["23", "24", "227", "228", "69", "70"].includes(id ?? "") ||
    (namedHome !== namedAway && /over|under|total|o\s*\/\s*u/.test(m))
  )
    family = "team_total";
  else if (
    /over|under|o\s*\/\s*u|total|goals?\s+o\d/.test(m) ||
    ["18", "225", "68", "62", "90", "236"].includes(id ?? "")
  )
    family = "total";
  else if (
    /winner|moneyline|1x2|match result|to win|straight.*win/.test(m) ||
    ["1", "219", "60"].includes(id ?? "")
  )
    family = "winner";
  let period: CanonicalMarket["period"] = "match";
  const quarter =
    spec.match(/(?:quarternr|quarter)=([1-4])/i)?.[1] ??
    m.match(/\bq([1-4])\b/)?.[1] ??
    m.match(/\b([1-4])(?:st|nd|rd|th)?\s*quarter/)?.[1] ??
    (m.includes("first quarter")
      ? "1"
      : m.includes("second quarter")
        ? "2"
        : m.includes("third quarter")
          ? "3"
          : m.includes("fourth quarter")
            ? "4"
            : undefined);
  if (quarter) period = `q${quarter}` as CanonicalMarket["period"];
  else if (/quarter/.test(m) || id === "236") period = "unknown";
  else if (
    /halfnr=2|halfnumber=2/.test(spec) ||
    /\b(2h|2nd half|second half)\b/.test(m) ||
    ["62", "90"].includes(id ?? "")
  )
    period = "second_half";
  else if (
    /halfnr=1|halfnumber=1/.test(spec) ||
    /\b(1h|1st half|first half|half time)\b/.test(m) ||
    ["68", "69", "70", "63", "64"].includes(id ?? "")
  )
    period = "first_half";
  else if (/half/.test(m)) period = "unknown";
  // Arbitrary minute intervals are not match/half scopes. Final-score sources
  // cannot establish their result, even when the label says "Total Goals".
  if (/\bminutes?\b|\bmins?\b/.test(m) ||
      /\b\d+\s*[-–]\s*\d+\b/.test(pick.market) ||
      /(?:^|;)(?:from|to|startminute|endminute)=/i.test(spec)) period = "unknown";
  let scope: CanonicalMarket["scope"] = "match";
  if (/\bhome\b/.test(m) || ["23", "227", "69"].includes(id ?? "")) scope = "home";
  else if (/\baway\b/.test(m) || ["24", "228", "70"].includes(id ?? "")) scope = "away";
  else if (family === "team_total") {
    if (namedHome && !namedAway) scope = "home";
    else if (namedAway && !namedHome) scope = "away";
    else scope = "unknown";
  }
  else if (["corners", "cards"].includes(family) && namedHome !== namedAway)
    scope = namedHome ? "home" : "away";
  const raw =
    spec.match(/(?:^|;)total=([+-]?\d+(?:\.\d+)?)/i)?.[1] ??
    s.match(/(?:over|under|^[ou])\s*([+-]?\d+(?:\.\d+)?)/)?.[1] ??
    m.match(/(?:total|over|under|o\/u|o)\s*([+-]?\d+(?:\.\d+)?)/)?.[1];
  const line = raw === undefined ? undefined : Number(raw);
  return {
    family,
    period,
    scope,
    outcome,
    ...(Number.isFinite(line) ? { line } : {}),
    single: !/\band\b|&|\+|combo|combination|bet builder|\/.*(?:winner|btts)/.test(all),
  };
}
export function automaticMarketAllowed(pick: TicketPick) {
  const c = canonicalMarket(pick);
  const displayedLine = text(pick.selection).match(
    /(?:over|under|^[ou])\s*([+-]?\d+(?:\.\d+)?)/,
  )?.[1];
  if (displayedLine !== undefined && c.line !== undefined && Number(displayedLine) !== c.line)
    return false;
  if (!c.single || c.period === "unknown" || c.scope === "unknown" || c.outcome === "under")
    return false;
  if (pick.sport === "basketball")
    return (
      ["total", "team_total"].includes(c.family) &&
      c.outcome === "over" &&
      c.line !== undefined &&
      c.line >= 0 &&
      !/player|rebound|assist|steal|block|three.pointer|race to|winning margin/.test(
        text(pick.market),
      )
    );
  if (pick.sport !== "football") return false;
  // Block aliases even if the provider calls them an unknown family.
  if (
    /\bunder\b|^u\s*\d|\b(?:1x|x2)\b|^(1|2)$|home\s*(?:or\s*)?draw|draw\s*(?:or\s*)?away|home.*dnb|away.*dnb|dnb.*(?:home|away)|draw no bet.*(?:home|away)|(?:home|away).*draw no bet|^(?:home|away)(?: win)?$/.test(
      text(pick.selection),
    )
  )
    return false;
  if (c.family === "draw_no_bet") return false;
  if (c.family === "winner" && ["home", "away"].includes(c.outcome)) return false;
  if (c.family === "double_chance" && ["1x", "x2"].includes(c.outcome)) return false;
  // Discovery is broad. Unsupported single markets are discarded by the evidence evaluator.
  return true;
}
