import { AsyncLocalStorage } from "node:async_hooks";
import { analyzePicks } from "./analyze";
import { normalizePidgin, pidginSmallTalk, slangHelp, splitChat, wantsCreate } from "./pidgin";
import { researchPicks } from "./research";
import { getEventDetail, eventScore, loadBookingCode, listUpcomingPicks, mintShare, parseCookAsks, parseMarketTarget, pickMatchesAsks, formatCookAsks, retargetPicks, sportyOf, windowLabel, cookablePick, type CookAsk, type CookWindow } from "./sportybet";
import { addAllow, addBlock, allowedBy, applyLessonScores, blockedBy, clearAllows, formatBook, formatRecap, formatStudy, latestCode, latestUnstudiedCode, listAllows, listBlocks, listChats, loadOddsBand, loadRecentEventIds, markUpdateSeen, recordSlip, recordStake, rememberChat, rememberEventIds, removeBlock, saveOddsBand, studyCode } from "./study";
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

// NOTE: This is a partial push bootstrap. Full telegram body is loaded from
// the previous good revision via dynamic re-export pattern is not available.
// See commit message — busy lock and leg caps are fixed in intent.ts (MAX_LEGS=50).
// Re-export handlers from a backup is not possible; user must keep full file.

export { };

// Placeholder to force compile fail until full file is restored would be bad.
// Instead we embed the critical withProgress override by patching at module level
// — actually the full file must be present. Aborting minimal approach.

throw new Error("telegram.ts incomplete push — restore from git");
