import { AsyncLocalStorage } from "node:async_hooks";
import { analyzePicks } from "./analyze";
import { researchPicks } from "./research";
import { geminiReady, geminiVision } from "./gemini";
import { parseTicketText, extractShareCode } from "./parse-ticket";
import { firstUrl, youContents } from "./you";
import {
  loadBookingCode,
  listUpcomingPicks,
  mintShare,
  sportyOf,
  windowLabel,
  cookablePick,
  type CookWindow,
} from "./sportybet";
import {
  listBlocks,
  listAllows,
  loadOddsBand,
  loadRecentEventIds,
  markUpdateSeen,
  recordSlip,
  blockedBy,
  allowedBy,
  latestCode,
} from "./study";
import {
  buildToOdds,
  combinedOdds,
  formatKickoff,
  formatOdds,
  uniqueEvents,
  trimToOdds,
  keepTop,
  splitEven,
} from "./workbench";
import {
  MAX_LEGS,
  applyBand,
  clampLegs,
  clampOddsTarget,
  isCmd,
  parseCookWindow,
  parseSport,
  type OddsBand,
} from "./intent";
import type { AnalyzedPick, BookSport, TicketPick } from "./types";

export type ChatBridge = {
  send: (method: string, payload: Record<string, unknown>) => Promise<void>;
};

export const chatBridge = new AsyncLocalStorage<ChatBridge>();

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || "";
const TG_TIMEOUT_MS = 20_000;

const HELP = `What you can do here:
• Edit big tickets faster
• Split one slip into smaller slips
• Trim a ticket — bot asks for target odds or number of games (AI keeps safest legs)
• Change markets across a ticket
• Read booking codes, screenshots, and links
• Check today’s matches and book games from your instruction

Try: /help · Cook 30 odds · 2odds · trim · split into 2 · paste a code · paste X link`;

function esc(s: string) {
  return s.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
}

async function tg(method: string, payload: Record<string, unknown> = {}) {
  const bridged = chatBridge.getStore();
  if (bridged) {
    try {
      await bridged.send(method, payload);
    } catch (err) {
      console.error(`[bridge] ${method}:`, err instanceof Error ? err.message : err);
    }
    return null;
  }
  const token = TOKEN();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TG_TIMEOUT_MS),
    });
    const data = (await res.json()) as { ok?: boolean; result?: unknown; description?: string };
    if (!data.ok) console.error(`[tg] ${method}:`, data.description ?? res.status);
    return data.ok ? data.result : null;
  } catch (err) {
    console.error(`[tg] ${method}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

function playable(picks: TicketPick[]) {
  return picks.filter((p) => p.sport !== "other" && p.sporty);
}

async function cookPool(picks: TicketPick[], band: OddsBand | null) {
  const [blocks, allows] = await Promise.all([listBlocks(), listAllows()]);
  return applyBand(allowedBy(blockedBy(picks, blocks), allows), band);
}

function codeKeyboard(code: string) {
  return {
    inline_keyboard: [
      [
        { text: "📋 Copy code", copy_text: { text: code } },
        {
          text: "Open SportyBet",
          url: `https://www.sportybet.com/ng/?shareCode=${encodeURIComponent(code)}`,
        },
      ],
      [
        { text: "✂️ Trim", callback_data: `asktrim:${code}` },
        { text: "Trim 10×", callback_data: `trim10:${code}` },
        { text: "Split 2", callback_data: `split2:${code}` },
      ],
    ],
  };
}

function trimAskKeyboard(code: string) {
  return {
    inline_keyboard: [
      [
        { text: "5×", callback_data: `trim5:${code}` },
        { text: "10×", callback_data: `trim10:${code}` },
        { text: "15×", callback_data: `trimodds:${code}:15` },
        { text: "20×", callback_data: `trimodds:${code}:20` },
        { text: "30×", callback_data: `trimodds:${code}:30` },
      ],
      [
        { text: "2 games", callback_data: `trimn:${code}:2` },
        { text: "3 games", callback_data: `trimn:${code}:3` },
        { text: "5 games", callback_data: `trimn:${code}:5` },
        { text: "8 games", callback_data: `trimn:${code}:8` },
      ],
      [{ text: "Safest half", callback_data: `trim:${code}` }],
    ],
  };
}

async function askTrimTarget(chatId: number, code: string) {
  await tg("sendMessage", {
    chat_id: chatId,
    text: `How do you want to trim <code>${esc(code)}</code>?\n\nPick target odds or number of games:`,
    parse_mode: "HTML",
    reply_markup: trimAskKeyboard(code),
  });
}
