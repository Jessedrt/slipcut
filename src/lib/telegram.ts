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
  unlockDesk,
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
• Trim a ticket down to your target odds (AI scores safest legs)
• Change markets across a ticket
• Read booking codes, screenshots, and links
• Check today’s matches and book games from your instruction

Try: /help · Cook 30 odds · 2odds · trim · split into 2 · paste a code · paste X link · Find safer football games today`;

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
        { text: "✂️ Trim", callback_data: `trim:${code}` },
        { text: "Trim 10×", callback_data: `trim10:${code}` },
        { text: "Split 2", callback_data: `split2:${code}` },
      ],
    ],
  };
}

async function mintAndReply(chatId: number, picks: TicketPick[], title: string) {
  const unique = uniqueEvents(picks);
  const work = unique.picks.slice(0, MAX_LEGS);
  const selections = sportyOf(work);
  if (!selections.length) {
    const lines = work.map((p, i) => {
      const price = p.odds ? formatOdds(p.odds) : "";
      return `${i + 1}. ${esc(p.home)} vs ${esc(p.away)} · ${esc(p.selection)}${price ? ` · ${price}` : ""}`;
    });
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: [esc(title), "Parsed games (no SportyBet IDs yet — cannot mint code):", "", ...lines]
        .join("\n")
        .slice(0, 3900),
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
  await mintAndReply(chatId, picks, title);
}

async function resolveCode(raw: string): Promise<string | null> {
  const m = raw.match(/\b([A-Za-z0-9]{5,12})\b/);
  if (m && !/^(trim|optimize|split|change|convert|help|odds|to|into)$/i.test(m[1])) {
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
    text: targetOdds
      ? `Trimming ${code} toward ${formatOdds(targetOdds)} with AI…`
      : `Trimming ${code} with AI — keeping safest legs…`,
  });
  let pool: AnalyzedPick[];
  try {
    const analysis = await analyzePicks(base, 40);
    const scored = (analysis.kept?.length ? analysis.kept : analysis.picks || []) as AnalyzedPick[];
    pool =
      scored.length > 0
        ? scored
        : (base.map((p) => ({
            ...p,
            probability: p.probability ?? 55,
            confidence: "medium" as const,
            summary: "",
            reasons: [],
            risks: [],
            verdict: "keep" as const,
          })) as AnalyzedPick[]);
  } catch (err) {
    console.error("trim analyze:", err instanceof Error ? err.message : err);
    pool = base.map((p) => ({
      ...p,
      probability: p.probability ?? (p.odds ? Math.max(20, Math.min(80, 100 / (p.odds || 2))) : 50),
      confidence: "medium" as const,
      summary: "",
      reasons: [],
      risks: [],
      verdict: "keep" as const,
    })) as AnalyzedPick[];
  }
  pool = [...pool].sort(
    (a, b) => (b.probability ?? 0) - (a.probability ?? 0) || (a.odds ?? 99) - (b.odds ?? 99),
  );
  let take: TicketPick[];
  if (targetOdds && targetOdds > 1.2) {
    take = trimToOdds(pool, clampOddsTarget(targetOdds));
  } else {
    take = keepTop(pool, Math.max(2, Math.ceil(pool.length / 2)));
  }
  if (!take.length) take = base.slice(0, Math.min(3, base.length));
  const actual = combinedOdds(take);
  await mintAndReply(
    chatId,
    take,
    `Trimmed${targetOdds ? ` to ~${formatOdds(clampOddsTarget(targetOdds))}` : ""}${actual ? ` · ${formatOdds(actual)}` : ""}`,
  );
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
    await tg("sendMessage", {
      chat_id: chatId,
      text: `Only ${base.length} games — need at least ${n} to split into ${n}.`,
    });
    return;
  }
  await tg("sendMessage", { chat_id: chatId, text: `Splitting ${code} into ${n} slips…` });
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

async function cookPredict(chatId: number, sport: BookSport, n: number, window: CookWindow) {
  const band = await loadOddsBand();
  const listed = await listUpcomingPicks(sport, Math.min(Math.max(n + 20, 40), 50), window);
  if ("error" in listed) {
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  let pool = await cookPool(listed.filter(cookablePick), band);
  const safeish = pool.filter((p) => !p.odds || (p.odds >= 1.15 && p.odds <= 2.4));
  if (safeish.length >= n) pool = safeish;
  /* SAFEST_RANK_V1 */ const researched = await researchPicks(pool, Math.max(n * 2, 12));
  const ranked = [...researched.keep].sort(
    (a, b) => (b.probability ?? 0) - (a.probability ?? 0) || (a.odds ?? 99) - (b.odds ?? 99),
  );
  const seen = new Set();
  const take = [];
  for (const p of ranked) {
    const key = p.eventId || p.home + "|" + p.away;
    if (seen.has(key)) continue;
    seen.add(key);
    take.push(p);
    if (take.length >= n) break;
  }
  if (!take.length) {
    await tg("sendMessage", { chat_id: chatId, text: `No ${sport} picks open now.` });
    return;
  }
  await analyzeThenMintAll(chatId, take, `Safest · ${take.length} ${sport}`);
}

async function cookOddsSlip(chatId: number, sport: BookSport, target: number, window: CookWindow) {
  const band = await loadOddsBand();
  const listed = await listUpcomingPicks(sport, 35, window, "any", await loadRecentEventIds());
  if ("error" in listed) {
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  const pool = await cookPool(listed.filter(cookablePick), band);
  const researched = await researchPicks(pool, 16);
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
  await analyzeThenMintAll(
    chatId,
    take,
    `${take.length} games ${sport}${span ? ` · ${span}` : ""}${actual ? ` · ${formatOdds(actual)}` : ""}`,
  );
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
    return cookablePick(p) && ko >= now + 15 * 60_000 && ko <= now + 36 * 3_600_000;
  });
  const short = dayPool.filter((p) => p.odds && p.odds >= 1.15 && p.odds <= 1.55);
  const pool = await cookPool(short.length ? short : dayPool.length ? dayPool : listed, null);
  const researched = await researchPicks(pool, 12);
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

async function cookInstruction(chatId: number, instruction: string) {
  const sport = (parseSport(instruction) || "football") as BookSport;
  const window = parseCookWindow(instruction) || "today";
  await cookPredict(chatId, sport, 5, window);
}

type TgUpdate = {
  update_id?: number;
  message?: {
    chat?: { id: number };
    text?: string;
    caption?: string;
    photo?: { file_id: string }[];
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat?: { id: number } };
  };
};

export async function handleTelegramUpdate(update: TgUpdate) {
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message?.chat?.id;
    const data = String(cb.data || "");
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    if (!chatId) return;
    if (data.startsWith("trim:")) return void (await trimCode(chatId, data.slice(5)));
    if (data.startsWith("trim10:")) return void (await trimCode(chatId, data.slice(7), 10));
    if (data.startsWith("trim5:")) return void (await trimCode(chatId, data.slice(6), 5));
    if (data.startsWith("split2:")) return void (await splitCode(chatId, data.slice(7), 2));
    return;
  }

  const msg = update.message;
  if (!msg?.chat?.id) return;
  const chatId = msg.chat.id;

  if (msg.photo?.length) {
    const best = msg.photo[msg.photo.length - 1];
    if (best?.file_id) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "Screenshot received. Paste the booking code or ticket text for now.",
      });
    }
    return;
  }

  const raw = String(msg.text || "").trim();
  if (!raw) {
    await tg("sendMessage", { chat_id: chatId, text: HELP.slice(0, 3500) });
    return;
  }

  if (update.update_id && !(await markUpdateSeen(update.update_id).catch(() => true))) return;

  const lower = raw.toLowerCase();

  if (isCmd(raw, "start") || /^\/start\b/i.test(raw)) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Welcome to SlipCut. Open to everyone.\n\n" + HELP,
    });
    return;
  }

  if (isCmd(raw, "help") || /^\/?help\b/i.test(raw) || lower === "menu") {
    await tg("sendMessage", { chat_id: chatId, text: HELP });
    return;
  }

  const splitMatch = lower.match(/split(?:\s+(?:this\s+)?(?:ticket|code|slip))?(?:\s+into)?\s+(\d+)/i);
  if (splitMatch || isCmd(raw, "split") || /^split\b/i.test(raw)) {
    const parts = splitMatch ? Number(splitMatch[1]) : 2;
    const code = await resolveCode(raw);
    if (!code) {
      await tg("sendMessage", { chat_id: chatId, text: "Paste a booking code, then say: split into 2" });
      return;
    }
    await splitCode(chatId, code, parts);
    return;
  }

  if (isCmd(raw, "trim") || isCmd(raw, "optimize") || /^(trim|optimize)\b/i.test(raw)) {
    const code = await resolveCode(raw);
    if (!code) {
      await tg("sendMessage", { chat_id: chatId, text: "Paste a booking code first, then: trim · trim to 10x" });
      return;
    }
    const oddsMatch = lower.match(/(?:to\s+)?(\d+(?:\.\d+)?)\s*(?:odds|[x×])/i);
    await trimCode(chatId, code, oddsMatch ? clampOddsTarget(Number(oddsMatch[1])) : undefined);
    return;
  }

  // FIND_SAFER_NL_V1 — safer / find games / give me games
  if (
    /check today|book the best|teams to score|book (me )?games|from (my )?instruction/i.test(lower) ||
    /\b(safer|safe|safest|high confidence)\b/i.test(lower) ||
    /\b(find|give me|get me|need|want|cook|build)\b.*\b(game|match|pick|selection|football|basketball)/i.test(
      lower,
    ) ||
    /\b(football|basketball)\b.*\b(game|match|pick|today)/i.test(lower)
  ) {
    const sport = (parseSport(raw) || "football") as BookSport;
    const window = parseCookWindow(raw) || "today";
    const nMatch = lower.match(/\b(\d{1,2})\b/);
    const n = nMatch ? clampLegs(Number(nMatch[1]), 10) : 5;
    await tg("sendMessage", {
      chat_id: chatId,
      text: /safer|safe|safest|high confidence/i.test(lower)
        ? "Finding safest " + n + " " + sport + " picks… this can take a moment."
        : "Cooking " + n + " " + sport + "…",
    });
    await cookPredict(chatId, sport, n, window);
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

  const legMatch =
    lower.match(/(\d+)\s*games?\s+(football|basketball|tennis|handball)/i) ||
    lower.match(/(\d+)\s+(football|basketball|tennis|handball)\s+games?/i);
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

  // FIND_SAFER_NL_V1 fallthrough
  if (/\b(game|match|pick|football|basketball|odds|safer|safe)\b/i.test(lower)) {
    const sport = (parseSport(raw) || "football") as BookSport;
    const nMatch = lower.match(/\b(\d{1,2})\b/);
    const n = nMatch ? clampLegs(Number(nMatch[1]), 10) : 5;
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Finding safest " + n + " " + sport + " picks… this can take a moment.",
    });
    await cookPredict(chatId, sport, n, parseCookWindow(raw) || "today");
    return;
  }

  await tg("sendMessage", { chat_id: chatId, text: HELP.slice(0, 3500) });
}
