import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runIdempotent, type IdempotencyDependencies } from "./booking-idempotency.ts";
import type { Sql } from "./db.ts";

const noDatabase: IdempotencyDependencies = {
  persistentAvailable: () => false,
  sql: async () => {
    throw new Error("database should not be used");
  },
};

function persistentDependencies(): IdempotencyDependencies {
  let row: { requestHash: string; status: string; responseJson: string | null } | undefined;
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim().toLowerCase();
    if (query.startsWith("insert into miniapp_booking_requests")) {
      if (row) return [] as T[];
      row = { requestHash: String(values[2]), status: "pending", responseJson: null };
      return [{ request_id: String(values[1]) }] as T[];
    }
    if (query.startsWith("select request_hash")) {
      return row
        ? ([
            { request_hash: row.requestHash, status: row.status, response_json: row.responseJson },
          ] as T[])
        : [];
    }
    if (query.startsWith("update miniapp_booking_requests")) {
      if (row) {
        row.status = String(values[0]);
        row.responseJson = String(values[1]);
      }
      return [] as T[];
    }
    if (query.startsWith("delete from miniapp_booking_requests")) {
      row = undefined;
      return [] as T[];
    }
    throw new Error(`Unexpected query: ${query}`);
  }) as Sql;
  sql.query = async () => [];
  return { persistentAvailable: () => true, sql: async () => sql };
}

describe("booking idempotency", () => {
  it("shares one in-flight booking operation for duplicate requests", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const operation = async () => {
      calls += 1;
      await gate;
      return { ok: true, shareCode: "REAL12" };
    };
    const first = runIdempotent("user-a", "request-123", "hash-a", operation, noDatabase);
    const second = runIdempotent("user-a", "request-123", "hash-a", operation, noDatabase);
    release?.();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.deepEqual(a, b);
  });

  it("does not deduplicate different request IDs", async () => {
    let calls = 0;
    const operation = async () => ({ ok: true, sequence: ++calls });
    const first = await runIdempotent("user-b", "request-one", "hash", operation, noDatabase);
    const second = await runIdempotent("user-b", "request-two", "hash", operation, noDatabase);
    assert.equal(calls, 2);
    assert.notDeepEqual(first, second);
  });

  it("replays a completed request in the same process after a network retry", async () => {
    let calls = 0;
    const operation = async () => ({ ok: true, shareCode: `REAL${++calls}` });
    const first = await runIdempotent("user-retry", "request-retry", "hash", operation, noDatabase);
    const second = await runIdempotent("user-retry", "request-retry", "hash", operation, noDatabase);
    assert.deepEqual(first, second);
    assert.equal(calls, 1);
  });

  it("rejects reuse of an active request ID with a different payload", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runIdempotent(
      "user-c",
      "request-shared",
      "hash-a",
      async () => {
        await gate;
        return { ok: true };
      },
      noDatabase,
    );
    const conflict = await runIdempotent(
      "user-c",
      "request-shared",
      "hash-b",
      async () => ({ ok: true }),
      noDatabase,
    );
    assert.deepEqual(conflict, {
      ok: false,
      code: "idempotency_conflict",
      error: "This booking request ID was already used for different selections.",
    });
    release?.();
    await first;
  });

  it("replays a completed persistent response without minting twice", async () => {
    const dependencies = persistentDependencies();
    let calls = 0;
    const operation = async () => ({ ok: true, shareCode: `REAL${++calls}` });
    const first = await runIdempotent(
      "user-d",
      "request-persisted",
      "hash-a",
      operation,
      dependencies,
    );
    const replay = await runIdempotent(
      "user-d",
      "request-persisted",
      "hash-a",
      operation,
      dependencies,
    );
    assert.equal(calls, 1);
    assert.deepEqual(replay, first);
  });
});
