import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { marketForTarget, type EventDetail } from "./sportybet.ts";

function ev(markets: EventDetail["markets"]): EventDetail {
  return { eventId: "1", status: 0, markets };
}

function market(
  id: string,
  specifier: string | undefined,
  outcomes: Array<{ desc: string; odds: string; isActive?: number }>,
  status = 0,
) {
  return {
    id,
    desc: id,
    specifier,
    status,
    outcomes: outcomes.map((o, i) => ({ id: `${id}-${i}`, ...o })),
  };
}

const FOOTBALL_MARKETS = [
  market("1", undefined, [
    { desc: "Home Win", odds: "2.1" },
    { desc: "Draw", odds: "3.2" },
    { desc: "Away Win", odds: "3.4" },
  ]),
  market("18", "total=2.5", [
    { desc: "Over", odds: "1.9" },
    { desc: "Under", odds: "1.9" },
  ]),
  market("29", undefined, [
    { desc: "Yes", odds: "1.75" },
    { desc: "No", odds: "2.05" },
  ]),
  market("10", undefined, [
    { desc: "1X", odds: "1.35" },
    { desc: "12", odds: "1.22" },
    { desc: "X2", odds: "1.55" },
  ]),
  market("11", undefined, [
    { desc: "Home / Draw", odds: "1.25" },
    { desc: "Draw / Away", odds: "1.65" },
  ]),
];

const BASKETBALL_MARKETS = [
  market("219", undefined, [
    { desc: "Home", odds: "1.8" },
    { desc: "Away", odds: "1.95" },
  ]),
  market("225", "2.5", [
    { desc: "Over", odds: "1.9" },
    { desc: "Under", odds: "1.9" },
  ]),
];

describe("marketForTarget — market exclusions enforced in retarget", () => {
  it("blocks 1X2 / straight win for football", () => {
    assert.equal(marketForTarget(ev(FOOTBALL_MARKETS), "football", "win"), null);
  });

  it("blocks straight win for basketball", () => {
    assert.equal(marketForTarget(ev(BASKETBALL_MARKETS), "basketball", "win"), null);
  });

  it("keeps the winner market for tennis", () => {
    const tennis = [
      market("1", undefined, [
        { desc: "Player A", odds: "1.5" },
        { desc: "Player B", odds: "2.6" },
      ]),
    ];
    const hit = marketForTarget(ev(tennis), "tennis", "win");
    assert.ok(hit);
    assert.equal(hit!.id, "1");
  });

  it("still allows over/under for football", () => {
    const hit = marketForTarget(ev(FOOTBALL_MARKETS), "football", "ou25");
    assert.ok(hit);
    assert.equal(hit!.id, "18");
    assert.equal(hit!.specifier, "total=2.5");
  });

  it("still allows GG / DC / DNB for football", () => {
    assert.equal(marketForTarget(ev(FOOTBALL_MARKETS), "football", "gg")!.id, "29");
    assert.equal(marketForTarget(ev(FOOTBALL_MARKETS), "football", "dc")!.id, "10");
    assert.equal(marketForTarget(ev(FOOTBALL_MARKETS), "football", "dnb")!.id, "11");
  });

  it("still allows totals for basketball", () => {
    const hit = marketForTarget(ev(BASKETBALL_MARKETS), "basketball", "ou25");
    assert.ok(hit);
    assert.equal(hit!.id, "225");
  });

  it("ignores closed markets (status != 0)", () => {
    const closed = [
      market("18", "total=2.5", [
        { desc: "Over", odds: "1.9" },
        { desc: "Under", odds: "1.9" },
      ], 1),
    ];
    assert.equal(marketForTarget(ev(closed), "football", "ou25"), null);
  });
});
