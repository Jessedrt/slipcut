import { AsyncLocalStorage } from "node:async_hooks";
import { analyzePicks } from "./analyze";
import { researchPicks } from "./research";
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
  type PendingReview,
} from "./study";
import {
  buildToOdds,
  combinedOdds,
  formatKickoff,
  formatOdds,
  uniqueEvents,
  trimToOdds,
  keepTop,
} from "./workbench";
import {
  MAX_LEGS,
  applyBand,
  clampLegs,
  clampOddsTarget,
  isCmd,
  parseCookWindow,
  parseOddsBand,
  parseOddsTarget,
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

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
          url: `https://www.sportybet.com/ng/m/code-hub/load-code?code=${encodeURIComponent(code)}`,
        },
      ],
      [
        { text: "✂️ Trim", callback_data: `trim:${code}` },
        { text: "Trim to 10×", callback_data: `trim10:${code}` },
        { text: "Trim to 5×", callback_data: `trim5:${code}` },
      ],
    ],
  };
}

async function mintAndReply(chatId: number, picks: TicketPick[], title: string) {
  const unique = uniqueEvents(picks);
  const work = unique.picks.slice(0, MAX_LEGS);
  const selections = sportyOf(work);
  if (!selections.length) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Those games no get SportyBet ID. Try again later.",
    });
    return;
  }
  const minted = await mintShare(selections, "ng");
  if ("error" in minted) {
    await tg("sendMessage", { chat_id: chatId, text: minted.error });
    return;
  }
  const code = minted.shareCode;
  const combo = combinedOdds(work);
  const lines = work.map((p, i) => {
    const when = formatKickoff(p.kickoff);
    const price = p.odds ? formatOdds(p.odds) : "";
    return `${i + 1}. ${esc(p.home)} vs ${esc(p.away)} · ${esc(p.selection)}${price ? ` · ${price}` : ""}${when ? ` · ${when}` : ""}`;
  });
  const head = `${esc(title)}${combo ? ` · ${formatOdds(combo)}` : ""} · ${work.length} games`;
  await tg("sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text: [`<code>${esc(code)}</code>`, head, "", ...lines].join("\n").slice(0, 3900),
    reply_markup: codeKeyboard(code),
  });
  await recordSlip(code, work).catch(() => {});
}

async function analyzeThenMintAll(chatId: number, picks: TicketPick[], title: string) {
  try {
    const scored = await analyzePicks(picks, 40);
    const kept = scored.kept?.length ?? 0;
    const total = picks.length;
    await tg("sendMessage", {
      chat_id: chatId,
      text: `Predict · ${total} games · keeping all legs for odds target (${kept}/${total} above soft bar)`,
    });
  } catch (err) {
    console.error("analyzeThenMintAll analyze:", err instanceof Error ? err.message : err);
  }
  await mintAndReply(chatId, picks, title);
}

async function trimCode(chatId: number, code: string, targetOdds?: number) {
  const loaded = await loadBookingCode(code, "ng");
  if ("error" in loaded) {
    await tg("sendMessage", { chat_id: chatId, text: loaded.error });
    return;
  }
  const base = playable(loaded.picks);
  if (!base.length) {
    await tg("sendMessage", { chat_id: chatId, text: "No playable legs in that code." });
    return;
  }
  await tg("sendMessage", {
    chat_id: chatId,
    text: targetOdds
      ? `Trimming ${code} toward ${formatOdds(targetOdds)}…`
      : `Trimming ${code} — keeping safest legs…`,
  });

  const analysis = await analyzePicks(base, 40);
  const scored = (analysis.kept?.length ? analysis.kept : analysis.picks || []) as AnalyzedPick[];
  const pool = scored.length
    ? scored
    : (base.map((p) => ({
        ...p,
        probability: 55,
        confidence: "medium" as const,
        summary: "",
        reasons: [],
        risks: [],
        verdict: "keep" as const,
      })) as AnalyzedPick[]);

  let take: TicketPick[];
  if (targetOdds && targetOdds > 1.2) {
    take = trimToOdds(pool, clampOddsTarget(targetOdds));
  } else {
    const n = Math.max(2, Math.ceil(pool.length / 2));
    take = keepTop(pool, n);
  }
  if (!take.length) take = base.slice(0, Math.min(3, base.length));

  const actual = combinedOdds(take);
  await mintAndReply(
    chatId,
    take,
    `Trimmed${targetOdds ? ` to ~${formatOdds(clampOddsTarget(targetOdds))}` : ""}${actual ? ` · ${formatOdds(actual)}` : ""}`,
  );
}

async function cookOddsSlip(chatId: number, sport: BookSport, target: number, window: CookWindow) {
  const band = await loadOddsBand();
  const listed = await listUpcomingPicks(sport, 35, window, "any", await loadRecentEventIds());
  if ("error" in listed) {
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  const pool = await cookPool(listed.filter(cookablePick), band);
  const researched = await researchPicks(pool, 24);
  const only = researched.keep.filter((p) => p.sport === sport);
  const take = buildToOdds(only, target).slice(0, MAX_LEGS);
  if (!take.length) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `I no fit build ${formatOdds(target)} from the ${sport} wey dey now.`,
    });
    return;
  }
  const actual = combinedOdds(take);
  const span = windowLabel(window);
  const title = `${take.length} games ${sport}${span ? ` · ${span}` : ""}${actual ? ` · ${formatOdds(actual)}` : ""}`;
  await analyzeThenMintAll(chatId, take, title);
}

async function cookDaily2(chatId: number) {
  const listed = await listUpcomingPicks("football", 28, "today");
  if ("error" in listed) {
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  const now = Date.now();
  const dayPool = listed.filter((p) => {
    const ko = p.kickoff ?? 0;
    return ko >= now - 60_000 && ko <= now + 36 * 3_600_000;
  });
  const short = dayPool.filter((p) => p.odds && p.odds >= 1.15 && p.odds <= 1.55);
  const pool = await cookPool(short.length ? short : dayPool.length ? dayPool : listed, null);
  const researched = await researchPicks(pool, 16);
  const safe = [...researched.keep].sort(
    (a, b) => (b.probability ?? 0) - (a.probability ?? 0) || (a.odds ?? 99) - (b.odds ?? 99),
  );
  let take = buildToOdds(safe, 2).slice(0, 3);
  if (!take.length) take = safe.slice(0, 2);
  if (!take.length) {
    await tg("sendMessage", { chat_id: chatId, text: "No football open for a 2-odds card today." });
    return;
  }
  await analyzeThenMintAll(chatId, take, "SportyBet · Daily 2 odds");
}

async function cookPredict(chatId: number, sport: BookSport, n: number, window: CookWindow) {
  const band = await loadOddsBand();
  const listed = await listUpcomingPicks(sport, Math.min(n + 12, 35), window);
  if ("error" in listed) {
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  const pool = await cookPool(listed.filter(cookablePick), band);
  const researched = await researchPicks(pool, n);
  const take = researched.keep.slice(0, n);
  if (!take.length) {
    await tg("sendMessage", { chat_id: chatId, text: `No ${sport} picks open now.` });
    return;
  }
  await analyzeThenMintAll(chatId, take, `Predict · ${take.length} ${sport}`);
}

export async function sendScheduledLongshot() {
  console.log("longshot");
}

export async function runDeskCron() {
  console.log("cron");
}

type TgUser = { id: number; username?: string };
type TgMessage = {
  message_id: number;
  chat: { id: number };
  text?: string;
};
type TgCallback = {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
};
type TgUpdate = {
  update_id?: number;
  message?: TgMessage;
  callback_query?: TgCallback;
};

export async function handleTelegramUpdate(update: TgUpdate) {
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message?.chat?.id;
    const data = String(cb.data || "");
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    if (!chatId) return;
    if (data.startsWith("trim:")) {
      await trimCode(chatId, data.slice(5));
      return;
    }
    if (data.startsWith("trim10:")) {
      await trimCode(chatId, data.slice(7), 10);
      return;
    }
    if (data.startsWith("trim5:")) {
      await trimCode(chatId, data.slice(6), 5);
      return;
    }
    return;
  }

  const msg = update.message;
  if (!msg?.chat?.id) return;
  const chatId = msg.chat.id;
  const raw = String(msg.text || "").trim();
  if (!raw) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Send: 2odds · Cook 30 odds basketball · Trim · Predict · or paste a code",
    });
    return;
  }

  if (update.update_id && !(await markUpdateSeen(update.update_id).catch(() => true))) return;

  const lower = raw.toLowerCase();

  if (isCmd(raw, "trim") || isCmd(raw, "optimize") || /^(trim|optimize)\b/i.test(raw)) {
    const codeMatch = raw.match(/\b([A-Za-z0-9]{5,12})\b/);
    const oddsMatch = lower.match(/(?:to\s+)?(\d+(?:\.\d+)?)\s*(?:odds|[x×])?/);
    const maybeCode =
      codeMatch && !/^(trim|optimize|to|odds)$/i.test(codeMatch[1])
        ? codeMatch[1].toUpperCase()
        : null;
    const code = maybeCode || (await latestCode());
    if (!code) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "Paste a booking code first, then say: trim · trim to 10x · or tap Trim under a code.",
      });
      return;
    }
    const withoutCode = maybeCode ? lower.replace(maybeCode.toLowerCase(), "") : lower;
    const explicitTarget = /(?:to\s+)?\d+(?:\.\d+)?\s*(?:odds|[x×])?/i.test(withoutCode);
    const target = explicitTarget && oddsMatch ? clampOddsTarget(Number(oddsMatch[1])) : undefined;
    await trimCode(chatId, code, target);
    return;
  }

  if (
    isCmd(raw, "2odds") ||
    isCmd(raw, "rollover") ||
    /^(daily\s*2(\s*odds)?|2\s*odds(\s*daily)?|2odds|rollover)\s*$/i.test(raw)
  ) {
    await tg("sendMessage", { chat_id: chatId, text: "Cooking Daily 2 odds…" });
    await cookDaily2(chatId);
    return;
  }

  const oddsMatch = lower.match(
    /(?:cook\s+)?(\d+(?:\.\d+)?)\s*(?:odds|[x×])(?:\s+(football|basketball|tennis|handball))?/i,
  );
  if (oddsMatch) {
    const target = clampOddsTarget(Number(oddsMatch[1]));
    const sport = (parseSport(raw) || (oddsMatch[2] as BookSport) || "football") as BookSport;
    const window = parseCookWindow(raw) || "today";
    await tg("sendMessage", {
      chat_id: chatId,
      text: `Cooking ${formatOdds(target)} ${sport}… keeping all legs needed`,
    });
    await cookOddsSlip(chatId, sport, target, window);
    return;
  }

  const legMatch = lower.match(/(\d+)\s*games?\s+(football|basketball|tennis|handball)/i);
  if (legMatch) {
    const n = clampLegs(Number(legMatch[1]), 10);
    const sport = legMatch[2] as BookSport;
    const window = parseCookWindow(raw) || "today";
    await tg("sendMessage", { chat_id: chatId, text: `Cooking ${n} ${sport}…` });
    await cookPredict(chatId, sport, n, window);
    return;
  }

  if (isCmd(raw, "predict") || /^predict\s*$/i.test(raw)) {
    await tg("sendMessage", { chat_id: chatId, text: "Cooking football…" });
    await cookPredict(chatId, "football", 8, "today");
    return;
  }

  const code = raw.replace(/\s+/g, "").toUpperCase();
  if (/^[A-Z0-9]{5,12}$/.test(code)) {
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
    text: "Try: Cook 30 odds basketball · 2odds · trim · trim to 10x · 10 games football · or paste a code",
  });
}
