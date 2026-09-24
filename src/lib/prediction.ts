import { analyzePicks } from "./analyze";
import { listUpcomingPicks } from "./sportybet";
import type { BookSport, TicketPick } from "./types";
import { matchEvent } from "./bookmakers/match";
import { eventKey, normalizePick } from "./bookmakers/normalize";

export type PredictionInput = {
  sport: BookSport;
  league?: string;
  home: string;
  away: string;
  kickoff?: number;
  options?: TicketPick[];
};

export type MatchPrediction = {
  pick: TicketPick;
  winProbability: number;
  expectedValue: number | null;
  confidence: "high" | "medium" | "low";
  summary: string;
  reasons: string[];
  risks: string[];
  provider: string;
  calibrated: false;
};

export interface MatchPredictor {
  readonly id: string;
  predict(input: PredictionInput): Promise<MatchPrediction>;
}

function ev(probability: number, odds?: number) {
  if (!odds || odds <= 1 || !Number.isFinite(odds)) return null;
  return (probability / 100) * odds - 1;
}

async function discoverOptions(input: PredictionInput): Promise<TicketPick[]> {
  const listed = await listUpcomingPicks(input.sport, 42, "upcoming");
  if ("error" in listed) throw new Error(listed.error);
  const representative = [...new Map(listed.map((pick) => [eventKey(pick), pick])).values()];
  const source: TicketPick = normalizePick({
    id: "prediction-match",
    sport: input.sport,
    league: input.league ?? "",
    home: input.home,
    away: input.away,
    market: "Winner",
    selection: "Unspecified",
    kickoff: input.kickoff,
  });
  const hit = matchEvent(source, representative, {
    kickoffToleranceMs: input.kickoff ? 30 * 60_000 : 36 * 60 * 60_000,
    minTeamScore: 0.68,
  });
  if (!hit.ok) throw new Error("Could not match that fixture to an upcoming SportyBet event.");
  const matchedEvent = hit.candidate.sporty?.eventId;
  if (!matchedEvent) throw new Error("Matched fixture has no bookmaker event identifier.");
  return listed.filter((pick) => pick.sporty?.eventId === matchedEvent);
}

export class ResearchMatchPredictor implements MatchPredictor {
  readonly id = "research-v1";

  async predict(input: PredictionInput): Promise<MatchPrediction> {
    const options =
      input.options?.length
        ? input.options.map(normalizePick)
        : await discoverOptions(input);
    if (!options.length) throw new Error("No open markets were available for this match.");

    const analyzed = await analyzePicks(options, 40);
    const candidates = analyzed.picks
      .filter((pick) => Number.isFinite(pick.probability))
      .sort((a, b) => {
        const eva = ev(a.probability, a.odds);
        const evb = ev(b.probability, b.odds);
        if (eva != null && evb != null && Math.abs(evb - eva) > 0.025) return evb - eva;
        return b.probability - a.probability;
      });
    const best = candidates[0];
    if (!best) throw new Error("Prediction engine could not score the available markets.");

    return {
      pick: best,
      winProbability: best.probability,
      expectedValue: ev(best.probability, best.odds),
      confidence: best.confidence,
      summary: best.summary,
      reasons: best.reasons,
      risks: best.risks,
      provider: this.id,
      // Existing AI/research scores are useful ranking estimates but are not
      // empirically calibrated probabilities. Preserve that truth in the API.
      calibrated: false,
    };
  }
}

let defaultPredictor: MatchPredictor = new ResearchMatchPredictor();

export function getMatchPredictor() {
  return defaultPredictor;
}

export function setMatchPredictorForTests(predictor: MatchPredictor) {
  defaultPredictor = predictor;
}

export async function predictMatch(input: PredictionInput) {
  return getMatchPredictor().predict(input);
}
