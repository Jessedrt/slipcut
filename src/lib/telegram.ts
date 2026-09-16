import { AsyncLocalStorage } from "node:async_hooks";
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

const HELP = `SlipCut live · safer cook on

Try: Find safer football games today · Cook 5 football games · Cook 30 odds · 2odds · trim · split into 2 · paste a code`;

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
  const selections = sportyOf(work);
  if (!selections.length) {
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: [esc(title), "Picks (no booking IDs yet):", "", ...lines].join("\n").slice(0, 3900),
    });
    return;
  }
  const minted = await mintShare(selections, "ng");
  if ("error" in minted) {
    console.error("[mint]", minted.error, "n=", selections.length);
    const combo = combinedOdds(work);
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: [
        esc(title) + (combo ? ` · ${formatOdds(combo)}` : ""),
        "Could not mint SportyBet code — safest picks:",
        "",
        ...lines,
        "",
        "Say again: Find safer football games today",
      ]
        .join("\n")
        .slice(0, 3900),
    });
    return;
  }
  const code = minted.shareCode;
  const combo = combinedOdds(work);
  const head = `${esc(title)}${combo ? ` · ${formatOdds(combo)}` : ""} · ${work.length} games`;
  await tg("sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text: [`<code>${esc(code)}</code>`, head, "", ...lines].join("\n").slice(0, 3900),
    reply_markup: codeKeyboard(code),
  });
  await recordSlip(code, work).catch(() => {});
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

async function cookPredict(chatId: number, sport: BookSport, n: number, window: CookWindow) {
  try {
    const band = await loadOddsBand();
    const listed = await listUpcomingPicks(sport, Math.min(Math.max(n + 20, 40), 50), window);
    if ("error" in listed) {
      await tg("sendMessage", { chat_id: chatId, text: listed.error });
      return;
    }
    let pool = await cookPool(listed.filter(cookablePick), band);
    const safeish = pool.filter((p) => !p.odds || (p.odds >= 1.15 && p.odds <= 2.4));
    if (safeish.length >= n) pool = safeish;
    const researched = await researchPicks(pool, Math.max(n * 2, 12));
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
      await tg("sendMessage", { chat_id: chatId, text: `No ${sport} picks open now. Try later.` });
      return;
    }
    await mintAndReply(chatId, take, `Safest · ${take.length} ${sport}`);
  } catch (err) {
    console.error("cookPredict:", err instanceof Error ? err.message : err);
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Could not finish cooking. Try: Cook 5 football games",
    });
  }
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
    await tg("sendMessage", { chat_id: chatId, text: `Could not build ${formatOdds(target)} ${sport} right now.` });
    return;
  }
  const actual = combinedOdds(take);
  const span = windowLabel(window);
  await mintAndReply(
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
  await mintAndReply(chatId, take, "SportyBet · Daily 2 odds");
}

type TgUpdate = {
  update_id?: number;
  message?: { chat?: { id: number }; text?: string; photo?: { file_id: string }[] };
  callback_query?: { id: string; data?: string; message?: { chat?: { id: number } } };
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
    await tg("sendMessage", { chat_id: chatId, text: HELP });
    return;
  }
  if (update.update_id && !(await markUpdateSeen(update.update_id).catch(() => true))) return;
  const lower = raw.toLowerCase();

  // FORCE_COOK_V1 — any mention of games/safer/football cooks immediately
  if (/safer|safe|safest|football|basketball|\bgames?\b|\bpicks?\b/i.test(lower)) {
    const sport = (parseSport(raw) || "football") as BookSport;
    const window = parseCookWindow(raw) || "today";
    const nMatch = lower.match(/\b(\d{1,2})\b/);
    const n = nMatch ? clampLegs(Number(nMatch[1]), 10) : 5;
    await tg("sendMessage", {
      chat_id: chatId,
      text: "✓ Finding safest " + n + " " + sport + " picks… this can take a moment.",
    });
    await cookPredict(chatId, sport, n, window);
    return;
  }

  // FIND_SAFER_NL_V1
  if (
    /\b(safer|safe|safest|high confidence)\b/i.test(lower) ||
    /\b(find|give me|get me|need|want|cook|build)\b.*\b(game|match|pick|football|basketball)/i.test(lower) ||
    /\b(football|basketball)\b.*\b(game|match|today)/i.test(lower) ||
    /\bgames?\b/i.test(lower)
  ) {
    const sport = (parseSport(raw) || "football") as BookSport;
    const window = parseCookWindow(raw) || "today";
    const nMatch = lower.match(/\b(\d{1,2})\b/);
    const n = nMatch ? clampLegs(Number(nMatch[1]), 10) : 5;
    await tg("sendMessage", {
      chat_id: chatId,
      text: /safer|safe|safest|high confidence/i.test(lower)
        ? `Finding safest ${n} ${sport} picks… this can take a moment.`
        : `Cooking ${n} ${sport}…`,
    });
    await cookPredict(chatId, sport, n, window);
    return;
  }

  if (isCmd(raw, "start") || /^\/start\b/i.test(raw) || isCmd(raw, "help") || /^\/?help\b/i.test(raw)) {
    await tg("sendMessage", { chat_id: chatId, text: HELP });
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
    await cookDaily2(chatId);
    return;
  }

  const oddsMatch = lower.match(/(?:cook\s+)?(\d+(?:\.\d+)?)\s*(?:odds|[x×])/i);
  if (oddsMatch) {
    const target = clampOddsTarget(Number(oddsMatch[1]));
    const sport = (parseSport(raw) || "football") as BookSport;
    const window = parseCookWindow(raw) || "today";
    await tg("sendMessage", { chat_id: chatId, text: `Cooking ${formatOdds(target)} ${sport}…` });
    await cookOddsSlip(chatId, sport, target, window);
    return;
  }

  // Never treat natural language as a booking code
  if (/\b(find|safer|safe|football|basketball|games?|today|cook|give|odds)\b/i.test(raw)) {
    const sport = (parseSport(raw) || "football") as BookSport;
    const nMatch = raw.toLowerCase().match(/\b(\d{1,2})\b/);
    const n = nMatch ? clampLegs(Number(nMatch[1]), 10) : 5;
    await tg("sendMessage", { chat_id: chatId, text: "✓ Cooking " + n + " safest " + sport + " picks…" });
    await cookPredict(chatId, sport, n, parseCookWindow(raw) || "today");
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

  await tg("sendMessage", { chat_id: chatId, text: HELP });
}
