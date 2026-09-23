import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listMiniAppSlips, recordMiniAppSlip, type HistoryDependencies } from "./miniapp-history.ts";
import type { Sql } from "./db.ts";

function fakeSql(rows: unknown[] = [], shouldFail = false): Sql {
  const run = async () => { if (shouldFail) throw new Error("db down"); return rows; };
  const sql = (async () => run()) as unknown as Sql;
  sql.query = async () => run() as Promise<any[]>;
  return sql;
}

function dependencies(available: boolean, rows: unknown[] = [], shouldFail = false): HistoryDependencies {
  return { persistentAvailable: () => available, sql: async () => fakeSql(rows, shouldFail) };
}

describe("Mini App history", () => {
  it("returns a clear unavailable state without DATABASE_URL", async () => {
    const result = await listMiniAppSlips("123", dependencies(false));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "database_unavailable");
  });
  it("maps stored history rows", async () => {
    const result = await listMiniAppSlips("123", dependencies(true, [{ id: "1", booking_code: "ABC12", created_at: "2026-09-23T00:00:00Z", sport: "football", selection_count: 3, combined_odds: 4.2, status: "created" }]));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.slips[0]?.bookingCode, "ABC12");
  });
  it("surfaces storage failures and records only when persistent", async () => {
    assert.equal(await recordMiniAppSlip({ telegramUserId: "1", bookingCode: "A", sport: "football", combinedOdds: 2, picks: [] }, dependencies(false)), false);
    const failed = await listMiniAppSlips("123", dependencies(true, [], true));
    assert.equal(failed.ok, false);
  });
});
