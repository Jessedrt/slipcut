import { createServerFn } from "@tanstack/react-start";
import { bankrollSummary, bookSummary, calibrationReport } from "./study.ts";
import { geminiKeys, seekaiKeys, youKeys } from "./keys.ts";
import { dbSource, getSql } from "./db.ts";

/**
 * Read-only view of the desk, for the website.
 *
 * Deliberately a view and nothing else: it cannot cut, mint or book a slip.
 * Every one of those actions lives on Telegram, where the punter actually is
 * (see `DESK_CLOSED` in analyze.ts). This page exists so the numbers have a
 * home you can look at — record, money, calibration, engine status, and
 * whether the database underneath all of it is answering.
 */

export type DeskSnapshot = Awaited<ReturnType<typeof snapshot>>;

/**
 * Is the book's home alive? Which backend, how quick a read, how far through
 * the schema, how much it holds, and when a read last landed. One failing
 * query flips `ok` — the panel would rather say "down" than pretend. Never
 * throws: a sick database is exactly when this must still answer.
 */
async function databaseHealth() {
  const started = Date.now();
  try {
    const sql = await getSql();
    await sql`select 1`;
    const ms = Date.now() - started;
    const [migrations] = await sql<{ n: number }>`select count(*) as n from _migrations`;
    const [slips] = await sql<{ n: number }>`select count(*) as n from study_slips`;
    const [reads] = await sql<{ n: number }>`select count(*) as n from desk_predictions`;
    const [fresh] = await sql<{ latest: string | null }>`
      select extract(epoch from max(created_at)) as latest from desk_predictions
    `;
    // epoch -> numeric -> string on both backends; null when nothing read yet.
    const latestReadAt = fresh?.latest == null ? null : Math.round(Number(fresh.latest) * 1000);
    return {
      ok: true as const,
      backend: dbSource,
      ms,
      migrations: Number(migrations?.n ?? 0),
      slips: Number(slips?.n ?? 0),
      reads: Number(reads?.n ?? 0),
      latestReadAt,
    };
  } catch {
    return {
      ok: false as const,
      backend: dbSource,
      ms: Date.now() - started,
      migrations: 0,
      slips: 0,
      reads: 0,
      latestReadAt: null,
    };
  }
}

async function snapshot() {
  const [book, money, calibration, database] = await Promise.all([
    bookSummary(12),
    bankrollSummary(),
    calibrationReport(),
    databaseHealth(),
  ]);
  return {
    book,
    money,
    calibration,
    database,
    engines: [
      { key: "gemini", keys: geminiKeys().length },
      { key: "opus", keys: seekaiKeys().length },
      { key: "you.com", keys: youKeys().length },
    ],
    at: Date.now(),
  };
}

export const deskSnapshot = createServerFn({ method: "GET" }).handler(snapshot);
