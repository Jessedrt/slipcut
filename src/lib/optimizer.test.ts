import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bestLegs,
  buildSlip,
  buildToTarget,
  diversify,
  eligiblePool,
  legValue,
  planStake,
  rankBySafety,
  rankByValue,
  weakestFirst,
} from "./optimizer.ts";
import type { AnalyzedPick, TicketPick } from "./types.ts";

let seq = 0;

function leg(p: Partial<TicketPick> & { probability: number }): TicketPick & { probability: number } {
  seq += 1;
  return {
    id: `p${seq}`,
    sport: "football",
    league: "Premier League",
    home: `Home ${seq}`,
    away: `Away ${seq}`,
    market: "Over/Under 2.5",
    selection: "Over 2.5",
    odds: 1.6,
    kickoff: Date.now() + seq * 3_600_000,
    sporty: { eventId: `e${seq}`, marketId: "18", outcomeId: `o${seq}` },
    ...p,
  };
}

function analyzed(over: Partial<AnalyzedPick> = {}): AnalyzedPick {
  const base = leg({ probability: 50 }) as TicketPick & { probability: number };
  return {
    ...base,
    confidence: "medium",
    summary: "",
    reasons: [],
    risks: [],
    verdict: "keep",
    ...over,
  } as AnalyzedPick;
}

describe("ranking", () => {
  it("ranks by value, then by safety", () => {
    const valuePick = leg({ probability: 60, odds: 2.2 }); // EV +0.32
    const safePick = leg({ probability: 80, odds: 1.25 }); // EV 0.00
    assert.equal(rankByValue([safePick, valuePick])[0]!.id, valuePick.id);
    assert.equal(rankBySafety([safePick, valuePick])[0]!.id, safePick.id);
  });

  it("falls back to the rated chance when there is no price", () => {
    const priced = leg({ probability: 60, odds: 2.0 });
    const unpriced = leg({ probability: 90 });
    assert.ok(legValue(unpriced) > legValue(priced) - 1);
  });
});

describe("pool filters", () => {
  it("drops weak legs, silly prices and non-desk sports", () => {
    const pool = [
      leg({ probability: 30 }),
      leg({ probability: 70, odds: 9 }),
      leg({ probability: 70, odds: 1.02 }),
      leg({ probability: 70, sport: "other" }),
      leg({ probability: 70 }),
    ];
    const kept = eligiblePool(pool);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]!.odds, 1.6);
  });

  it("valueOnly keeps only positively expected legs", () => {
    const good = leg({ probability: 60, odds: 2.0 });
    const bad = leg({ probability: 45, odds: 2.0 });
    const kept = eligiblePool([good, bad], { valueOnly: true });
    assert.deepEqual(
      kept.map((p) => p.id),
      [good.id],
    );
  });
});

describe("diversification", () => {
  it("caps how much of one league a slip can hold", () => {
    const pool = Array.from({ length: 8 }, () => leg({ probability: 70, league: "Premier League" }));
    assert.equal(diversify(pool, { maxPerLeague: 3 }).length, 3);
  });

  it("spreads across kickoff windows", () => {
    const sameSlot = Date.now() + 3_600_000;
    const pool = Array.from({ length: 8 }, (_, i) =>
      leg({ probability: 70, league: `L${i}`, kickoff: sameSlot }),
    );
    assert.equal(diversify(pool, { maxPerSlot: 4 }).length, 4);
  });

  it("never backs the same fixture twice", () => {
    const pool = [
      leg({ probability: 70, home: "Arsenal", away: "Chelsea" }),
      leg({ probability: 72, home: "Arsenal", away: "Chelsea" }),
    ];
    assert.equal(diversify(pool).length, 1);
  });

  it("keeps legs when it can", () => {
    const pool = Array.from({ length: 6 }, (_, i) =>
      leg({ probability: 70, league: `L${i}`, kickoff: Date.now() + i * 86_400_000 }),
    );
    assert.equal(diversify(pool).length, 6);
  });
});

describe("best legs", () => {
  it("takes the strongest count requested", () => {
    const pool = [
      leg({ probability: 40 }),
      leg({ probability: 80 }),
      leg({ probability: 60 }),
      leg({ probability: 70 }),
    ];
    const slip = bestLegs(pool, 2, { minProb: 35 });
    assert.equal(slip.legs.length, 2);
    assert.deepEqual(
      slip.legs.map((p) => p.probability),
      [80, 70],
    );
  });

  it("reports when the pool cannot fill the ask", () => {
    const pool = [leg({ probability: 80 })];
    const slip = bestLegs(pool, 5);
    assert.equal(slip.short, true);
    assert.ok(slip.notes.join(" ").length > 0);
  });

  it("will not return nothing just because the bar is high", () => {
    const pool = [leg({ probability: 20 }), leg({ probability: 25 })];
    const slip = bestLegs(pool, 2);
    assert.equal(slip.legs.length, 2);
    assert.ok(slip.notes.some((n) => n.includes("dropped the quality bar")));
  });

  it("respects the leg cap even with a huge pool", () => {
    const pool = Array.from({ length: 40 }, (_, i) =>
      leg({ probability: 70, league: `L${i}`, kickoff: Date.now() + i * 86_400_000 }),
    );
    assert.equal(bestLegs(pool, 12, { maxLegs: 5 }).legs.length, 5);
  });
});

describe("building to a target price", () => {
  it("lands near the target without overshooting it wildly", () => {
    const pool = Array.from({ length: 20 }, (_, i) =>
      leg({ probability: 62, odds: 1.5 + (i % 5) * 0.1, league: `L${i}`, kickoff: Date.now() + i * 86_400_000 }),
    );
    const slip = buildToTarget(pool, 10);
    const price = slip.price as number;
    assert.ok(price >= 6 && price <= 14, `expected a price near 10×, got ${price}`);
  });

  it("flags a pool that cannot reach the target", () => {
    const pool = [leg({ probability: 70, odds: 1.4 })];
    const slip = buildToTarget(pool, 50);
    assert.equal(slip.short, true);
    assert.ok(slip.notes.join(" ").includes("no reach"));
  });

  it("prefers value over mere safety when both reach the target", () => {
    const pool = [
      leg({ probability: 55, odds: 3.0 }), // EV +0.65
      leg({ probability: 70, odds: 1.5 }), // EV +0.05
    ];
    const slip = buildToTarget(pool, 2.8);
    assert.equal(slip.legs[0]!.odds, 3.0);
  });

  it("buildSlip routes to the right builder", () => {
    const pool = Array.from({ length: 10 }, (_, i) =>
      leg({ probability: 65, odds: 1.6, league: `L${i}`, kickoff: Date.now() + i * 86_400_000 }),
    );
    assert.ok(buildSlip(pool, { maxLegs: 3 }).legs.length <= 3);
    assert.ok((buildSlip(pool, { target: 8 }).price as number) >= 6);
  });

  it("an empty pool is an empty slip, not a crash", () => {
    const slip = buildToTarget([], 10);
    assert.equal(slip.legs.length, 0);
    assert.equal(slip.price, null);
  });
});

describe("staking", () => {
  it("recommends more on a better bet", () => {
    const good = [leg({ probability: 80, odds: 1.5 }), leg({ probability: 80, odds: 1.5 })];
    const poor = [leg({ probability: 50, odds: 1.5 }), leg({ probability: 50, odds: 1.5 })];
    const bankroll = 100_000;
    assert.ok(planStake(good, bankroll).stake > planStake(poor, bankroll).stake);
  });

  it("never risks more than the cap, however good the bet", () => {
    const dream = [leg({ probability: 97, odds: 1.5 })];
    const plan = planStake(dream, 1_000_000, { cap: 0.03 });
    assert.ok(plan.stake <= 30_000);
  });

  it("stakes nothing when the price is bad", () => {
    const bad = [leg({ probability: 40, odds: 1.3 })];
    assert.equal(planStake(bad, 100_000).stake, 0);
  });

  it("needs a bankroll and a price", () => {
    assert.equal(planStake([leg({ probability: 80 })], 0).stake, 0);
    assert.equal(planStake([{ ...leg({ probability: 80 }), odds: undefined }], 10_000).stake, 0);
  });
});

describe("weakest first", () => {
  it("puts the leg most likely to cut the slip at the top", () => {
    const rows = [analyzed({ probability: 70 }), analyzed({ probability: 30 }), analyzed({ probability: 50 })];
    assert.deepEqual(
      weakestFirst(rows).map((p) => p.probability),
      [30, 50, 70],
    );
  });
});
