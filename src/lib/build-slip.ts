import { deskScore, researchPicks } from "./research";
import {
  cookablePick,
  listUpcomingPicks,
  marketFamily,
  type CookWindow,
  type DiscoveryDiagnostics,
  type ProviderErrorCode,
  type SportyFailure,
} from "./sportybet";
import { buildToOdds, combinedOdds, uniqueEvents } from "./workbench";
import type { AnalyzedPick, BookSport, TicketPick } from "./types";

export type BuildSport = Extract<BookSport, "football" | "basketball">;
export type BuildMode = "games" | "odds";
export type BuildRisk = "conservative" | "balanced" | "aggressive";
export type BuildWindow = Extract<CookWindow, "today" | "tomorrow" | "weekend" | "upcoming">;

export type BuildSlipRequest = {
  sport: BuildSport;
  mode: BuildMode;
  games?: number;
  targetOdds?: number;
  risk: BuildRisk;
  window: BuildWindow;
};

export type RiskPolicy = {
  label: string;
  minModelScore: number;
  minOdds: number;
  maxOdds: number;
  explanation: string;
};

export type BuildSelection = TicketPick & {
  modelScore: number;
  confidenceLabel: "higher evidence" | "moderate evidence" | "limited evidence";
  summary: string;
  reasons: string[];
  risks: string[];
};

export type AnalysisDiagnostics = {
  discovered: number;
  eligibleBeforeScoring: number;
  researched: number;
  researchFallbackUsed: boolean;
  rejected: {
    wrongSport: number;
    notCookable: number;
    outsideRiskOdds: number;
    marketFamily: number;
    belowScore: number;
    duplicateEvents: number;
  };
  selected: number;
};

export type BuildSlipSuccess = {
  ok: true;
  requested: BuildSlipRequest;
  policy: RiskPolicy;
  actualCombinedOdds: number | null;
  targetReached: boolean | null;
  requestedGames: number | null;
  actualGames: number;
  selections: BuildSelection[];
  diagnostics?: DiscoveryDiagnostics;
  analysis: AnalysisDiagnostics;
  notice?: string;
};

export type BuildSlipFailure = {
  ok: false;
  code: ProviderErrorCode | "invalid_request";
  error: string;
  retryable?: boolean;
  diagnostics?: DiscoveryDiagnostics;
  analysis?: AnalysisDiagnostics;
};

export type BuildSlipResult = BuildSlipSuccess | BuildSlipFailure;
export type BuildRequestValidation =
  | { ok: true; value: BuildSlipRequest }
  | BuildSlipFailure;

export const RISK_POLICIES: Record<BuildRisk, RiskPolicy> = {
  conservative: {
    label: "Conservative",
    minModelScore: 62,
    minOdds: 1.16,
    maxOdds: 1.82,
    explanation:
      "Prioritises shorter eligible prices, stronger deterministic scores and lower-variance market families. It is not a safety guarantee.",
  },
  balanced: {
    label: "Balanced",
    minModelScore: 54,
    minOdds: 1.16,
    maxOdds: 2.2,
    explanation:
      "Allows a wider price and market range while retaining SlipCut's league, kickoff and market filters.",
  },
  aggressive: {
    label: "Aggressive",
    minModelScore: 45,
    minOdds: 1.16,
    maxOdds: 2.75,
    explanation:
      "Accepts wider prices and more volatile eligible markets. It raises variance and does not imply a higher chance of winning.",
  },
};

export type BuildDependencies = {
  discover: typeof listUpcomingPicks;
  research: typeof researchPicks;
};

const defaultDependencies: BuildDependencies = {
  discover: listUpcomingPicks,
  research: researchPicks,
};

function isFailure(value: TicketPick[] | SportyFailure): value is SportyFailure {
  return !Array.isArray(value);
}

export function validateBuildRequest(input: unknown): BuildRequestValidation {
  if (!input || typeof input !== "object") {
    return { ok: false, code: "invalid_request", error: "Build settings are required." };
  }
  const value = input as Record<string, unknown>;
  if (value.sport !== "football" && value.sport !== "basketball") {
    return { ok: false, code: "invalid_request", error: "Choose football or basketball." };
  }
  if (value.mode !== "games" && value.mode !== "odds") {
    return { ok: false, code: "invalid_request", error: "Choose a game count or target odds." };
  }
  if (!Object.hasOwn(RISK_POLICIES, String(value.risk))) {
    return { ok: false, code: "invalid_request", error: "Choose a valid risk mode." };
  }
  if (!["today", "tomorrow", "weekend", "upcoming"].includes(String(value.window))) {
    return { ok: false, code: "invalid_request", error: "Choose a valid fixture window." };
  }

  const base: Pick<BuildSlipRequest, "sport" | "risk" | "window"> = {
    sport: value.sport as BuildSport,
    risk: value.risk as BuildRisk,
    window: value.window as BuildWindow,
  };
  if (value.mode === "games") {
    const games = Number(value.games);
    if (!Number.isInteger(games) || games < 2 || games > 15) {
      return { ok: false, code: "invalid_request", error: "Choose between 2 and 15 games." };
    }
    return { ok: true, value: { ...base, mode: "games", games } };
  }
  const targetOdds = Number(value.targetOdds);
  if (!Number.isFinite(targetOdds) || targetOdds < 1.5 || targetOdds > 50) {
    return { ok: false, code: "invalid_request", error: "Target odds must be between 1.50 and 50.00." };
  }
  return { ok: true, value: { ...base, mode: "odds", targetOdds } };
}

function allowedFamily(pick: TicketPick, risk: BuildRisk) {
  const family = marketFamily(pick.sporty?.marketId, pick.market);
  if (risk === "aggressive") return family !== "odd";
  if (pick.sport === "football") {
    const conservative = new Set(["dc", "dnb", "ou", "ou1h", "teamou", "corners"]);
    const balanced = new Set([...conservative, "gg"]);
    return (risk === "conservative" ? conservative : balanced).has(family);
  }
  const conservative = new Set(["win", "ou", "teamou"]);
  const balanced = new Set([...conservative, "hcp"]);
  return (risk === "conservative" ? conservative : balanced).has(family);
}

function scoreLabel(score: number): BuildSelection["confidenceLabel"] {
  if (score >= 70) return "higher evidence";
  if (score >= 56) return "moderate evidence";
  return "limited evidence";
}

function explainSelection(pick: TicketPick, score: number, policy: RiskPolicy): BuildSelection {
  const family = marketFamily(pick.sporty?.marketId, pick.market);
  const reasons = [
    `Passed the ${policy.label.toLowerCase()} score and odds rules.`,
    `${pick.league || "The competition"} passed SlipCut's competition filter.`,
    `${family.toUpperCase()} was the highest-ranked eligible family for this event.`,
  ];
  const risks = [
    "Odds and market availability can change before the code is created.",
    family === "hcp" || family === "gg" || family === "corners"
      ? "This market can be more volatile than a short double-chance or total line."
      : "A qualifying model score is not a calibrated win probability or guarantee.",
  ];
  return {
    ...pick,
    modelScore: score,
    confidenceLabel: scoreLabel(score),
    summary: `${pick.selection} in ${pick.home} vs ${pick.away} ranked within the selected ${policy.label.toLowerCase()} rules.`,
    reasons,
    risks,
  };
}

function researchWithin<T>(promise: Promise<T>, ms: number): Promise<{ value: T | null; fallback: boolean }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ value: null, fallback: true }), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ value, fallback: false });
      },
      () => {
        clearTimeout(timer);
        resolve({ value: null, fallback: true });
      },
    );
  });
}

export async function buildSlip(
  input: BuildSlipRequest,
  dependencies: BuildDependencies = defaultDependencies,
): Promise<BuildSlipResult> {
  const validated = validateBuildRequest(input);
  if (!validated.ok) return validated;
  const request = validated.value;
  const policy = RISK_POLICIES[request.risk];
  const requestedCount = request.mode === "games" ? request.games ?? 5 : 15;
  const discoveryLimit = Math.min(42, Math.max(20, requestedCount * 3));
  const discovered = await dependencies.discover(
    request.sport,
    discoveryLimit,
    request.window,
  );
  if (isFailure(discovered)) return { ok: false, ...discovered };

  const analysis: AnalysisDiagnostics = {
    discovered: discovered.length,
    eligibleBeforeScoring: 0,
    researched: 0,
    researchFallbackUsed: false,
    rejected: {
      wrongSport: 0,
      notCookable: 0,
      outsideRiskOdds: 0,
      marketFamily: 0,
      belowScore: 0,
      duplicateEvents: 0,
    },
    selected: 0,
  };
  const eligible = discovered.filter((pick) => {
    const odds = pick.odds ?? 0;
    if (pick.sport !== request.sport) {
      analysis.rejected.wrongSport += 1;
      return false;
    }
    if (!cookablePick(pick)) {
      analysis.rejected.notCookable += 1;
      return false;
    }
    if (odds < policy.minOdds || odds > policy.maxOdds) {
      analysis.rejected.outsideRiskOdds += 1;
      return false;
    }
    if (!allowedFamily(pick, request.risk)) {
      analysis.rejected.marketFamily += 1;
      return false;
    }
    return true;
  });
  analysis.eligibleBeforeScoring = eligible.length;
  if (!eligible.length) {
    console.info("[slipcut.analysis]", JSON.stringify({ sport: request.sport, risk: request.risk, ...analysis, code: "no_eligible_markets" }));
    return {
      ok: false,
      code: "no_eligible_markets",
      error: `No open ${request.sport} markets matched the ${policy.label.toLowerCase()} rules.`,
      analysis,
    };
  }

  const researchResult = await researchWithin(
    dependencies.research(eligible, Math.min(30, Math.max(requestedCount * 2, 12))),
    32_000,
  );
  const research = researchResult.value;
  analysis.researchFallbackUsed = researchResult.fallback;
  analysis.researched = research?.keep.length ?? 0;
  const researchedById = new Map((research?.keep ?? []).map((pick) => [pick.id, pick]));
  const scored = eligible
    .map((pick) => {
      const researched = researchedById.get(pick.id);
      const score = Math.round(researched?.probability ?? deskScore(pick));
      return explainSelection({ ...pick, ...researched }, score, policy);
    })
  const ranked = scored
    .filter((pick) => {
      if (pick.modelScore >= policy.minModelScore) return true;
      analysis.rejected.belowScore += 1;
      return false;
    })
    .sort((a, b) => b.modelScore - a.modelScore || (a.odds ?? 99) - (b.odds ?? 99));
  const deduped = uniqueEvents(ranked).picks;
  analysis.rejected.duplicateEvents = ranked.length - deduped.length;
  if (!deduped.length) {
    console.info("[slipcut.analysis]", JSON.stringify({ sport: request.sport, risk: request.risk, ...analysis, code: "no_eligible_markets" }));
    return {
      ok: false,
      code: "no_eligible_markets",
      error: `Markets were available, but none passed the ${policy.label.toLowerCase()} analysis rules.`,
      analysis,
    };
  }

  const selections =
    request.mode === "games"
      ? deduped.slice(0, request.games)
      : buildToOdds(deduped, request.targetOdds ?? 2).slice(0, 15);
  const actualCombinedOdds = combinedOdds(selections);
  const targetReached =
    request.mode === "odds" && actualCombinedOdds !== null
      ? actualCombinedOdds >= (request.targetOdds ?? 2)
      : null;
  const short =
    request.mode === "games"
      ? selections.length < (request.games ?? 0)
      : targetReached === false;
  const notice = short
    ? request.mode === "games"
      ? `${request.games} games were requested, but only ${selections.length} passed the analysis rules.`
      : `The eligible selections reached ${actualCombinedOdds?.toFixed(2) ?? "unknown"} odds, below the requested ${(request.targetOdds ?? 0).toFixed(2)}. No unsupported leg was added.`
    : undefined;
  analysis.selected = selections.length;
  console.info("[slipcut.analysis]", JSON.stringify({ sport: request.sport, risk: request.risk, ...analysis }));

  return {
    ok: true,
    requested: request,
    policy,
    actualCombinedOdds,
    targetReached,
    requestedGames: request.mode === "games" ? request.games ?? null : null,
    actualGames: selections.length,
    selections,
    analysis,
    notice,
  };
}

export function asAnalyzedPick(selection: BuildSelection): AnalyzedPick {
  return {
    ...selection,
    probability: selection.modelScore,
    confidence:
      selection.confidenceLabel === "higher evidence"
        ? "high"
        : selection.confidenceLabel === "limited evidence"
          ? "low"
          : "medium",
    verdict: "keep",
  };
}
