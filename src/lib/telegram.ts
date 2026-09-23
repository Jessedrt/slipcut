import { AsyncLocalStorage } from "node:async_hooks";
import { buildSlip, type BuildSlipRequest } from "./build-slip";
import { mintReviewedSlip } from "./book-slip";
import {
  loadBookingCode,
} from "./sportybet";
import {
  markUpdateSeen,
  recordSlip,
  latestCode,
} from "./study";
import {
  formatKickoff,
  formatOdds,
  uniqueEvents,
  trimToOdds,
  keepTop,
  splitEven,
} from "./workbench";
import {
  MAX_LEGS,
  clampOddsTarget,
  isCmd,
  missingChatBuildField,
  parseChatBuildDraft,
  type ChatBuildDraft,
} from "./intent";
import type { AnalyzedPick, TicketPick } from "./types";

export type ChatBridge = {
  send: (method: string, payload: Record<string, unknown>) => Promise<void>;
};
export const chatBridge = new AsyncLocalStorage<ChatBridge>();

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || "";
const TG_TIMEOUT_MS = 20_000;

const HELP = `SlipCut is ready.

Describe the complete slip you want in one message, or paste a SportyBet booking code.

Examples:
• Cook 5 football games today
• Cook 5 odds basketball
• 2odds

Use Open SlipCut for the full builder and manual review.`;

const REMOVE_DESK_KEYBOARD = { remove_keyboard: true } as const;
const CHAT_BUILD_TTL_MS = 30 * 60_000;
const telegramGlobal = globalThis as typeof globalThis & {
  __slipcutLastBuilds__?: Map<number, { draft: ChatBuildDraft; expires: number }>;
};
const lastBuilds = telegramGlobal.__slipcutLastBuilds__ ??= new Map();

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

function codeKeyboard(code: string) {
  return {
    inline_keyboard: [
      [
        { text: "📋 Copy code", copy_text: { text: code } },
        { text: "Open SportyBet", url: `https://www.sportybet.com/ng/?shareCode=${encodeURIComponent(code)}` },
      ],
      [
        { text: "✂️ Trim", callback_data: `trim:${code}` },
        { text: "Trim 10×", callback_data: `trim10:${code}` },
        { text: "Split 2", callback_data: `split2:${code}` },
      ],
    ],
  };
}

function pickLines(work: TicketPick[]) {
  return work.map((p, i) => {
    const price = p.odds ? formatOdds(p.odds) : "";
    const when = formatKickoff(p.kickoff);
    return `${i + 1}. ${esc(p.home)} vs ${esc(p.away)} · ${esc(p.selection)}${price ? ` · ${price}` : ""}${when ? ` · ${when}` : ""}`;
  });
}

async function mintAndReply(chatId: number, picks: TicketPick[], title: string) {
  const unique = uniqueEvents(picks);
  const work = unique.picks.slice(0, MAX_LEGS);
  const lines = pickLines(work);
  if (!work.some((pick) => pick.sporty?.eventId)) {
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: [esc(title), "Picks (no booking IDs yet):", "", ...lines].join("\n").slice(0, 3900),
    });
    return;
  }
  const booked = await mintReviewedSlip(work, "ng");
  if (!booked.ok) {
    console.error("[mint]", booked.code, booked.error, "n=", work.length);
    const remaining = booked.available ?? [];
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: [
        esc(booked.error),
        remaining.length ? `${remaining.length} refreshed selection(s) remain available. Review them in Open SlipCut before retrying.` : "No booking code was created.",
      ]
        .join("\n")
        .slice(0, 3900),
    });
    return;
  }
  const code = booked.shareCode;
  const combo = booked.combinedOdds;
  const head = `${esc(title)}${combo ? ` · ${formatOdds(combo)}` : ""} · ${booked.picks.length} games`;
  await tg("sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text: [`<code>${esc(code)}</code>`, head, "", ...pickLines(booked.picks)].join("\n").slice(0, 3900),
    reply_markup: codeKeyboard(code),
  });
  await recordSlip(code, booked.picks).catch(() => {});
}

async function resolveCode(raw: string): Promise<string | null> {
  const m = raw.match(/\b([A-Za-z0-9]{5,12})\b/);
  if (
    m &&
    !/^(trim|optimize|split|change|help|odds|to|into|safer|games|today|football|basketball|find|give|cook)$/i.test(
      m[1],
    )
  ) {
    return m[1].toUpperCase();
  }
  return latestCode();
}

async function loadPlayableCode(code: string) {
  const loaded = await loadBookingCode(code, "ng");
  if ("error" in loaded) return loaded;
  return { shareCode: loaded.shareCode, picks: playable(loaded.picks) };
}

async function trimCode(chatId: number, code: string, targetOdds?: number) {
  const loaded = await loadPlayableCode(code);
  if ("error" in loaded) {
    await tg("sendMessage", { chat_id: chatId, text: loaded.error });
    return;
  }
  const base = loaded.picks;
  if (!base.length) {
    await tg("sendMessage", { chat_id: chatId, text: "No playable legs in that code." });
    return;
  }
  await tg("sendMessage", {
    chat_id: chatId,
    text: targetOdds ? `Trimming toward ${formatOdds(targetOdds)}…` : "Trimming — keeping safest legs…",
  });
  const pool = base.map((p) => ({
    ...p,
    probability: p.probability ?? (p.odds ? Math.max(20, Math.min(80, 100 / (p.odds || 2))) : 50),
    confidence: "medium" as const,
    summary: "",
    reasons: [],
    risks: [],
    verdict: "keep" as const,
  })) as AnalyzedPick[];
  pool.sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0) || (a.odds ?? 99) - (b.odds ?? 99));
  let take: TicketPick[];
  if (targetOdds && targetOdds > 1.2) take = trimToOdds(pool, clampOddsTarget(targetOdds));
  else take = keepTop(pool, Math.max(2, Math.ceil(pool.length / 2)));
  if (!take.length) take = base.slice(0, Math.min(3, base.length));
  await mintAndReply(chatId, take, `Trimmed`);
}

async function splitCode(chatId: number, code: string, parts: number) {
  const n = Math.min(6, Math.max(2, Math.round(parts) || 2));
  const loaded = await loadPlayableCode(code);
  if ("error" in loaded) {
    await tg("sendMessage", { chat_id: chatId, text: loaded.error });
    return;
  }
  const base = loaded.picks;
  if (base.length < n) {
    await tg("sendMessage", { chat_id: chatId, text: `Only ${base.length} games — need at least ${n}.` });
    return;
  }
  await tg("sendMessage", { chat_id: chatId, text: `Splitting into ${n}…` });
  const ordered = [...base].sort(
    (a, b) => (b.probability ?? 0) - (a.probability ?? 0) || (a.odds ?? 99) - (b.odds ?? 99),
  );
  const groups = splitEven(ordered, n);
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (!g?.length) continue;
    await mintAndReply(chatId, g, `Split ${i + 1}/${groups.length}`);
  }
}

async function cookRequest(chatId: number, request: BuildSlipRequest) {
  try {
    const result = await buildSlip(request);
    if (!result.ok) {
      const next = result.code === "no_events" && request.window === "today"
        ? " Try ‘upcoming’ to widen the window."
        : "";
      await tg("sendMessage", { chat_id: chatId, text: `${result.error}${next}` });
      return;
    }
    const target = request.mode === "odds" ? ` · target ${formatOdds(request.targetOdds ?? 0)}` : "";
    await mintAndReply(
      chatId,
      result.selections,
      `${result.policy.label} · ${result.actualGames} ${request.sport}${target}`,
    );
  } catch (err) {
    console.error("cookRequest:", err instanceof Error ? err.message : err);
    await tg("sendMessage", {
      chat_id: chatId,
      text: "SlipCut could not finish the analysis. No booking code was created. Try again shortly.",
    });
  }
}

async function cookDaily2(chatId: number) {
  await cookRequest(chatId, {
    sport: "football",
    mode: "odds",
    targetOdds: 2,
    risk: "conservative",
    window: "today",
  });
}

function activeDraft(chatId: number) {
  const saved = lastBuilds.get(chatId);
  if (!saved || saved.expires <= Date.now()) {
    lastBuilds.delete(chatId);
    return {};
  }
  return saved.draft;
}

function saveDraft(chatId: number, draft: ChatBuildDraft) {
  lastBuilds.set(chatId, { draft, expires: Date.now() + CHAT_BUILD_TTL_MS });
}

function completeBuildRequest(draft: ChatBuildDraft): BuildSlipRequest | null {
  if (!draft.sport || !draft.mode || !draft.risk || !draft.window) return null;
  if (draft.mode === "odds") {
    if (draft.targetOdds == null) return null;
    return { sport: draft.sport, mode: "odds", targetOdds: draft.targetOdds, risk: draft.risk, window: draft.window };
  }
  if (draft.games == null) return null;
  return { sport: draft.sport, mode: "games", games: draft.games, risk: draft.risk, window: draft.window };
}

type TgUpdate = {
  update_id?: number;
  message?: { message_id?: number; chat?: { id: number }; text?: string; photo?: { file_id: string }[] };
  callback_query?: { id: string; from?: { id: number }; data?: string; message?: { message_id?: number; chat?: { id: number }; text?: string } };
};

export async function sendScheduledLongshot() {
  console.log("longshot");
}
export async function runDeskCron() {
  console.log("cron");
}

export async function handleTelegramUpdate(update: TgUpdate) {
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message?.chat?.id;
    const data = String(cb.data || "");
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    if (!chatId) return;
    if (data.startsWith("trim:")) return void (await trimCode(chatId, data.slice(5)));
    if (data.startsWith("trim10:")) return void (await trimCode(chatId, data.slice(7), 10));
    if (data.startsWith("split2:")) return void (await splitCode(chatId, data.slice(7), 2));
    return;
  }

  const msg = update.message;
  if (!msg?.chat?.id) return;
  const chatId = msg.chat.id;
  const raw = String(msg.text || "").trim();
  if (!raw) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Send your request as text, paste a SportyBet code, or use /help.",
      reply_markup: REMOVE_DESK_KEYBOARD,
    });
    return;
  }
  if (update.update_id && !(await markUpdateSeen(update.update_id).catch(() => true))) return;
  const lower = raw.toLowerCase();

  if (isCmd(raw, "start") || /^\/start\b/i.test(raw) || isCmd(raw, "help") || /^\/?help\b/i.test(raw)) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: HELP,
      reply_markup: REMOVE_DESK_KEYBOARD,
    });
    return;
  }

  const splitMatch = lower.match(/split(?:\s+(?:this\s+)?(?:ticket|code|slip))?(?:\s+into)?\s+(\d+)/i);
  if (splitMatch || isCmd(raw, "split") || /^split\b/i.test(raw)) {
    const parts = splitMatch ? Number(splitMatch[1]) : 2;
    const code = await resolveCode(raw);
    if (!code) {
      await tg("sendMessage", { chat_id: chatId, text: "Paste a booking code, then: split into 2" });
      return;
    }
    await splitCode(chatId, code, parts);
    return;
  }

  if (isCmd(raw, "trim") || /^(trim|optimize)\b/i.test(raw)) {
    const code = await resolveCode(raw);
    if (!code) {
      await tg("sendMessage", { chat_id: chatId, text: "Paste a booking code first, then: trim" });
      return;
    }
    const oddsMatch = lower.match(/(?:to\s+)?(\d+(?:\.\d+)?)\s*(?:odds|[x×])/i);
    await trimCode(chatId, code, oddsMatch ? clampOddsTarget(Number(oddsMatch[1])) : undefined);
    return;
  }

  if (isCmd(raw, "2odds") || /^(2odds|rollover)\s*$/i.test(raw)) {
    await tg("sendMessage", { chat_id: chatId, text: "Cooking Daily 2 odds…" });
    saveDraft(chatId, { sport: "football", mode: "odds", targetOdds: 2, risk: "conservative", window: "today" });
    await cookDaily2(chatId);
    return;
  }

  const draft = parseChatBuildDraft(raw, activeDraft(chatId));
  if (draft) {
    saveDraft(chatId, draft);
    const missing = missingChatBuildField(draft);
    if (missing === "targetOdds") {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "What combined odds should I target? For example: 5 odds.",
      });
      return;
    }
    if (missing === "games") {
      await tg("sendMessage", { chat_id: chatId, text: "How many games should I build? Send a number from 2 to 15." });
      return;
    }
    const request = completeBuildRequest(draft);
    if (!request) {
      await tg("sendMessage", { chat_id: chatId, text: "Describe the slip in one message, for example: Cook 5 football games today." });
      return;
    }
    const requestLabel = request.mode === "odds"
      ? `${formatOdds(request.targetOdds ?? 0)} ${request.sport}`
      : `${request.games} ${request.sport} games`;
    await tg("sendMessage", {
      chat_id: chatId,
      text: `Building ${requestLabel} · ${request.risk} · ${request.window}…`,
    });
    await cookRequest(chatId, request);
    return;
  }

  const code = raw.replace(/\s+/g, "").toUpperCase();
  if (/^[A-Z0-9]{5,12}$/.test(code) && !/^(SAFER|GAMES|TODAY|FOOTBALL|COOK|FIND)$/.test(code)) {
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await tg("sendMessage", { chat_id: chatId, text: loaded.error });
      return;
    }
    const play = playable(loaded.picks);
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: `<code>${esc(loaded.shareCode)}</code>\n${play.length} games loaded`,
      reply_markup: codeKeyboard(loaded.shareCode),
    });
    await recordSlip(loaded.shareCode, play).catch(() => {});
    return;
  }

  await tg("sendMessage", {
    chat_id: chatId,
    text: "I couldn't understand that. Describe the slip in one message, paste a SportyBet code, or send /help.",
    reply_markup: REMOVE_DESK_KEYBOARD,
  });
}
