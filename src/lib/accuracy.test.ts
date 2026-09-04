import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_SAMPLE,
  QUALIFYING_BAR,
  SHORT_ODDS,
  engineAverage,
  familyGate,
  legProbability,
  type MarketStat,
} from "./accuracy.ts";

function stat(family: string, sport: string, settled: number, wins: number): MarketStat {
  return {
    family,
    sport,
    settled,
    wins,
    losses: settled - wins,
    hitRate: settled ? wins / settled : 0,
    avgWinOdds: null,
  };
}

describe("engine average", () => {
  it("is the overall hit rate across settled legs", () => {
    const stats = [stat("dc", "football", 100, 80), stat("ou", "football", 100, 40)];
    assert.equal(engineAverage(stats), 0.6);
  });
  it("is 0 with no history", () => {
    assert.equal(engineAverage([]), 0);
  });
});

describe("familyGate — the qualifying bar", () => {
  it("never allows winner for football", () => {
    // Even a perfect record must not re-admit 1/2.
    const stats = [stat("win", "football", 100, 100)];
    const g = familyGate(stats, "win", "football");
    assert.equal(g.allowed, false);
    assert.equal(g.status, "never");
  });
  it("never allows handicap", () => {
    const stats = [stat("hcp", "football", 100, 100)];
    assert.equal(familyGate(stats, "hcp", "football").allowed, false);
  });
  it("allows the bootstrap list (DC/O/U) with no history", () => {
    const g1 = familyGate([], "dc", "football");
    const g2 = familyGate([], "ou", "football");
    assert.equal(g1.allowed, true);
    assert.equal(g1.status, "bootstrap");
    assert.equal(g2.allowed, true);
    assert.equal(g2.status, "bootstrap");
  });
  it("locks non-bootstrap families under the sample size", () => {
    const g = familyGate([], "gg", "football");
    assert.equal(g.allowed, false);
    assert.equal(g.status, "locked-sample");
  });
  it("requires the bar once the sample is met", () => {
    // 40 settled, 30 wins = 75% == bar (engine avg is 75% here too).
    const stats = [stat("dc", "football", 40, 30)];
    const g = familyGate(stats, "dc", "football");
    assert.equal(g.allowed, true); // >= bar
    assert.equal(g.status, "pass");
  });
  it("fails a family below the bar with enough history", () => {
    const stats = [stat("gg", "football", 40, 20)]; // 50% < 75%
    const g = familyGate(stats, "gg", "football");
    assert.equal(g.allowed, false);
    assert.equal(g.status, "below-bar");
  });
  it("uses max(engine average, bar) as the threshold", () => {
    // A very good engine (90% overall) raises the bar for every family.
    const stats = [
      stat("dc", "football", 100, 90), // engine avg = 90%
      stat("gg", "football", 40, 34), // gg = 85% < 90%
    ];
    assert.equal(engineAverage(stats), (90 + 34) / 140);
    const g = familyGate(stats, "gg", "football");
    assert.equal(g.allowed, false); // 85% < max(90%,75%)
    assert.equal(g.status, "below-bar");
  });
  it("bar is at least QUALIFYING_BAR", () => {
    const g = familyGate([], "dc", "football");
    assert.ok(g.bar >= QUALIFYING_BAR);
  });
  it("keeps tennis winner allowed by history, not never", () => {
    const stats = [stat("win", "tennis", 40, 30)];
    const g = familyGate(stats, "win", "tennis");
    assert.notEqual(g.status, "never");
    assert.equal(g.allowed, true);
  });
});

describe("legProbability — honest card maths", () => {
  it("uses the family hit rate once it has history", () => {
    const stats = [stat("dc", "football", 100, 78)];
    assert.equal(legProbability(stats, "dc", "football", 1.4), 0.78);
  });
  it("falls back to implied probability (margin included) with no history", () => {
    const p = legProbability([], "dc", "football", 2);
    assert.ok(p != null && Math.abs(p - 0.5) < 1e-9);
  });
});

describe("constants", () => {
  it("short-odds band is 1.20-1.65", () => {
    assert.equal(SHORT_ODDS.min, 1.2);
    assert.equal(SHORT_ODDS.max, 1.65);
  });
  it("minimum sample is 30", () => {
    assert.equal(MIN_SAMPLE, 30);
  });
});
