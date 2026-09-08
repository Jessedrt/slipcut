/**
 * Pure text → intent helpers for the chat bot. No network, no database, so
 * every parser here can be unit tested in isolation (see intent.test.ts).
 */
import { extractShareCode } from "./parse-ticket.ts";
import type { BookSport } from "./types.ts";

export const MAX_LEGS = 35;

export type CookWindow = "soon" | "today" | "week" | "fortnight" | "weekend";
export type OddsBand = { min: number; max: number };

/** Strip zero-width characters Telegram clients sometimes inject. */
export function cleanText(raw: string) {
  return raw.replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, "").trim();
}

/** `/name`, `/name@BotName`, or the bare word `name`. */
export function isCmd(raw: string, name: string) {
  const t = cleanText(raw);
  if (new RegExp(`^/${name}(?:@\\w+)?(?:\\s|$)`, "i").test(t)) return true;
  return new RegExp(`^${name}$`, "i").test(t);
}

/** Text after the leading `/command`. */
export function cmdArg(raw: string) {
  return cleanText(raw).replace(/^\/\w+(?:@\w+)?\s*/i, "").trim();
}

export function clampLegs(n: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(MAX_LEGS, Math.round(n)));
}

export function clampOddsTarget(n: number) {
  if (!Number.isFinite(n)) return 20;
  return Math.max(1.5, Math.min(1000, n));
}

export function normalizeFilter(raw: string): string | "clear" | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (/^(clear|off|any|all|none|reset)$/.test(t)) return "clear";
  if (/epl|premier/.test(t)) return "premier league";
  if (/la ?liga/.test(t)) return "laliga";
  if (/serie/.test(t)) return "serie a";
  if (/bundes/.test(t)) return "bundesliga";
  if (/ligue ?1/.test(t)) return "ligue 1";
  if (/\bucl\b|champions/.test(t)) return "champions league";
  if (/\bcaf\b/.test(t) && /champions/.test(t)) return "caf champions";
  if (/\bnba\b/.test(t)) return "nba";
  if (/\bwta\b/.test(t)) return "wta";
  if (/atp|us open|grand slam/.test(t)) return "atp";
  if (t.length >= 3) return t;
  return null;
}

/**
 * "stake 2000", "stake 2k", "5k stake". Ignores "stake 2 odds" style phrases
 * where the number is an odds target, not money.
 */
export function parseStake(text: string): number | null {
  const m =
    text.match(/\bstake\s+(?:of\s+)?(?:₦|n|ngn)?\s*([\d,.]+)\s*([kKmM])?\b(?!\s*(?:odds?|[x×]))/i) ||
    text.match(/(?:₦|n|ngn)?\s*\b([\d,.]+)\s*([kKmM])?\s*stake\b/i);
  if (!m) return null;
  let n = Number(String(m[1]).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = (m[2] || "").toLowerCase();
  if (u === "k") n *= 1000;
  if (u === "m") n *= 1_000_000;
  return n;
}

export function parseOddsBand(text: string): OddsBand | null {
  const between = text.match(/between\s+([\d.]+)\s+and\s+([\d.]+)/i);
  if (between) {
    const a = Number(between[1]);
    const b = Number(between[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const maxM = text.match(/(?:no game(?:s)? above|max(?:imum)?(?: odds?)?|not above|cap)\s+([\d.]+)/i);
  const minM = text.match(/(?:no game(?:s)? below|min(?:imum)?(?: odds?)?)\s+([\d.]+)/i);
  if (!maxM && !minM) return null;
  const min = minM ? Number(minM[1]) : 1.05;
  const max = maxM ? Number(maxM[1]) : 6;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

export function wantsMix(text: string) {
  return /\bmix\b|both sports?|football and basketball|basketball and football|bola and hoop/i.test(text);
}

export function wantsLive(text: string) {
  return /^(score|live|scores?)\b/i.test(text) || /\b(live score|how e dey play|how e dey go)\b/i.test(text);
}

export function wantsDraw(text: string) {
  if (/draw no bet|\bdnb\b/i.test(text)) return false;
  return /\bdraws?\b/i.test(text);
}

export function parseSport(text: string): BookSport | null {
  if (/hand\s*ball/i.test(text)) return "handball";
  if (/tennis|atp|wta/i.test(text)) return "tennis";
  if (/basket|hoop/i.test(text)) return "basketball";
  if (/foot|soccer|bola|ucl|champions league/i.test(text)) return "football";
  return null;
}

/** UEFA / CAF / AFC / CONCACAF Champions League — not EFL Championship. */
export function isChampionsLeague(league: string) {
  const l = (league ?? "").toLowerCase();
  if (/women|uwcl|feminine|femenin/.test(l)) return false;
  if (/\bchampionship\b/.test(l) && !/champions league/.test(l)) return false;
  return /champions league|\bucl\b|uefa cl\b|caf champions|afc champions|concacaf champions|liga de campeones/.test(l);
}

export function wantsChampions(text: string) {
  if (/\bchampionship\b/i.test(text) && !/champions league/i.test(text)) return false;
  return /champions leagues?|\bucl\b|uefa\s*cl\b|caf champions|afc champions/i.test(text);
}

export function parseCookWindow(text: string): CookWindow {
  if (/\btoday\b|\btonight\b|\bthis (?:evening|night)\b/i.test(text)) return "today";
  if (/weekends?|\bsat(?:urday)?s?\b|\bsun(?:day)?s?\b/i.test(text)) return "weekend";
  if (/2\s*weeks?|two weeks|fortnight/i.test(text)) return "fortnight";
  if (/long\s*shots?|longshot|1\s*week|one week|this week/i.test(text)) return "week";
  return "soon";
}

export type BlockIntent = { add?: string; remove?: string; list?: boolean };

export function parseBlock(text: string): BlockIntent | null {
  if (/^(blacklist|blocks?|blocked|no list)\s*$/i.test(text)) return { list: true };
  const rem = text.match(/^(?:allow|unban|unblock|remove block)\s+(.+)/i);
  if (rem?.[1]) return { remove: rem[1].trim().replace(/[.!?]+$/, "") };
  if (/no game(?:s)? above|no game(?:s)? below|no wahala|no be |not /i.test(text)) return null;
  const add = text.match(/^(?:no|block|blacklist)\s+(.+)$/i);
  if (!add?.[1]) return null;
  const v = add[1].trim().replace(/[.!?]+$/, "");
  if (v.length < 3) return null;
  if (/^(football|basketball|tennis|handball|legs?|games?|odds?|code|bola|hoop|mix|draws?)/i.test(v)) return null;
  return { add: v };
}

export function applyBand<T extends { odds?: number }>(picks: T[], band: OddsBand | null): T[] {
  if (!band) return picks;
  return picks.filter((p) => p.odds && p.odds >= band.min && p.odds <= band.max);
}

/** Words that look like a share code but are really commands. */
const NOT_A_CODE = new Set(
  [
    "CREATE", "START", "HELP", "LEGS", "GAMES", "ODDS", "TRIM", "MINT", "ANALYZE",
    "FOOTBALL", "BASKETBALL", "SOCCER", "SLIPCUT", "SPORT", "SHARE", "CODE", "KEEP",
    "DROP", "HOME", "AWAY", "OVER", "UNDER", "SPLIT", "STUDY", "CUT", "LOST", "COOK",
    "LIKE", "TENNIS", "HANDBALL", "ATP", "WTA", "BOOK", "COMBINE", "WEEKEND", "WEEKENDS", "WEEK",
    "WEEKS", "STAKE", "TODAY", "MIX", "FILTER", "PING", "RECAP", "SCORE", "LIVE",
    "BLOCK", "DRAW", "DRAWS", "LOCK", "UNLOCK", "GRANT", "REVOKE", "KEYS", "KEY",
    "SLANG", "ONLY", "CLEAR", "DAILY", "DAILY2", "RESULTS", "BOLA", "HOOP", "OKAY",
    "THANKS", "ABEG", "OMO", "BOSS", "HELLO", "YES", "NO", "TONIGHT", "GG", "BTTS",
    "DNB", "LONGSHOT", "SURE", "MENU", "CANCEL", "STOP", "MORE", "AGAIN", "SCORES",
    "ENGINE", "LADDER", "ACCUMULATOR", "ACCUMULATORS", "PREDICT", "ANALYZE", "OPTIMIZE",
    "UCL", "CHAMPIONS", "CHAMPION",
  ],
);

export function looksLikeShareCode(token: string): boolean {
  const t = token.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(t)) return false;
  if (NOT_A_CODE.has(t)) return false;
  return true;
}

export function codeFromText(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = cleanText(raw);
  if (looksLikeShareCode(trimmed)) return trimmed.toUpperCase();
  const labeled = extractShareCode(trimmed);
  if (labeled && looksLikeShareCode(labeled)) return labeled;
  const head = trimmed.match(/^([A-Z0-9]{4,16})(?:\s|$|·)/i)?.[1];
  if (head && looksLikeShareCode(head)) return head.toUpperCase();
  return null;
}

export function parseDropIndexes(text: string): number[] | null {
  if (!/(?:drop|remove|delete|comot)/i.test(text)) return null;
  const m = text.match(
    /(?:drop|remove|delete|comot)\s+(?:(?:legs?|games?|match(?:es)?)\s+)?(?:game\s+)?([\d,\s&and]+)/i,
  );
  if (!m) return null;
  const nums = [...m[1].matchAll(/\d+/g)].map((x) => Number(x[0])).filter((n) => n >= 1 && n <= 80);
  return nums.length ? [...new Set(nums)] : null;
}

export function parseCombineCode(text: string): string | null {
  const m = text.match(
    /\b(?:combin(?:e|ing)|join|add|merge|plus)\s+(?:am\s+)?(?:with\s+)?(?:code\s+)?([A-Z0-9]{4,16})\b/i,
  );
  if (!m?.[1] || !looksLikeShareCode(m[1])) return null;
  return m[1].toUpperCase();
}

export function parseOddsTarget(text: string): number | null {
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

export function parseLegCount(text: string): number | null {
  if (/\bodds?\b/i.test(text) && !/\b(?:legs?|games?)\b/i.test(text)) return null;
  const cleaned = text
    .replace(/\b(?:over|under|o|u)\s*\d+(?:\.\d+)?/gi, " ")
    .replace(/\b\d+\.\d+\b/g, " ");
  const m =
    cleaned.match(/(?:sure\s*)?(\d{1,4})\s*(?:legs?|games?|matches)\b/i) ||
    cleaned.match(/^\/(?:legs?|games?)(?:@\w+)?\s+(\d{1,4})\b/i) ||
    (parseSport(text) && !/\bodds?\b/i.test(text) ? cleaned.match(/\b(\d{1,4})\b/) : null) ||
    (wantsDraw(text) && !/\bodds?\b/i.test(text) ? cleaned.match(/\b(\d{1,4})\b/) : null);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

/** Escape text for Telegram `parse_mode: "HTML"`. */
export function escapeHtml(s: string) {
  return s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch] as string);
}

/** Reverse of escapeHtml plus tag stripping — used for WhatsApp plain text. */
export function htmlToPlain(html: string) {
  return html
    .replace(/<\/?(?:b|strong)>/gi, "*")
    .replace(/<\/?(?:i|em)>/gi, "_")
    .replace(/<\/?(?:code|pre)>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
