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

export type ChatBridge = {
  send: (method: string, payload: Record<string, unknown>) => Promise<void>;
};

export const chatBridge = new AsyncLocalStorage<ChatBridge>();

export async function sendScheduledLongshot() {
  console.log("longshot");
}

export async function runDeskCron() {
  console.log("cron");
}

export async function handleTelegramUpdate(update: any) {
  const msg = update?.message;
  if (!msg?.chat?.id) return;
  const chatId = msg.chat.id;
  const raw = String(msg.text || "").trim();
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  async function tg(method: string, payload: Record<string, unknown> = {}) {
    if (!token) return null;
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      const data = await res.json();
      return data.ok ? data.result : null;
    } catch {
      return null;
    }
  }
  if (!raw) {
    await tg("sendMessage", { chat_id: chatId, text: "Send Predict, Daily 2 odds, or paste a code." });
    return;
  }
  await tg("sendMessage", {
    chat_id: chatId,
    text: "Restoring full desk now. Send again in ~1 min after deploy finishes.",
  });
}
