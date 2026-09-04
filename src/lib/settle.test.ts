import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  lineFromMarket,
  settleBasket,
  settleFootball,
  settleTennis,
  type StoredPick,
} from "./settle.ts";

function pick(over: Partial<StoredPick> = {}): StoredPick {
  return {
    home: "Home",
    away: "Away",
    market: "Over/Under 2.5",
    selection: "Over 2.5",
    league: "Premier League",
    sport: "football",
    family: "ou",
    ...over,
  };
}

describe("totals line parsing", () => {
  it("reads the line off a plain totals market", () => {
    assert.equal(lineFromMarket("Over/Under 2.5", "Over 2.5"), 2.5);
    assert.equal(lineFromMarket("Over/Under", "Under 3.5"), 3.5);
  });

  it("ignores the ordinal in a first-half market", () => {
    // The old parser read the "1" out of "1st" and settled against 1 goal.
    assert.equal(lineFromMarket("1st Half O/U 1.5", "Over 1.5"), 1.5);
    assert.equal(lineFromMarket("1st Half Over/Under", "Over 2.5"), 2.5);
  });

  it("prefers the half-point line over stray numbers", () => {
    assert.equal(lineFromMarket("O/U 2.5 (3-way)", "Over 2.5"), 2.5);
  });

  it("keeps basketball's big round totals", () => {
    assert.equal(lineFromMarket("Over/Under 210.5", "Over 210.5"), 210.5);
    assert.equal(lineFromMarket("Over/Under", "Over 214"), 214);
  });

  it("keeps the sign for handicaps", () => {
    assert.equal(lineFromMarket("Asian Handicap -1.5", "Home -1.5"), -1.5);
  });

  it("returns null when there is no number at all", () => {
    assert.equal(lineFromMarket("Draw No Bet", "Home"), null);
  });
});

describe("football settlement", () => {
  it("overs land as soon as the line is cleared", () => {
    assert.equal(settleFootball(pick({ selection: "Over 2.5" }), 2, 1, false).result, "won");
    assert.equal(settleFootball(pick({ selection: "Over 2.5" }), 2, 1, true).result, "won");
  });

  it("overs stay pending while they can still land", () => {
    const live = settleFootball(pick({ selection: "Over 2.5" }), 1, 0, false);
    assert.equal(live.result, "pending");
  });

  it("overs die at the whistle, not before", () => {
    assert.equal(settleFootball(pick({ selection: "Over 2.5" }), 1, 0, true).result, "lost");
  });

  it("unders only settle once the match is over", () => {
    const live = settleFootball(pick({ selection: "Under 2.5" }), 1, 0, false);
    assert.equal(live.result, "pending", "an under is alive until full time");
    assert.equal(settleFootball(pick({ selection: "Under 2.5" }), 1, 0, true).result, "won");
    assert.equal(settleFootball(pick({ selection: "Under 2.5" }), 2, 1, true).result, "lost");
    // Goals never come off the board, so a live 3-0 is already dead for the under.
    assert.equal(settleFootball(pick({ selection: "Under 2.5" }), 3, 0, false).result, "lost");
  });

  it("both-teams-to-score settles yes early and no only at the end", () => {
    const gg = pick({ family: "gg", market: "GG/NG", selection: "Yes" });
    assert.equal(settleFootball(gg, 1, 1, false).result, "won");
    assert.equal(settleFootball(gg, 1, 0, false).result, "pending");
    assert.equal(settleFootball(gg, 1, 0, true).result, "lost");
    const ng = pick({ family: "gg", market: "GG/NG", selection: "No" });
    assert.equal(settleFootball(ng, 1, 0, false).result, "pending");
    assert.equal(settleFootball(ng, 1, 0, true).result, "won");
  });

  it("double chance covers the two named outcomes", () => {
    const dc = (selection: string) => pick({ family: "dc", market: "Double Chance", selection });
    assert.equal(settleFootball(dc("1X"), 1, 1, true).result, "won");
    assert.equal(settleFootball(dc("1X"), 0, 2, true).result, "lost");
    assert.equal(settleFootball(dc("12"), 1, 1, true).result, "lost");
    assert.equal(settleFootball(dc("12"), 2, 1, true).result, "won");
    assert.equal(settleFootball(dc("X2"), 1, 1, true).result, "won");
  });

  it("draw no bet voids on the draw", () => {
    const dnb = pick({ family: "dnb", market: "Draw No Bet", selection: "Home" });
    assert.equal(settleFootball(dnb, 1, 1, true).result, "void");
    assert.equal(settleFootball(dnb, 2, 1, true).result, "won");
    assert.equal(settleFootball(dnb, 0, 1, true).result, "lost");
  });

  it("refuses to guess at markets a scoreline cannot settle", () => {
    const hcp = pick({ family: "hcp", market: "Asian Handicap", selection: "Home -1.5" });
    const settled = settleFootball(hcp, 3, 0, true);
    assert.equal(settled.result, "pending");
    assert.match(settled.note, /no fit settle/);
  });

  it("does not invent a result for a totals market with no line", () => {
    const broken = pick({ family: "ou", market: "Over/Under", selection: "Over" });
    assert.equal(settleFootball(broken, 3, 0, true).result, "pending");
  });
});

describe("basketball settlement", () => {
  it("overs land when the line is cleared", () => {
    assert.equal(settleBasket(pick({ sport: "basketball", selection: "Over 210.5" }), 110, 105, false).result, "won");
  });

  it("unders are not lost the moment the live total passes the line", () => {
    // The old code returned "lost" here for any unfinished game whose total had
    // not yet passed the line — including games that were never going to get there.
    const under = pick({ sport: "basketball", selection: "Under 210.5" });
    const live = settleBasket(under, 50, 50, false);
    assert.equal(live.result, "pending");
    assert.match(live.note, /live total/);
  });

  it("unders die as soon as the total passes the line, because scores only rise", () => {
    const under = pick({ sport: "basketball", selection: "Under 210.5" });
    assert.equal(settleBasket(under, 120, 100, false).result, "lost");
  });

  it("unders win at the buzzer", () => {
    const under = pick({ sport: "basketball", selection: "Under 210.5" });
    assert.equal(settleBasket(under, 100, 100, true).result, "won");
  });

  it("moneyline follows the higher score", () => {
    const home = pick({ sport: "basketball", family: "win", market: "Winner", selection: "Home" });
    assert.equal(settleBasket(home, 99, 98, true).result, "won");
    assert.equal(settleBasket(home, 97, 98, true).result, "lost");
    assert.equal(settleBasket(home, 97, 98, false).result, "pending");
  });
});

describe("tennis settlement", () => {
  it("counts sets from the score string", () => {
    const match = pick({ sport: "tennis", family: "win", market: "Winner", selection: "Home" });
    const settled = settleTennis(match, 2, 1, true, "6:4 4:6 6:3");
    assert.equal(settled.result, "won");
  });

  it("totals use games, not sets", () => {
    // 6:4 4:6 6:3 = 29 games, well over 22.5
    const over = pick({ sport: "tennis", family: "ou", market: "Total Games", selection: "Over 22.5" });
    assert.equal(settleTennis(over, 2, 1, true, "6:4 4:6 6:3").result, "won");
    const under = pick({ sport: "tennis", family: "ou", market: "Total Games", selection: "Under 20.5" });
    assert.equal(settleTennis(under, 2, 1, true, "6:4 4:6 6:3").result, "lost");
  });

  it("stays pending while the match is on court", () => {
    const match = pick({ sport: "tennis", family: "win", market: "Winner", selection: "Home" });
    assert.equal(settleTennis(match, 1, 0, false, "6:4").result, "pending");
  });
});
