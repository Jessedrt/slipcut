import { geminiChat } from "./gemini";
import { deskScore } from "./research";
import { refreshKeys, geminiKeys, seekaiKeys } from "./keys";
import { seekChat } from "./seekai";
import { marketFamily } from "./sportybet";
import type { AnalyzedPick, TicketPick } from "./types";
import { youAnswer, youKeys } from "./you";

export type ReviewedMarket = {
  pickId: string;
  score: number;
  summary: string;
  reasons: string[];
  risks: string[];
};

export type AIReviewResult = {
  reviews: ReviewedMarket[];
  attemptedEvents: number;
  reviewedEvents: number;
  fallbackUsed?: boolean;
};

export class AIAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIAnalysisError";
  }
}

function eventKey(pick: TicketPick): string {
  return pick.sporty?.eventId ?? `${pick.home}|${pick.away}|${pick.kickoff ?? ""}`;
}

export function parseBuildAIReviews(answer: string, groups: TicketPick[][]): ReviewedMarket[] {
  const fenced = answer.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced?.[1] ?? answer).replace(/\\?\[\[\d+(?:\s*,\s*\d+)*\]\]/g, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed: { events?: unknown; games?: unknown };
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as { events?: unknown; games?: unknown };
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed.games) ? parsed.games : parsed.events;
  if (!Array.isArray(rows)) return [];
  const valid = new Map(groups.map((options) => [eventKey(options[0]!), options]));
  const seen = new Set<string>();
  const reviews: ReviewedMarket[] = [];
  for (const value of rows) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const gameIndex = row.g;
    const indexedOptions =
      typeof gameIndex === "number" && Number.isInteger(gameIndex)
        ? groups[gameIndex - 1]
        : undefined;
    const key = indexedOptions ? eventKey(indexedOptions[0]!) : String(row.eventId ?? "");
    const options = valid.get(key);
    const optionIndex = row.o;
    const pickId =
      indexedOptions && typeof optionIndex === "number" && Number.isInteger(optionIndex)
        ? (indexedOptions[optionIndex - 1]?.id ?? "")
        : String(row.pickId ?? "");
    const score = row.score;
    const summary = typeof row.summary === "string" ? row.summary.trim() : "";
    if (
      !options ||
      seen.has(key) ||
      !options.some((pick) => pick.id === pickId) ||
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 100 ||
      !summary ||
      summary.length > 300
    )
      continue;
    seen.add(key);
    reviews.push({
      pickId,
      score: Math.round(score),
      summary,
      reasons: Array.isArray(row.reasons)
        ? row.reasons
            .filter((item): item is string => typeof item === "string" && item.length <= 180)
            .slice(0, 3)
        : [],
      risks: Array.isArray(row.risks)
        ? row.risks
            .filter((item): item is string => typeof item === "string" && item.length <= 180)
            .slice(0, 3)
        : [],
    });
  }
  return reviews;
}

export function selectExistingAIScores(
  groups: TicketPick[][],
  scored: AnalyzedPick[],
): ReviewedMarket[] {
  const byId = new Map(scored.map((pick) => [pick.id, pick]));
  return groups.flatMap((options) => {
    const best = options
      .map((option) => byId.get(option.id))
      .filter(
        (row) =>
          row &&
          Number.isFinite(row.probability) &&
          row.summary.trim() &&
          row.reasons.length > 0 &&
          !/live research missed|not enough to score|could not parse|live brief had no clean score/i.test(
            row.summary,
          ),
      )
      .sort((a, b) => (b?.probability ?? 0) - (a?.probability ?? 0))[0];
    return best
      ? [
          {
            pickId: best.id,
            score: best.probability,
            summary: best.summary,
            reasons: best.reasons,
            risks: best.risks,
          },
        ]
      : [];
  });
}

function fallbackMarketReviews(groups: TicketPick[][]): ReviewedMarket[] {
  return groups.flatMap((options) => {
    const ranked = options
      .filter((pick) => Number.isFinite(pick.odds) && (pick.odds ?? 0) > 1)
      .map((pick) => {
        const implied = Math.min(95, Math.max(4, 100 / (pick.odds ?? 9)));
        const family = marketFamily(pick.sporty?.marketId, pick.market);
        const volatilityPenalty =
          family === "hcp" || family === "gg" || family === "corners"
            ? 5
            : family === "win"
              ? 3
              : 0;
        const score = Math.max(
          4,
          Math.min(96, Math.round(0.68 * deskScore(pick) + 0.32 * implied - volatilityPenalty)),
        );
        return { pick, score, family };
      })
      .sort((a, b) => b.score - a.score || (a.pick.odds ?? 99) - (b.pick.odds ?? 99));
    const best = ranked[0];
    if (!best) return [];
    return [
      {
        pickId: best.pick.id,
        score: best.score,
        summary:
          "Live AI providers were unavailable, so SlipCut used its internal market-risk model for this event.",
        reasons: [
          `Current price ${best.pick.odds?.toFixed(2) ?? "unknown"} and ${best.family.toUpperCase()} market shape ranked best among the eligible options.`,
          "The pick passed the existing league, kickoff, market-family and odds filters.",
        ],
        risks: [
          "This fallback does not include live injury, lineup or form verification.",
          "Provider recovery may change the preferred market on a later run.",
        ],
      },
    ];
  });
}

function compact(value: string, max: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(1, max - 1))}…`;
}

function safeProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown";
  return message.replace(/(?:AIza|ydc-|sk-)[A-Za-z0-9._-]+/g, "[redacted]").slice(0, 140);
}

async function reviewWithYou(groups: TicketPick[][]): Promise<ReviewedMarket[]> {
  const rows = await Promise.all(
    groups.map(async (options) => {
      const first = options[0]!;
      const choices = options
        .slice(0, 3)
        .map(
          (pick, index) =>
            `${index + 1})${compact(pick.market, 24)}→${compact(pick.selection, 18)}@${pick.odds?.toFixed(2) ?? "?"}`,
        )
        .join("; ");
      const query =
        `Review game 1: ${compact(first.home, 22)} v ${compact(first.away, 22)} (${compact(first.league, 18)}). ` +
        `Choose max one offered option; score 0-100 as ranking, not win probability. Options: ${choices}. ` +
        'Return ONLY JSON {"games":[{"g":1,"o":1,"score":65,"summary":"why","reasons":["reason"],"risks":["risk"]}]}';
      try {
        const answer = await youAnswer(query, 9_000);
        return parseBuildAIReviews(answer, [options]);
      } catch {
        return [];
      }
    }),
  );
  return rows.flat();
}

async function reviewBatch(groups: TicketPick[][]): Promise<ReviewedMarket[]> {
  const games = groups.map((options, index) => ({
    g: index + 1,
    sport: options[0]!.sport,
    league: options[0]!.league,
    home: options[0]!.home,
    away: options[0]!.away,
    kickoff: options[0]!.kickoff ? new Date(options[0]!.kickoff!).toISOString() : null,
    options: options.map((pick, optionIndex) => ({
      o: optionIndex + 1,
      market: pick.market,
      selection: pick.selection,
      odds: pick.odds,
    })),
  }));
  const system =
    'Review each game and its offered SportyBet markets. Choose AT MOST one numbered option (o) for each numbered game (g), or omit the game. Compare eligible options and rank the best games overall. Score 0-100 is an uncalibrated ranking, NOT win probability. Only use the supplied fixtures, markets and odds; do not invent form, injuries, lineups, results or sources. State brief market/odds reasoning and a concrete risk. Return ONLY JSON {"games":[{"g":1,"o":2,"score":65,"summary":"brief market comparison","reasons":["reason"],"risks":["risk"]}]}';
  const user = JSON.stringify(games);
  const engines: Array<{ name: string; run: () => Promise<string> }> = [];
  if (geminiKeys().length)
    engines.push({ name: "gemini", run: () => geminiChat(system, user, 9_000) });
  if (seekaiKeys().length)
    engines.push({
      name: "seekai",
      run: () =>
        seekChat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          9_000,
        ),
    });
  for (const engine of engines) {
    const started = Date.now();
    try {
      const answer = await engine.run();
      const reviews = parseBuildAIReviews(answer, groups);
      console.info(
        "[slipcut.ai.review]",
        JSON.stringify({
          provider: engine.name,
          status: reviews.length ? "accepted" : "invalid_response",
          games: groups.length,
          accepted: reviews.length,
          durationMs: Date.now() - started,
        }),
      );
      if (reviews.length) return reviews;
    } catch (error) {
      console.info(
        "[slipcut.ai.review]",
        JSON.stringify({
          provider: engine.name,
          status: "request_failed",
          games: groups.length,
          accepted: 0,
          error: safeProviderError(error),
          durationMs: Date.now() - started,
        }),
      );
    }
  }

  // You.com's Answer API caps query length. Review each game separately so the
  // full fixture + option set fits instead of sending one oversized batch.
  if (youKeys().length) {
    const started = Date.now();
    try {
      const reviews = await reviewWithYou(groups);
      console.info(
        "[slipcut.ai.review]",
        JSON.stringify({
          provider: "you",
          status: reviews.length ? "accepted" : "invalid_response",
          games: groups.length,
          accepted: reviews.length,
          durationMs: Date.now() - started,
        }),
      );
      if (reviews.length) return reviews;
    } catch (error) {
      console.info(
        "[slipcut.ai.review]",
        JSON.stringify({
          provider: "you",
          status: "request_failed",
          games: groups.length,
          accepted: 0,
          error: safeProviderError(error),
          durationMs: Date.now() - started,
        }),
      );
    }
  }
  const fallback = fallbackMarketReviews(groups);
  console.warn(
    "[slipcut.ai.review]",
    JSON.stringify({
      provider: "internal_market_model",
      status: fallback.length ? "fallback" : "invalid_response",
      games: groups.length,
      accepted: fallback.length,
      durationMs: 0,
    }),
  );
  return fallback;}

/** AI must choose one of the supplied, already-eligible outcomes for each returned event. */
export async function reviewBuildMarkets(picks: TicketPick[]): Promise<AIReviewResult> {
  await refreshKeys();
  const providers = [
    ...(geminiKeys().length ? ["gemini"] : []),
    ...(seekaiKeys().length ? ["seekai"] : []),
    ...(youKeys().length ? ["you"] : []),
  ];
  console.info("[slipcut.ai.config]", JSON.stringify({ providers, candidates: picks.length }));
  if (!providers.length) {
    throw new AIAnalysisError("AI analysis is not configured. No slip was built.");
  }
  const grouped = new Map<string, TicketPick[]>();
  for (const pick of picks) {
    const key = eventKey(pick);
    const options = grouped.get(key) ?? [];
    options.push(pick);
    grouped.set(key, options);
  }
  const games = [...grouped.values()];
  const batches: TicketPick[][][] = [];
  for (let i = 0; i < games.length; i += 3) batches.push(games.slice(i, i + 3));
  const reviews: ReviewedMarket[] = [];
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(2, batches.length) }, async () => {
      while (index < batches.length) {
        const batch = batches[index++];
        if (batch) reviews.push(...(await reviewBatch(batch)));
      }
    }),
  );
  const fallbackUsed = reviews.some((review) =>
    review.summary.startsWith("Live AI providers were unavailable"),
  );
  if (!reviews.length)
    throw new AIAnalysisError(
      "AI could not analyse the available markets. No slip was built; try again shortly.",
    );
  console.info(
    "[slipcut.ai.result]",
    JSON.stringify({ attemptedEvents: games.length, reviewedEvents: reviews.length, fallbackUsed }),
  );
  return { reviews, attemptedEvents: games.length, reviewedEvents: reviews.length, fallbackUsed };
}
