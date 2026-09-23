import { getSql, persistentDatabaseAvailable, type Sql } from "./db";
import type { TicketPick } from "./types";

export type MiniAppSlipHistoryItem = {
  id: string;
  bookingCode: string;
  createdAt: string;
  sport: string;
  selectionCount: number;
  combinedOdds: number | null;
  status: string;
};

export type MiniAppHistoryResult =
  | { ok: true; persistent: true; slips: MiniAppSlipHistoryItem[] }
  | { ok: false; persistent: false; code: "database_unavailable"; error: string };

export type HistoryDependencies = {
  persistentAvailable: () => boolean;
  sql: () => Promise<Sql>;
};

const defaultHistoryDependencies: HistoryDependencies = {
  persistentAvailable: persistentDatabaseAvailable,
  sql: getSql,
};

export async function recordMiniAppSlip(input: {
  telegramUserId: string;
  bookingCode: string;
  sport: string;
  combinedOdds: number | null;
  picks: TicketPick[];
}, dependencies: HistoryDependencies = defaultHistoryDependencies) {
  if (!dependencies.persistentAvailable()) return false;
  const sql = await dependencies.sql();
  const id = globalThis.crypto.randomUUID();
  await sql`
    insert into miniapp_slips (
      id, telegram_user_id, booking_code, sport, selection_count,
      combined_odds, status, picks_json
    ) values (
      ${id}, ${input.telegramUserId}, ${input.bookingCode}, ${input.sport},
      ${input.picks.length}, ${input.combinedOdds}, ${"created"},
      ${JSON.stringify(input.picks)}
    )
  `;
  return true;
}

export async function listMiniAppSlips(
  telegramUserId: string,
  dependencies: HistoryDependencies = defaultHistoryDependencies,
): Promise<MiniAppHistoryResult> {
  if (!dependencies.persistentAvailable()) {
    return {
      ok: false,
      persistent: false,
      code: "database_unavailable",
      error: "Persistent slip history is unavailable because DATABASE_URL is not configured.",
    };
  }
  try {
    const sql = await dependencies.sql();
    const rows = await sql<{
      id: string;
      booking_code: string;
      created_at: string | Date;
      sport: string;
      selection_count: number;
      combined_odds: number | null;
      status: string;
    }>`
      select id, booking_code, created_at, sport, selection_count, combined_odds, status
      from miniapp_slips
      where telegram_user_id = ${telegramUserId}
      order by created_at desc
      limit 20
    `;
    return {
      ok: true,
      persistent: true,
      slips: rows.map((row) => ({
        id: row.id,
        bookingCode: row.booking_code,
        createdAt:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at),
        sport: row.sport,
        selectionCount: Number(row.selection_count),
        combinedOdds:
          row.combined_odds == null ? null : Number(row.combined_odds),
        status: row.status,
      })),
    };
  } catch (error) {
    console.error(
      "[miniapp.history] read failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return {
      ok: false,
      persistent: false,
      code: "database_unavailable",
      error: "Slip history could not be loaded from persistent storage.",
    };
  }
}
