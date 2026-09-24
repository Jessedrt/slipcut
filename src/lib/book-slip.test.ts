import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mintReviewedSlip, type BookDependencies } from "./book-slip.ts";
import type { TicketPick } from "./types.ts";

function pick(id: number): TicketPick {
  return {
    id: `p-${id}`,
    sport: "football",
    league: "Premier League",
    home: `H${id}`,
    away: `A${id}`,
    market: "Double Chance",
    selection: "Home or Draw",
    odds: 1.5,
    kickoff: Date.now() + 3_600_000,
    sporty: { eventId: `e-${id}`, marketId: "10", outcomeId: "9" },
  };
}

function dependencies(overrides: Partial<BookDependencies> = {}): BookDependencies {
  return {
    refresh: async (picks) => ({ available: picks, unavailable: [] }),
    mint: async () => ({
      shareCode: "REAL12",
      shareURL: "https://www.sportybet.com/ng/?shareCode=REAL12",
      unavailable: 0,
    }),
    ...overrides,
  };
}

describe("reviewed booking", () => {
  it("does not mint when an outcome expired", async () => {
    let minted = false;
    const result = await mintReviewedSlip(
      [pick(1)],
      "ng",
      dependencies({
        refresh: async (picks) => ({
          available: [],
          unavailable: [{ pick: picks[0]!, reason: "closed" }],
        }),
        mint: async () => {
          minted = true;
          return { error: "should not run" };
        },
      }),
    );
    assert.equal(result.ok, false);
    assert.equal(minted, false);
    if (!result.ok) assert.equal(result.code, "selection_unavailable");
  });

  it("returns remaining legs for partial unavailability", async () => {
    const rows = [pick(1), pick(2)];
    const result = await mintReviewedSlip(
      rows,
      "ng",
      dependencies({
        refresh: async () => ({
          available: [rows[0]!],
          unavailable: [{ pick: rows[1]!, reason: "closed" }],
        }),
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.available?.length, 1);
  });

  it("reports mint failure without inventing a code", async () => {
    const result = await mintReviewedSlip(
      [pick(1)],
      "ng",
      dependencies({ mint: async () => ({ error: "upstream" }) }),
    );
    assert.deepEqual(result, {
      ok: false,
      code: "mint_failed",
      error: "Booking code creation failed. No code was created.",
    });
  });

  it("does not display a partial code when SportyBet reports unavailable outcomes", async () => {
    const result = await mintReviewedSlip(
      [pick(1)],
      "ng",
      dependencies({
        mint: async () => ({
          shareCode: "PARTIAL",
          shareURL: "https://example.test/PARTIAL",
          unavailable: 1,
        }),
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "selection_unavailable");
  });

  it("distinguishes refresh provider failure from an expired selection", async () => {
    const result = await mintReviewedSlip(
      [pick(1)],
      "ng",
      dependencies({
        refresh: async () => ({
          available: [],
          unavailable: [],
          error: {
            code: "provider_timeout",
            error: "SportyBet refresh timed out.",
            retryable: true,
          },
        }),
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "provider_timeout");
  });

  it("rejects two selections from the same event before refresh", async () => {
    const rows = [pick(1), { ...pick(2), sporty: { ...pick(2).sporty!, eventId: "e-1" } }];
    const result = await mintReviewedSlip(rows, "ng", dependencies());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_request");
  });

  it("returns a real-shaped mint mock and respects manual removal", async () => {
    const rows = [pick(1), pick(2)];
    let refreshed = 0;
    const result = await mintReviewedSlip(
      [rows[1]!],
      "ng",
      dependencies({
        refresh: async (picks) => {
          refreshed = picks.length;
          return { available: picks, unavailable: [] };
        },
      }),
    );
    assert.equal(result.ok, true);
    assert.equal(refreshed, 1);
    if (result.ok) assert.equal(result.shareCode, "REAL12");
  });

  it("requires review when refreshed odds changed", async () => {
    let minted = false;
    const original = pick(1);
    const result = await mintReviewedSlip(
      [original],
      "ng",
      dependencies({
        refresh: async () => ({ available: [{ ...original, odds: 1.62 }], unavailable: [] }),
        mint: async () => {
          minted = true;
          return { shareCode: "NOPE", shareURL: "https://example.test", unavailable: 0 };
        },
      }),
      { acceptOddsChanges: false },
    );
    assert.equal(result.ok, false);
    assert.equal(minted, false);
    if (!result.ok) {
      assert.equal(result.code, "odds_changed");
      assert.deepEqual(
        result.changes?.map(({ beforeOdds, afterOdds }) => [beforeOdds, afterOdds]),
        [[1.5, 1.62]],
      );
    }
  });

  it("mints after the caller explicitly accepts refreshed odds", async () => {
    const original = pick(1);
    const result = await mintReviewedSlip(
      [original],
      "ng",
      dependencies({
        refresh: async () => ({ available: [{ ...original, odds: 1.62 }], unavailable: [] }),
      }),
      { acceptOddsChanges: true },
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.combinedOdds, 1.62);
  });
});
