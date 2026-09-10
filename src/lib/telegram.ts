import { AsyncLocalStorage } from "node:async_hooks";
import { analyzePicks } from "./analyze";
import { researchPicks } from "./research";
import { geminiReady, geminiVision } from "./gemini";
import { parseTicketText } from "./parse-ticket";
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
  copySplitBook,
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
• Trim a ticket down to your target odds
• Change markets across a ticket
• Convert text tickets toward SportyBet booking codes
• Read booking codes, screenshots, and links
• Check today’s matches and book games from your instruction

Best way to start:
Send any one of these:
• A booking code
• A screenshot of a ticket or match list
• An X / web link with selections
• A simple instruction

Try: /help · Cook 30 odds · 2odds · trim · split into 2 · paste a code`;

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

/** Mint immediately — do not block on slow AI analysis. */
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
      ? `Trimming ${code} toward ${formatOdds(targetOdds)}…`
      : `Trimming ${code} — keeping safest legs…`,
  });
  // Fast trim: no AI round-trip — rank by probability then lower odds
  const pool = ([...base].map((p) => ({
    ...p,
    probability: p.probability ?? (p.odds ? Math.max(20, Math.min(80, 100 / (p.odds || 2))) : 50),
    confidence: (p.confidence as AnalyzedPick["confidence"]) || "medium",
    summary: p.summary || "",
    reasons: [] as string[],
    risks: [] as string[],
    verdict: (p.verdict as AnalyzedPick["verdict"]) || "keep",
  })) as AnalyzedPick[]).sort(
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

function changeMarkets(picks: TicketPick[], instruction: string): TicketPick[] {
  const t = instruction.toLowerCase();
  const toUnder = /under\s*2\.5|u2\.5|under 2,5/.test(t);
  const toOver = /over\s*2\.5|o2\.5|over 2,5/.test(t);
  const toHome = /to\s+home|all\s+home|home\s+win/.test(t);
  const toAway = /to\s+away|all\s+away|away\s+win/.test(t);
  const drawsOnly = /draw/.test(t);
  const allLegs = /all\s+selection|every\s+leg|across/.test(t) || !drawsOnly;

  return picks.map((p) => {
    const sel = (p.selection || "").toLowerCase();
    const isDraw = /\bdraw\b|\bx\b/.test(sel) || /draw/i.test(p.market);
    if (drawsOnly && !isDraw && !allLegs) return p;
    if (toUnder && (isDraw || allLegs)) {
      return { ...p, market: "Over/Under 2.5", selection: "Under 2.5", sporty: undefined };
    }
    if (toOver && (isDraw || allLegs)) {
      return { ...p, market: "Over/Under 2.5", selection: "Over 2.5", sporty: undefined };
    }
    if (toHome) return { ...p, market: "1X2", selection: "Home", sporty: undefined };
    if (toAway) return { ...p, market: "1X2", selection: "Away", sporty: undefined };
    return p;
  });
}

async function changeCodeMarkets(chatId: number, code: string, instruction: string) {
  const loaded = await loadPlayableCode(code);
  if ("error" in loaded) {
    await tg("sendMessage", { chat_id: chatId, text: loaded.error });
    return;
  }
  const next = changeMarkets(loaded.picks, instruction);
  const still = next.filter((p) => p.sporty);
  if (still.length) {
    await mintAndReply(chatId, still, "Changed markets (legs with live IDs)");
  } else {
    const lines = next.map((p, i) => `${i + 1}. ${p.home} vs ${p.away} · ${p.selection}`);
    await tg("sendMessage", {
      chat_id: chatId,
      text: ["Updated selections:", ...lines, "", "Tip: cook under 2.5 today from live markets."].join("\n"),
    });
  }
}

async function handleTextTicket(chatId: number, text: string, title = "From paste") {
  const picks = parseTicketText(text).slice(0, MAX_LEGS);
  if (!picks.length) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "I no fit read games from that text. Paste clearer lines or a SportyBet code.",
    });
    return;
  }
  await mintAndReply(chatId, picks, title);
}

async function handleLink(chatId: number, url: string) {
  await tg("sendMessage", { chat_id: chatId, text: "Reading link…" });
  try {
    const md = await youContents(url);
    await handleTextTicket(chatId, md, "From link");
  } catch (err) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: err instanceof Error ? err.message : "Could not read that link.",
    });
  }
}

async function downloadTgFile(fileId: string): Promise<{ mime: string; data: string } | null> {
  const token = TOKEN();
  if (!token) return null;
  const metaRes = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  const meta = (await metaRes.json()) as { ok?: boolean; result?: { file_path?: string } };
  const path = meta.result?.file_path;
  if (!path) return null;
  const bin = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!bin.ok) return null;
  const buf = Buffer.from(await bin.arrayBuffer());
  const mime = path.endsWith(".png")
    ? "image/png"
    : path.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
  return { mime, data: buf.toString("base64") };
}

async function handlePhoto(chatId: number, fileId: string, caption: string) {
  if (!geminiReady()) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Screenshot read needs Gemini keys on the server. Paste the code or ticket text for now.",
    });
    return;
  }
  await tg("sendMessage", { chat_id: chatId, text: "Reading screenshot…" });
  const img = await downloadTgFile(fileId);
  if (!img) {
    await tg("sendMessage", { chat_id: chatId, text: "Could not download that photo." });
    return;
  }
  try {
    const text = await geminiVision(
      "Extract every betting selection from this ticket screenshot. Output plain lines: Home vs Away · market/selection · odds if visible. No commentary.",
      caption || "Extract the full betting ticket.",
      img,
    );
    await handleTextTicket(chatId, text, "From screenshot");
  } catch (err) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: err instanceof Error ? err.message : "Could not read screenshot.",
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
    return ko >= now - 60_000 && ko <= now + 36 * 3_600_000;
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

async function cookInstruction(chatId: number, instruction: string) {
  const sport = (parseSport(instruction) || "football") as BookSport;
  const window = parseCookWindow(instruction) || "today";
  const listed = await listUpcomingPicks(sport, 35, window);
  if ("error" in listed) {
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  let pool = listed.filter(cookablePick);
  const t = instruction.toLowerCase();
  if (/score|btts|gg|both teams/.test(t)) {
    pool = pool.filter((p) => /btts|both teams|gg|score/i.test(`${p.market} ${p.selection}`));
  } else if (/under\s*2\.5|u2\.5/.test(t)) {
    pool = pool.filter((p) => /under\s*2\.5/i.test(`${p.market} ${p.selection}`));
  } else if (/over\s*2\.5|o2\.5/.test(t)) {
    pool = pool.filter((p) => /over\s*2\.5/i.test(`${p.market} ${p.selection}`));
  }
  if (!pool.length) pool = listed.filter(cookablePick);
  const researched = await researchPicks(await cookPool(pool, await loadOddsBand()), 12);
  const take = researched.keep.slice(0, 6);
  if (!take.length) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "No matching live markets for that instruction right now.",
    });
    return;
  }
  await analyzeThenMintAll(chatId, take, `From instruction · ${take.length} ${sport}`);
}

export async function sendScheduledLongshot() {
  console.log("longshot");
}

export async function runDeskCron() {
  console.log("cron");
}

type TgPhoto = { file_id: string };
type TgMessage = {
  message_id: number;
  chat: { id: number };
  text?: string;
  caption?: string;
  photo?: TgPhoto[];
};
type TgCallback = { id: string; message?: TgMessage; data?: string };
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
    if (best?.file_id) await handlePhoto(chatId, best.file_id, msg.caption || "");
    return;
  }

  const raw = String(msg.text || "").trim();
  if (!raw) {
    await tg("sendMessage", { chat_id: chatId, text: HELP.slice(0, 3500) });
    return;
  }

  if (update.update_id && !(await markUpdateSeen(update.update_id).catch(() => true))) return;

  const lower = raw.toLowerCase();

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

  if (/^change\b|change all|make all .* (under|over|home|away)/i.test(raw)) {
    const code = await resolveCode(raw);
    if (!code) {
      await tg("sendMessage", { chat_id: chatId, text: "Paste a code, then: change all draw selections to under 2.5" });
      return;
    }
    await changeCodeMarkets(chatId, code, raw);
    return;
  }

  if (/^convert\b|bet9ja|stake\.com|stake ticket/i.test(lower)) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Send the ticket as text or screenshot. I will parse it and try to book matching legs on SportyBet.",
    });
    return;
  }

  const url = firstUrl(raw);
  if (url && /twitter|x\.com|sportybet|stake|bet9ja|http/i.test(url)) {
    await handleLink(chatId, url);
    return;
  }

  if (/check today|book the best|teams to score|book (me )?games|from (my )?instruction/i.test(lower)) {
    await tg("sendMessage", { chat_id: chatId, text: "Checking today’s board…" });
    await cookInstruction(chatId, raw);
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

  if (raw.includes("\n") && /\bvs\.?\b|\bv\b/i.test(raw)) {
    await handleTextTicket(chatId, raw, "From paste");
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

  await tg("sendMessage", { chat_id: chatId, text: HELP.slice(0, 3500) });
}
