import { geminiChat } from "./gemini";
import { refreshKeys, geminiKeys, seekaiKeys } from "./keys";
import { seekChat } from "./seekai";
import type { TicketPick } from "./types";
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
  const text = fenced?.[1] ?? answer;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed: { events?: unknown };
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as { events?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.events)) return [];
  const valid = new Map(groups.map((options) => [eventKey(options[0]!), options]));
  const seen = new Set<string>();
  const reviews: ReviewedMarket[] = [];
  for (const value of parsed.events) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const key = String(row.eventId ?? "");
    const options = valid.get(key);
    const pickId = String(row.pickId ?? "");
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

async function reviewBatch(groups: TicketPick[][]): Promise<ReviewedMarket[]> {
  const games = groups.map((options) => ({
    eventId: eventKey(options[0]!),
    sport: options[0]!.sport,
    league: options[0]!.league,
    home: options[0]!.home,
    away: options[0]!.away,
    kickoff: options[0]!.kickoff ? new Date(options[0]!.kickoff!).toISOString() : null,
    options: options.map((pick) => ({
      id: pick.id,
      market: pick.market,
      selection: pick.selection,
      odds: pick.odds,
    })),
  }));
  const system =
    'Review the offered SportyBet markets for each game. Choose AT MOST one eligible option per event, or omit an event if none is justified. Compare the options within each event, then rank the best games overall. Score 0-100 is an uncalibrated analysis ranking, NOT a win probability. Use only the supplied fixtures, market names and odds; do not invent form, injuries, lineups, results or sources. State the actual market/odds reasoning and a concrete uncertainty. Return ONLY JSON {"events":[{"eventId":"exact eventId","pickId":"exact option id","score":0,"summary":"brief market comparison","reasons":["reason"],"risks":["risk"]}]}';
  const user = JSON.stringify(games);
  const engines: Array<() => Promise<string>> = [];
  if (geminiKeys().length) engines.push(() => geminiChat(system, user, 9_000));
  if (seekaiKeys().length)
    engines.push(() =>
      seekChat(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        9_000,
      ),
    );
  if (youKeys().length) engines.push(() => youAnswer(`${system}\n${user}`, 9_000));
  for (const engine of engines) {
    try {
      const reviews = parseBuildAIReviews(await engine(), groups);
      if (reviews.length) return reviews;
    } catch {
      // Try the next configured provider; never use a deterministic fallback.
    }
  }
  return [];
}

/** AI must choose one of the supplied, already-eligible outcomes for each returned event. */
export async function reviewBuildMarkets(picks: TicketPick[]): Promise<AIReviewResult> {
  await refreshKeys();
  if (!geminiKeys().length && !seekaiKeys().length && !youKeys().length) {
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
    Array.from({ length: Math.min(3, batches.length) }, async () => {
      while (index < batches.length) {
        const batch = batches[index++];
        if (batch) reviews.push(...(await reviewBatch(batch)));
      }
    }),
  );
  if (!reviews.length)
    throw new AIAnalysisError(
      "AI could not analyse the available markets. No slip was built; try again shortly.",
    );
  return { reviews, attemptedEvents: games.length, reviewedEvents: reviews.length };
}
