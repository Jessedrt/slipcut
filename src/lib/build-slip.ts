import { AIAnalysisError, reviewBuildMarkets } from "./build-ai";
import { deskScore } from "./research";
import { evaluateRecord, loadRecord, type RecordSnapshot, type RecordSummary } from "./track-record";
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
import type { BookSport, TicketPick } from "./types";

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
  trackRecord: RecordSummary;
  modelScore: number;
  confidenceLabel: "higher ranking" | "moderate ranking" | "lower ranking";
  analysisBasis: "ai_assisted_unverified";
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
    notReviewedByAI: number;
    belowHistoricalAverage: number;
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
export type BuildRequestValidation = { ok: true; value: BuildSlipRequest } | BuildSlipFailure;

export const RISK_POLICIES: Record<BuildRisk, RiskPolicy> = {
  conservative: {
    label: "Conservative",
    minModelScore: 62,
    minOdds: 1.16,
    maxOdds: 1.82,
    explanation:
      "Prioritises shorter eligible prices, stronger AI-reviewed rankings and lower-variance market families. It is not a safety guarantee.",
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
  review: typeof reviewBuildMarkets;
  record?: () => Promise<RecordSnapshot>;
  analysisTimeoutMs?: number;
};

const defaultDependencies: BuildDependencies = {
  discover: listUpcomingPicks,
  review: reviewBuildMarkets,
  record: loadRecord,
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
    return {
      ok: false,
      code: "invalid_request",
      error: "Target odds must be between 1.50 and 50.00.",
    };
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
  if (score >= 70) return "higher ranking";
  if (score >= 56) return "moderate ranking";
  return "lower ranking";
}

function explainSelection(
  pick: TicketPick,
  score: number,
  policy: RiskPolicy,
  review: { summary: string; reasons: string[]; risks: string[] },
  trackRecord: RecordSummary,
): BuildSelection {
  const family = marketFamily(pick.sporty?.marketId, pick.market);
  const reasons = [
    `Current SportyBet price ${pick.odds?.toFixed(2) ?? "unknown"} is inside the ${policy.label.toLowerCase()} range (${policy.minOdds.toFixed(2)}–${policy.maxOdds.toFixed(2)}).`,
    `${pick.league || "Competition"} and ${family.toUpperCase()} passed the configured filters.`,
    ...review.reasons,
    ...(trackRecord.status === "qualified"
      ? [`This market family has ${trackRecord.settled} settled recommendations above the comparable sport/odds-band average.`]
      : []),
  ];
  const risks = [
    "No match-specific form, injury or lineup facts were independently verified for this pick.",
    "Odds and market availability can change before the code is created.",
    ...review.risks,
    ...(trackRecord.status === "qualified" ? ["Past hit rates do not predict this game's result or establish value at today's price."] : []),
    family === "hcp" || family === "gg" || family === "corners"
      ? "This market can be more volatile than a short double-chance or total line."
      : "A qualifying model score is not a calibrated win probability or guarantee.",
  ];
  return {
    ...pick,
    modelScore: score,
    trackRecord,
    confidenceLabel: scoreLabel(score),
    analysisBasis: "ai_assisted_unverified",
    summary: review.summary,
    reasons,
    risks,
  };
}

function reviewWithin<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ value: T | null; timedOut: boolean; failed: boolean; error?: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ value: null, timedOut: true, failed: false }), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ value, timedOut: false, failed: false });
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (!(error instanceof AIAnalysisError))
          console.error(
            "[slipcut.ai] analysis failed:",
            error instanceof Error ? error.name : "unknown",
          );
        resolve({
          value: null,
          timedOut: false,
          failed: true,
          error: error instanceof AIAnalysisError ? error.message : undefined,
        });
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
  const requestedCount = request.mode === "games" ? (request.games ?? 5) : 15;
  const discoveryLimit = Math.min(42, Math.max(20, requestedCount * 3));
  const discovered = await dependencies.discover(request.sport, discoveryLimit, request.window);
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
      notReviewedByAI: 0,
      belowHistoricalAverage: 0,
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
    console.info(
      "[slipcut.analysis]",
      JSON.stringify({
        sport: request.sport,
        risk: request.risk,
        ...analysis,
        code: "no_eligible_markets",
      }),
    );
    return {
      ok: false,
      code: "no_eligible_markets",
      error: `No open ${request.sport} markets matched the ${policy.label.toLowerCase()} rules.`,
      analysis,
    };
  }

  // Never mistake missing history/storage for positive evidence. Established
  // underperforming groups are excluded; thin records remain labelled as such.
  const record = await (dependencies.record ?? loadRecord)();
  const historical = eligible.filter((pick) => {
    if (evaluateRecord(pick, record).status !== "below_average") return true;
    analysis.rejected.belowHistoricalAverage++;
    return false;
  });
  if (!historical.length) return {
    ok: false,
    code: "no_eligible_markets",
    error: "No markets passed the settled track-record filter for comparable odds.",
    analysis,
  };

  // Rules constrain the options; they do not pick the final market. The AI
  // compares up to three different eligible options for each game it reviews.
  const byEvent = new Map<string, TicketPick[]>();
  for (const pick of historical) {
    const key = pick.sporty?.eventId ?? `${pick.home}|${pick.away}|${pick.kickoff ?? ""}`;
    const options = byEvent.get(key) ?? [];
    options.push(pick);
    byEvent.set(key, options);
  }
  const maxGamesToReview = Math.min(24, Math.max(12, requestedCount + 8));
  const candidatePool = [...byEvent.values()]
    .sort((a, b) => Math.max(...b.map(deskScore)) - Math.max(...a.map(deskScore)))
    .slice(0, maxGamesToReview)
    .flatMap((options) => {
      const ranked = [...new Map(options.map((pick) => [pick.id, pick])).values()].sort(
        (a, b) => deskScore(b) - deskScore(a),
      );
      const distinct = new Map<string, TicketPick>();
      for (const pick of ranked) {
        const family = marketFamily(pick.sporty?.marketId, pick.market);
        if (!distinct.has(family)) distinct.set(family, pick);
      }
      return [...distinct.values()].slice(0, 3);
    });
  const reviewResult = await reviewWithin(
    Promise.resolve().then(() => dependencies.review(candidatePool)),
    dependencies.analysisTimeoutMs ?? 38_000,
  );
  const aiReview = reviewResult.value;
  analysis.researchFallbackUsed = false;
  analysis.researched = aiReview?.reviewedEvents ?? 0;
  if (!aiReview?.reviews.length) {
    return {
      ok: false,
      code: "analysis_failed",
      error:
        reviewResult.error ??
        (reviewResult.timedOut
          ? "AI analysis took too long. No slip was built; try again shortly."
          : "AI could not analyse the available games. No slip was built; try again shortly."),
      retryable:
        reviewResult.timedOut ||
        (reviewResult.failed && !reviewResult.error?.includes("not configured")),
      analysis,
    };
  }
  const candidates = new Map(candidatePool.map((pick) => [pick.id, pick]));
  const scored = aiReview.reviews.flatMap((review) => {
    const pick = candidates.get(review.pickId);
    if (!pick) return [];
    const score = Math.round(0.85 * review.score + 0.15 * deskScore(pick));
    return [explainSelection(pick, score, policy, review, evaluateRecord(pick, record))];
  });
  analysis.rejected.notReviewedByAI = aiReview.attemptedEvents - aiReview.reviewedEvents;
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
    console.info(
      "[slipcut.analysis]",
      JSON.stringify({
        sport: request.sport,
        risk: request.risk,
        ...analysis,
        code: "no_eligible_markets",
      }),
    );
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
    request.mode === "games" ? selections.length < (request.games ?? 0) : targetReached === false;
  const notice = short
    ? request.mode === "games"
      ? `${request.games} games were requested, but only ${selections.length} passed the analysis rules.`
      : `The eligible selections reached ${actualCombinedOdds?.toFixed(2) ?? "unknown"} odds, below the requested ${(request.targetOdds ?? 0).toFixed(2)}. No unsupported leg was added.`
    : undefined;
  analysis.selected = selections.length;
  console.info(
    "[slipcut.analysis]",
    JSON.stringify({ sport: request.sport, risk: request.risk, ...analysis }),
  );

  return {
    ok: true,
    requested: request,
    policy,
    actualCombinedOdds,
    targetReached,
    requestedGames: request.mode === "games" ? (request.games ?? null) : null,
    actualGames: selections.length,
    selections,
    analysis,
    notice,
  };
}
