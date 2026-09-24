import { getSql, persistentDatabaseAvailable, type Sql } from "./db";

export type IdempotencyDependencies = {
  persistentAvailable: () => boolean;
  sql: () => Promise<Sql>;
};

const defaultDependencies: IdempotencyDependencies = {
  persistentAvailable: persistentDatabaseAvailable,
  sql: getSql,
};

type StoredRow = {
  request_hash: string;
  status: string;
  response_json: string | null;
};

type IdempotencyFailure = {
  ok: false;
  code: "idempotency_conflict" | "request_in_progress";
  error: string;
};

const pending = new Map<string, { hash: string; promise: Promise<unknown> }>();
const completed = new Map<string, { hash: string; response: unknown; expires: number }>();
const MEMORY_TTL_MS = 10 * 60_000;

async function runInMemory<T>(
  memoryKey: string,
  requestHash: string,
  operation: () => Promise<T>,
): Promise<T | IdempotencyFailure> {
  const previous = completed.get(memoryKey);
  if (previous && previous.expires > Date.now()) {
    if (previous.hash !== requestHash) {
      return {
        ok: false,
        code: "idempotency_conflict",
        error: "This booking request ID was already used for different selections.",
      };
    }
    return previous.response as T;
  }
  completed.delete(memoryKey);
  const active = pending.get(memoryKey);
  if (active) {
    if (active.hash !== requestHash) {
      return {
        ok: false,
        code: "idempotency_conflict",
        error: "This booking request ID was already used for different selections.",
      };
    }
    return active.promise as Promise<T>;
  }
  const task = operation().then((response) => {
    completed.set(memoryKey, { hash: requestHash, response, expires: Date.now() + MEMORY_TTL_MS });
    if (completed.size > 500) {
      for (const [key, item] of completed) {
        if (item.expires <= Date.now()) completed.delete(key);
      }
      if (completed.size > 500) completed.delete(completed.keys().next().value!);
    }
    return response;
  }).finally(() => pending.delete(memoryKey));
  pending.set(memoryKey, { hash: requestHash, promise: task });
  return task;
}

export async function runIdempotent<T>(
  userId: string,
  requestId: string,
  requestHash: string,
  operation: () => Promise<T>,
  dependencies: IdempotencyDependencies = defaultDependencies,
): Promise<T | IdempotencyFailure> {
  const memoryKey = `${userId}:${requestId}`;
  const previous = completed.get(memoryKey);
  if (previous && previous.expires > Date.now()) {
    if (previous.hash !== requestHash) {
      return {
        ok: false,
        code: "idempotency_conflict",
        error: "This booking request ID was already used for different selections.",
      };
    }
    return previous.response as T;
  }
  completed.delete(memoryKey);
  const active = pending.get(memoryKey);
  if (active) {
    if (active.hash !== requestHash) {
      return {
        ok: false,
        code: "idempotency_conflict",
        error: "This booking request ID was already used for different selections.",
      };
    }
    return active.promise as Promise<T>;
  }

  if (!dependencies.persistentAvailable()) {
    return runInMemory(memoryKey, requestHash, operation);
  }

  let sql: Sql;
  let claimed: Array<{ request_id: string }>;
  try {
    sql = await dependencies.sql();
    claimed = await sql<{ request_id: string }>`
      insert into miniapp_booking_requests (
        telegram_user_id, request_id, request_hash, status
      ) values (${userId}, ${requestId}, ${requestHash}, ${"pending"})
      on conflict (telegram_user_id, request_id) do nothing
      returning request_id
    `;
  } catch (error) {
    console.error(
      "[miniapp.idempotency] storage unavailable:",
      error instanceof Error ? error.message : "unknown error",
    );
    return runInMemory(memoryKey, requestHash, operation);
  }

  if (!claimed.length) {
    let rows: StoredRow[];
    try {
      rows = await sql<StoredRow>`
        select request_hash, status, response_json
        from miniapp_booking_requests
        where telegram_user_id = ${userId} and request_id = ${requestId}
        limit 1
      `;
    } catch (error) {
      console.error(
        "[miniapp.idempotency] replay lookup failed:",
        error instanceof Error ? error.message : "unknown error",
      );
      return {
        ok: false,
        code: "request_in_progress",
        error: "This booking request may already be processing. Wait a moment before retrying.",
      };
    }
    const existing = rows[0];
    if (!existing || existing.request_hash !== requestHash) {
      return {
        ok: false,
        code: "idempotency_conflict",
        error: "This booking request ID was already used for different selections.",
      };
    }
    if (existing.status === "completed" && existing.response_json) {
      try {
        return JSON.parse(existing.response_json) as T;
      } catch {
        return {
          ok: false,
          code: "request_in_progress",
          error:
            "The previous booking response could not be replayed safely. Start a new booking request.",
        };
      }
    }
    return {
      ok: false,
      code: "request_in_progress",
      error: "This booking request is already being processed. Wait a moment before retrying.",
    };
  }

  const task = operation();
  pending.set(memoryKey, { hash: requestHash, promise: task });
  try {
    const result = await task;
    try {
      await sql`
        update miniapp_booking_requests
        set status = ${"completed"}, response_json = ${JSON.stringify(result)}, updated_at = now()
        where telegram_user_id = ${userId} and request_id = ${requestId}
      `;
    } catch (error) {
      console.error(
        "[miniapp.idempotency] result persistence failed:",
        error instanceof Error ? error.message : "unknown error",
      );
    }
    return result;
  } catch (error) {
    await sql`
      delete from miniapp_booking_requests
      where telegram_user_id = ${userId} and request_id = ${requestId} and status = ${"pending"}
    `.catch(() => undefined);
    throw error;
  } finally {
    pending.delete(memoryKey);
  }
}
