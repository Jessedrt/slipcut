import assert from "node:assert/strict";
import test from "node:test";
import { matchSelection, stringSimilarity } from "./match";
import { normalizeMarket, normalizeName, normalizePick, toRelayBookPick } from "./normalize";
import type { TicketPick } from "../types";

function pick(overrides: Partial<TicketPick> = {}): TicketPick {
  return normalizePick({
    id: "p",
    sport: "football",
    league: "England Premier League",
    home: "Manchester United",
    away: "Arsenal",
    market: "Over/Under 2.5",
    selection: "Over 2.5",
    odds: 1.8,
    kickoff: Date.UTC(2026, 8, 26, 14, 0),
    ...overrides,
  });
}

test("normalizes common team aliases and market semantics", () => {
  assert.equal(normalizeName("Man Utd FC"), "manchester united");
  assert.deepEqual(normalizeMarket("Over/Under 2.5", "Over 2.5"), {
    family: "total",
    period: "match",
    line: 2.5,
    scope: "match",
    outcome: "over",
  });
});

test("fuzzy selection matching tolerates bookmaker naming differences", () => {
  const source = pick({ home: "Man Utd", away: "Arsenal FC" });
  const candidate = pick({
    id: "target",
    home: "Manchester United FC",
    away: "Arsenal",
    kickoff: source.kickoff! + 8 * 60_000,
  });
  const result = matchSelection(source, [candidate]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.candidate.id, "target");
  assert.ok(stringSimilarity("PSG", "Paris Saint-Germain") > 0.9);
});

test("relay market mapping preserves total line and outcome", () => {
  const mapped = toRelayBookPick(pick());
  assert.ok(mapped);
  assert.equal(mapped?.market, "O/U");
  assert.equal(mapped?.pick, "Over 2.5");
});
