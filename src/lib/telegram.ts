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

function researchTag(researched: boolean) {
  if (!researched) return "desk read";
  if (geminiReady()) return "gemini";
  if (seekaiReady()) return "opus";
  return "researched";
}
const MENU = [
  { command: "start", description: "Welcome" },
  { command: "predict", description: "AI picks — cook a slip" },
  { command: "ucl", description: "Champions League slip" },
  { command: "engine", description: "Accuracy-led accumulators" },
  { command: "handball", description: "Cook handball" },
  { command: "tennis", description: "Cook tennis" },
  { command: "mix", description: "Mix all sports" },
  { command: "analyze", description: "Form, stats & H2H" },
  { command: "optimize", description: "Trim odds (cut risk)" },
  { command: "2odds", description: "Safe ~2.00 odds rollover" },
  { command: "split", description: "Split a slip" },
  { command: "book", description: "Mint a SportyBet code" },
  { command: "results", description: "See tracked slip results" },
  { command: "live", description: "Live results" },
  { command: "help", description: "How to talk to me" },
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
const KEEP_LINE = 52;
/** Telegram API call budget — a hung fetch must not eat the whole function timeout. */
const TG_TIMEOUT_MS = 20_000;
/** How long one chat is considered "cooking" before a new request may start. */
const BUSY_MS = 120_000;
/** Remember recent update_ids so Telegram retries do not cook the same slip twice. */
const RECENT_UPDATES_MAX = 1000;

function naira(n: number) {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
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
  // No busy-lock — start another cook anytime.
  const sent = await tg("sendMessage", { chat_id: chatId, text });
  const progressId = messageIdOf(sent);
  await tg("sendChatAction", { chat_id: chatId, action: "typing" });
  try {
    await job();
  } finally {
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

async function cookPool<T extends TicketPick>(picks: T[], band: OddsBand | null): Promise<T[]> {
  const [blocks, allows] = await Promise.all([listBlocks(), listAllows()]);
  return applyBand(allowedBy(blockedBy(picks, blocks), allows), band);
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
    await tg("sendMessage", { chat_id: chatId, text: loaded.error });
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

async function tg(method: string, payload: Record<string, unknown> = {}) {
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
  if (sport === "handball") return "🤾";
  if (sport === "football") return "⚽";
  return "🎟️";
}

function sportFromFlag(code: string): BookSport {
  if (code === "b") return "basketball";
  if (code === "t") return "tennis";
  if (code === "h") return "handball";
  return "football";
}

function deskKeyboard() {
  return {
    keyboard: [
      [{ text: "Predict" }, { text: "Daily 2 odds" }, { text: "Engine" }],
      [{ text: "Analyze" }, { text: "Optimize" }, { text: "Live" }],
      [{ text: "Book" }, { text: "Results" }, { text: "Help" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Paste a code, or say 12 games football",
  };
}

/** Buttons under a code the user pasted. */
function keyboard(code: string) {
  return {
    inline_keyboard: [
      [
        { text: "Copy", copy_text: { text: code } },
        { text: "Trim", callback_data: `g:${code}` },
        { text: "Split 2", callback_data: `s:${code}:2` },
      ],
      [
        { text: "Score", callback_data: `v:${code}` },
        { text: "Study", callback_data: `y:${code}` },
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
        { text: "Score", callback_data: `v:${code}` },
        { text: "Study", callback_data: `y:${code}` },
      ],
    ],
  };
}

function listPicks(picks: TicketPick[]) {
  const shown = picks.slice(0, 35);
  const lines = shown.map((p, i) => {
    const when = formatKickoff(p.kickoff);
    const price = p.odds ? formatOdds(p.odds) : "";
    const bits = [`${sportIcon(p.sport)} ${p.home} vs ${p.away}`, p.selection, price, when].filter(Boolean);
    return `${i + 1}  ${bits.join("  ·  ")}`;
  });
  if (picks.length > shown.length) lines.push(`+${picks.length - shown.length} more`);
  return lines.join("\n");
}

function playable(picks: TicketPick[]) {
  return picks.filter((p) => p.sport !== "other" && p.sporty);
}

async function mintAndReply(chatId: number, picks: TicketPick[], country: string, title: string, limit = MAX_LEGS) {
  const unique = uniqueEvents(picks);
  const work = unique.picks.slice(0, Math.max(1, Math.min(MAX_LEGS, limit)));
  const head =
    unique.dropped > 0 ? `${title} · I comot ${unique.dropped} same-match` : title;
  const selections = sportyOf(work);
  if (!selections.length) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Those games no get SportyBet ID. Send booking code first, my guy.",
    });
    return;
  }
  const minted = await mintShare(selections, country);
  if ("error" in minted && selections.length > 40) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `SportyBet no gree take ${selections.length} for one code. I dey split am.`,
    });
    // Must be smaller than the >40 threshold above, or a 41-50 leg slip
    // recurses into an identical-size "split" forever without ever
    // actually shrinking below the limit.
    const size = 35;
    for (let i = 0; i < work.length; i += size) {
      await mintAndReply(
        chatId,
        work.slice(i, i + size),
        country,
        `${head} · part ${Math.floor(i / size) + 1}`,
      );
    }
    return;
  }
  if ("error" in minted) {
    await tg("sendMessage", { chat_id: chatId, text: minted.error });
    return;
  }
  const code = minted.shareCode;
  await tg("sendMessage", {
    chat_id: chatId,
    text: `<code>${esc(code)}</code>`,
    parse_mode: "HTML",
    reply_markup: mintedKeyboard(code, minted.shareURL),
  });
  await recordSlip(code, work);
  await rememberEventIds(work.map((p) => p.sporty?.eventId).filter((id): id is string => Boolean(id)));
}

async function scorePlayable(picks: TicketPick[]) {
  return analyzePicks(picks, KEEP_LINE);
}

async function sureNAndReply(
  chatId: number,
  picks: TicketPick[],
  count: number,
  title = "",
) {
  const n = clampLegs(count, 2);
  if (!picks.length) {
    await tg("sendMessage", { chat_id: chatId, text: "No playable games for this one." });
    return;
  }
  await withProgress(chatId, `Picking ${n}…`, async () => {
    const result = await scorePlayable(picks);
    const top = keepTop(await applyLessonScores(result.picks), n);
    if (!top.length) {
      await tg("sendMessage", { chat_id: chatId, text: `I no fit pick ${n} sure games from that ticket.` });
      return;
    }
    await mintAndReply(chatId, top, "ng", title || `${top.length} games`);
  });
}

async function createSportSlip(
  chatId: number,
  sport: BookSport,
  count: number,
  window: CookWindow = "today",
  band?: OddsBand | null,
  asks: CookAsk[] = [],
  league: string | null = null,
) {
  const n = clampLegs(count, MAX_LEGS);
  const span = windowLabel(window);
  const market = formatCookAsks(asks);
  const leagueTag = league === "champions" ? "Champions League" : sport;
  const label = span
    ? `Researching ${span}${market ? ` · ${market}` : ""}…`
    : `Researching ${n} ${leagueTag}${market ? ` · ${market}` : ""}…`;
  await withProgress(chatId, label, () => cookSportSlip(chatId, sport, n, window, band, asks, league));
}

async function cookSportSlip(
  chatId: number,
  sport: BookSport,
  n: number,
  window: CookWindow,
  band: OddsBand | null | undefined,
  asks: CookAsk[],
  league: string | null = null,
) {
  const span = windowLabel(window);
  const useBand = band ?? (await loadOddsBand());
  const market = formatCookAsks(asks);
  const leagueTag = league === "champions" ? "Champions League" : sport;
  const listed = await listUpcomingPicks(
    sport,
    Math.max(n + 20, 60),
    window,
    "any",
    await loadRecentEventIds(),
    league,
  );
  if ("error" in listed) {
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  await maybeStudyLast(chatId);
  const wanted = (asks.length ? listed.filter((p) => pickMatchesAsks(p, asks)) : listed).filter(cookablePick);
  if (!wanted.length) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: market ? `No ${leagueTag} ${market} open now. Try another line or later.` : `No ${leagueTag} remain after research. Relax the cap or blacklist.`,
    });
    return;
  }
  // Accuracy-led gate: prefer sports/prediction types whose settled record
  // beats the engine's own average hit rate. Draws and straight home wins
  // (the `win`/1X2 family) are deprioritized; double chance and goal lines
  // are preferred. If NOTHING clears the bar (e.g. thin settled sample, or
  // an off night for the usual strong markets), fall back to the ungated
  // pool instead of refusing outright — a flagged, lower-confidence slip
  // beats no slip at all.
  const accStats = await loadAccuracy();
  const gated = accuracyFilter(wanted, accStats);
  const gateFellBack = !gated.kept.length;
  const usable = gateFellBack ? wanted : gated.kept;
  const pool = await cookPool(usable, useBand);
  const researched = await researchPicks(pool, n);
  const recent = await loadRecentEventIds();
  const ranked = uniqueEvents(researched.keep.filter((p) => p.sport === sport)).picks;
  const fresh = ranked.filter((p) => !recent.includes(p.sporty?.eventId ?? ""));
  const take = (fresh.length >= Math.min(n, 4) ? fresh : ranked).slice(0, n);
  if (!take.length) {
    await tg("sendMessage", { chat_id: chatId, text: `No ${leagueTag}${market ? ` ${market}` : ""} remain after research.` });
    return;
  }
  const tag = researchTag(researched.researched);
  const accTag = accStats.sampleCount > 0 ? ` · accuracy` : "";
  const gatedNote = gateFellBack
    ? " · below usual accuracy bar"
    : gated.dropped > 0
      ? ` · gate −${gated.dropped}`
      : "";
  const title =
    take.length < n
      ? `${take.length} games ${leagueTag}${market ? ` · ${market}` : ""}${span ? ` · ${span}` : ""} · ${tag}${accTag}${gatedNote} — na only ${take.length} pass`
      : `${take.length} games ${leagueTag}${market ? ` · ${market}` : ""}${span ? ` · ${span}` : ""} · ${tag}${accTag}${gatedNote}${researched.dropped ? ` · dropped ${researched.dropped}` : ""}`;
  await analyzeThenMint(chatId, take, "ng", title, `<b>Predict · ${take.length} games</b>`, n);
}

async function createOddsSlip(
  chatId: number,
  sport: BookSport,
  targetRaw: number,
  window: CookWindow = "today",
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
  const listed = await listUpcomingPicks(sport, 35, window, "any", await loadRecentEventIds());
  if ("error" in listed) {
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  await maybeStudyLast(chatId);
  const pool = await cookPool(listed.filter(cookablePick), useBand);
  const researched = await researchPicks(pool, 24);
  const only = researched.keep.filter((p) => p.sport === sport);
  const take = buildToOdds(only, target).slice(0, MAX_LEGS);
  if (!take.length) {
    await tg("sendMessage", { chat_id: chatId, text: `I no fit build ${formatOdds(target)} from the ${sport} wey dey now.` });
    return;
  }
  const actual = combinedOdds(take);
  const tag = researchTag(researched.researched);
  const title =
    actual && actual < target * 0.75
      ? `${take.length} games ${sport}${span ? ` · ${span}` : ""} · ${formatOdds(actual)} · ${tag} — pool no reach ${formatOdds(target)}`
      : `${take.length} games ${sport}${span ? ` · ${span}` : ""} · ${actual ? formatOdds(actual) : "—"} · ${tag}`;
  await analyzeThenMint(chatId, take, "ng", title, `<b>Predict · ${take.length} games</b>`);
}

async function createStakeDaily(chatId: number) {
  await withProgress(chatId, "Researching Stake 2…", () => cookStakeDaily(chatId));
}

async function cookStakeDaily(chatId: number) {
  const listed = await listUpcomingPicks("football", 28, "today");
  if ("error" in listed) {
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  const short = listed.filter((p) => p.odds && p.odds >= 1.12 && p.odds <= 1.55);
  const pool = await cookPool(short, null);
  const researched = await researchPicks(pool, 10);
  const take = buildToOdds(researched.keep, 2).slice(0, 5);
  if (!take.length) {
    await tg("sendMessage", { chat_id: chatId, text: "No 2-odds football for Stake today. Try later." });
    return;
  }
  const combo = combinedOdds(take);
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
      `${take.length} games`,
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
  const listed = await listUpcomingPicks("football", 40, "today");
  if ("error" in listed) {
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  // Strict same-day only (Lagos): drop anything past ~36h even if feed mislabels.
  const now = Date.now();
  const dayPool = listed.filter((p) => {
    const ko = p.kickoff ?? 0;
    return ko >= now - 60_000 && ko <= now + 36 * 3_600_000;
  });
  // Short prices only — safer rollover building blocks.
  const short = dayPool.filter((p) => p.odds && p.odds >= 1.15 && p.odds <= 1.55);
  const pool = await cookPool(short.length ? short : dayPool.length ? dayPool : listed, null);
  const researched = await researchPicks(pool, 16);
  const safe = researched.keep
    .filter((p) => (p.probability ?? 0) >= Math.min(KEEP_LINE, 48))
    .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0) || (a.odds ?? 99) - (b.odds ?? 99));
  const pool2 = safe.length
    ? safe
    : [...researched.keep].sort(
        (a, b) => (b.probability ?? 0) - (a.probability ?? 0) || (a.odds ?? 99) - (b.odds ?? 99),
      );
  let take = buildToOdds(pool2, 2).slice(0, 3);
  if (!take.length) take = pool2.slice(0, 2);
  if (!take.length) {
    await tg("sendMessage", { chat_id: chatId, text: "No football open for a 2-odds card today. Try later." });
    return;
  }
  const combo = combinedOdds(take);
  await analyzeThenMint(
    chatId,
    take,
    "ng",
    `SportyBet · Daily 2 odds${combo ? ` · ${formatOdds(combo)}` : ""} · ${researched.researched ? researchTag(true) : "desk read"}`,
    `<b>Daily 2 odds · ${take.length} games</b>`,
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
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  const pool = await cookPool(uniqueEvents(listed).picks, null);
  const researched = await researchPicks(pool, n);
  const take = researched.keep;
  if (!take.length) {
    await tg("sendMessage", { chat_id: chatId, text: "No draw markets open now. Try later." });
    return;
  }
  const combo = combinedOdds(take);
  await analyzeThenMint(
    chatId,
    take,
    "ng",
    `Draw only · ${take.length} football${combo ? ` · ${formatOdds(combo)}` : ""} · ${researched.researched ? researchTag(true) : "desk read"}`,
    `<b>Predict · Draw only ${take.length} games</b>`,
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
  window: CookWindow = "today",
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
  const skip = await loadRecentEventIds();
  const [foot, hoop, ten, hand] = await Promise.all([
    listUpcomingPicks("football", 14, window, "any", skip),
    listUpcomingPicks("basketball", 12, window, "any", skip),
    listUpcomingPicks("tennis", 12, window, "any", skip),
    listUpcomingPicks("handball", 12, window, "any", skip),
  ]);
  const pools = [foot, hoop, ten, hand].filter((p) => !("error" in p)) as TicketPick[][];
  if (!pools.length) {
    await tg("sendMessage", { chat_id: chatId, text: "error" in foot ? foot.error : "No mix sports now." });
    return;
  }
  await maybeStudyLast(chatId);
  const stacked = interleave(pools[0] ?? [], interleave(pools[1] ?? [], interleave(pools[2] ?? [], pools[3] ?? []))).filter(cookablePick);
  const accStats = await loadAccuracy();
  const gated = accuracyFilter(stacked, accStats);
  const gateFellBack = !gated.kept.length;
  const usable = gateFellBack ? stacked : gated.kept;
  const mixed = await cookPool(usable, useBand);
  const researched = await researchPicks(mixed, opts.odds ? 24 : n);
  const take = opts.odds
    ? uniqueEvents(buildToOdds(researched.keep, clampOddsTarget(opts.odds))).picks.slice(0, MAX_LEGS)
    : uniqueEvents(researched.keep).picks.slice(0, n);
  if (!take.length) {
    await tg("sendMessage", { chat_id: chatId, text: "Mix no gree. Relax filter or try again later." });
    return;
  }
  const actual = combinedOdds(take);
  const fc = take.filter((p) => p.sport === "football").length;
  const bc = take.filter((p) => p.sport === "basketball").length;
  const tc = take.filter((p) => p.sport === "tennis").length;
  const hc = take.filter((p) => p.sport === "handball").length;
  await analyzeThenMint(
    chatId,
    take,
    "ng",
    `Mix ${fc} football + ${bc} basketball + ${tc} tennis + ${hc} handball${actual ? ` · ${formatOdds(actual)}` : ""}${span ? ` · ${span}` : ""}${accStats.sampleCount > 0 ? " · accuracy" : ""}${gateFellBack ? " · below usual accuracy bar" : gated.dropped > 0 ? ` · gate −${gated.dropped}` : ""} · ${researched.researched ? researchTag(true) : "desk read"}`,
    `<b>Predict · Mix ${take.length} games</b>`,
  );
}

async function liveScoreAndReply(chatId: number, code: string, picks: TicketPick[]) {
  const ids = [...new Set(picks.map((p) => p.sporty?.eventId).filter(Boolean))] as string[];
  const details = await Promise.all(ids.map((id) => getEventDetail(id)));
  const byId = new Map(ids.map((id, i) => [id, details[i]]));
  const lines = picks.slice(0, 35).map((p, i) => {
    const ev = p.sporty?.eventId ? byId.get(p.sporty.eventId) : null;
    const score = eventScore(ev ?? null);
    const tag = score ? score.label : formatKickoff(p.kickoff) || "—";
    return `${i + 1}  ${sportIcon(p.sport)} ${p.home} vs ${p.away}  ·  ${tag}  ·  ${p.selection}`;
  });
  await tg("sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text: [`<code>${esc(code)}</code>`, "", ...lines].join("\n").slice(0, 3900),
  });
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
  const engine = await sendScheduledEngine();
  const longshot = await sendScheduledLongshot();
  const recap = await maybeSundayRecap();
  return { engine, longshot, recap };
}

async function sendScheduledEngine() {
  if (new Date().getUTCHours() !== 7) return { sent: 0, skip: true as const };
  return sendEngineToChats((chatId, html, extra) =>
    tg("sendMessage", { chat_id: chatId, text: html, ...(extra ?? {}) }),
  );
}

async function mintKeepersAndReply(chatId: number, picks: TicketPick[], count?: number) {
  await withProgress(chatId, "Trimming…", async () => {
    const result = await scorePlayable(picks);
    const counted = result.picks.filter((p) => p.sport !== "other");
    const n = clampLegs(count ?? Math.max(2, Math.ceil(counted.length / 2)), 2);
    const strongest = keepTop(await applyLessonScores(result.picks), n).filter((p) => p.sporty);
    if (!strongest.length) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "Nothing remain after I drop those ones.",
      });
      return;
    }
    await mintAndReply(chatId, strongest, "ng", `Trimmed to ${strongest.length} games`);
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

async function studyAndReply(chatId: number, code: string, picks?: TicketPick[]) {
  const report = await studyCode(code, picks);
  if ("error" in report) {
    await tg("sendMessage", { chat_id: chatId, text: report.error });
    return;
  }
  await tg("sendMessage", { chat_id: chatId, text: formatStudy(report) });
}

/** Human label for a market family, for the data-driven analysis card. */
const FAM_LABEL: Record<string, string> = {
  ou: "O/U",
  ou1h: "1H O/U",
  teamou: "Team",
  gg: "GG",
  dc: "DC",
  dnb: "DNB",
  win: "1X2",
  hcp: "Hcp",
  odd: "Odd/Even",
  corners: "Corners",
};

/** Real-time enrichment: live score/clock/status + market family hit-rate. */
async function realTimeRead(picks: TicketPick[]) {
  const ids = [...new Set(picks.map((p) => p.sporty?.eventId).filter(Boolean))] as string[];
  const details = await Promise.all(ids.map((id) => getEventDetail(id)));
  const byId = new Map(ids.map((id, i) => [id, details[i] ?? null]));
  const acc = await loadAccuracy();
  return picks.map((p) => {
    const ev = p.sporty?.eventId ? byId.get(p.sporty.eventId) : null;
    const score = eventScore(ev ?? null);
    const fam = pickFamily(p);
    const g = acc.groups[`${p.sport}|${fam}`];
    const rate = g && g.won + g.lost >= 5 ? g.rate : null;
    return {
      live: score ? score.label : "",
      finished: score?.finished ?? false,
      family: fam,
      rate,
    };
  });
}

/** Render the AI analysis card for a set of playable picks (prob + live + market hit-rate). */
async function analyzeCard(
  chatId: number,
  picks: TicketPick[],
  label: string,
  progress: string | false = "Analyzing form, stats, H2H & live data…",
) {
  const render = async () => {
    const result = await scorePlayable(picks);
    const rt = await realTimeRead(result.picks);
    const keepChance = result.combinedKeepChance != null ? ` · keep ${pct(result.combinedKeepChance)}` : "";
    const lines = result.picks.slice(0, 35).map((p, i) => {
      const verdict =
        p.verdict === "keep" ? "🟢" : p.verdict === "drop" ? "🔴" : "⚪";
      const sport = sportIcon(p.sport);
      const prob = p.probability != null ? pct(p.probability) : "—";
      const info = rt[i];
      const live = info?.live ? ` · ${info.live}` : "";
      const fam = info?.family ? ` · ${FAM_LABEL[info.family] ?? info.family}` : "";
      const rate = info?.rate != null ? ` ${pct(info.rate * 100)}` : "";
      const summary = p.summary ? ` · ${p.summary}` : "";
      const why = p.reasons?.length ? `\n    ↳ ${p.reasons.slice(0, 2).join(" · ")}` : "";
      const marketLabel = p.market && p.market !== p.selection ? `${p.market} · ${p.selection}` : p.selection;
      return `${i + 1} ${verdict} ${sport} ${p.home} vs ${p.away} · ${marketLabel} · ${prob}${live}${fam}${rate}${summary}${why}`;
    });
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: [
        `🧠 ${label} · ${result.kept.length}/${result.picks.length} keep${keepChance}`,
        "",
        ...lines,
      ].join("\n").slice(0, 3900),
    });
    // Rank safest first: higher probability, then shorter odds.
    const ranked = [...result.picks].sort((a, b) => {
      const pa = a.probability ?? 0;
      const pb = b.probability ?? 0;
      if (pb !== pa) return pb - pa;
      return (a.odds ?? 99) - (b.odds ?? 99);
    });
    return { kept: result.kept, ranked };
  };
  if (progress === false) {
    return render();
  }
  let out: Awaited<ReturnType<typeof render>> = { kept: [], ranked: [] };
  await withProgress(chatId, progress, async () => {
    out = await render();
  });
  return out;
}

/**
 * A generated slip is always shown and analysed before we mint its SportyBet
 * code.  This keeps the chat honest: users see the confidence and reasons
 * first, and a code is only created for selections the analysis kept.
 */
async function analyzeThenMint(
  chatId: number,
  picks: TicketPick[],
  country: string,
  title: string,
  label: string,
  limit = MAX_LEGS,
) {
  const scored = await analyzeCard(chatId, picks, label, false);
  // Prefer AI "keep" legs; else safest ranked by probability + shorter odds.
  const preferred = scored.kept.length ? scored.kept : scored.ranked;
  const approved = (preferred.length ? preferred : picks).slice(0, limit);
  if (!scored.kept.length) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Confidence soft on these — booking the safest legs by score + shorter odds.",
    });
  }
  // Always drop a SportyBet code. Never block on review/DB.
  await mintAndReply(chatId, approved, country, title, limit);
}

function reviewKeyboard(review: PendingReview) {
  const removeRows = review.picks.map((_, index) => [
    { text: `Remove ${index + 1}`, callback_data: `r:${review.token}:d${index}` },
  ]);
  return {
    inline_keyboard: [
      [{ text: `Book ${review.picks.length} approved picks`, callback_data: `r:${review.token}:b` }],
      ...removeRows,
    ],
  };
}

async function sendReview(chatId: number, review: PendingReview) {
  const legs = review.picks.map((pick, index) => `${index + 1}. ${pick.home} vs ${pick.away} · ${pick.selection}`);
  await tg("sendMessage", {
    chat_id: chatId,
    text: ["Review before booking", "", ...legs, "", "Remove any leg, or book the approved picks."].join("\n").slice(0, 3900),
    reply_markup: reviewKeyboard(review),
  });
}

async function analyzeAndReply(chatId: number, code: string, picks?: TicketPick[]) {
  const loaded = picks ? { picks } : await loadBookingCode(code, "ng");
  if ("error" in loaded) {
    await tg("sendMessage", { chat_id: chatId, text: loaded.error });
    return;
  }
  const base = playable(loaded.picks);
  if (!base.length) {
    await tg("sendMessage", { chat_id: chatId, text: "No football or basketball picks in that slip." });
    return;
  }
  await analyzeCard(chatId, base, `<code>${esc(code)}</code>`);
}

async function maybeStudyLast(chatId: number) {
  const code = await latestUnstudiedCode();
  if (!code) return;
  const report = await studyCode(code);
  if ("error" in report) return;
  if (report.pending === report.legs.length) return;
  await tg("sendMessage", { chat_id: chatId, text: formatStudy(report) });
}

async function handleCode(chatId: number, code: string) {
  const loaded = await loadBookingCode(code, "ng");
  if ("error" in loaded) {
    await tg("sendMessage", { chat_id: chatId, text: loaded.error });
    return;
  }
  const play = playable(loaded.picks);
  await tg("sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text: `<code>${esc(loaded.shareCode)}</code>`,
    reply_markup: keyboard(loaded.shareCode),
  });
  await recordSlip(loaded.shareCode, play);
}

function wantsMarketChange(text: string) {
  const target = parseMarketTarget(text);
  if (!target) return null;
  if (/change|convert|swap|make|all\b|to over|to gg|to double|to dnb|to 1x2/i.test(text)) return target;
  if (/^(over\s*[123]\.5|gg|btts|double chance|draw no bet|1x2)\b/i.test(text.trim())) return target;
  return null;
}

async function runTicketCommand(chatId: number, code: string, text: string): Promise<boolean> {
  const loaded = await loadBookingCode(code, "ng");
  if ("error" in loaded) {
    await tg("sendMessage", { chat_id: chatId, text: loaded.error });
    return true;
  }
  const base = playable(loaded.picks);
  const drop = parseDropIndexes(text);
  if (drop) {
    const kept = loaded.picks.filter((_, i) => !drop.includes(i + 1));
    const play = playable(kept);
    if (!play.length) {
      await tg("sendMessage", { chat_id: chatId, text: "Nothing remain after I drop those ones." });
      return true;
    }
    await mintAndReply(chatId, play, "ng", `🗑 Dropped ${drop.join(", ")} · ${play.length} games`);
    return true;
  }
  const other = parseCombineCode(text);
  if (other && other !== loaded.shareCode) {
    const extra = await loadBookingCode(other, "ng");
    if ("error" in extra) {
      await tg("sendMessage", { chat_id: chatId, text: extra.error });
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
    await tg("sendMessage", { chat_id: chatId, text: `⚡ I dey change market for ${loaded.shareCode}.` });
    const next = playable(await retargetPicks(base, market));
    if (!next.length) {
      await tg("sendMessage", { chat_id: chatId, text: "That market no gree change." });
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
    const scored = base.map((p) => ({
      ...p,
      probability: p.odds ? Math.max(8, Math.min(90, Math.round(100 / p.odds))) : 50,
      confidence: "medium" as const,
      summary: "",
      reasons: [] as string[],
      risks: [] as string[],
      verdict: "keep" as const,
    }));
    const trimmed = trimToOdds(scored, cmd.targetOdds);
    await mintAndReply(chatId, trimmed, "ng", `Trimmed to ${cmd.targetOdds}× · ${trimmed.length} games`);
    return true;
  }
  if (cmd.type === "keepLegs") {
    await sureNAndReply(chatId, base, cmd.count);
    return true;
  }
  if (cmd.type === "sport") {
    const filtered = base.filter((p) => p.sport === cmd.sport);
    if (!filtered.length) {
      await tg("sendMessage", { chat_id: chatId, text: `That ticket no get ${cmd.sport} at all.` });
      return true;
    }
    await mintAndReply(chatId, filtered, "ng", `${cmd.sport} only · ${filtered.length} games`);
    return true;
  }
  return false;
}

export async function handleTelegramUpdate(update: TgUpdate) {
  if (!TOKEN()) return;
  await ensureMenu();
  await refreshKeys();

  const from = update.callback_query?.from ?? update.message?.from;
  const chatId = update.callback_query?.message?.chat.id ?? update.message?.chat.id;
  const incoming = update.message?.text?.trim() ?? "";

  if (from && chatId && isCmd(incoming, "lock")) {
    if ((await accessLocked()) && !(await isOwner(from))) {
      await tg("sendMessage", { chat_id: chatId, text: "Private desk." });
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
      await tg("sendMessage", { chat_id: chatId, text: "Lock no save. Try /lock again." });
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
      await tg("sendMessage", { chat_id: chatId, text: "Private desk." });
      return;
    }
    const state = await loadAccess();
    await saveAccess({ ...state, locked: false });
    await tg("sendMessage", { chat_id: chatId, text: "Open. Anyone can use it." });
    return;
  }

  if (from && !(await hasAccess(from))) {
    if (update.callback_query) {
      await tg("answerCallbackQuery", { callback_query_id: update.callback_query.id, text: "Private desk." });
    } else if (chatId) {
      await tg("sendMessage", { chat_id: chatId, text: "Private desk." });
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
        await tg("sendMessage", { chat_id: chatId, text: "No slip to study yet. Book one first." });
        return;
      }
      await studyAndReply(chatId, last);
      return;
    }
    if (kind === "r") {
      const review = await loadPendingReview(code, chatId);
      if (!review) {
        await tg("sendMessage", { chat_id: chatId, text: "That review don expire. Run the analysis again." });
        return;
      }
      if (arg === "b") {
        if (!review.picks.length) {
          await tg("sendMessage", { chat_id: chatId, text: "No picks remain to book." });
          return;
        }
        await mintAndReply(chatId, review.picks, "ng", review.title, review.picks.length);
        await deletePendingReview(review.token, chatId);
        return;
      }
      if (arg?.startsWith("d")) {
        const index = Number(arg.slice(1));
        if (!Number.isInteger(index) || index < 0 || index >= review.picks.length) return;
        const removed = review.picks[index];
        review.picks.splice(index, 1);
        if (!review.picks.length) {
          await deletePendingReview(review.token, chatId);
          await tg("sendMessage", { chat_id: chatId, text: "All legs removed. Run another prediction when you ready." });
          return;
        }
        await updatePendingReview(review);
        await tg("sendMessage", {
          chat_id: chatId,
          text: `Removed ${removed?.home} vs ${removed?.away}. Here is the updated review.`,
        });
        await sendReview(chatId, review);
      }
      return;
    }
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await tg("sendMessage", { chat_id: chatId, text: loaded.error });
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
    if (kind === "ch") {
      const target = parseMarketTarget(arg || "ou25") ?? "ou25";
      await tg("sendMessage", { chat_id: chatId, text: `⚡ I dey change market for ${loaded.shareCode}.` });
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
      const scored = base.map((p) => ({
        ...p,
        probability: p.odds ? Math.max(8, Math.min(90, Math.round(100 / p.odds))) : 50,
        confidence: "medium" as const,
        summary: "",
        reasons: [] as string[],
        risks: [] as string[],
        verdict: "keep" as const,
      }));
      const trimmed = trimToOdds(scored, target);
      await mintAndReply(chatId, trimmed, "ng", `Trimmed to ${target}× · ${trimmed.length} games`);
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
        await tg("sendMessage", { chat_id: msg.chat.id, text: loaded.error });
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
        "Type what you want, or tap the menu.",
        "",
        "<b>Predict</b> — cook an AI slip",
        "<code>/predict 12 football</code>",
        "<code>/ucl</code> · <code>10 champions league</code>",
        "<code>/predict 8 basketball</code>",
        "<code>10 games handball</code>",
        "<code>12 games tennis</code>",
        "⚡ accuracy-led: only markets whose settled record beats my average hit rate.",
        "",
        "<b>Engine</b> — five accuracy-led accumulator cards",
        "<code>/engine</code>",
        "Draws and home wins no dey. DC and goal lines usually dey.",
        "",
        "<b>Analyze</b> — form, stats, H2H & live data",
        "<code>/analyze</code> · <code>/analyze TY87PV</code>",
        "",
        "<b>2odds</b> — safe ~2.00 odds rollover",
        "<code>/2odds</code> · <code>rollover</code> · <code>daily2</code>",
        "Builds a short, high-probability slip around 2.00× for rollover.",
        "",
        "<b>Optimize</b> — trim odds, cut risk",
        "<code>/optimize 50</code> · <code>trim TY87PV to 50</code>",
        "",
        "<b>Split</b> — split a big slip",
        "<code>/split 3</code> · <code>split TY87PV into 2</code>",
        "",
        "<b>Edit / Convert</b> — change markets",
        "<code>/convert over 2.5</code> · <code>make TY87PV gg</code>",
        "",
        "<b>Book</b> — mint a fresh SportyBet code",
        "<code>/book</code> · <code>book TY87PV</code>",
        "",
        "<b>Live</b> — live scores & results",
        "<code>/live</code> · <code>score</code> · <code>study</code>",
      ].join("\n"),
      reply_markup: deskKeyboard(),
    });
    return;
  }
  if (raw === "/slang") {
    await tg("sendMessage", { chat_id: msg.chat.id, text: slangHelp() });
    return;
  }
  if (isCmd(raw, "predict")) {
    const arg = cmdArg(raw);
    const sport = parseSport(arg) ?? "football";
    const n = parseLegCount(arg) ?? MAX_LEGS;
    const window = parseCookWindow(arg) === "soon" ? "soon" : parseCookWindow(arg);
    const league = wantsChampions(arg) ? "champions" : null;
    await createSportSlip(msg.chat.id, sport, n, window, undefined, [], league);
    return;
  }
  if (isCmd(raw, "ucl") || isCmd(raw, "champions") || /^(ucl|champions league)\s*$/i.test(raw)) {
    const n = parseLegCount(raw) ?? Number(cmdArg(raw).match(/\d{1,4}/)?.[0]);
    await createSportSlip(
      msg.chat.id,
      "football",
      Number.isFinite(n) ? n : MAX_LEGS,
      parseCookWindow(raw),
      undefined,
      [],
      "champions",
    );
    return;
  }
  if (isCmd(raw, "engine") || /^(engine|accumulators?|ladder)\s*$/i.test(raw)) {
    await withProgress(msg.chat.id, "Building engine cards…", async () => {
      await sendEngineToChats(
        (chatId, html, extra) => tg("sendMessage", { chat_id: chatId, text: html, ...(extra ?? {}) }),
        [String(msg.chat.id)],
      );
    });
    return;
  }
  if (isCmd(raw, "analyze")) {
    const code =
      codeFromText(cmdArg(raw)) ||
      codeFromText(msg.reply_to_message?.text) ||
      (await latestCode());
    if (!code) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "Send a booking code first, then say analyze." });
      return;
    }
    await analyzeAndReply(msg.chat.id, code);
    return;
  }
  if (isCmd(raw, "optimize")) {
    const code = codeFromText(cmdArg(raw)) || (await latestCode());
    if (!code) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "Send a booking code first, then say optimize." });
      return;
    }
    const target = parseOddsTarget(cmdArg(raw)) ?? 50;
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: loaded.error });
      return;
    }
    const scored = playable(loaded.picks).map((p) => ({
      ...p,
      probability: p.odds ? Math.max(8, Math.min(90, Math.round(100 / p.odds))) : 50,
      confidence: "medium" as const,
      summary: "",
      reasons: [] as string[],
      risks: [] as string[],
      verdict: "keep" as const,
    }));
    const trimmed = trimToOdds(scored, clampOddsTarget(target));
    await mintAndReply(
      msg.chat.id,
      trimmed,
      "ng",
      `Optimized to ${formatOdds(clampOddsTarget(target))} · ${trimmed.length} games`,
    );
    return;
  }
  if (isCmd(raw, "split")) {
    const code = codeFromText(cmdArg(raw)) || (await latestCode());
    if (!code) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "Send a booking code first, then say split." });
      return;
    }
    const parts = parseLegCount(cmdArg(raw)) ?? 2;
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: loaded.error });
      return;
    }
    const slips = splitEven(playable(loaded.picks), parts);
    for (let i = 0; i < slips.length; i++) {
      await mintAndReply(msg.chat.id, slips[i] ?? [], "ng", `Slip ${i + 1} · ${slips[i]?.length ?? 0} games`);
    }
    return;
  }
  if (isCmd(raw, "edit") || isCmd(raw, "convert")) {
    const code = codeFromText(cmdArg(raw)) || (await latestCode());
    if (!code) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "Send a booking code first, then say the market." });
      return;
    }
    const target = parseMarketTarget(cmdArg(raw)) ?? "ou25";
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: loaded.error });
      return;
    }
    await tg("sendMessage", { chat_id: msg.chat.id, text: `⚡ I dey change market for ${code}.` });
    const next = playable(await retargetPicks(playable(loaded.picks), target));
    await mintAndReply(msg.chat.id, next, "ng", `⚡ Market don change · ${next.length} games`);
    return;
  }
  if (isCmd(raw, "live")) {
    const code = codeFromText(cmdArg(raw)) || (await latestCode());
    if (!code) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: "Send a booking code first, then say live." });
      return;
    }
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: loaded.error });
      return;
    }
    await liveScoreAndReply(msg.chat.id, code, playable(loaded.picks));
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
    const add = arg.match(/^(you|seekai|gemini|you\.com)\s+(\S+)/i);
    const detected = detectKey(arg);
    if (add || detected) {
      const token = add?.[1]?.toLowerCase() ?? "";
      const kind = detected
        ? detected.kind
        : token.startsWith("you")
          ? "you"
          : token.startsWith("gem")
            ? "gemini"
            : "seekai";
      const key = add ? add[2]! : detected!.key;
      const look = detectKey(key) ?? { kind, key };
      const saved = await addDeskKey(look.kind, look.key);
      await refreshKeys();
      await tg("sendMessage", {
        chat_id: msg.chat.id,
        text: saved
          ? `Added ${look.kind} key.\n\n${formatKeyList()}`
          : `Could not save ${look.kind} key to the database. Add it on Vercel as ${look.kind === "gemini" ? "GEMINI_API_KEY" : look.kind === "seekai" ? "SEEKAI_API_KEY" : "YDC_API_KEY"} then Redeploy.\n\n${formatKeyList()}`,
      });
      return;
    }
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: formatKeyList(),
    });
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
    await createSportSlip(msg.chat.id, parseSport(cmdArg(raw)) ?? "football", 10, "today");
    return;
  }
  if (
    isCmd(raw, "stake") ||
    /^(stake 2|2 odds stake|stake daily)\s*$/i.test(raw)
  ) {
    await createStakeDaily(msg.chat.id);
    return;
  }
  if (
    isCmd(raw, "2odds") ||
    isCmd(raw, "daily2") ||
    isCmd(raw, "rollover") ||
    /^(daily\s*2(\s*odds)?|2\s*odds(\s*daily)?|2odds|rollover)\s*$/i.test(raw)
  ) {
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
    await createSportSlip(msg.chat.id, parseSport(cmdArg(raw)) ?? "football", MAX_LEGS, "weekend");
    return;
  }
  if (isCmd(raw, "mix")) {
    await createMixSlip(msg.chat.id, { games: 12 });
    return;
  }
  if (isCmd(raw, "handball")) {
    const n = Number(cmdArg(raw).match(/\d{1,4}/)?.[0]);
    await createSportSlip(msg.chat.id, "handball", Number.isFinite(n) ? n : 10, parseCookWindow(raw));
    return;
  }
  if (isCmd(raw, "tennis")) {
    const n = Number(cmdArg(raw).match(/\d{1,4}/)?.[0]);
    await createSportSlip(msg.chat.id, "tennis", Number.isFinite(n) ? n : 10, parseCookWindow(raw));
    return;
  }
  if (isCmd(raw, "book") || /^(my book|my slips|book|bankroll)\s*$/i.test(raw)) {
    const bookCode = codeFromText(cmdArg(raw)) || codeFromText(msg.reply_to_message?.text) || (await latestCode());
    if (bookCode) {
      const loaded = await loadBookingCode(bookCode, "ng");
      if (!("error" in loaded)) {
        const base = playable(loaded.picks);
        await mintAndReply(msg.chat.id, base, "ng", `🎫 SportyBet code · ${base.length} games`);
        return;
      }
    }
    await tg("sendMessage", { chat_id: msg.chat.id, text: await formatBook() });
    return;
  }
  if (isCmd(raw, "recap") || isCmd(raw, "results") || /^(results|my results|tracker)\s*$/i.test(raw)) {
    await tg("sendMessage", { chat_id: msg.chat.id, text: await formatRecap() });
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
      await tg("sendMessage", { chat_id: msg.chat.id, text: loaded.error });
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
      await tg("sendMessage", { chat_id: msg.chat.id, text: loaded.error });
      return;
    }
    const base = playable(loaded.picks);
    const scored = base.map((p) => ({
      ...p,
      probability: p.odds ? Math.max(8, Math.min(90, Math.round(100 / p.odds))) : 50,
      confidence: "medium" as const,
      summary: "",
      reasons: [] as string[],
      risks: [] as string[],
      verdict: "keep" as const,
    }));
    const trimmed = trimToOdds(scored, clampOddsTarget(oddsOnTicket));
    await mintAndReply(
      msg.chat.id,
      trimmed,
      "ng",
      `Trimmed to about ${formatOdds(clampOddsTarget(oddsOnTicket))} · ${trimmed.length} games`,
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
      await tg("sendMessage", { chat_id: msg.chat.id, text: loaded.error });
      return;
    }
    await askTrimCount(msg.chat.id, loaded.shareCode, playable(loaded.picks).length);
    return;
  }
  if (code && /\bmint all\b/i.test(text)) {
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: loaded.error });
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
  if (wantsChampions(`${text} ${raw}`) && !code) {
    await createSportSlip(
      msg.chat.id,
      "football",
      legCount ?? 8,
      cookWindow,
      band,
      asks,
      "champions",
    );
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
      await tg("sendMessage", { chat_id: msg.chat.id, text: loaded.error });
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
    await createSportSlip(msg.chat.id, sport, 10, cookWindow, band, asks);
    return;
  }
  if (legCount && !code) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: `Add the sport — type: ${clampLegs(legCount, 5)} games football`,
    });
    return;
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
