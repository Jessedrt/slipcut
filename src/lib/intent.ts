/**
 * Pure text → intent helpers for the chat bot. No network, no database, so
 * every parser here can be unit tested in isolation (see intent.test.ts).
 */
import { extractShareCode } from "./parse-ticket.ts";
import type { BookSport } from "./types.ts";

/** SportyBet share codes start to struggle past ~50; quality filter decides how many we keep. */
export const MAX_LEGS = 50;

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

export function clampLegs(n: number, fallback = 10) {
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(MAX_LEGS, Math.max(1, Math.round(n)));
}

export function clampOddsTarget(n: number) {
  if (!Number.isFinite(n) || n < 1.2) return 2;
  return Math.min(5000, Math.max(1.2, n));
}

export function parseOddsTarget(text: string): number | null {
  const m = text.match(/(?:cook\s+)?(\d+(?:\.\d+)?)\s*(?:odds|[x×])/i);
  if (!m) return null;
  return clampOddsTarget(Number(m[1]));
}

export function parseOddsBand(text: string): OddsBand | null {
  const range = text.match(/odds?\s*(?:between|=)?\s*(\d+(?:\.\d+)?)\s*(?:-|to|and)\s*(\d+(?:\.\d+)?)/i);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  return null;
}

export function applyBand(picks: { odds?: number }[], band: OddsBand | null) {
  if (!band) return picks;
  return picks.filter((p) => {
    const o = p.odds;
    if (!o || !Number.isFinite(o)) return true;
    return o >= band.min && o <= band.max;
  });
}

export function wantsDraw(text: string) {
  if (/draw no bet|\bdnb\b/i.test(text)) return false;
  return /\bdraws?\b/i.test(text);
}

export function parseSport(text: string): BookSport | null {
  if (/hand\s*ball/i.test(text)) return "handball";
  if (/tennis|atp|wta/i.test(text)) return "tennis";
  if (/\bnba\b|basket|hoop/i.test(text)) return "basketball";
  if (/foot|soccer|bola|ucl|champions league/i.test(text)) return "football";
  return null;
}

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
  if (/soon|next\s*hours?|in\s*a\s*bit/i.test(text)) return "soon";
  return "today";
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

export function parseStake(text: string): number | null {
  const m = text.match(
    /\bstake\s+(?:of\s+)?(?:₦|n|ngn)?\s*([\d,.]+)\s*([kKmM])?\b(?!\s*(?:odds?|[x×]))/i,
  ) || text.match(/\b([\d,.]+)\s*([kKmM])?\s*stake\b/i);
  if (!m) return null;
  let n = Number(String(m[1]).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = (m[2] || "").toLowerCase();
  if (u === "k") n *= 1_000;
  if (u === "m") n *= 1_000_000;
  return Math.round(n);
}

export function looksLikeShareCode(raw: string) {
  const t = cleanText(raw);
  return /^[A-Za-z0-9]{5,12}$/.test(t);
}
