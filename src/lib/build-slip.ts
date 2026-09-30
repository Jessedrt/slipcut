import type { reviewBuildMarkets } from "./build-ai";
import {
  evaluateRecord,
  loadRecord,
  type RecordSnapshot,
  type RecordSummary,
} from "./track-record";
import {
  cookablePick,
  listUpcomingPicks,
  refreshSelections,
  type CookWindow,
  type DiscoveryDiagnostics,
  type ProviderErrorCode,
  type SportyFailure,
} from "./sportybet";
import { automaticMarketAllowed, canonicalMarket, riskOddsAllowed, SELECTION_POLICIES } from "./selection-policy";
import {
  assessEvidence,
  researchSelectionEvidence,
  type Evidence,
  type EvidenceAssessment,
} from "./selection-evidence";
import { buildToOdds, combinedOdds, uniqueEvents } from "./workbench";
import type { BookSport, TicketPick } from "./types";
import { normalizeName } from "./bookmakers/normalize";
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
  analysisBasis: "source_corroborated_history";
  riskMode: BuildRisk;
  evidence: EvidenceAssessment;
  summary: string;
  reasons: string[];
  risks: string[];
};

export type AnalysisDiagnostics = {
  historyCoverage?: { eligibleFixtures: number; fixturesWithHistory: number; marketsWithHistory: number };
  discovered: number;
  eligibleBeforeScoring: number;
  researched: number;
  marketOptionsReviewed: number;
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
    insufficientEvidence: number;
    providerValidation: number;
  };
  selected: number;
  qualifiedGames: number;
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

export const RISK_POLICIES = SELECTION_POLICIES;
export type BuildDependencies = {
  discover: typeof listUpcomingPicks;
  review?: typeof reviewBuildMarkets;
  evidence?: typeof researchSelectionEvidence;
  refresh?: typeof refreshSelections;
  record?: () => Promise<RecordSnapshot>;
  analysisTimeoutMs?: number;
};
const defaultDependencies: BuildDependencies = {
  discover: listUpcomingPicks,
  evidence: researchSelectionEvidence,
  refresh: refreshSelections,
  record: loadRecord,
};
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
  if (!Number.isFinite(targetOdds) || targetOdds < 1.5 || targetOdds > 5000) {
    return {
      ok: false,
      code: "invalid_request",
      error: "Target odds must be between 1.50 and 5000.00.",
    };
  }
  return { ok: true, value: { ...base, mode: "odds", targetOdds } };
}

async function within<T>(promise: Promise<T>, timeout: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
export async function buildSlip(
  input: BuildSlipRequest,
  dependencies: BuildDependencies = defaultDependencies,
): Promise<BuildSlipResult> {
  const validated = validateBuildRequest(input);
  if (!validated.ok) return validated;
  const request = validated.value,
    policy = RISK_POLICIES[request.risk];
  const analysis: AnalysisDiagnostics = {
    discovered: 0,
    eligibleBeforeScoring: 0,
    researched: 0,
    marketOptionsReviewed: 0,
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
      insufficientEvidence: 0,
      providerValidation: 0,
    },
    selected: 0,
    qualifiedGames: 0,
  };
  const fail = (
    error: string,
    code: BuildSlipFailure["code"] = "no_eligible_markets",
  ): BuildSlipFailure => {
    console.info("[slipcut.build]", JSON.stringify({ sport: request.sport, risk: request.risk,
      window: request.window, ok: false, code, analysis }));
    return { ok: false, code, error, analysis };
  };
  const discovered = await dependencies.discover(request.sport, 42, request.window);
  if (!Array.isArray(discovered)) return { ok: false, ...discovered };
  analysis.discovered = discovered.length;
  const prelim = discovered.filter((pick) => {
    if (pick.sport !== request.sport) {
      analysis.rejected.wrongSport++;
      return false;
    }
    if (!cookablePick(pick)) {
      analysis.rejected.notCookable++;
      return false;
    }
    if (!riskOddsAllowed(pick.odds, request.risk)) {
      analysis.rejected.outsideRiskOdds++;
      return false;
    }
    if (!automaticMarketAllowed(pick)) {
      analysis.rejected.marketFamily++;
      return false;
    }
    return true;
  });
  if (!prelim.length)
    return fail(
      `No open ${request.sport} selections matched ${policy.label}'s ${policy.minOdds.toFixed(2)}–${policy.maxOdds.toFixed(2)} range and market rules.`,
    );
  const refreshed = await (dependencies.refresh ?? refreshSelections)(prelim);
  if (refreshed.error) return { ok: false, ...refreshed.error, analysis };
  analysis.rejected.providerValidation = refreshed.unavailable.length;
  // Refresh must preserve the exact fixture/market/outcome/line identity.
  const identity = (p: TicketPick) => JSON.stringify(p.sporty);
  const original = new Set(prelim.map(identity));
  const eligible = refreshed.available.filter(
    (p) =>
      original.has(identity(p)) &&
      p.sport === request.sport &&
      cookablePick(p) &&
      automaticMarketAllowed(p) &&
      riskOddsAllowed(p.odds, request.risk),
  );
  analysis.eligibleBeforeScoring = eligible.length;
  if (!eligible.length)
    return fail("No selections remained valid after refreshing SportyBet markets and prices.");
  const record = await (dependencies.record ?? loadRecord)();
  const historical = eligible.filter((p) => {
    if (evaluateRecord(p, record).status !== "below_average") return true;
    analysis.rejected.belowHistoricalAverage++;
    return false;
  });
  let evidence: Map<string, Evidence> | null;
  try {
    evidence = await within(
      (dependencies.evidence ?? researchSelectionEvidence)(historical),
      dependencies.analysisTimeoutMs ?? 38_000,
    );
  } catch {
    return fail(
      "Historical statistics could not be retrieved. No unsupported selections were added.",
      "analysis_failed",
    );
  }
  if (!evidence)
    return fail("Historical research took too long. No slip was built.", "analysis_failed");
  analysis.marketOptionsReviewed = historical.length;
  const historyPicks = historical.filter((pick) => {
    const c = canonicalMarket(pick);
    const metric = c.family === "corners" ? "corners" : c.family === "cards" ? "cards" : "score";
    return evidence.get(pick.id)?.rows.some((r) => r.corroborated && r.period === c.period && r.metric === metric);
  });
  analysis.historyCoverage = {
    eligibleFixtures: new Set(historical.map((p) => p.sporty?.eventId)).size,
    fixturesWithHistory: new Set(historyPicks.map((p) => p.sporty?.eventId)).size,
    marketsWithHistory: historyPicks.length,
  };
  const assessments = new Map<string, EvidenceAssessment>();
  const inspected = new Set<string>();
  for (const pick of historical) {
    const assessment = assessEvidence(pick, evidence.get(pick.id), request.risk);
    const c = canonicalMarket(pick), ev = evidence.get(pick.id);
    const event = pick.sporty!.eventId;
    if (ev?.rows.length && c.period === "match" && c.family === "total" && !inspected.has(event)) {
      inspected.add(event);
      const recent = [...ev.rows].filter((r) => r.period === "match" && r.metric === "score")
        .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      const totals = (team: string) => recent.filter((r) => [r.home, r.away].some((n) => normalizeName(n) === normalizeName(team)))
        .slice(0, 10).map((r) => r.homeValue + r.awayValue);
      console.info("[slipcut.evidence]", JSON.stringify({ home: pick.home, away: pick.away,
        market: pick.market, line: c.line, odds: pick.odds, homeTotals: totals(pick.home),
        awayTotals: totals(pick.away), qualified: Boolean(assessment) }));
    }
    if (assessment) assessments.set(pick.id, assessment);
    else analysis.rejected.insufficientEvidence++;
  }
  analysis.researched = new Set(
    historical.filter((p) => assessments.has(p.id)).map((p) => p.sporty?.eventId),
  ).size;
  let reviewed = historical.filter((p) => assessments.has(p.id));
  // Optional external review can reject evidence-qualified options, never admit unsupported ones.
  if (dependencies.review && reviewed.length) {
    try {
      const review = await within(
        dependencies.review(reviewed, {
          sport: request.sport,
          risk: request.risk,
          minModelScore: policy.minModelScore,
          minOdds: policy.minOdds,
          maxOdds: policy.maxOdds,
        }),
        dependencies.analysisTimeoutMs ?? 38_000,
      );
      if (!review || review.fallbackUsed)
        return fail(
          "Market review unavailable. No heuristic fallback was accepted.",
          "analysis_failed",
        );
      const allowed = new Set(
        review.reviews.filter((r) => r.score >= policy.minModelScore).map((r) => r.pickId),
      );
      analysis.rejected.notReviewedByAI = reviewed.filter((p) => !allowed.has(p.id)).length;
      reviewed = reviewed.filter((p) => allowed.has(p.id));
    } catch {
      return fail("Market review failed. No slip was built.", "analysis_failed");
    }
  }
  const scored: BuildSelection[] = reviewed
    .map((pick): BuildSelection => {
      const a = assessments.get(pick.id)!;
      return {
        ...pick,
        riskMode: request.risk,
        evidence: a,
        trackRecord: evaluateRecord(pick, record),
        modelScore: a.score,
        confidenceLabel: a.score >= 80 ? "higher ranking" : "moderate ranking",
        analysisBasis: "source_corroborated_history",
        summary: a.summary,
        reasons: [
          `Price ${pick.odds!.toFixed(2)} passed ${policy.label} (${policy.minOdds.toFixed(2)}–${policy.maxOdds.toFixed(2)}).`,
          a.summary,
          ...a.sources.map((url) => `Historical source: ${url}`),
        ],
        risks: [
          "Historical hit rates are not calibrated win probabilities. Odds can change before booking.",
          ...a.warnings,
        ],
      };
    })
    .sort((a, b) => b.modelScore - a.modelScore || a.odds! - b.odds!);
  const distinct = uniqueEvents(scored).picks;
  analysis.rejected.duplicateEvents = scored.length - distinct.length;
  analysis.qualifiedGames = distinct.length;
  if (!distinct.length) {
    const coverage = analysis.historyCoverage;
    if (coverage.fixturesWithHistory < coverage.eligibleFixtures)
      return fail(
        `Historical score coverage is incomplete: results matched ${coverage.fixturesWithHistory} of ${coverage.eligibleFixtures} fixtures. No available selection could be verified for ${policy.label}.`,
        coverage.fixturesWithHistory === 0 ? "analysis_failed" : "no_eligible_markets",
      );
    return fail(
      `Insufficient qualified selections: none passed ${policy.label}'s sample, exact-line hit-rate, scope and consistency requirements. Missing statistics were not guessed.`,
    );
  }
  // Both sports use the same deterministic nearest-target search over qualified events.
  const selections =
    request.mode === "games"
      ? distinct.slice(0, request.games)
      : buildToOdds(distinct, request.targetOdds!);
  const actualCombinedOdds = combinedOdds(selections);
  const targetReached =
    request.mode === "odds"
      ? actualCombinedOdds !== null &&
        Math.abs(Math.log(actualCombinedOdds / request.targetOdds!)) <= Math.log(1.05)
      : null;
  analysis.selected = selections.length;
  console.info("[slipcut.build]", JSON.stringify({ sport: request.sport, risk: request.risk,
    window: request.window, ok: true, actualCombinedOdds, analysis }));
  const notice =
    request.mode === "games" && selections.length < request.games!
      ? `${request.games} games requested; only ${selections.length} qualified selections were available. Evidence thresholds and odds ranges were preserved.`
      : request.mode === "odds" && !targetReached
        ? `Closest qualified result: ${actualCombinedOdds?.toFixed(2)} versus ${request.targetOdds!.toFixed(2)} target. Only ${distinct.length} events qualified; at most 15 can be booked. No odds range or evidence threshold was relaxed.`
        : undefined;
  return {
    ok: true,
    requested: request,
    policy,
    actualCombinedOdds,
    targetReached,
    requestedGames: request.mode === "games" ? request.games! : null,
    actualGames: selections.length,
    selections,
    analysis,
    notice,
  };
}
