import { AsyncLocalStorage } from "node:async_hooks";
import { analyzePicks } from "./analyze";
import { normalizePidgin, pidginSmallTalk, slangHelp, splitChat, wantsCreate } from "./pidgin";
import { researchPicks } from "./research";
import { getEventDetail, eventScore, loadBookingCode, listUpcomingPicks, mintShare, parseCookAsks, parseMarketTarget, pickMatchesAsks, formatCookAsks, retargetPicks, sportyOf, windowLabel, cookablePick, type CookAsk, type CookWindow } from "./sportybet";
import { addAllow, addBlock, allowedBy, applyLessonScores, blockedBy, clearAllows, deletePendingReview, formatBook, formatRecap, formatStudy, latestCode, latestUnstudiedCode, listAllows, listBlocks, listChats, loadOddsBand, loadPendingReview, loadRecentEventIds, markUpdateSeen, recordSlip, recordStake, rememberChat, rememberEventIds, removeBlock, saveOddsBand, savePendingReview, studyCode, updatePendingReview, type PendingReview } from "./study";
import { addDeskKey, delDeskKey, detectKey, formatKeyList, refreshKeys } from "./keys";
import { seekaiReady } from "./seekai";
import { geminiReady } from "./gemini";
import { buildToOdds, combinedOdds, formatKickoff, formatOdds, keepTop, parseCommand, splitEven, trimToOdds, uniqueEvents } from "./workbench";
import { pct } from "./format";
import { accuracyFilter, loadAccuracy, pickFamily } from "./accuracy";
import { sendEngineToChats } from "./engine";
import {
  MAX_LEGS,
  applyBand,
  clampLegs,
  clampOddsTarget,
  cmdArg,
  codeFromText,
  escapeHtml as esc,
  isCmd,
  looksLikeShareCode,
  normalizeFilter,
  parseBlock,
  parseCombineCode,
  parseCookWindow,
  parseDropIndexes,
  parseLegCount,
  parseOddsBand,
  parseOddsTarget,
  parseSport,
  parseStake,
  wantsChampions,
  wantsDraw,
  wantsLive,
  wantsMix,
  type OddsBand,
} from "./intent";
import type { BookSport, TicketPick } from "./types";

// PART1 — assembled with part2 by scripts/assemble-telegram.mjs at build time
export type ChatBridge = {
  send: (method: string, payload: Record<string, unknown>) => Promise<void>;
};
export const chatBridge = new AsyncLocalStorage<ChatBridge>();
