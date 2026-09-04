import { AsyncLocalStorage } from "node:async_hooks";
import { scorePicks } from "./analyze.ts";
import { parseTicketText } from "./parse-ticket.ts";
import { normalizePidgin, pidginSmallTalk, slangHelp, splitChat, wantsCreate } from "./pidgin.ts";
import { cookLadder, concentrationNote, researchPicks } from "./research.ts";
import { LADDER_TARGETS, familyGate, formatMarketStats, loadMarketStats } from "./accuracy.ts";
import {
  RULE,
  bullets,
  cap,
  codeBlock,
  doc,
  glyph,
  head,
  leg,
  pct,
  stats,
  subhead,
  tail,
} from "./tg-format.ts";
import { getEventDetail, eventScore, loadBookingCode, listUpcomingPicks, marketFamily, mintShare, parseCookAsks, parseMarketTarget, pickMatchesAsks, formatCookAsks, retargetPicks, sportyOf, windowLabel, type CookAsk, type CookWindow, type MarketTarget } from "./sportybet.ts";
import { addAllow, addBlock, allowedBy, applyLessonScores, blockedBy, calibrationReport, clearAllows, formatBook, formatCalibration, formatRecap, formatStudy, latestCode, latestUnstudiedCode, listAllows, listBlocks, listChats, loadOddsBand, markUpdateSeen, recordPredictions, recordSlip, recordStake, rememberChat, removeBlock, saveOddsBand, studyCode } from "./study.ts";
import { addDeskKey, delDeskKey, detectKey, formatKeyList, refreshKeys, type KeyKind } from "./keys.ts";
import { probeText } from "./keytest.ts";
import { combinedOdds, formatEv, formatKickoff, formatOdds, parseCommand, splitEven, uniqueEvents } from "./workbench.ts";
import { bestLegs, buildSlip, planStake } from "./optimizer.ts";
import { combinedPrice, fairOddsFromProb, slipTrueChance } from "./odds.ts";
import {
  MAX_LEGS,
  applyBand,
  clampLegs,
  clampOddsTarget,
  cmdArg,
  codeFromText,
  escapeHtml as esc,
  htmlToPlain,
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
  wantsDraw,
  wantsLive,
  wantsMix,
  type OddsBand,
} from "./intent.ts";
import type { AnalyzedPick, BookSport, TicketPick } from "./types.ts";

/**
 * Which engine the slip really came from. Cook research only runs through
 * you.com (Gemini is rate-limited, Opus aborts), so saying "gemini" or "opus"
 * here would be a lie — the tag names the engine that actually answered.
 */
function researchTag(researched: boolean) {
  if (!researched) return "desk read";
  return "you.com";
}
/** Shown in Telegram's menu button, so it is the desk's real navigation. */
const MENU = [
  { command: "today", description: "Today's ladder cards" },
  { command: "weekend", description: "Weekend ladder cards" },
  { command: "mix", description: "Mix football, basketball, tennis" },
  { command: "draw", description: "Draw-only football" },
  { command: "stake", description: "Stake.com daily 2 odds" },
  { command: "daily2", description: "SportyBet daily 2 odds" },
  { command: "book", description: "My book, record and money" },
];

let menuReady = false;

async function ensureMenu(force = false) {
  if (menuReady && !force) return;
  const scopes = [{ type: "default" }, { type: "all_private_chats" }, { type: "all_group_chats" }];
  for (const scope of scopes) {
    await tg("deleteMyCommands", { scope });
    await tg("setMyCommands", { commands: MENU, scope });
  }
  menuReady = true;
}

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || "";
const BANNER_URL = "https://slipcut.vercel.app/banner.jpg";
/** Telegram API call budget — a hung fetch must not eat the whole function timeout. */
const TG_TIMEOUT_MS = 20_000;
/** How long one chat is considered "cooking" before a new request may start. */
const BUSY_MS = 120_000;
/** Remember recent update_ids so Telegram retries do not cook the same slip twice. */
const RECENT_UPDATES_MAX = 1000;

function naira(n: number) {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
}

/** Lagos wall-clock, short enough for a footer. */
function stamp() {
  return new Date().toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });
}

/** Send a desk reply: HTML, length-capped, plain-text fallback on rejection. */
async function say(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  await tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", text: cap(text), ...extra });
}

/**
 * Failure is a design surface too. One line on what happened, one on what to
 * do next — "error" is not actionable.
 */
async function sorry(chatId: number, what: string, fix?: string) {
  await say(chatId, doc(head("no go", what), fix ? tail(fix) : null));
}

// ---- per-chat busy guard --------------------------------------------------

const busyChats = new Map<number, number>();

function isBusy(chatId: number) {
  const since = busyChats.get(chatId);
  if (!since) return false;
  if (Date.now() - since > BUSY_MS) {
    busyChats.delete(chatId);
    return false;
  }
  return true;
}

/**
 * Run a long job (research, mint) for a chat: shows a progress line plus the
 * typing indicator, blocks a second concurrent job for the same chat, and
 * removes the progress line once the real answer has been sent.
 */
async function withProgress(chatId: number, text: string, job: () => Promise<void>) {
  if (isBusy(chatId)) {
    await tg("sendMessage", { chat_id: chatId, text: "I still dey cook the last one. Hold on small." });
    return;
  }
  busyChats.set(chatId, Date.now());
  const sent = await tg("sendMessage", { chat_id: chatId, text });
  const progressId = messageIdOf(sent);
  await tg("sendChatAction", { chat_id: chatId, action: "typing" });
  try {
    await job();
  } finally {
    busyChats.delete(chatId);
    if (progressId) await tg("deleteMessage", { chat_id: chatId, message_id: progressId });
  }
}

function messageIdOf(result: unknown): number | null {
  if (result && typeof result === "object" && "message_id" in result) {
    const id = Number((result as { message_id?: unknown }).message_id);
    return Number.isFinite(id) ? id : null;
  }
  return null;
}

// ---- update de-duplication -----------------------------------------------

const recentUpdates = new Set<number>();

async function alreadySeen(updateId?: number): Promise<boolean> {
  if (!Number.isFinite(updateId)) return false;
  const id = updateId as number;
  if (recentUpdates.has(id)) return true;
  recentUpdates.add(id);
  if (recentUpdates.size > RECENT_UPDATES_MAX) {
    const first = recentUpdates.values().next().value;
    if (first !== undefined) recentUpdates.delete(first);
  }
  // Cross-instance guard (serverless retries can land on a cold instance).
  return !(await markUpdateSeen(id));
}

/**
 * The shared cook filter: user blocks/allows, the odds band, and — the
 * primary gate — the market-family accuracy bar. A leg only enters the pool
 * if its market family passes (see accuracy.ts). `gate: false` is for
 * dedicated products that are a different thing (the draw cook).
 */
async function cookPool<T extends TicketPick>(
  picks: T[],
  band: OddsBand | null,
  opts: { gate?: boolean } = {},
): Promise<T[]> {
  const [blocks, allows, stats] = await Promise.all([
    listBlocks(),
    listAllows(),
    opts.gate === false ? [] : loadMarketStats(),
  ]);
  const filtered = applyBand(allowedBy(blockedBy(picks, blocks), allows), band);
  if (opts.gate === false) return filtered;
  return filtered.filter(
    (p) => familyGate(stats, marketFamily(p.sporty?.marketId, p.market), p.sport).allowed,
  );
}

async function resolveBand(text: string): Promise<OddsBand | null> {
  const parsed = parseOddsBand(text);
  if (parsed) {
    await saveOddsBand(parsed.min, parsed.max);
    return parsed;
  }
  return loadOddsBand();
}

async function stakeAndReply(chatId: number, code: string, stake: number) {
  const loaded = await loadBookingCode(code, "ng");
  if ("error" in loaded) {
    await sorry(chatId, loaded.error, "Check the code and send it again.");
    return;
  }
  const picks = playable(loaded.picks);
  const combo = combinedOdds(picks);
  if (!combo) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `${code} — some games no show odds. I no fit calculate return.`,
    });
    return;
  }
  const ret = stake * combo;
  await recordStake(code, stake, combo);
  await tg("sendMessage", {
    chat_id: chatId,
    text: [
      `💰 ${code} · ${picks.length} games · ${formatOdds(combo)}`,
      `Stake ${naira(stake)}`,
      `You fit collect ${naira(ret)}`,
      `Profit ${naira(ret - stake)}`,
    ].join("\n"),
  });
}

type TgUser = { id: number; username?: string };
type TgChat = { id: number };
type TgMessage = {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  reply_to_message?: TgMessage;
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

export type ChatBridge = {
  send: (method: string, payload: Record<string, unknown>) => Promise<void>;
};

export const chatBridge = new AsyncLocalStorage<ChatBridge>();

/** Methods whose failure is noise (e.g. deleting an already-deleted message). */
const QUIET_METHODS = new Set(["deleteMessage", "sendChatAction", "answerCallbackQuery"]);

/**
 * @param allowPlain retry once as plain text if Telegram rejects the markup.
 *   Telegram drops the whole message on any HTML mistake, and losing a slip to
 *   a stray "<" is worse than losing the bold.
 */
async function tg(method: string, payload: Record<string, unknown> = {}, allowPlain = true) {
  const bridged = chatBridge.getStore();
  if (bridged) {
    try {
      await bridged.send(method, payload);
    } catch (err) {
      console.error(`[bridge] ${method} failed:`, err instanceof Error ? err.message : err);
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
    if (!data.ok && allowPlain && payload.parse_mode === "HTML" && typeof payload.text === "string") {
      console.error(`[tg] ${method} markup rejected, retrying plain:`, data.description);
      return tg(
        method,
        { ...payload, parse_mode: undefined, text: htmlToPlain(payload.text) },
        false,
      );
    }
    if (!data.ok && !QUIET_METHODS.has(method)) {
      console.error(`[tg] ${method} rejected:`, data.description ?? res.status);
    }
    return data.ok ? data.result : null;
  } catch (err) {
    if (!QUIET_METHODS.has(method)) {
      console.error(`[tg] ${method} failed:`, err instanceof Error ? err.message : err);
    }
    return null;
  }
}

type AccessUser = { user_id: string; username: string; role: "owner" | "guest" };
type AccessState = { locked: boolean; users: AccessUser[] };

const ACCESS_MARK = "#A#";
const PUBLIC_DESC = "Paste a SportyBet code, or cook a new slip.";

function parseAccess(desc: string): AccessState {
  const idx = desc.indexOf(ACCESS_MARK);
  if (idx < 0) return { locked: false, users: [] };
  const rest = desc.slice(idx + ACCESS_MARK.length);
  const [flag, list = ""] = rest.split("#");
  const users = list
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [user_id = "", role = "guest", username = ""] = part.split(":");
      return {
        user_id,
        username,
        role: role === "owner" ? ("owner" as const) : ("guest" as const),
      };
    })
    .filter((u) => u.user_id);
  return { locked: flag === "1", users };
}

function encodeAccess(state: AccessState) {
  const blob = `${ACCESS_MARK}${state.locked ? "1" : "0"}#${state.users
    .map((u) => `${u.user_id}:${u.role}:${u.username.replace(/[:|#]/g, "")}`)
    .join("|")}`;
  return `${PUBLIC_DESC}\n${blob}`.slice(0, 512);
}

function encodeShort(state: AccessState) {
  const ids = state.users.map((u) => u.user_id).join(",");
  const label = state.locked ? "Private desk." : "SportyBet desk.";
  return `${label} SC#${state.locked ? "1" : "0"}#${ids}`.slice(0, 120);
}

function parseShort(text: string): AccessState | null {
  const m = text.match(/SC#([01])#([^]*)/);
  if (!m) return null;
  const users = (m[2] || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map((user_id, i) => ({
      user_id,
      username: "",
      role: i === 0 ? ("owner" as const) : ("guest" as const),
    }));
  return { locked: m[1] === "1", users };
}

function descText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "description" in result) {
    return String((result as { description?: string }).description ?? "");
  }
  if (result && typeof result === "object" && "short_description" in result) {
    return String((result as { short_description?: string }).short_description ?? "");
  }
  return "";
}

/**
 * Access state lives in the bot description (no DB dependency) but reading it
 * costs two Telegram round-trips. Cache briefly so a normal message does not
 * pay that price; every save refreshes the cache immediately.
 */
const ACCESS_TTL_MS = 60_000;
let accessCache: { state: AccessState; at: number } | null = null;

async function loadAccess(force = false): Promise<AccessState> {
  if (!force && accessCache && Date.now() - accessCache.at < ACCESS_TTL_MS) return accessCache.state;
  const long = parseAccess(descText(await tg("getMyDescription", {})));
  let state = long;
  if (!long.locked && !long.users.length) {
    state = parseShort(descText(await tg("getMyShortDescription", {}))) ?? long;
  }
  accessCache = { state, at: Date.now() };
  return state;
}

async function saveAccess(state: AccessState) {
  await tg("setMyDescription", { description: encodeAccess(state) });
  await tg("setMyShortDescription", { short_description: encodeShort(state) });
  accessCache = { state, at: Date.now() };
}

function userAllowed(state: AccessState, user: { id: number; username?: string }) {
  const id = String(user.id);
  const name = (user.username ?? "").toLowerCase();
  return state.users.some(
    (u) => u.user_id === id || (name && u.username.toLowerCase() === name),
  );
}

async function accessLocked() {
  return (await loadAccess()).locked;
}

async function hasAccess(user: { id: number; username?: string }) {
  const state = await loadAccess();
  if (!state.locked) return true;
  return userAllowed(state, user);
}

async function isOwner(user: { id: number; username?: string }) {
  const state = await loadAccess();
  if (!state.users.some((u) => u.role === "owner")) return true;
  const id = String(user.id);
  const name = (user.username ?? "").toLowerCase();
  return state.users.some(
    (u) =>
      u.role === "owner" &&
      (u.user_id === id || (name && u.username.toLowerCase() === name)),
  );
}

function accessLines(state: AccessState) {
  return state.users.map((r) => `${r.role}  ·  ${r.username ? `@${r.username}` : r.user_id}`);
}

function sportIcon(sport: string) {
  if (sport === "basketball") return "🏀";
  if (sport === "tennis") return "🎾";
  if (sport === "football") return "⚽";
  return "🎟️";
}

function sportFromFlag(code: string): BookSport {
  if (code === "b") return "basketball";
  if (code === "t") return "tennis";
  return "football";
}

/**
 * The persistent keyboard. Three rows of three: cook, read, manage. Long
 * labels are dead weight on a phone — the menu button carries the rest.
 */
function deskKeyboard() {
  return {
    keyboard: [
      [{ text: "Today" }, { text: "Weekend" }, { text: "Draw" }],
      [{ text: "2 odds" }, { text: "Mix" }, { text: "Score" }],
      [{ text: "Book" }, { text: "Study" }, { text: "Help" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Paste a code, or say 12 games football",
  };
}

/** Buttons under a code the user pasted: act on it, then interrogate it. */
function keyboard(code: string) {
  return {
    inline_keyboard: [
      [
        { text: "Copy", copy_text: { text: code } },
        { text: "Trim", callback_data: `g:${code}` },
        { text: "Split 2", callback_data: `s:${code}:2` },
      ],
      [
        { text: "Value", callback_data: `e:${code}` },
        { text: "Why", callback_data: `w:${code}` },
        { text: "Score", callback_data: `v:${code}` },
        { text: "Settle", callback_data: `y:${code}` },
      ],
    ],
  };
}

/** Buttons under a code the bot just minted. */
function mintedKeyboard(code: string, url: string) {
  return {
    inline_keyboard: [
      [
        { text: "Copy", copy_text: { text: code } },
        { text: "Open", url },
        { text: "Trim", callback_data: `g:${code}` },
      ],
      [
        { text: "Value", callback_data: `e:${code}` },
        { text: "Why", callback_data: `w:${code}` },
        { text: "Score", callback_data: `v:${code}` },
        { text: "Settle", callback_data: `y:${code}` },
      ],
    ],
  };
}

function listPicks(picks: TicketPick[]) {
  const shown = picks.slice(0, 24);
  const lines = shown.map((p, i) => {
    const when = formatKickoff(p.kickoff);
    const price = p.odds ? formatOdds(p.odds) : "";
    const bits = [p.selection, price, when].filter(Boolean);
    return leg(i + 1, `${p.home} v ${p.away}`, bits.join("  "), sportIcon(p.sport));
  });
  if (picks.length > shown.length) lines.push(`    +${picks.length - shown.length} more`);
  return lines.join("\n");
}

/**
 * The legs of a slip we are about to hand over. Showing them matters: the
 * punter is about to paste this code into a real book.
 */
function slipBody(picks: TicketPick[]) {
  const shown = picks.slice(0, 20);
  const lines = shown.map((p, i) => {
    const price = p.odds ? formatOdds(p.odds) : "";
    const prob = Number((p as { probability?: number }).probability);
    const known = Number.isFinite(prob);
    return leg(
      i + 1,
      `${p.home} v ${p.away}`,
      [p.selection, price].filter(Boolean).join("  "),
      known ? glyph(prob) : undefined,
      known ? pct(prob) : undefined,
    );
  });
  if (picks.length > shown.length) lines.push(`    +${picks.length - shown.length} more`);
  return lines.join("\n");
}

function playable(picks: TicketPick[]) {
  return picks.filter((p) => p.sport !== "other" && p.sporty);
}

/**
 * "true 38% · 12.4× · EV +6.2%" — the honest read of a slip we just minted.
 *
 * Most bots only ever show the price. The price is what the book offers; the
 * true chance is what the desk thinks it is worth; the gap between them is the
 * only reason to bet at all. Returns null when the legs were never scored.
 */
function valueStats(picks: TicketPick[]): Array<[string, string]> {
  if (!picks.length) return [];
  const scored = picks.filter((p) => Number.isFinite(Number((p as { probability?: number }).probability)));
  if (scored.length !== picks.length) return [];
  const chance = slipTrueChance(picks);
  const price = combinedPrice(picks);
  const rows: Array<[string, string]> = [["true", pct(chance * 100)]];
  if (price) {
    rows.push(["price", formatOdds(price)]);
    rows.push(["EV", formatEv(chance * price - 1)]);
  }
  return rows;
}

/** The old one-line form, for places that can only spare one line. */
function valueLine(picks: TicketPick[]): string | null {
  const rows = valueStats(picks);
  return rows.length ? rows.map(([k, v]) => `${k} ${v}`).join("  ·  ") : null;
}

async function mintAndReply(chatId: number, picks: TicketPick[], country: string, title: string, limit = MAX_LEGS) {
  const unique = uniqueEvents(picks);
  const work = unique.picks.slice(0, Math.max(1, Math.min(MAX_LEGS, limit)));
  const titleLine =
    unique.dropped > 0 ? `${title} · I comot ${unique.dropped} same-match` : title;
  const selections = sportyOf(work);
  if (!selections.length) {
    await sorry(
      chatId,
      "no SportyBet id on those games",
      "Send the booking code first — I need the market ids to mint a new one.",
    );
    return;
  }
  const minted = await mintShare(selections, country);
  if ("error" in minted && selections.length > 40) {
    await say(
      chatId,
      doc(
        head("split"),
        `SportyBet no gree take ${selections.length} for one code. I dey split am.`,
      ),
    );
    const size = 50;
    for (let i = 0; i < work.length; i += size) {
      await mintAndReply(
        chatId,
        work.slice(i, i + size),
        country,
        `${titleLine} · part ${Math.floor(i / size) + 1}`,
      );
    }
    return;
  }
  if ("error" in minted) {
    await sorry(chatId, minted.error, "Fewer games, or try again in a moment.");
    return;
  }
  const code = minted.shareCode;
  const value = valueStats(work);
  const crowded = concentrationNote(work);
  await say(
    chatId,
    doc(
      head(titleLine),
      value.length ? stats(value) : null,
      RULE,
      slipBody(work),
      crowded ? tail(crowded) : null,
      codeBlock(code),
      tail(stamp()),
    ),
    { reply_markup: mintedKeyboard(code, minted.shareURL) },
  );
  await recordSlip(code, work);
  // Remember what we believed, so settling the slip can grade the desk.
  await recordPredictions(code, work as Array<TicketPick & { probability?: number }>);
}

/**
 * Research-grade scoring for an existing ticket: market-anchored, lesson-aware,
 * and ready for the slip builder (which expects a 0-100 `probability`).
 */
async function scoreTicket(picks: TicketPick[]): Promise<AnalyzedPick[]> {
  const { picks: scored } = await scorePicks(picks);
  return applyLessonScores(scored);
}

/**
 * Trim a ticket down to a target price.
 *
 * The old path guessed each leg's chance as 100/odds, which just ranks by price
 * — it always kept the shortest legs and threw away every bit of research.
 * Now: score the legs properly, then let the builder choose the combination
 * with the best true chance at the requested price.
 */
async function trimToTarget(chatId: number, picks: TicketPick[], target: number) {
  const scored = await scoreTicket(picks);
  const slip = buildSlip(scored, { target, maxLegs: MAX_LEGS, maxPerLeague: 4 });
  const take = slip.legs.filter((p) => p.sporty);
  if (!take.length) {
    await sorry(chatId, "nothing survived that trim", "Try a lower target: trim 20");
    return;
  }
  const note = slip.notes.length ? ` · ${slip.notes.join(" ")}` : "";
  await mintAndReply(
    chatId,
    take,
    "ng",
    `Trimmed to about ${formatOdds(target)} · ${take.length} games${note}`,
  );
}

async function sureNAndReply(
  chatId: number,
  picks: TicketPick[],
  count: number,
  title = "",
) {
  const n = clampLegs(count, 2);
  if (!picks.length) {
    await sorry(chatId, "no football or basketball on that one", "Send a code with playable markets.");
    return;
  }
  await withProgress(chatId, `Picking ${n}…`, async () => {
    const scored = await scoreTicket(picks);
    const slip = bestLegs(scored, n, { maxPerLeague: 3 });
    const top = slip.legs.filter((p) => p.sporty);
    if (!top.length) {
      await sorry(
        chatId,
        `no ${n} safe legs in that ticket`,
        "Ask for fewer games, or paste a bigger ticket.",
      );
      return;
    }
    const note = slip.notes.length ? ` · ${slip.notes.join(" ")}` : "";
    await mintAndReply(chatId, top, "ng", `${title || `${top.length} games`}${note}`);
  });
}

async function createSportSlip(
  chatId: number,
  sport: BookSport,
  count: number,
  window: CookWindow = "soon",
  band?: OddsBand | null,
  asks: CookAsk[] = [],
) {
  const n = clampLegs(count, 5);
  const span = windowLabel(window);
  const market = formatCookAsks(asks);
  const label = span
    ? `Researching ${span}${market ? ` · ${market}` : ""}…`
    : `Researching ${n} ${sport}${market ? ` · ${market}` : ""}…`;
  await withProgress(chatId, label, () => cookSportSlip(chatId, sport, n, window, band, asks));
}

async function cookSportSlip(
  chatId: number,
  sport: BookSport,
  n: number,
  window: CookWindow,
  band: OddsBand | null | undefined,
  asks: CookAsk[],
) {
  const span = windowLabel(window);
  const useBand = band ?? (await loadOddsBand());
  const market = formatCookAsks(asks);
  const listed = await listUpcomingPicks(sport, Math.min(n + 16, 40), window);
  if ("error" in listed) {
    await sorry(chatId, listed.error, "Try again in a moment.");
    return;
  }
  await maybeStudyLast(chatId);
  const wanted = asks.length ? listed.filter((p) => pickMatchesAsks(p, asks)) : listed;
  if (!wanted.length) {
    await sorry(
      chatId,
      market ? `no ${sport} ${market} open now` : `no ${sport} left after the filters`,
      market ? "Try another line, or later." : "/filter clear, or lift the odds cap.",
    );
    return;
  }
  const pool = await cookPool(wanted, useBand);
  const researched = await researchPicks(pool, n);
  const take = uniqueEvents(researched.keep.filter((p) => p.sport === sport)).picks.slice(0, n);
  if (!take.length) {
    await sorry(
      chatId,
      `no ${sport}${market ? ` ${market}` : ""} cleared the bar`,
      "Lower the game count, or cook a different window.",
    );
    return;
  }
  const tag = researchTag(researched.researched);
  const notes = researched.notes.length ? ` · ${researched.notes.join(" ")}` : "";
  const title =
    take.length < n
      ? `${take.length} games ${sport}${market ? ` · ${market}` : ""}${span ? ` · ${span}` : ""} · ${tag} — na only ${take.length} pass${notes}`
      : `${take.length} games ${sport}${market ? ` · ${market}` : ""}${span ? ` · ${span}` : ""} · ${tag}${researched.dropped ? ` · dropped ${researched.dropped}` : ""}${notes}`;
  await mintAndReply(chatId, take, "ng", title, n);
}

async function cookLadderAndReply(
  chatId: number,
  picks: TicketPick[],
  targets: number[],
  label: string,
) {
  const result = await cookLadder(picks, targets);
  if (result.emptyReason || !result.cards.length) {
    const reason = result.emptyReason ?? "no card cleared the market bar";
    await sorry(chatId, reason, "Try another window, or check /accuracy for the bar.");
    return;
  }
  const barPct = Math.round(result.bar * 100);
  const famLabel: Record<string, string> = {
    dc: "DC",
    ou: "O/U",
    ou1h: "1H O/U",
    gg: "GG",
    dnb: "DNB",
    win: "winner",
  };
  const markets = result.families.map((f) => famLabel[f] ?? f).join("+");
  for (let i = 0; i < result.cards.length; i++) {
    const card = result.cards[i]!;
    const take = uniqueEvents(card.legs).picks;
    if (!take.length) continue;
    const actual = combinedOdds(take);
    const shortNote = card.short ? ` — ${card.notes[0]}` : "";
    const title = `🏆 ${label} · Card ${i + 1} ~${card.target}×${actual ? ` → ${formatOdds(actual)}` : ""} · ${markets} · bar ${barPct}% · history-led${shortNote}`;
    await mintAndReply(chatId, take, "ng", title);
  }
  if (result.skipped.length) {
    const skipped = result.skipped.map((s) => `${s.target}×`).join(", ");
    await say(chatId, tail(`No reach ${skipped} from this pool — I no pad am with long shots.`));
  }
}

async function createLadderCook(
  chatId: number,
  sport: BookSport,
  window: CookWindow,
  band: OddsBand | null | undefined,
) {
  const span = windowLabel(window) || "today";
  const useBand = band ?? (await loadOddsBand());
  await withProgress(chatId, `Cooking the ${span} ladder · ${sport}…`, async () => {
    const listed = await listUpcomingPicks(sport, 40, window);
    if ("error" in listed) {
      await sorry(chatId, listed.error, "Try again in a moment.");
      return;
    }
    await maybeStudyLast(chatId);
    const pool = await cookPool(listed, useBand);
    await cookLadderAndReply(chatId, playable(pool), LADDER_TARGETS, `${sport} · ${span}`);
  });
}

async function createOddsSlip(
  chatId: number,
  sport: BookSport,
  targetRaw: number,
  window: CookWindow = "soon",
  band?: OddsBand | null,
) {
  const target = clampOddsTarget(targetRaw);
  const span = windowLabel(window);
  const label = span ? `Researching ${span}…` : `Researching ${formatOdds(target)} ${sport}…`;
  await withProgress(chatId, label, () => cookOddsSlip(chatId, sport, target, window, band));
}

async function cookOddsSlip(
  chatId: number,
  sport: BookSport,
  target: number,
  window: CookWindow,
  band: OddsBand | null | undefined,
) {
  const span = windowLabel(window);
  const useBand = band ?? (await loadOddsBand());
  const listed = await listUpcomingPicks(sport, 35, window);
  if ("error" in listed) {
    await sorry(chatId, listed.error, "Try again in a moment.");
    return;
  }
  await maybeStudyLast(chatId);
  const pool = await cookPool(listed, useBand);
  // History-led single card: the market bar gates the pool, legs rank
  // short-odds-first, and the card is honest about what the pool can hold.
  await cookLadderAndReply(chatId, playable(pool), [target], `${sport} · ${span}`);
}

async function createStakeDaily(chatId: number) {
  await withProgress(chatId, "Researching Stake 2…", () => cookStakeDaily(chatId));
}

async function cookStakeDaily(chatId: number) {
  const listed = await listUpcomingPicks("football", 28, "today");
  if ("error" in listed) {
    await sorry(chatId, listed.error, "Try again in a moment.");
    return;
  }
  const short = listed.filter((p) => p.odds && p.odds >= 1.12 && p.odds <= 1.55);
  const pool = await cookPool(short, null);
  const researched = await researchPicks(pool, 6, { target: 2 });
  const take = researched.keep.slice(0, 6);
  if (!take.length) {
    await sorry(chatId, "no Stake 2-odds today", "Try /daily2 for the SportyBet version.");
    return;
  }
  const combo = combinedOdds(take);
  const honest = valueLine(take);
  const lines = take.map((p, i) => {
    const when = formatKickoff(p.kickoff);
    const price = p.odds ? formatOdds(p.odds) : "";
    return `${i + 1}  ${p.home} vs ${p.away}  ·  ${p.selection}  ·  ${price}${when ? `  ·  ${when}` : ""}`;
  });
  const copy = [
    `Stake.com  ${combo ? formatOdds(combo) : "2.00"}`,
    ...take.map(
      (p) => `${p.home} vs ${p.away} — ${p.selection}${p.odds ? ` ${formatOdds(p.odds)}` : ""}`,
    ),
  ]
    .join("\n")
    .slice(0, 256);
  await tg("sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text: [
      "<b>Stake.com</b> · daily 2",
      combo ? formatOdds(combo) : "2.00×",
      honest ?? `${take.length} games`,
      "",
      ...lines,
      "",
      "No SportyBet code. Place this on Stake.",
    ].join("\n"),
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Copy", copy_text: { text: copy } },
          { text: "Open Stake", url: "https://stake.com/sports/soccer" },
        ],
      ],
    },
  });
}

async function createSportyDaily2(chatId: number) {
  await withProgress(chatId, "Researching 2 odds…", () => cookSportyDaily2(chatId));
}

async function cookSportyDaily2(chatId: number) {
  const listed = await listUpcomingPicks("football", 28, "today");
  if ("error" in listed) {
    await sorry(chatId, listed.error, "Try again in a moment.");
    return;
  }
  const short = listed.filter((p) => p.odds && p.odds >= 1.12 && p.odds <= 1.55);
  const pool = await cookPool(short, null);
  const researched = await researchPicks(pool, 6, { target: 2 });
  const take = researched.keep.slice(0, 6);
  if (!take.length) {
    await sorry(chatId, "no 2-odds football today", "Later in the day, or ask for 3 odds.");
    return;
  }
  const combo = combinedOdds(take);
  const notes = researched.notes.length ? ` · ${researched.notes.join(" ")}` : "";
  await mintAndReply(
    chatId,
    take,
    "ng",
    `SportyBet · daily 2${combo ? ` · ${formatOdds(combo)}` : ""} · ${researched.researched ? researchTag(true) : "desk read"}${notes}`,
  );
}

async function createDrawSlip(chatId: number, count: number, window: CookWindow = "today") {
  const n = clampLegs(count, 12);
  const span = windowLabel(window) || "today";
  await withProgress(chatId, `Researching ${n} draws · ${span}…`, () => cookDrawSlip(chatId, n, window));
}

async function cookDrawSlip(chatId: number, n: number, window: CookWindow) {
  const listed = await listUpcomingPicks("football", Math.min(n + 14, 35), window, "draw");
  if ("error" in listed) {
    await sorry(chatId, listed.error, "Try again in a moment.");
    return;
  }
  const pool = await cookPool(uniqueEvents(listed).picks, null, { gate: false });
  const researched = await researchPicks(pool, n);
  const take = uniqueEvents(researched.keep).picks;
  if (!take.length) {
    await sorry(chatId, "no draw markets open now", "Try /today, or later in the week.");
    return;
  }
  const combo = combinedOdds(take);
  const notes = researched.notes.length ? ` · ${researched.notes.join(" ")}` : "";
  await mintAndReply(
    chatId,
    take,
    "ng",
    `Draw only · ${take.length} football${combo ? ` · ${formatOdds(combo)}` : ""} · ${researched.researched ? researchTag(true) : "desk read"}${notes}`,
  );
}

async function askDrawCount(chatId: number) {
  await tg("sendMessage", {
    chat_id: chatId,
    text: "How many draw games?",
    reply_markup: {
      force_reply: true,
      selective: true,
      input_field_placeholder: "Any number, e.g. 8",
    },
  });
}

function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}

async function createMixSlip(
  chatId: number,
  opts: { games?: number; odds?: number },
  window: CookWindow = "soon",
  band?: OddsBand | null,
) {
  const span = windowLabel(window);
  const label = span ? `Researching mix · ${span}…` : "Researching mix…";
  await withProgress(chatId, label, () => cookMixSlip(chatId, opts, window, band));
}

async function cookMixSlip(
  chatId: number,
  opts: { games?: number; odds?: number },
  window: CookWindow,
  band: OddsBand | null | undefined,
) {
  const useBand = band ?? (await loadOddsBand());
  const n = clampLegs(opts.games ?? 12, 8);
  const span = windowLabel(window);
  const [foot, hoop, ten] = await Promise.all([
    listUpcomingPicks("football", 16, window),
    listUpcomingPicks("basketball", 16, window),
    listUpcomingPicks("tennis", 16, window),
  ]);
  const pools = [foot, hoop, ten].filter((p) => !("error" in p)) as TicketPick[][];
  if (!pools.length) {
    await sorry(chatId, "error" in foot ? foot.error : "no sports open for a mix", "Try again later, or ask for one sport.");
    return;
  }
  await maybeStudyLast(chatId);
  const stacked = interleave(pools[0] ?? [], interleave(pools[1] ?? [], pools[2] ?? []));
  const mixed = await cookPool(stacked, useBand);
  const researched = await researchPicks(
    mixed,
    opts.odds ? 20 : n,
    opts.odds ? { target: clampOddsTarget(opts.odds) } : {},
  );
  const take = uniqueEvents(researched.keep).picks.slice(0, opts.odds ? MAX_LEGS : n);
  if (!take.length) {
    await sorry(chatId, "mix no gree", "Relax the filter, or try again later.");
    return;
  }
  const actual = combinedOdds(take);
  const fc = take.filter((p) => p.sport === "football").length;
  const bc = take.filter((p) => p.sport === "basketball").length;
  const tc = take.filter((p) => p.sport === "tennis").length;
  const notes = researched.notes.length ? ` · ${researched.notes.join(" ")}` : "";
  await mintAndReply(
    chatId,
    take,
    "ng",
    `Mix ${fc} football + ${bc} basketball + ${tc} tennis${actual ? ` · ${formatOdds(actual)}` : ""}${span ? ` · ${span}` : ""} · ${researched.researched ? researchTag(true) : "desk read"}${notes}`,
  );
}

async function liveScoreAndReply(chatId: number, code: string, picks: TicketPick[]) {
  const ids = [...new Set(picks.map((p) => p.sporty?.eventId).filter(Boolean))] as string[];
  const details = await Promise.all(ids.map((id) => getEventDetail(id)));
  const byId = new Map(ids.map((id, i) => [id, details[i]]));
  const shown = picks.slice(0, 24);
  const lines = shown.map((p, i) => {
    const ev = p.sporty?.eventId ? byId.get(p.sporty.eventId) : null;
    const score = eventScore(ev ?? null);
    const tag = score ? score.label : formatKickoff(p.kickoff) || "\u2014";
    return leg(i + 1, `${p.home} v ${p.away}`, p.selection, undefined, tag);
  });
  if (picks.length > shown.length) lines.push(`    +${picks.length - shown.length} more`);
  await say(chatId, doc(head("score", code), RULE, lines.join("\n"), tail(stamp())));
}


export async function sendScheduledLongshot() {
  const chats = await listChats();
  if (!chats.length) return { sent: 0 };
  const wat = new Date(Date.now() + 3_600_000);
  const dow = wat.getUTCDay();
  const utcHour = new Date().getUTCHours();
  if ((dow !== 1 && dow !== 5) || utcHour !== 7) return { sent: 0, skip: true as const };
  const window: CookWindow = dow === 5 ? "weekend" : "week";
  const label = dow === 5 ? "Weekend slip." : "Week slip.";
  for (const id of chats) {
    const chatId = Number(id);
    if (!Number.isFinite(chatId)) continue;
    await tg("sendMessage", { chat_id: chatId, text: label });
    await createSportSlip(chatId, "football", 12, window);
  }
  return { sent: chats.length };
}

async function maybeSundayRecap() {
  const wat = new Date(Date.now() + 3_600_000);
  if (wat.getUTCDay() !== 0 || new Date().getUTCHours() !== 7) return { sent: 0, skip: true as const };
  const chats = await listChats();
  const text = await formatRecap();
  for (const id of chats) {
    const chatId = Number(id);
    if (!Number.isFinite(chatId)) continue;
    await tg("sendMessage", { chat_id: chatId, text });
  }
  return { sent: chats.length };
}

export async function runDeskCron() {
  const longshot = await sendScheduledLongshot();
  const recap = await maybeSundayRecap();
  return { longshot, recap };
}

async function mintKeepersAndReply(chatId: number, picks: TicketPick[], count?: number) {
  await withProgress(chatId, "Trimming…", async () => {
    const scored = await scoreTicket(picks);
    const counted = scored.filter((p) => p.sport !== "other");
    const n = clampLegs(count ?? Math.max(2, Math.ceil(counted.length / 2)), 2);
    const slip = bestLegs(counted, n, { maxPerLeague: 3 });
    const strongest = slip.legs.filter((p) => p.sporty);
    if (!strongest.length) {
      await sorry(chatId, "nothing left after I dropped those", "Drop fewer legs, or keep am as e be.");
      return;
    }
    const note = slip.notes.length ? ` · ${slip.notes.join(" ")}` : "";
    await mintAndReply(chatId, strongest, "ng", `Trimmed to ${strongest.length} games${note}`);
  });
}

async function askTrimCount(chatId: number, code: string, max: number) {
  await tg("sendMessage", {
    chat_id: chatId,
    text: `Trim ${code} to how many games? (1–${Math.max(1, max)})`,
    reply_markup: {
      force_reply: true,
      selective: true,
      input_field_placeholder: "e.g. 5",
    },
  });
}

/**
 * The value report: what the book says, what the desk says, and whether the
 * gap is worth betting. This is the whole point of the product — a price on
 * its own tells you nothing about whether it is good.
 */
async function evAndReply(chatId: number, code: string) {
  const loaded = await loadBookingCode(code, "ng");
  if ("error" in loaded) {
    await sorry(chatId, loaded.error, "Send the code again, or paste the slip as text.");
    return;
  }
  const picks = playable(loaded.picks);
  if (!picks.length) {
    await sorry(chatId, "nothing playable on that code", "Football, basketball or tennis only.");
    return;
  }
  await withProgress(chatId, "Reading the slip…", async () => {
    const scored = await scoreTicket(picks);
    const ranked = scored.slice().sort((a, b) => b.probability - a.probability);
    const shown = ranked.slice(0, 16);
    const lines = shown.map((p, i) => {
      const price = p.odds ? formatOdds(p.odds) : "";
      const mkt = p.marketProb != null ? `mkt ${pct(p.marketProb)}` : "";
      const edge = p.edge == null ? "" : `${p.edge > 0 ? "+" : ""}${p.edge}pts`;
      return leg(
        i + 1,
        `${p.home} v ${p.away}`,
        [p.selection, price].filter(Boolean).join("  "),
        glyph(p.probability),
        [mkt, `desk ${pct(p.probability)}`, edge].filter(Boolean).join("  "),
      );
    });
    if (ranked.length > shown.length) lines.push(`    +${ranked.length - shown.length} more`);
    const chance = slipTrueChance(scored);
    const price = combinedPrice(scored);
    const ev = price ? chance * price - 1 : null;
    const verdict =
      ev == null
        ? "Some legs no get price, so I no fit value the whole slip."
        : ev > 0.08
          ? "Strong value — the price pay more than the chance."
          : ev > 0
            ? "Small edge. E go pay small, but e no be license to over-stake."
            : "No value. The book dey charge more than this slip is worth — na enjoyment bet be this.";
    await say(
      chatId,
      doc(
        head("value", code),
        stats(
          price
            ? [
                ["true", pct(chance * 100)],
                ["price", formatOdds(price)],
                ["EV", formatEv(ev as number)],
              ]
            : [["true", pct(chance * 100)]],
        ),
        RULE,
        lines.join("\n"),
        verdict,
        tail("edge = desk chance − what the price implies, margin removed", stamp()),
      ),
    );
  });
}

/** Explain one leg: the reasoning, not just the number. Defaults to the weakest. */
async function whyAndReply(chatId: number, code: string, which?: number) {
  const loaded = await loadBookingCode(code, "ng");
  if ("error" in loaded) {
    await sorry(chatId, loaded.error, "Check the code and send it again.");
    return;
  }
  const picks = playable(loaded.picks);
  if (!picks.length) {
    await sorry(chatId, "nothing playable on that code", "Football, basketball or tennis only.");
    return;
  }
  const scored = await scoreTicket(picks);
  const ranked = scored.slice().sort((a, b) => b.probability - a.probability);
  const index = which && which >= 1 && which <= ranked.length ? which - 1 : ranked.length - 1;
  const pick = ranked[index];
  if (!pick) {
    await sorry(
      chatId,
      "no leg there",
      `This slip has ${ranked.length} legs. Try /why ${Math.min(2, ranked.length)}.`,
    );
    return;
  }
  const fair = pick.fairOdds ?? fairOddsFromProb(pick.probability / 100);
  const rows: Array<[string, string]> = [
    ["market", pick.marketProb != null ? pct(pick.marketProb) : "\u2014"],
    ["desk", pct(pick.probability)],
  ];
  if (pick.edge != null) rows.push(["edge", `${pick.edge > 0 ? "+" : ""}${pick.edge}pts`]);
  if (fair) rows.push(["fair", formatOdds(fair)]);
  rows.push(["confidence", pick.confidence]);
  if (pick.agreement != null) rows.push(["agreement", pct(pick.agreement)]);

  await say(
    chatId,
    doc(
      head("why", code, `leg ${index + 1}${which ? "" : " \u00b7 weakest"}`),
      `${esc(pick.home)} v ${esc(pick.away)}`,
      `${esc(pick.market)} \u2014 ${esc(pick.selection)}${pick.odds ? `  ${formatOdds(pick.odds)}` : ""}`,
      RULE,
      stats(rows),
      pick.summary,
      pick.reasons.length ? doc(subhead("why"), bullets(pick.reasons)) : null,
      pick.risks.length ? doc(subhead("wahala"), bullets(pick.risks)) : null,
      tail(stamp()),
    ),
  );
}

/** Fractional Kelly sizing for the last slip, haircut for leg count. */
async function kellyAndReply(chatId: number, code: string, bankroll: number) {
  const loaded = await loadBookingCode(code, "ng");
  if ("error" in loaded) {
    await sorry(chatId, loaded.error, "Send the code again, or paste the slip as text.");
    return;
  }
  const picks = playable(loaded.picks);
  if (!picks.length) {
    await sorry(chatId, "nothing playable on that code", "Football, basketball or tennis only.");
    return;
  }
  const scored = await scoreTicket(picks);
  const plan = planStake(scored, bankroll);
  if (!plan.stake) {
    await sorry(
      chatId,
      plan.price == null
        ? "some legs have no price, so I cannot size this"
        : "no edge here \u2014 kelly says stake nothing",
      plan.price == null
        ? "Send the code so every leg carries a price."
        : "The price no pay for the risk. Skip am.",
    );
    return;
  }
  await say(
    chatId,
    doc(
      head("stake", code),
      stats([
        ["legs", String(scored.length)],
        ["price", plan.price ? formatOdds(plan.price) : "\u2014"],
        ["true", pct(plan.trueChance * 100)],
        ...(plan.ev != null ? ([["EV", formatEv(plan.ev)]] as Array<[string, string]>) : []),
      ]),
      RULE,
      stats([
        ["bankroll", naira(bankroll)],
        ["quarter kelly", `${(plan.fraction * 100).toFixed(2)}%`],
        ["stake", naira(plan.stake)],
      ]),
      tail("kelly cuts for accumulators: more legs, more variance, smaller stake", stamp()),
    ),
  );
}

/**
 * Read a slip pasted as plain text (no booking code).
 *
 * Plenty of punters forward the ticket from the SportyBet app instead of the
 * code. We cannot mint a new code without SportyBet's market IDs, but we can
 * still tell them what to cut — which is the actual decision they are making.
 */
async function slipTextAndReply(chatId: number, picks: TicketPick[]) {
  await withProgress(chatId, "Reading that slip…", async () => {
    const scored = await scoreTicket(picks);
    const ranked = scored.slice().sort((a, b) => b.probability - a.probability);
    const shown = ranked.slice(0, 20);
    const lines = shown.map((p, i) => {
      const price = p.odds ? formatOdds(p.odds) : "";
      return leg(
        i + 1,
        `${p.home} v ${p.away}`,
        [p.selection, price].filter(Boolean).join("  "),
        glyph(p.probability),
        `desk ${pct(p.probability)}`,
      );
    });
    if (ranked.length > shown.length) lines.push(`    +${ranked.length - shown.length} more`);
    const hold = ranked.filter((p) => p.probability >= 55).length;
    const cut = ranked.filter((p) => p.probability < 45).length;
    await say(
      chatId,
      doc(
        head("read", `${ranked.length} selections`),
        RULE,
        lines.join("\n"),
        RULE,
        stats([
          ["hold", String(hold)],
          ["watch", String(ranked.length - hold - cut)],
          ["cut", String(cut)],
        ]),
        tail("no booking code, so I cannot mint a new one", stamp()),
      ),
    );
  });
}


async function studyAndReply(chatId: number, code: string, picks?: TicketPick[]) {
  const report = await studyCode(code, picks);
  if ("error" in report) {
    await sorry(chatId, report.error, "Try again in a moment.");
    return;
  }
  await say(chatId, formatStudy(report));
}

async function maybeStudyLast(chatId: number) {
  const code = await latestUnstudiedCode();
  if (!code) return;
  const report = await studyCode(code);
  if ("error" in report) return;
  if (report.pending === report.legs.length) return;
  await say(chatId, formatStudy(report));
}

async function handleCode(chatId: number, code: string) {
  const loaded = await loadBookingCode(code, "ng");
  if ("error" in loaded) {
    await sorry(chatId, loaded.error, "Check the code and send it again.");
    return;
  }
  const play = playable(loaded.picks);
  const price = combinedPrice(play);
  const other = loaded.picks.length - play.length;
  await say(
    chatId,
    doc(
      head("ticket", loaded.shareCode),
      stats([
        ["legs", String(play.length)],
        ...(price ? ([["price", formatOdds(price)]] as Array<[string, string]>) : []),
        ...(other ? ([["off desk", String(other)]] as Array<[string, string]>) : []),
      ]),
      RULE,
      listPicks(play),
      tail("value for the read · why for the reasoning", stamp()),
    ),
    { reply_markup: keyboard(loaded.shareCode) },
  );
  await recordSlip(loaded.shareCode, play);
}


function wantsMarketChange(text: string) {
  const target = parseMarketTarget(text);
  if (!target) return null;
  if (/change|convert|swap|make|all\b|to over|to gg|to double|to dnb|to 1x2/i.test(text)) return target;
  if (/^(over\s*[123]\.5|gg|btts|double chance|draw no bet|1x2)\b/i.test(text.trim())) return target;
  return null;
}

/**
 * 1X2 / straight-win is off the desk for football and basketball — those legs
 * are how the weak 180× slips used to come out. Tennis keeps its winner.
 * Enforced here at the bot level with a clear refusal; `marketForTarget` in
 * sportybet.ts is the second line of defence.
 */
function marketRefusal(target: MarketTarget, picks: TicketPick[]): string | null {
  if (target !== "win") return null;
  if (picks.some((p) => p.sport === "football" || p.sport === "basketball")) {
    return "I no do 1X2 / straight win on football and basketball — only over/under, GG, DC, DNB.";
  }
  return null;
}

async function runTicketCommand(chatId: number, code: string, text: string): Promise<boolean> {
  const loaded = await loadBookingCode(code, "ng");
  if ("error" in loaded) {
    await sorry(chatId, loaded.error, "Check the code and send it again.");
    return true;
  }
  const base = playable(loaded.picks);
  const drop = parseDropIndexes(text);
  if (drop) {
    const kept = loaded.picks.filter((_, i) => !drop.includes(i + 1));
    const play = playable(kept);
    if (!play.length) {
      await sorry(chatId, "nothing left after I dropped those", "Drop fewer legs, or keep am as e be.");
      return true;
    }
    await mintAndReply(chatId, play, "ng", `🗑 Dropped ${drop.join(", ")} · ${play.length} games`);
    return true;
  }
  const other = parseCombineCode(text);
  if (other && other !== loaded.shareCode) {
    const extra = await loadBookingCode(other, "ng");
    if ("error" in extra) {
      await sorry(chatId, extra.error, "Try again in a moment.");
      return true;
    }
    const mergedAll = playable([...loaded.picks, ...extra.picks]);
    const { picks: merged, dropped } = uniqueEvents(mergedAll);
    await mintAndReply(
      chatId,
      merged,
      "ng",
      dropped
        ? `🔗 Combined ${loaded.shareCode} + ${extra.shareCode} · ${merged.length} games · I comot ${dropped} same match`
        : `🔗 Combined ${loaded.shareCode} + ${extra.shareCode} · ${merged.length} games`,
    );
    return true;
  }
  const market = wantsMarketChange(text);
  if (market) {
    const refusal = marketRefusal(market, base);
    if (refusal) {
      await sorry(chatId, "that market no fit the desk", refusal);
      return true;
    }
    await tg("sendMessage", { chat_id: chatId, text: `⚡ I dey change market for ${loaded.shareCode}.` });
    const next = playable(await retargetPicks(base, market));
    if (!next.length) {
      await sorry(chatId, "that market no gree change", "Try another line: over 2.5, gg, dnb.");
      return true;
    }
    await mintAndReply(chatId, next, "ng", `⚡ Market don change · ${next.length} games`);
    return true;
  }
  const cmd = parseCommand(text);
  if (cmd.type === "split") {
    const slips = splitEven(base, cmd.parts);
    for (let i = 0; i < slips.length; i++) {
      await mintAndReply(chatId, slips[i] ?? [], "ng", `Slip ${i + 1} · ${slips[i]?.length ?? 0} games`);
    }
    return true;
  }
  if (cmd.type === "trim") {
    await withProgress(chatId, `Trimming to ${formatOdds(cmd.targetOdds)}…`, () =>
      trimToTarget(chatId, base, cmd.targetOdds),
    );
    return true;
  }
  if (cmd.type === "keepLegs") {
    await sureNAndReply(chatId, base, cmd.count);
    return true;
  }
  if (cmd.type === "sport") {
    const filtered = base.filter((p) => p.sport === cmd.sport);
    if (!filtered.length) {
      await sorry(chatId, `no ${cmd.sport} on that ticket`, "Ask for a sport the ticket actually has.");
      return true;
    }
    await mintAndReply(chatId, filtered, "ng", `${cmd.sport} only · ${filtered.length} games`);
    return true;
  }
  return false;
}

export async function handleTelegramUpdate(update: TgUpdate) {
  if (!TOKEN()) return;
  // Telegram retries until it gets a 200, and a cook can take longer than its
  // retry window. Without this the desk cooks the same slip twice.
  if (await alreadySeen(update.update_id)) return;
  await ensureMenu();
  await refreshKeys();

  const from = update.callback_query?.from ?? update.message?.from;
  const chatId = update.callback_query?.message?.chat.id ?? update.message?.chat.id;
  const incoming = update.message?.text?.trim() ?? "";

  if (from && chatId && isCmd(incoming, "lock")) {
    if ((await accessLocked()) && !(await isOwner(from))) {
      await sorry(chatId, "private desk", "Only the owner fit run that one.");
      return;
    }
    const state = await loadAccess();
    const id = String(from.id);
    const username = from.username ?? "";
    const users = state.users.filter((u) => u.user_id !== id && u.username.toLowerCase() !== username.toLowerCase());
    users.unshift({ user_id: id, username, role: "owner" });
    const next = { locked: true, users };
    await saveAccess(next);
    const check = await loadAccess();
    if (!check.locked || !check.users.length) {
      await sorry(chatId, "lock no save", "Try /lock again.");
      return;
    }
    await tg("sendMessage", {
      chat_id: chatId,
      text: ["Locked. Only these people:", "", ...accessLines(check), "", "/grant @username"].join("\n"),
    });
    return;
  }
  if (from && chatId && isCmd(incoming, "unlock")) {
    if (!(await isOwner(from))) {
      await sorry(chatId, "private desk", "Only the owner fit run that one.");
      return;
    }
    const state = await loadAccess();
    await saveAccess({ ...state, locked: false });
    await say(chatId, doc(head("unlocked"), "Anyone fit use the desk now."));
    return;
  }

  if (from && !(await hasAccess(from))) {
    if (update.callback_query) {
      await tg("answerCallbackQuery", { callback_query_id: update.callback_query.id, text: "Private desk." });
    } else if (chatId) {
      await sorry(chatId, "private desk", "Only the owner fit run that one.");
    }
    return;
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id;
    const data = cq.data ?? "";
    await tg("answerCallbackQuery", { callback_query_id: cq.id });
    if (!chatId) return;
    await rememberChat(chatId);
    const [kind, code, arg] = data.split(":");
    if (!code) return;
    if (kind === "c") {
      const sport = sportFromFlag(code);
      await createSportSlip(chatId, sport, Number(arg || 10));
      return;
    }
    if (kind === "o") {
      const sport = sportFromFlag(code);
      await createOddsSlip(chatId, sport, Number(arg || 10));
      return;
    }
    if (kind === "l") {
      const sport = sportFromFlag(code);
      const window: CookWindow =
        arg === "weekend" ? "weekend" : arg === "fortnight" ? "fortnight" : "week";
      await createSportSlip(chatId, sport, 12, window);
      return;
    }
    if (kind === "x") {
      await createMixSlip(chatId, { games: Number(arg || 12) });
      return;
    }
    if (kind === "y" && code === "LAST") {
      const last = await latestUnstudiedCode();
      if (!last) {
        await sorry(chatId, "no slip to settle yet", "Cook one, or send a code first.");
        return;
      }
      await studyAndReply(chatId, last);
      return;
    }
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await sorry(chatId, loaded.error, "Check the code and send it again.");
      return;
    }
    const base = playable(loaded.picks);
    if (kind === "k") {
      await sureNAndReply(chatId, base, Number(arg || 2));
      return;
    }
    if (kind === "g") {
      await askTrimCount(chatId, loaded.shareCode, base.length);
      return;
    }
    if (kind === "e") {
      await evAndReply(chatId, code);
      return;
    }
    if (kind === "w") {
      await whyAndReply(chatId, code);
      return;
    }
    if (kind === "ch") {
      const target = parseMarketTarget(arg || "ou25") ?? "ou25";
      const refusal = marketRefusal(target, base);
      if (refusal) {
        await sorry(chatId, "that market no fit the desk", refusal);
        return;
      }
      await say(chatId, head("market", `changing ${loaded.shareCode}`));
      const next = playable(await retargetPicks(base, target));
      await mintAndReply(chatId, next, "ng", `⚡ Market don change · ${next.length} games`);
      return;
    }
    if (kind === "y") {
      await studyAndReply(chatId, loaded.shareCode, base);
      return;
    }
    if (kind === "m") {
      await mintAndReply(chatId, base, "ng", `🎫 SportyBet code · ${base.length} games`);
      return;
    }
    if (kind === "s") {
      const parts = Number(arg || 2);
      const slips = splitEven(base, parts);
      for (let i = 0; i < slips.length; i++) {
        await mintAndReply(chatId, slips[i] ?? [], "ng", `Slip ${i + 1} · ${slips[i]?.length ?? 0} games`);
      }
      return;
    }
    if (kind === "t") {
      const target = Number(arg || 50);
      await withProgress(chatId, `Trimming to ${formatOdds(target)}…`, () =>
        trimToTarget(chatId, base, target),
      );
    }
    return;
  }

  const msg = update.message;
  if (!msg?.text || !msg.chat) return;
  await rememberChat(msg.chat.id);
  const raw = msg.text.trim();
  const replyText = msg.reply_to_message?.text ?? "";
  if (/how many draw/i.test(replyText)) {
    const n = Number(raw.match(/\d{1,4}/)?.[0]);
    if (Number.isFinite(n) && n >= 1) {
      await createDrawSlip(msg.chat.id, n, "today");
      return;
    }
    await askDrawCount(msg.chat.id);
    return;
  }
  if (/trim [A-Z0-9]+ to how many/i.test(replyText)) {
    const code = replyText.match(/trim\s+([A-Z0-9]{4,16})/i)?.[1];
    const n = Number(raw.match(/\d{1,4}/)?.[0]);
    if (code && Number.isFinite(n) && n >= 1) {
      const loaded = await loadBookingCode(code, "ng");
      if ("error" in loaded) {
        await sorry(msg.chat.id, loaded.error, "Check the code and send it again.");
        return;
      }
      await mintKeepersAndReply(msg.chat.id, playable(loaded.picks), n);
      return;
    }
    if (code) await askTrimCount(msg.chat.id, code, MAX_LEGS);
    return;
  }
  if (raw === "/start" || isCmd(raw, "start")) {
    await ensureMenu(true);
    const access = await loadAccess();
    await saveAccess(access);
    await tg("sendPhoto", {
      chat_id: msg.chat.id,
      photo: BANNER_URL,
      caption: "<b>SlipCut</b>\n\nPaste a booking code.\nOr tap the menu.",
      parse_mode: "HTML",
      reply_markup: deskKeyboard(),
    });
    return;
  }
  if (isCmd(raw, "help")) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      parse_mode: "HTML",
      text: [
        "<b>SlipCut</b>",
        "",
        "Paste a booking code.",
        "",
        "<b>Cook</b>",
        "<code>10 games football over 1.5</code>",
        "<code>cook over 2 football</code>",
        "<code>12 games football 1st half overs</code>",
        "<code>cook basketball full time overs and 1st half overs</code>",
        "<code>12 games tennis</code>",
        "<code>weekend mix</code>",
        "<code>stake 2</code>",
        "<code>2 odds</code>",
        "<code>8 draw</code>",
        "<code>20 draw football</code>",
        "",
        "<b>On a slip</b>",
        "trim  ·  study  ·  stake 2000",
      ].join("\n"),
      reply_markup: deskKeyboard(),
    });
    return;
  }
  if (raw === "/slang") {
    await tg("sendMessage", { chat_id: msg.chat.id, text: slangHelp() });
    return;
  }
  if (isCmd(raw, "keys") || isCmd(raw, "key")) {
    const user = msg.from;
    if (!user || !(await isOwner(user))) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "Private desk." });
      return;
    }
    const arg = cmdArg(raw);
    if (!arg || isCmd(raw, "keys")) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: formatKeyList() });
      return;
    }
    const del = arg.match(/^del(?:ete)?\s+(you|seekai|gemini|you\.com)\s+(\d+)\s*$/i);
    if (del) {
      const token = del[1]!.toLowerCase();
      const kind = token.startsWith("you") ? "you" : token.startsWith("gem") ? "gemini" : "seekai";
      const ok = await delDeskKey(kind, Number(del[2]));
      await refreshKeys();
      await tg("sendMessage", {
        chat_id: msg.chat.id,
        text: ok ? `Removed ${kind} extra ${del[2]}.\n\n${formatKeyList()}` : `No extra ${kind} key ${del[2]}. Env keys stay.`,
      });
      return;
    }
    // Multi-line pastes are normal — people forward keys with newlines.
    // Split on whitespace and read every token; an engine name (you /
    // you.com / gemini / seekai) labels the keys that follow it until the
    // next engine name. detectKey still wins when a key identifies itself.
    const tokens = arg.split(/\s+/).filter(Boolean);
    const kindOf = (t: string): KeyKind | null => {
      const x = t.toLowerCase();
      if (x === "you" || x === "you.com") return "you";
      if (x === "gemini") return "gemini";
      if (x === "seekai" || x === "opus") return "seekai";
      return null;
    };
    let label: KeyKind | null = null;
    const looks: Array<{ kind: KeyKind; key: string }> = [];
    for (const tok of tokens) {
      const asKind = kindOf(tok);
      if (asKind && !detectKey(tok)) {
        label = asKind;
        continue;
      }
      const look = detectKey(tok) ?? (label ? { kind: label, key: tok } : null);
      if (look) looks.push(look);
    }
    if (looks.length) {
      let savedAny = false;
      for (const look of looks) {
        savedAny = (await addDeskKey(look.kind, look.key)) || savedAny;
      }
      await refreshKeys();
      const howMany = `${looks.length} key${looks.length === 1 ? "" : "s"}`;
      await tg("sendMessage", {
        chat_id: msg.chat.id,
        text: savedAny
          ? `Added ${howMany}.\n\n${formatKeyList()}`
          : `Could not save the key(s) to the database. Add them on Vercel as GEMINI_API_KEY / SEEKAI_API_KEY / YDC_API_KEY, then Redeploy.\n\n${formatKeyList()}`,
      });
      return;
    }
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: formatKeyList(),
    });
    return;
  }
  if (isCmd(raw, "keytest") || isCmd(raw, "keycheck") || isCmd(raw, "engine")) {
    const user = msg.from;
    if (!user || !(await isOwner(user))) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "Private desk." });
      return;
    }
    const sent = (await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: "🧪 Dey test engines…",
    })) as { message_id?: number } | null;
    const report = await probeText();
    if (sent?.message_id) {
      await tg("editMessageText", {
        chat_id: msg.chat.id,
        message_id: sent.message_id,
        text: report,
      });
      return;
    }
    await tg("sendMessage", { chat_id: msg.chat.id, text: report });
    return;
  }
  {
    const pasted = detectKey(raw);
    if (pasted && msg.from && (await isOwner(msg.from))) {
      const saved = await addDeskKey(pasted.kind, pasted.key);
      await refreshKeys();
      await tg("sendMessage", {
        chat_id: msg.chat.id,
        text: saved
          ? `Added ${pasted.kind} key.\n\n${formatKeyList()}`
          : `Could not save. Add ${pasted.kind === "gemini" ? "GEMINI_API_KEY" : pasted.kind === "seekai" ? "SEEKAI_API_KEY" : "YDC_API_KEY"} on Vercel, then Redeploy.\n\n${formatKeyList()}`,
      });
      return;
    }
  }
  if (isCmd(raw, "who") || isCmd(raw, "grant") || isCmd(raw, "revoke")) {
    const user = msg.from;
    if (!user || !(await isOwner(user))) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "Private desk." });
      return;
    }
    if (isCmd(raw, "who")) {
      const state = await loadAccess();
      const lines = accessLines(state);
      await tg("sendMessage", {
        chat_id: msg.chat.id,
        text: [
          state.locked ? "Locked — only people you grant" : "Open — anybody fit use this bot",
          "",
          ...lines,
        ]
          .filter((l, i, arr) => l !== "" || arr[i - 1] !== "")
          .join("\n"),
      });
      return;
    }
    if (isCmd(raw, "revoke")) {
      const token = cmdArg(raw).replace(/^@/, "");
      if (!token) {
        await tg("sendMessage", { chat_id: msg.chat.id, text: "/revoke @username" });
        return;
      }
      const state = await loadAccess();
      const next = {
        ...state,
        users: state.users.filter(
          (u) => u.user_id !== token && u.username.toLowerCase() !== token.toLowerCase(),
        ),
      };
      await saveAccess(next);
      await tg("sendMessage", { chat_id: msg.chat.id, text: `Revoked ${token}.` });
      return;
    }
    const reply = msg.reply_to_message?.from;
    const arg = cmdArg(raw);
    let userId = "";
    let username = "";
    if (reply?.id) {
      userId = String(reply.id);
      username = reply.username ?? "";
    } else if (/^\d{5,}$/.test(arg)) {
      userId = arg;
    } else if (arg) {
      username = arg.replace(/^@/, "");
      const chat = await tg("getChat", { chat_id: `@${username}` });
      if (chat && typeof chat === "object" && "id" in chat) {
        userId = String((chat as { id: number }).id);
      } else {
        userId = `@${username.toLowerCase()}`;
      }
    } else {
      await tg("sendMessage", {
        chat_id: msg.chat.id,
        text: "Reply to their message with /grant, or /grant @username",
      });
      return;
    }
    const state = await loadAccess();
    const users = state.users.filter(
      (u) => u.user_id !== userId && u.username.toLowerCase() !== username.toLowerCase(),
    );
    users.push({ user_id: userId, username, role: "guest" });
    await saveAccess({ ...state, locked: true, users });
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: `Granted ${username ? `@${username}` : userId}. They must tap Start.`,
    });
    return;
  }
  if (isCmd(raw, "today")) {
    await createLadderCook(msg.chat.id, parseSport(cmdArg(raw)) ?? "football", "today", await resolveBand(raw));
    return;
  }
  if (
    isCmd(raw, "stake") ||
    /^(stake 2|2 odds stake|stake daily)\s*$/i.test(raw)
  ) {
    await createStakeDaily(msg.chat.id);
    return;
  }
  if (isCmd(raw, "daily2") || /^(2 odds|daily 2)\s*$/i.test(raw)) {
    await createSportyDaily2(msg.chat.id);
    return;
  }
  if (isCmd(raw, "draw") || /^(draw|draws)\s*$/i.test(raw)) {
    const arg = cmdArg(raw);
    const n = Number(arg.match(/\d{1,4}/)?.[0]);
    if (Number.isFinite(n) && n >= 1) {
      const w = parseCookWindow(raw);
      await createDrawSlip(msg.chat.id, n, w === "soon" ? "today" : w);
      return;
    }
    await askDrawCount(msg.chat.id);
    return;
  }
  if (isCmd(raw, "weekend")) {
    await createLadderCook(msg.chat.id, parseSport(cmdArg(raw)) ?? "football", "weekend", await resolveBand(raw));
    return;
  }
  if (isCmd(raw, "mix")) {
    await createMixSlip(msg.chat.id, { games: 12 });
    return;
  }
  if (isCmd(raw, "book") || /^(my book|my slips|book|bankroll)\s*$/i.test(raw)) {
    await say(msg.chat.id, await formatBook());
    return;
  }
  if (isCmd(raw, "recap")) {
    await say(msg.chat.id, await formatRecap());
    return;
  }
  if (isCmd(raw, "ev")) {
    const arg = cmdArg(raw);
    const target =
      codeFromText(arg) ||
      codeFromText(msg.reply_to_message?.text) ||
      (await latestCode());
    if (!target) {
      await tg("sendMessage", {
        chat_id: msg.chat.id,
        text: "Paste a code first, or: /ev ABC123",
      });
      return;
    }
    await evAndReply(msg.chat.id, target);
    return;
  }
  if (isCmd(raw, "why")) {
    const arg = cmdArg(raw);
    const target =
      codeFromText(arg) ||
      codeFromText(msg.reply_to_message?.text) ||
      (await latestCode());
    if (!target) {
      await tg("sendMessage", {
        chat_id: msg.chat.id,
        text: "Paste a code first, or: /why ABC123 3",
      });
      return;
    }
    const which = Number(arg.replace(/[A-Z0-9]{4,16}/i, "").match(/\d{1,2}/)?.[0] ?? NaN);
    await withProgress(msg.chat.id, "Checking that leg…", () =>
      whyAndReply(msg.chat.id, target, Number.isFinite(which) ? which : undefined),
    );
    return;
  }
  if (isCmd(raw, "kelly")) {
    const bankroll = Number((cmdArg(raw).match(/[\d,.]+/)?.[0] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(bankroll) || bankroll <= 0) {
      await tg("sendMessage", {
        chat_id: msg.chat.id,
        text: "Tell me your bankroll: /kelly 50000",
      });
      return;
    }
    const target = codeFromText(msg.reply_to_message?.text) || (await latestCode());
    if (!target) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "Paste a code first, then: /kelly 50000" });
      return;
    }
    await withProgress(msg.chat.id, "Sizing the bet…", () =>
      kellyAndReply(msg.chat.id, target, bankroll),
    );
    return;
  }
  if (isCmd(raw, "calibration")) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: formatCalibration(await calibrationReport()),
    });
    return;
  }
  if (isCmd(raw, "accuracy") || isCmd(raw, "bar") || isCmd(raw, "stats")) {
    await say(msg.chat.id, formatMarketStats(await loadMarketStats()));
    return;
  }
  if (isCmd(raw, "filter")) {
    const arg = cmdArg(raw);
    const hit = normalizeFilter(arg);
    if (hit === "clear") {
      await clearAllows();
      await tg("sendMessage", { chat_id: msg.chat.id, text: "Filter off. All leagues." });
      return;
    }
    if (hit) {
      await addAllow(hit);
      await tg("sendMessage", { chat_id: msg.chat.id, text: `Only “${hit}” from now.` });
      return;
    }
    const rows = await listAllows();
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: rows.length
        ? `Filter: ${rows.join(", ")}\nSay /filter EPL or /filter clear`
        : "No filter. Try /filter EPL",
    });
    return;
  }
  const block = parseBlock(normalizePidgin(raw));
  if (block?.list) {
    const rows = await listBlocks();
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: rows.length ? `Blacklist:\n${rows.map((v) => `• ${v}`).join("\n")}` : "Blacklist empty.",
    });
    return;
  }
  if (block?.add) {
    await addBlock(block.add);
    await tg("sendMessage", { chat_id: msg.chat.id, text: `I go skip anything wey get “${block.add}”.` });
    return;
  }
  if (block?.remove) {
    await removeBlock(block.remove);
    await tg("sendMessage", { chat_id: msg.chat.id, text: `I don allow “${block.remove}” again.` });
    return;
  }
  const onlyM = raw.match(/^only\s+(.+)$/i);
  if (onlyM?.[1]) {
    const hit = normalizeFilter(onlyM[1]);
    if (hit === "clear") {
      await clearAllows();
      await tg("sendMessage", { chat_id: msg.chat.id, text: "Filter off. All leagues." });
      return;
    }
    if (hit) {
      await addAllow(hit);
      await tg("sendMessage", { chat_id: msg.chat.id, text: `Only “${hit}” from now.` });
      return;
    }
  }
  const chat = splitChat(raw);
  if (chat.greet && !chat.rest) {
    await tg("sendMessage", { chat_id: msg.chat.id, text: chat.greet });
    return;
  }
  const text = normalizePidgin(chat.rest || raw);
  const talk = pidginSmallTalk(raw) || pidginSmallTalk(text);
  if (talk && !codeFromText(text) && !parseLegCount(text) && !parseSport(text) && !wantsCreate(text) && !parseOddsTarget(text) && !parseOddsTarget(raw) && parseCookWindow(`${text} ${raw}`) === "soon" && !wantsMix(text) && !wantsLive(text)) {
    await tg("sendMessage", { chat_id: msg.chat.id, text: talk });
    return;
  }
  const oddsTarget = parseOddsTarget(text) ?? parseOddsTarget(raw) ?? parseOddsTarget(chat.rest || "");
  const sportGuess = parseSport(text) ?? parseSport(raw);
  const cookWindow = parseCookWindow(`${text} ${raw}`);
  const mix = wantsMix(`${text} ${raw}`);
  const band = await resolveBand(`${text} ${raw}`);
  const stakeAmt = parseStake(text) ?? parseStake(raw);
  if (stakeAmt) {
    const stakeCode =
      codeFromText(text) || codeFromText(msg.reply_to_message?.text) || (await latestCode());
    if (!stakeCode) {
      await tg("sendMessage", {
        chat_id: msg.chat.id,
        text: "Paste a code first, then: stake 2000",
      });
      return;
    }
    await stakeAndReply(msg.chat.id, stakeCode, stakeAmt);
    return;
  }
  if (wantsLive(text) || wantsLive(raw)) {
    const liveCode =
      codeFromText(text) || codeFromText(msg.reply_to_message?.text) || (await latestCode());
    if (!liveCode) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "Paste a code first, then: score" });
      return;
    }
    const loaded = await loadBookingCode(liveCode, "ng");
    if ("error" in loaded) {
      await sorry(msg.chat.id, loaded.error, "Check the code and send it again.");
      return;
    }
    await liveScoreAndReply(msg.chat.id, liveCode, playable(loaded.picks));
    return;
  }
  if (parseOddsBand(`${text} ${raw}`) && !oddsTarget && !parseLegCount(text) && !mix && !wantsCreate(text) && !sportGuess) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: `I go keep each game between ${formatOdds(band?.min ?? 1.05)} and ${formatOdds(band?.max ?? 6)}.`,
    });
    return;
  }
  if (
    /\bstake(?:\.com)?\b/i.test(`${text} ${raw}`) &&
    !parseStake(raw) &&
    (oddsTarget || parseLegCount(text) || /daily|today|2\b/i.test(`${text} ${raw}`))
  ) {
    await createStakeDaily(msg.chat.id);
    return;
  }
  if (oddsTarget && !looksLikeShareCode(raw)) {
    if (mix) await createMixSlip(msg.chat.id, { odds: oddsTarget }, cookWindow, band);
    else await createOddsSlip(msg.chat.id, sportGuess ?? "football", oddsTarget, cookWindow, band);
    return;
  }
  if (raw === "/study" || /^(study|results|cut|lost|it cut|this cut)\b/i.test(text)) {
    const studyCodeToken =
      codeFromText(text) ||
      codeFromText(msg.reply_to_message?.text) ||
      (await latestUnstudiedCode());
    if (!studyCodeToken) {
      await tg("sendMessage", {
        chat_id: msg.chat.id,
        text: "Send booking code first, then talk study after the games don finish.",
      });
      return;
    }
    const loaded = await loadBookingCode(studyCodeToken, "ng");
    const picks = "error" in loaded ? undefined : playable(loaded.picks);
    await studyAndReply(msg.chat.id, studyCodeToken, picks);
    return;
  }
  const oddsOnTicket = parseOddsTarget(text) ?? parseOddsTarget(raw);
  const legCount = parseLegCount(text);
  const sport = parseSport(text) ?? parseSport(raw);
  const asks = parseCookAsks(`${text} ${raw}`);
  const code = codeFromText(text) || codeFromText(msg.reply_to_message?.text);
  const isBareCode = Boolean(code && looksLikeShareCode(text));
  if (oddsOnTicket && code) {
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await sorry(msg.chat.id, loaded.error, "Check the code and send it again.");
      return;
    }
    const base = playable(loaded.picks);
    await withProgress(msg.chat.id, `Trimming to ${formatOdds(clampOddsTarget(oddsOnTicket))}…`, () =>
      trimToTarget(msg.chat.id, base, clampOddsTarget(oddsOnTicket)),
    );
    return;
  }
  if (code && /\b(study|results|cut|lost)\b/i.test(text) && !isBareCode) {
    const loaded = await loadBookingCode(code, "ng");
    const picks = "error" in loaded ? undefined : playable(loaded.picks);
    await studyAndReply(msg.chat.id, code, picks);
    return;
  }
  if (code && !isBareCode) {
    const handled = await runTicketCommand(msg.chat.id, code, text);
    if (handled) return;
  }
  if (code && !legCount && /^\s*trim\s*$/i.test(text)) {
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await sorry(msg.chat.id, loaded.error, "Check the code and send it again.");
      return;
    }
    await askTrimCount(msg.chat.id, loaded.shareCode, playable(loaded.picks).length);
    return;
  }
  if (code && /\bmint all\b/i.test(text)) {
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await sorry(msg.chat.id, loaded.error, "Check the code and send it again.");
      return;
    }
    const base = playable(loaded.picks);
    await mintAndReply(msg.chat.id, base, "ng", `🎫 SportyBet code · ${base.length} games`);
    return;
  }
  if (legCount && mix && !code) {
    await createMixSlip(msg.chat.id, { games: legCount }, cookWindow, band);
    return;
  }
  if (wantsDraw(`${text} ${raw}`) && !code) {
    const w = cookWindow === "soon" ? "today" : cookWindow;
    await createDrawSlip(msg.chat.id, legCount ?? 12, w);
    return;
  }
  if (asks.length && !code) {
    const n = legCount ?? 10;
    await createSportSlip(msg.chat.id, sport ?? "football", n, cookWindow, band, asks);
    return;
  }
  if (legCount && sport && !code) {
    await createSportSlip(msg.chat.id, sport, legCount, cookWindow, band, asks);
    return;
  }
  if (legCount && !code && wantsCreate(text + " " + raw)) {
    await createSportSlip(msg.chat.id, sport ?? "football", legCount, cookWindow, band, asks);
    return;
  }
  if (mix && !code && !legCount) {
    await createMixSlip(msg.chat.id, { games: 12 }, cookWindow, band);
    return;
  }
  if (legCount && code) {
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await sorry(msg.chat.id, loaded.error, "Check the code and send it again.");
      return;
    }
    const base = playable(loaded.picks);
    const filtered = sport ? base.filter((p) => p.sport === sport) : base;
    if (sport && !filtered.length) {
      await tg("sendMessage", {
        chat_id: msg.chat.id,
        text: `That ticket no get ${sport}. Make I cook fresh ${clampLegs(legCount, 5)} games ${sport} instead.`,
      });
      await createSportSlip(msg.chat.id, sport, legCount, cookWindow, band);
      return;
    }
    await sureNAndReply(msg.chat.id, filtered, legCount);
    return;
  }
  if (cookWindow !== "soon" && !code && !legCount) {
    await createSportSlip(msg.chat.id, sport ?? "football", 12, cookWindow, band);
    return;
  }
  if (sport && !legCount && !code) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: `How many ${sport} games you want? Type: 12 games ${sport}`,
    });
    return;
  }
  if (legCount && !code) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: `Add the sport — type: ${clampLegs(legCount, 5)} games football`,
    });
    return;
  }
  // Last resort before the shrug: maybe they pasted the slip as text.
  if (!code) {
    const pasted = parseTicketText(raw);
    if (pasted.length >= 2) {
      await slipTextAndReply(msg.chat.id, pasted);
      return;
    }
  }
  if (!code) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: "Paste a code, or say 10 odds football.",
    });
    return;
  }
  await handleCode(msg.chat.id, code);
}
