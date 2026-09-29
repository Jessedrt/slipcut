import { AIAnalysisError, reviewBuildMarkets } from "./build-ai";
import { deskScore } from "./research";
import { evaluateRecord, loadRecord, type RecordSnapshot, type RecordSummary } from "./track-record";
import {
  basketballOptionAllowed,
  basketballOverKind,
  cookablePick,
  footballOptionAllowed,
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

export const RISK_POLICIES: Record<BuildRisk, RiskPolicy> = {
  conservative: {
    label: "Conservative",
    minModelScore: 62,
    minOdds: 1.2,
    maxOdds: 1.82,
    explanation:
      "Prioritises eligible prices from 1.20 upward and stronger AI-reviewed rankings across SportyBet's available markets. It is not a safety guarantee.",
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

function policyForSport(sport: BuildSport, risk: BuildRisk): RiskPolicy {
  const base = RISK_POLICIES[risk];

  if (sport === "basketball") {
    if (risk === "conservative") {
      return {
        ...base,
        minOdds: 1.2,
        maxOdds: 1.82,
        explanation:
          "Basketball conservative uses full-game Overs, individual/team full-game Overs and match half Overs only, with the stricter 62+ review threshold and 1.20–1.82 prices.",
      };
    }

    if (risk === "balanced") {
      return {
        ...base,
        minOdds: 1.16,
        maxOdds: 2.2,
        explanation:
          "Basketball balanced keeps full-game and half Overs, and also allows individual half and quarter Overs, with the 54+ review threshold and 1.16–2.20 prices.",
      };
    }

    return {
      ...base,
      explanation:
        "Basketball aggressive uses the same Over-only market catalogue with the wider 1.16–2.75 price band and lower 45+ review threshold.",
    };
  }

  if (risk === "conservative") {
    return {
      ...base,
      minOdds: 1.2,
      maxOdds: 1.3,
      explanation:
        "Football conservative uses eligible prices from 1.20 to 1.30 with the stricter AI-review threshold. It is not a safety guarantee.",
    };
  }

  if (risk === "balanced") {
    return {
      ...base,
      minOdds: 1.35,
      maxOdds: 2.2,
      explanation:
        "Football balanced starts at 1.35 and keeps the wider 2.20 ceiling while retaining SlipCut's other analysis filters.",
    };
  }

  return base;
}

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
  if (!Number.isFinite(targetOdds) || targetOdds < 1.5 || targetOdds > 5000) {
    return {
      ok: false,
      code: "invalid_request",
      error: "Target odds must be between 1.50 and 5000.00.",
    };
  }
  return { ok: true, value: { ...base, mode: "odds", targetOdds } };
}

function allowedFamily(pick: TicketPick, risk: BuildRisk) {
  if (pick.sport === "basketball") {
    const kind = basketballOverKind(pick);
    if (!kind) return false;

    // Conservative keeps the lower-variance Over families only. Balanced adds
    // team/individual half and quarter Overs. Aggressive keeps the same
    // Over-only catalogue but relies on its wider odds/lower score thresholds.
    if (risk === "conservative") {
      return kind === "full_game" || kind === "team_full_game" || kind === "half";
    }
    return basketballOptionAllowed(pick);
  }

  // Football is score-Over only in every risk mode: full-time totals,
  // team/individual-team totals and half totals.
  return footballOptionAllowed(pick);
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

function diversifyBasketballCandidates<T extends TicketPick>(
  ranked: T[],
  limit: number,
): T[] {
  if (limit <= 0 || !ranked.length) return [];

  const groups = new Map<string, T[]>();
  for (const pick of ranked) {
    const family = marketFamily(pick.sporty?.marketId, pick.market);
    const bucket = groups.get(family) ?? [];
    bucket.push(pick);
    groups.set(family, bucket);
  }

  // Full-game totals are the preferred basketball base market and may form a
  // multi-leg card on their own. Other single-family pools are kept to one leg
  // so the builder does not pad a card with repeated handicaps/derivatives.
  if (groups.size < 2) {
    return groups.has("ou") ? ranked.slice(0, limit) : ranked.slice(0, 1);
  }

  const selected: T[] = [];
  const familyOrder = [...groups.keys()];
  let round = 0;
  while (selected.length < limit) {
    let added = false;
    for (const family of familyOrder) {
      const pick = groups.get(family)?.[round];
      if (!pick) continue;
      selected.push(pick);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
    round += 1;
  }

  // If one family runs out much earlier than another, trim the weakest tail
  // until no family owns more than half the issued card (rounded up). Full-game
  // totals may exceed that share because they are the preferred non-winner base.
  while (selected.length > 1) {
    const counts = new Map<string, number>();
    for (const pick of selected) {
      const family = marketFamily(pick.sporty?.marketId, pick.market);
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
    const maxAllowed = Math.ceil(selected.length / 2);
    const overloaded = [...counts.entries()].find(
      ([family, count]) => family !== "ou" && count > maxAllowed,
    )?.[0];
    if (!overloaded) break;
    let removeAt = -1;
    for (let index = selected.length - 1; index >= 0; index -= 1) {
      const pick = selected[index]!;
      if (marketFamily(pick.sporty?.marketId, pick.market) === overloaded) {
        removeAt = index;
        break;
      }
    }
    if (removeAt < 0) break;
    selected.splice(removeAt, 1);
  }

  return selected;
}

const MAX_TARGET_LEGS = 42;

function targetLegBudget(target: number, policy: RiskPolicy) {
  const requested = Math.max(1.5, Math.min(5000, target));
  const floor = Math.max(1.02, policy.minOdds);
  const worstCaseLegs = Math.ceil(Math.log(requested) / Math.log(floor));
  return Math.min(MAX_TARGET_LEGS, Math.max(15, worstCaseLegs + 2));
}

function basketballTargetRank<T extends TicketPick & { modelScore?: number }>(
  ranked: T[],
  risk: BuildRisk,
) {
  const oddsWeight = risk === "conservative" ? 2 : risk === "balanced" ? 9 : 16;
  return [...ranked].sort((a, b) => {
    const aOdds = Math.max(1.01, a.odds ?? 1.01);
    const bOdds = Math.max(1.01, b.odds ?? 1.01);
    const aScore = (a.modelScore ?? 0) + oddsWeight * Math.log(aOdds);
    const bScore = (b.modelScore ?? 0) + oddsWeight * Math.log(bOdds);
    return bScore - aScore || (b.modelScore ?? 0) - (a.modelScore ?? 0);
  });
}

function buildBasketballToOdds<T extends TicketPick & { modelScore?: number }>(
  ranked: T[],
  target: number,
  risk: BuildRisk,
  limit: number,
): T[] {
  const riskRanked = basketballTargetRank(ranked, risk);
  const pool = diversifyBasketballCandidates(riskRanked, limit);
  if (!pool.length) return [];

  const requested = Math.max(1.5, Math.min(5000, target));
  const kept: T[] = [];
  let product = 1;
  for (const pick of pool) {
    const odds = pick.odds ?? 0;
    if (!Number.isFinite(odds) || odds <= 1) continue;
    kept.push(pick);
    product *= odds;
    if (product >= requested) break;
  }
  return kept;
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
  const policy = policyForSport(request.sport, request.risk);
  const targetBudget =
    request.mode === "odds"
      ? targetLegBudget(request.targetOdds ?? 2, policy)
      : null;
  const requestedCount =
    request.mode === "games" ? (request.games ?? 5) : (targetBudget ?? 15);
  const discoveryLimit = Math.min(42, Math.max(20, requestedCount * 2));
  const discovered = await dependencies.discover(request.sport, discoveryLimit, request.window);
  if (isFailure(discovered)) return { ok: false, ...discovered };

  const analysis: AnalysisDiagnostics = {
    discovered: discovered.length,
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
    },
      selected: 0,
      qualifiedGames: 0,
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

  // Rules constrain the options; they do not pick the final market. Review a
  // broad, diversified set of lines/outcomes per event instead of collapsing
  // each market family to a single option before the AI gets to compare them.
  const byEvent = new Map<string, TicketPick[]>();
  for (const pick of historical) {
    const key = pick.sporty?.eventId ?? `${pick.home}|${pick.away}|${pick.kickoff ?? ""}`;
    const options = byEvent.get(key) ?? [];
    options.push(pick);
    byEvent.set(key, options);
  }
  const maxGamesToReview = Math.min(
    request.mode === "odds" ? 42 : 24,
    Math.max(12, requestedCount + 6),
  );
  const maxOptionsPerEvent = 24;
  const candidatePool = [...byEvent.values()]
    .sort((a, b) => Math.max(...b.map(deskScore)) - Math.max(...a.map(deskScore)))
    .slice(0, maxGamesToReview)
    .flatMap((options) => {
      const ranked = [...new Map(options.map((pick) => [pick.id, pick])).values()].sort(
        (a, b) => deskScore(b) - deskScore(a),
      );
      const buckets = new Map<string, TicketPick[]>();
      for (const pick of ranked) {
        const family = marketFamily(pick.sporty?.marketId, pick.market);
        const specifier = pick.sporty?.specifier ?? "";
        const periodKey =
          specifier
            .split(";")
            .filter((part) => part && !/^total=/i.test(part))
            .sort()
            .join(";") || "main";
        const bucketKey = `${family}:${pick.sporty?.marketId ?? pick.market}:${periodKey}`;
        const bucket = buckets.get(bucketKey) ?? [];
        // SportyBet may expose hundreds of score-total lines per fixture.
        // Keep several lines from every full-game/team/half/quarter bucket,
        // then round-robin them so one period cannot crowd out the rest.
        if (bucket.length < 4) {
          bucket.push(pick);
          buckets.set(bucketKey, bucket);
        }
      }
      const families = [...buckets.entries()]
        .sort((a, b) => deskScore(b[1]![0]!) - deskScore(a[1]![0]!))
        .map(([family]) => family);
      const selected: TicketPick[] = [];
      for (let round = 0; round < 4 && selected.length < maxOptionsPerEvent; round++) {
        for (const family of families) {
          const pick = buckets.get(family)?.[round];
          if (pick) selected.push(pick);
          if (selected.length >= maxOptionsPerEvent) break;
        }
      }
      return selected;
    });
  analysis.marketOptionsReviewed = candidatePool.length;
  const reviewResult = await reviewWithin(
    Promise.resolve().then(() => dependencies.review(candidatePool)),
    dependencies.analysisTimeoutMs ?? 38_000,
  );
  const aiReview = reviewResult.value;
  analysis.researchFallbackUsed = Boolean(aiReview?.fallbackUsed);
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
  analysis.qualifiedGames = deduped.length;
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

  const selectionLimit =
    request.mode === "games" ? (request.games ?? 5) : (targetBudget ?? 15);
  const diversified =
    request.sport === "basketball"
      ? diversifyBasketballCandidates(deduped, selectionLimit)
      : deduped;
  const diversityLimited =
    request.sport === "basketball" &&
    diversified.length < Math.min(deduped.length, selectionLimit);

  const selections =
    request.mode === "games"
      ? diversified.slice(0, request.games)
      : request.sport === "basketball"
        ? buildBasketballToOdds(
            deduped,
            request.targetOdds ?? 2,
            request.risk,
            selectionLimit,
          )
        : buildToOdds(deduped, request.targetOdds ?? 2).slice(0, selectionLimit);
  const actualCombinedOdds = combinedOdds(selections);
  const targetReached =
    request.mode === "odds" && actualCombinedOdds !== null
      ? actualCombinedOdds >= (request.targetOdds ?? 2)
      : null;
  const short =
    request.mode === "games" ? selections.length < (request.games ?? 0) : targetReached === false;
  const shortNotice = short
    ? request.mode === "games"
      ? `${request.games} games were requested, but only ${selections.length} passed the analysis rules.`
      : `Only ${deduped.length} distinct game${deduped.length === 1 ? "" : "s"} passed SlipCut's ${policy.label.toLowerCase()} market and AI review rules. SlipCut used up to ${selectionLimit} qualified legs and reached ${actualCombinedOdds?.toFixed(2) ?? "unknown"} odds, below your ${(request.targetOdds ?? 0).toFixed(2)} target. Try Upcoming or a wider risk mode for more eligible fixtures; unsupported games were not added.`
    : undefined;
  const fallbackNotice = analysis.researchFallbackUsed
    ? "Live AI providers were temporarily unavailable, so SlipCut used its internal market-risk fallback for this build."
    : undefined;
  const diversityNotice = diversityLimited
    ? "Basketball market-diversity rules prevented SlipCut from padding the card with one repeated market family."
    : undefined;
  const notice =
    [fallbackNotice, diversityNotice, shortNotice].filter(Boolean).join(" ") || undefined;
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
