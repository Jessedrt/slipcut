import { AsyncLocalStorage } from "node:async_hooks";
import { analyzePicks } from "./analyze";
import { extractShareCode } from "./parse-ticket";
import { normalizePidgin, pidginSmallTalk, slangHelp, splitChat, wantsCreate } from "./pidgin";
import { researchPicks } from "./research";
import { getEventDetail, eventScore, loadBookingCode, listUpcomingPicks, mintShare, parseMarketTarget, retargetPicks, sportyOf, windowLabel, type CookWindow } from "./sportybet";
import { addAllow, addBlock, allowedBy, applyLessonScores, blockedBy, clearAllows, formatBankroll, formatBook, formatRecap, formatStudy, getSetting, latestCode, latestUnstudiedCode, listAllows, listBlocks, listChats, loadOddsBand, recordSlip, recordStake, rememberChat, removeBlock, saveOddsBand, setSetting, studyCode } from "./study";
import { buildToOdds, combinedOdds, copyRebuild, formatKickoff, formatOdds, keepTop, parseCommand, splitEven, trimToOdds, uniqueEvents } from "./workbench";
import type { BookSport, TicketPick } from "./types";

const MAX_LEGS = 35;
const MENU = [
  { command: "start", description: "Welcome" },
  { command: "today", description: "Today football" },
  { command: "weekend", description: "Weekend slip" },
  { command: "mix", description: "Mix all sports" },
  { command: "draw", description: "Draw-only football" },
  { command: "stake", description: "Stake.com daily 2 odds" },
  { command: "daily2", description: "SportyBet daily 2 odds" },
  { command: "book", description: "Slips and bankroll" },
  { command: "recap", description: "This week" },
  { command: "filter", description: "only EPL NBA ATP" },
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

function isCmd(raw: string, name: string) {
  const t = raw.trim().replace(/[\u200b\u2060]/g, "");
  if (new RegExp(`^/${name}(?:@\\w+)?(?:\\s|$)`, "i").test(t)) return true;
  return new RegExp(`^${name}$`, "i").test(t);
}

function cmdArg(raw: string) {
  return raw.trim().replace(/^\/\w+(?:@\w+)?\s*/i, "").trim();
}

function normalizeFilter(raw: string): string | "clear" | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (/^(clear|off|any|all)$/.test(t)) return "clear";
  if (/epl|premier/.test(t)) return "premier league";
  if (/la ?liga/.test(t)) return "laliga";
  if (/serie/.test(t)) return "serie a";
  if (/\bnba\b/.test(t)) return "nba";
  if (/\bwta\b/.test(t)) return "wta";
  if (/atp|us open|grand slam/.test(t)) return "atp";
  if (t.length >= 3) return t;
  return null;
}
const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || "";
const BANNER_URL = "https://slipcut.vercel.app/banner.jpg";
const KEEP_LINE = 45;

function clampLegs(n: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(MAX_LEGS, Math.round(n)));
}

function naira(n: number) {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
}

function parseStake(text: string): number | null {
  const m =
    text.match(/\bstake\s+([\d,.]+)\s*([kKmM])?\b/i) ||
    text.match(/\b([\d,.]+)\s*([kKmM])?\s*stake\b/i);
  if (!m) return null;
  let n = Number(String(m[1]).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = (m[2] || "").toLowerCase();
  if (u === "k") n *= 1000;
  if (u === "m") n *= 1_000_000;
  return n;
}

type OddsBand = { min: number; max: number };

function parseOddsBand(text: string): OddsBand | null {
  const between = text.match(/between\s+([\d.]+)\s+and\s+([\d.]+)/i);
  if (between) {
    const a = Number(between[1]);
    const b = Number(between[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const maxM = text.match(/(?:no game(?:s)? above|max(?:imum)?(?: odds?)?|not above|cap)\s+([\d.]+)/i);
  const minM = text.match(/(?:no game(?:s)? below|min(?:imum)?(?: odds?)?)\s+([\d.]+)/i);
  if (!maxM && !minM) return null;
  return {
    min: minM ? Number(minM[1]) : 1.05,
    max: maxM ? Number(maxM[1]) : 6,
  };
}

function wantsMix(text: string) {
  return /\bmix\b|both sports?|football and basketball|basketball and football|bola and hoop/i.test(text);
}

function wantsLive(text: string) {
  return /^(score|live|scores?)\b/i.test(text) || /\b(live score|how e dey play)\b/i.test(text);
}

function parseBlock(text: string): { add?: string; remove?: string; list?: boolean } | null {
  if (/^(blacklist|blocks?|blocked|no list)\s*$/i.test(text)) return { list: true };
  const rem = text.match(/^(?:allow|unban|unblock|remove block)\s+(.+)/i);
  if (rem?.[1]) return { remove: rem[1].trim() };
  if (/no game(?:s)? above|no game(?:s)? below|no wahala|no be |not /i.test(text)) return null;
  const add = text.match(/^(?:no|block|blacklist)\s+(.+)$/i);
  if (!add?.[1]) return null;
  const v = add[1].trim().replace(/[.!?]+$/, "");
  if (v.length < 3) return null;
  if (/^(football|basketball|tennis|legs?|games?|odds?|code|bola|hoop)/i.test(v)) return null;
  return { add: v };
}

function applyBand<T extends { odds?: number }>(picks: T[], band: OddsBand | null): T[] {
  if (!band) return picks;
  return picks.filter((p) => p.odds && p.odds >= band.min && p.odds <= band.max);
}

async function cookPool<T extends TicketPick>(picks: T[], band: OddsBand | null): Promise<T[]> {
  const [blocks, allows] = await Promise.all([listBlocks(), listAllows()]);
  const noFootballUnder = picks.filter((p) => {
    if (p.sport === "football" && /\bunder\b/i.test(`${p.selection} ${p.market}`)) return false;
    if (p.sport === "football" && /\bgg\b|both teams|btts/i.test(`${p.selection} ${p.market}`)) return false;
    if (p.sport === "football" && p.sporty?.marketId === "29") return false;
    if (p.sport === "football" && p.sporty?.marketId === "1") return false;
    if (p.sport === "football" && p.sporty?.marketId === "10") return false;
    if (p.sport === "basketball" && /\bunder\b/i.test(`${p.selection} ${p.market}`)) return false;
    if (p.sport === "basketball" && (p.sporty?.marketId === "219" || /winner/i.test(p.market))) return false;
    return true;
  });
  return applyBand(allowedBy(blockedBy(noFootballUnder, blocks), allows), band);
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
  message?: TgMessage;
  callback_query?: TgCallback;
};

export type ChatBridge = {
  send: (method: string, payload: Record<string, unknown>) => Promise<void>;
};

export const chatBridge = new AsyncLocalStorage<ChatBridge>();

async function tg(method: string, payload: Record<string, unknown> = {}) {
  const bridged = chatBridge.getStore();
  if (bridged) {
    await bridged.send(method, payload);
    return null;
  }
  const token = TOKEN();
  if (!token) return null;
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  try {
    const data = (await res.json()) as { ok?: boolean; result?: unknown };
    return data.ok ? data.result : null;
  } catch {
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

async function loadAccess(): Promise<AccessState> {
  const long = parseAccess(descText(await tg("getMyDescription", {})));
  if (long.locked || long.users.length) return long;
  const short = parseShort(descText(await tg("getMyShortDescription", {})));
  return short ?? long;
}

async function saveAccess(state: AccessState) {
  await tg("setMyDescription", { description: encodeAccess(state) });
  await tg("setMyShortDescription", { short_description: encodeShort(state) });
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

function deskKeyboard() {
  return {
    keyboard: [
      [{ text: "Today" }, { text: "Weekend" }, { text: "Draw" }],
      [{ text: "2 odds" }, { text: "Stake 2" }, { text: "Help" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Paste a code",
  };
}

function keyboard(code: string) {
  return {
    inline_keyboard: [
      [
        { text: "Trim", callback_data: `g:${code}` },
        { text: "Copy", copy_text: { text: code } },
      ],
    ],
  };
}

function listPicks(picks: TicketPick[]) {
  const shown = picks.slice(0, 35);
  const lines = shown.map((p, i) => {
    const when = formatKickoff(p.kickoff);
    const price = p.odds ? formatOdds(p.odds) : "";
    const bits = [`${p.home} vs ${p.away}`, p.selection, price, when].filter(Boolean);
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
    const size = 50;
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
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Copy", copy_text: { text: code } },
          { text: "Open", url: minted.shareURL },
          { text: "Trim", callback_data: `g:${code}` },
        ],
      ],
    },
  });
  await recordSlip(code, work);
}

function esc(s: string) {
  return s.replace(/[&<>]/g, (ch) => ({ "&": "&", "<": "<", ">": ">" })[ch] as string);
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
    await tg("sendMessage", { chat_id: chatId, text: "No football or basketball for this one." });
    return;
  }
  await tg("sendMessage", {
    chat_id: chatId,
    text: `Picking ${n}…`,
  });
  const result = await scorePlayable(picks);
  const top = keepTop(await applyLessonScores(result.picks), n);
  if (!top.length) {
    await tg("sendMessage", { chat_id: chatId, text: `I no fit pick ${n} sure games from that ticket.` });
    return;
  }
  await mintAndReply(chatId, top, "ng", title || `${top.length} games`);
}

async function createSportSlip(
  chatId: number,
  sport: BookSport,
  count: number,
  window: CookWindow = "soon",
  band?: OddsBand | null,
) {
  const n = clampLegs(count, 5);
  const span = windowLabel(window);
  const useBand = band ?? (await loadOddsBand());
  await tg("sendMessage", {
    chat_id: chatId,
    text: span ? `Researching ${span}…` : `Researching ${n} ${sport}…`,
  });
  const listed = await listUpcomingPicks(sport, Math.min(n + 16, 40), window);
  if ("error" in listed) {
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  await maybeStudyLast(chatId);
  const pool = await cookPool(listed, useBand);
  const researched = await researchPicks(pool, n);
  const take = uniqueEvents(researched.keep.filter((p) => p.sport === sport)).picks.slice(0, n);
  if (!take.length) {
    await tg("sendMessage", { chat_id: chatId, text: `No ${sport} remain after research. Relax the cap or blacklist.` });
    return;
  }
  const tag = researched.researched ? "researched" : "desk read";
  const title =
    take.length < n
      ? `${take.length} games ${sport}${span ? ` · ${span}` : ""} · ${tag} — na only ${take.length} pass`
      : `${take.length} games ${sport}${span ? ` · ${span}` : ""} · ${tag}${researched.dropped ? ` · dropped ${researched.dropped}` : ""}`;
  await mintAndReply(chatId, take, "ng", title, n);
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
  const useBand = band ?? (await loadOddsBand());
  await tg("sendMessage", {
    chat_id: chatId,
    text: span ? `Researching ${span}…` : `Researching ${formatOdds(target)} ${sport}…`,
  });
  const listed = await listUpcomingPicks(sport, 35, window);
  if ("error" in listed) {
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  await maybeStudyLast(chatId);
  const pool = await cookPool(listed, useBand);
  const researched = await researchPicks(pool, 24);
  const only = researched.keep.filter((p) => p.sport === sport);
  const take = buildToOdds(only, target).slice(0, MAX_LEGS);
  if (!take.length) {
    await tg("sendMessage", { chat_id: chatId, text: `I no fit build ${formatOdds(target)} from the ${sport} wey dey now.` });
    return;
  }
  const actual = combinedOdds(take);
  const tag = researched.researched ? "researched" : "desk read";
  const title =
    actual && actual < target * 0.75
      ? `${take.length} games ${sport}${span ? ` · ${span}` : ""} · ${formatOdds(actual)} · ${tag} — pool no reach ${formatOdds(target)}`
      : `${take.length} games ${sport}${span ? ` · ${span}` : ""} · ${actual ? formatOdds(actual) : "—"} · ${tag}`;
  await mintAndReply(chatId, take, "ng", title);
}

async function createStakeDaily(chatId: number) {
  await tg("sendMessage", { chat_id: chatId, text: "Researching Stake 2…" });
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
  await tg("sendMessage", { chat_id: chatId, text: "Researching 2 odds…" });
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
    await tg("sendMessage", { chat_id: chatId, text: "No 2-odds football for SportyBet today. Try later." });
    return;
  }
  const combo = combinedOdds(take);
  await mintAndReply(
    chatId,
    take,
    "ng",
    `SportyBet · daily 2${combo ? ` · ${formatOdds(combo)}` : ""} · ${researched.researched ? "researched" : "desk read"}`,
  );
}

async function createDrawSlip(chatId: number, count: number, window: CookWindow = "today") {
  const n = clampLegs(count, 12);
  const span = windowLabel(window) || "today";
  await tg("sendMessage", { chat_id: chatId, text: `Researching ${n} draws · ${span}…` });
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
  await mintAndReply(
    chatId,
    take,
    "ng",
    `Draw only · ${take.length} football${combo ? ` · ${formatOdds(combo)}` : ""} · ${researched.researched ? "researched" : "desk read"}`,
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
  const useBand = band ?? (await loadOddsBand());
  const n = clampLegs(opts.games ?? 12, 8);
  const span = windowLabel(window);
  await tg("sendMessage", {
    chat_id: chatId,
    text: span ? `Researching mix · ${span}…` : "Researching mix…",
  });
  const [foot, hoop, ten] = await Promise.all([
    listUpcomingPicks("football", 16, window),
    listUpcomingPicks("basketball", 16, window),
    listUpcomingPicks("tennis", 16, window),
  ]);
  const pools = [foot, hoop, ten].filter((p) => !("error" in p)) as TicketPick[][];
  if (!pools.length) {
    await tg("sendMessage", { chat_id: chatId, text: "error" in foot ? foot.error : "No mix sports now." });
    return;
  }
  await maybeStudyLast(chatId);
  const stacked = interleave(pools[0] ?? [], interleave(pools[1] ?? [], pools[2] ?? []));
  const mixed = await cookPool(stacked, useBand);
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
  await mintAndReply(
    chatId,
    take,
    "ng",
    `Mix ${fc} football + ${bc} basketball + ${tc} tennis${actual ? ` · ${formatOdds(actual)}` : ""}${span ? ` · ${span}` : ""} · ${researched.researched ? "researched" : "desk read"}`,
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
    return `${i + 1}  ${p.home} vs ${p.away}  ·  ${tag}  ·  ${p.selection}`;
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
  const longshot = await sendScheduledLongshot();
  const recap = await maybeSundayRecap();
  return { longshot, recap };
}

function parseCookWindow(text: string): CookWindow {
  if (/\btoday\b/i.test(text)) return "today";
  if (/weekends?|\bsat(?:urday)?s?\b|\bsun(?:day)?s?\b/i.test(text)) return "weekend";
  if (/2\s*weeks?|two weeks|fortnight/i.test(text)) return "fortnight";
  if (/long\s*shots?|longshot|1\s*week|one week|this week/i.test(text)) return "week";
  return "soon";
}

function wantsDraw(text: string) {
  if (/draw no bet|\bdnb\b/i.test(text)) return false;
  return /\bdraws?\b/i.test(text);
}

function parseSport(text: string): BookSport | null {
  if (/tennis|atp|wta/i.test(text)) return "tennis";
  if (/basket|hoop/i.test(text)) return "basketball";
  if (/foot|soccer|bola/i.test(text)) return "football";
  return null;
}

async function mintKeepersAndReply(chatId: number, picks: TicketPick[], count?: number) {
  await tg("sendMessage", { chat_id: chatId, text: "Trimming…" });
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

const NOT_A_CODE = new Set([
  "CREATE",
  "START",
  "HELP",
  "LEGS",
  "GAMES",
  "ODDS",
  "TRIM",
  "MINT",
  "ANALYZE",
  "FOOTBALL",
  "BASKETBALL",
  "SOCCER",
  "SLIPCUT",
  "SPORT",
  "SHARE",
  "CODE",
  "KEEP",
  "DROP",
  "HOME",
  "AWAY",
  "OVER",
  "UNDER",
  "SPLIT",
  "STUDY",
  "CUT",
  "LOST",
  "COOK",
  "LIKE",
  "TENNIS",
  "ATP",
  "WTA",
  "BOOK",
  "COMBINE",
  "WEEKEND",
  "WEEKENDS",
  "WEEK",
  "WEEKS",
  "STAKE",
  "TODAY",
  "WEEKEND",
  "MIX",
  "FILTER",
  "PING",
  "RECAP",
  "SCORE",
  "LIVE",
  "BLOCK",
  "STAKE",
  "DRAW",
]);

function looksLikeShareCode(token: string): boolean {
  const t = token.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(t)) return false;
  if (NOT_A_CODE.has(t)) return false;
  return true;
}

function codeFromText(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (looksLikeShareCode(trimmed)) return trimmed.toUpperCase();
  const labeled = extractShareCode(trimmed);
  if (labeled && looksLikeShareCode(labeled)) return labeled;
  const head = trimmed.match(/^([A-Z0-9]{4,16})(?:\s|$|·)/i)?.[1];
  if (head && looksLikeShareCode(head)) return head.toUpperCase();
  return null;
}

function parseDropIndexes(text: string): number[] | null {
  const m = text.match(
    /(?:drop|remove|delete|comot)\s+(?:(?:legs?|games?|match(?:es)?)\s+)?(?:game\s+)?([\d,\s&and]+)/i,
  );
  if (!m) return null;
  if (!/(?:drop|remove|delete|comot)/i.test(text)) return null;
  const nums = [...m[1].matchAll(/\d+/g)].map((x) => Number(x[0])).filter((n) => n >= 1 && n <= 80);
  return nums.length ? nums : null;
}

function parseCombineCode(text: string): string | null {
  const m = text.match(
    /\b(?:combin(?:e|ing)|join|add|merge|plus)\s+(?:am\s+)?(?:with\s+)?(?:code\s+)?([A-Z0-9]{4,16})\b/i,
  );
  if (!m?.[1] || !looksLikeShareCode(m[1])) return null;
  return m[1].toUpperCase();
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

function clampOddsTarget(n: number) {
  if (!Number.isFinite(n)) return 20;
  return Math.max(1.5, Math.min(1000, n));
}

function parseOddsTarget(text: string): number | null {
  if (/\b(?:legs?|games?)\b/i.test(text) && !/\bodds?\b|[x×]/i.test(text)) return null;
  const m =
    text.match(/(\d{1,4}(?:\.\d+)?)\s*odds?\b/i) ||
    text.match(/(\d{1,4}(?:\.\d+)?)\s*[x×]\b/i) ||
    (/\bodds?\b/i.test(text) ? text.match(/\blike\s+(\d{1,4}(?:\.\d+)?)\b/i) : null);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1.2) return null;
  return n;
}

function parseLegCount(text: string): number | null {
  if (/\bodds?\b/i.test(text) && !/\b(?:legs?|games?)\b/i.test(text)) return null;
  const m =
    text.match(/(?:sure\s*)?(\d{1,4})\s*(?:legs?|games?|matches)\b/i) ||
    text.match(/^\/(?:legs?|games?)(?:@\w+)?\s+(\d{1,4})\b/i) ||
    (parseSport(text) && !/\bodds?\b/i.test(text) ? text.match(/\b(\d{1,4})\b/) : null) ||
    (wantsDraw(text) && !/\bodds?\b/i.test(text) ? text.match(/\b(\d{1,4})\b/) : null);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

export async function handleTelegramUpdate(update: TgUpdate) {
  if (!TOKEN()) return;
  await ensureMenu();

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
        "Paste a booking code.",
        "",
        "<b>Cook</b>",
        "<code>10 odds football</code>",
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
    await createSportSlip(msg.chat.id, parseSport(cmdArg(raw)) ?? "football", 12, "weekend");
    return;
  }
  if (isCmd(raw, "mix")) {
    await createMixSlip(msg.chat.id, { games: 12 });
    return;
  }
  if (isCmd(raw, "book") || /^(my book|my slips|book|bankroll)\s*$/i.test(raw)) {
    await tg("sendMessage", { chat_id: msg.chat.id, text: await formatBook() });
    return;
  }
  if (isCmd(raw, "recap")) {
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
  if (legCount && sport && !code) {
    await createSportSlip(msg.chat.id, sport, legCount, cookWindow, band);
    return;
  }
  if (legCount && !code && wantsCreate(text + " " + raw)) {
    await createSportSlip(msg.chat.id, sport ?? "football", legCount, cookWindow, band);
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
  if (!code) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: "Paste a code, or say 10 odds football.",
    });
    return;
  }
  await handleCode(msg.chat.id, code);
}
