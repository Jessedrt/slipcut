import { createServerFn } from "@tanstack/react-start";
import { bankrollSummary, bookSummary, calibrationReport } from "./study.ts";
import { geminiKeys, seekaiKeys, youKeys } from "./keys.ts";

/**
 * Read-only view of the desk, for the website.
 *
 * Deliberately a view and nothing else: it cannot cut, mint or book a slip.
 * Every one of those actions lives on Telegram, where the punter actually is
 * (see `DESK_CLOSED` in analyze.ts). This page exists so the numbers have a
 * home you can look at — record, money, calibration, engine status.
 */

export type DeskSnapshot = Awaited<ReturnType<typeof snapshot>>;

async function snapshot() {
  const [book, money, calibration] = await Promise.all([
    bookSummary(12),
    bankrollSummary(),
    calibrationReport(),
  ]);
  return {
    book,
    money,
    calibration,
    engines: [
      { key: "gemini", keys: geminiKeys().length },
      { key: "opus", keys: seekaiKeys().length },
      { key: "you.com", keys: youKeys().length },
    ],
    at: Date.now(),
  };
}

export const deskSnapshot = createServerFn({ method: "GET" }).handler(snapshot);
