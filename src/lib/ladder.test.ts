import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LADDER_LIMITS, buildLadderCard, rankLadder, type Leg, type LadderCardSpec } from "./optimizer.ts";
import type { SportySelection } from "./types.ts";

let n = 0;
function leg(odds: number, probability: number, league = "League A"): Leg {
  n += 1;
  const sporty: SportySelection = { eventId: `e${n}`, marketId: "18", outcomeId: `o${n}` };
  return {
    id: `l${n}`,
    sport: "football",
    home: `Home ${n}`,
    away: `Away ${n}`,
    market: "Over/Under",
    selection: "Over",
    league,
    odds,
    sporty,
    probability,
  };
}

describe("rankLadder — short odds first, then safety", () => {
  it("puts the in-band legs ahead of longer ones", () => {
    const short = leg(1.4, 70);
    const long = leg(2.5, 90);
    const short2 = leg(1.3, 40);
    const out = rankLadder([leg(2.2, 99), short, long, short2]);
    assert.equal(out[0]!.id, short.id);
    assert.equal(out[1]!.id, short2.id);
  });
  it("breaks in-band ties by probability (safety)", () => {
    const safe = leg(1.4, 85);
    const risky = leg(1.4, 55);
    const out = rankLadder([risky, safe]);
    assert.equal(out[0]!.id, safe.id);
  });
});

describe("buildLadderCard — honest ladder construction", () => {
  it("builds a 20× card from short legs; pool exhaustion flags it short", () => {
    // six 1.4 legs: 1.4^6 = 7.5, well under 75% of the 20× target, so the
    // card is honest about being short instead of being padded to reach it.
    const legs = Array.from({ length: 6 }, (_, i) => leg(1.4, 75, `League ${i}`));
    const card = buildLadderCard(legs, 20);
    assert.equal(card.legs.length, 6);
    assert.ok(card.price != null && Math.abs(card.price - 1.4 ** 6) < 0.01);
    assert.equal(card.short, true);
  });

  it("stops adding legs once the target is reached (no over-fill)", () => {
    // 1.7^5 = 14.2 < 20, 1.7^6 = 24.1 >= 20 -> exactly six legs.
    const legs = Array.from({ length: 10 }, () => leg(1.7, 75, `L${(n % 9) + 1}`));
    const card = buildLadderCard(legs, 20);
    assert.ok(card.legs.length >= 5 && card.legs.length <= 6);
    assert.ok(card.price != null && card.price >= 20);
    assert.equal(card.short, false);
  });

  it("NEVER pads with long shots past the odds cap", () => {
    // The only way to reach 50× would be one 5.5 leg — that is a long shot,
    // so the card must be short (or empty), not padded.
    const legs = [leg(1.3, 80), leg(1.4, 78), leg(5.5, 30)];
    const card = buildLadderCard(legs, 50);
    assert.ok(!card.legs.some((l) => (l.odds ?? 0) > LADDER_LIMITS.maxOdds));
    assert.ok(card.price == null || card.price < 50 * 0.75);
    assert.equal(card.short, true);
  });

  it("returns an empty card for an empty pool", () => {
    const card = buildLadderCard([], 20);
    assert.equal(card.legs.length, 0);
    assert.equal(card.price, null);
    assert.equal(card.ev, null);
  });

  it("respects the per-league concentration cap", () => {
    // Ten 1.6 legs, all one league -> max 3 may be taken.
    const legs = Array.from({ length: 10 }, () => leg(1.6, 75, "Only League"));
    const card = buildLadderCard(legs, 1000);
    assert.ok(card.legs.length <= LADDER_LIMITS.maxPerLeague);
    assert.equal(card.short, true);
  });

  it("never shows fake positive EV on implied-probability legs", () => {
    // probability = implied (1/odds): the book's own price. The card's EV
    // must be ~0 or negative (margin + correlation), never a fake +%.
    const legs = [leg(1.4, Math.round(100 / 1.4), "L1"), leg(1.5, Math.round(100 / 1.5), "L2"), leg(1.6, Math.round(100 / 1.6), "L3")];
    const card: LadderCardSpec = buildLadderCard(legs, 10);
    assert.ok(card.ev != null);
    assert.ok(card.ev < 0.05, `EV at implied prices should be ~0, not a fake positive; got ${card.ev}`);
  });

  it("true chance is the product of the (family) hit rates, hair-cut for load", () => {
    // Three 78% legs, different leagues: 0.78^3 ≈ 0.474 before any haircut.
    const legs = [leg(1.4, 78, "L1"), leg(1.4, 78, "L2"), leg(1.4, 78, "L3")];
    const card = buildLadderCard(legs, 10);
    assert.ok(Math.abs(card.trueChance - 0.78 ** 3) < 0.001, `true chance should be 0.78^3, got ${card.trueChance}`);
  });
});
