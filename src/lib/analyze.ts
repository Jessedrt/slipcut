import { createServerFn } from "@tanstack/react-start";
import { applyThreshold, combinedChance } from "./format";
import { extractShareCode, parseTicketText } from "./parse-ticket";
import { loadBookingCode, mintShare, sportyOf } from "./sportybet";
import { firstUrl, youAnswer, youContents, youKeys } from "./you";
import { seekaiReady, seekChat } from "./seekai";
import { geminiReady, geminiChat } from "./gemini";
import { refreshKeys } from "./keys";
import type {
  AnalyzedPick,
  CutResponse,
  CutResult,
  SportKind,
  TicketPick,
} from "./types";

const MAX_PICKS = 20;

export type CutInput = {
  mode: "code" | "text" | "image" | "picks";
  country?: string;
  code?: string;
  text?: string;
  image?: { mime: string; data: string };
  picks?: TicketPick[];
  threshold: number;
};

function clampThreshold(n: number) {
  if (!Number.isFinite(n)) return 45;
  return Math.min(80, Math.max(40, Math.round(n)));
}

function isSport(v: unknown): v is SportKind {
  return v === "football" || v === "basketball" || v === "tennis" || v === "handball" || v === "other";
}

function stripJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model returned no JSON");
  return JSON.parse(body.slice(start, end + 1));
}

function mergeAnalysis(
  picks: TicketPick[],
  raw: unknown,
  threshold: number,
): Omit<CutResult, "ok" | "shareCode"> {
  const obj = (raw ?? {}) as {
    desk?: unknown;
    picks?: unknown;
  };
  const byId = new Map<string, Record<string, unknown>>();
  if (Array.isArray(obj.picks)) {
    for (const row of obj.picks) {
      if (row && typeof row === "object" && "id" in row) {
        const rec = row as Record<string, unknown>;
        byId.set(String(rec.id), rec);
      }
    }
  }

  const analyzed: AnalyzedPick[] = picks.map((pick, i) => {
    const row = byId.get(pick.id) ?? [...byId.values()][i] ?? {};
    const probability = Number(row.probability);
    const sport = isSport(row.sport) ? row.sport : pick.sport;
    const confidence =
      row.confidence === "high" || row.confidence === "low" || row.confidence === "medium"
        ? row.confidence
        : "medium";
    const reasons = Array.isArray(row.reasons)
      ? row.reasons.filter((x): x is string => typeof x === "string").slice(0, 4)
      : [];
    const risks = Array.isArray(row.risks)
      ? row.risks.filter((x): x is string => typeof x === "string").slice(0, 3)
      : [];
    const summary =
      typeof row.summary === "string" && row.summary.trim()
        ? row.summary.trim()
        : "Not enough to score this pick cleanly.";
    const str = (key: string, fallback: string) =>
      typeof row[key] === "string" && String(row[key]).trim()
        ? String(row[key]).trim()
        : fallback;
    return {
      ...pick,
      sport,
      home: str("home", pick.home),
      away: str("away", pick.away),
      market: str("market", pick.market),
      selection: str("selection", pick.selection),
      league: str("league", pick.league),
      probability: Number.isFinite(probability) ? Math.min(95, Math.max(4, Math.round(probability))) : 50,
      confidence,
      summary,
      reasons,
      risks,
      verdict: "drop",
    };
  });

  const split = applyThreshold(analyzed, threshold);
  const tagged = new Map(
    [...split.kept, ...split.dropped, ...split.ignored].map((p) => [p.id, p]),
  );
  return {
    desk: typeof obj.desk === "string" ? obj.desk : "Form-first read of the slip.",
    picks: analyzed.map((p) => tagged.get(p.id) ?? p),
    threshold,
    ...split,
    combinedKeepChance: combinedChance(split.kept),
  };
}

function clip(s: string, n: number) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, Math.max(0, n - 1)).trim();
}

function pickQuery(pick: TicketPick) {
  const sport =
    pick.sport === "basketball"
      ? "basketball"
      : pick.sport === "other"
        ? "sport"
        : "football soccer";
  const core = `${sport}: ${clip(pick.home, 36)} vs ${clip(pick.away, 36)}. ${clip(pick.league, 24)}. Market: ${clip(pick.market, 36)}. Selection: ${clip(pick.selection, 36)}.`;
  const tail =
    " Recent form, injuries, H2H, motivation. Be harsh. If unsure score under 45. IGNORE odds. Reply ONLY JSON {\"probability\":0-100,\"confidence\":\"high|medium|low\",\"summary\":\"short\",\"reasons\":[\"x\"],\"risks\":[\"x\"]}";
  return (core + tail).slice(0, 400);
}

function parsePickScore(text: string): Record<string, unknown> {
  const cleaned = text.replace(/\[\[\d+(?:\s*,\s*\d+)*\]\]/g, "").trim();
  try {
    return stripJson(cleaned) as Record<string, unknown>;
  } catch {
    const pct = cleaned.match(/\b(\d{1,2}|100)\s*%/);
    return {
      probability: pct ? Number(pct[1]) : 40,
      confidence: "low",
      summary: clip(cleaned.replace(/[#*_]/g, ""), 140) || "Live brief had no clean score.",
      reasons: [],
      risks: ["Could not parse a structured score from live research."],
    };
  }
}

async function mapPool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx] as T, idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function liveBrief(picks: TicketPick[]): Promise<string> {
  if (!youKeys().length) return "";
  const q = picks
    .slice(0, 6)
    .map((p) => `${clip(p.home, 24)} vs ${clip(p.away, 24)} ${clip(p.league, 18)} ${clip(p.market, 18)} ${clip(p.selection, 16)}`)
    .join(" | ");
  try {
    return clip(
      await youAnswer(
        `For each match give: last 5 results both teams, injuries/absences, H2H goals or pace, and whether ${picks[0]?.selection ?? "this pick"} is justified. Be specific, no odds. ${q}`,
        10_000,
      ),
      1400,
    );
  } catch {
    return "";
  }
}

async function scoreChunk(picks: TicketPick[]): Promise<Record<string, unknown>[]> {
  const lines = picks
    .map((p, i) => {
      const when = p.kickoff ? new Date(p.kickoff).toISOString().slice(0, 16) : "tba";
      return `${i + 1}. ${p.sport} | ${clip(p.league, 28)} | ${clip(p.home, 34)} vs ${clip(p.away, 34)} | ${clip(p.market, 32)} → ${clip(p.selection, 32)} | price ${p.odds ?? "?"} | KO ${when}`;
    })
    .join("\n");
  const brief = await liveBrief(picks);
  const system =
    "You are an elite football/basketball match analyst, not a tipster. Think carefully about each selection: league quality, team style, injuries, rest, H2H, whether this MARKET (Over/1H Over/GG/DNB/DC) actually fits THIS match. Reject Home/Away winner and handicap. Score true chance the selection wins, 0-100. Coin-flips 40-48. Only 62+ if you would stake your own money. Reply ONLY JSON {\"picks\":[{\"i\":1,\"probability\":0-100,\"confidence\":\"high|medium|low\",\"summary\":\"one line\",\"reasons\":[\"form\",\"style\"],\"risks\":[\"x\"]}]}";
  const user = `${brief ? `LIVE RESEARCH:\n${brief}\n\n` : ""}Score each selection independently. Do not copy the same market across games unless the matchup truly matches.\n${lines}`;

  const tryParse = (answer: string, engine: string) => {
    try {
      const parsed = stripJson(answer) as { picks?: unknown };
      const rows = Array.isArray(parsed.picks) ? parsed.picks : [];
      if (!rows.length) return null;
      return picks.map((pick, i) => {
        const row =
          rows.find((r) => r && typeof r === "object" && Number((r as { i?: number }).i) === i + 1) ??
          rows[i] ??
          {};
        const rec = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
        return { id: pick.id, sport: pick.sport, engine, ...rec };
      });
    } catch {
      return null;
    }
  };

  if (geminiReady()) {
    try {
      const hit = tryParse(await geminiChat(system, user, 28_000), "gemini");
      if (hit) return hit;
    } catch {
      /* opus next */
    }
  }
  if (seekaiReady()) {
    try {
      const hit = tryParse(
        await seekChat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          28_000,
        ),
        "opus",
      );
      if (hit) return hit;
    } catch {
      /* you.com next */
    }
  }

  if (picks.length === 1) {
    const pick = picks[0]!;
    try {
      const answer = await youAnswer(pickQuery(pick), 12_000);
      return [{ id: pick.id, sport: pick.sport, ...parsePickScore(answer) }];
    } catch {
      return [
        {
          id: pick.id,
          sport: pick.sport,
          probability: 40,
          confidence: "low",
          summary: "Live research missed this pick.",
          reasons: [],
          risks: ["No current form brief returned."],
        },
      ];
    }
  }
  const query = `You are a sharp football/basketball analyst. For each selection, use recent form, injuries, H2H and whether the market actually fits the match. Be harsh: average games 40-50, only strong spots 60+. IGNORE odds. Reply ONLY JSON {"picks":[{"i":1,"probability":0-100,"confidence":"high|medium|low","summary":"one line","reasons":["form"],"risks":["x"]}]}\n${lines}`.slice(
    0,
    1800,
  );
  try {
    const answer = await youAnswer(query, 14_000);
    const parsed = stripJson(answer) as { picks?: unknown };
    const rows = Array.isArray(parsed.picks) ? parsed.picks : [];
    return picks.map((pick, i) => {
      const row =
        rows.find((r) => r && typeof r === "object" && Number((r as { i?: number }).i) === i + 1) ??
        rows[i] ??
        {};
      const rec = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
      return { id: pick.id, sport: pick.sport, ...rec };
    });
  } catch {
    const singles = await mapPool(picks, 2, async (pick) => {
      try {
        const answer = await youAnswer(pickQuery(pick), 12_000);
        return { id: pick.id, sport: pick.sport, ...parsePickScore(answer) };
      } catch {
        return {
          id: pick.id,
          sport: pick.sport,
          probability: 40,
          confidence: "low",
          summary: "Live research missed this pick.",
          reasons: [],
          risks: ["No current form brief returned."],
        };
      }
    });
    return singles;
  }
}

async function scorePicks(picks: TicketPick[]): Promise<unknown> {
  const rows: Record<string, unknown>[] = [];
  const others = picks.filter((p) => p.sport === "other");
  const playable = picks.filter((p) => p.sport !== "other");
  for (const pick of others) {
    rows.push({
      id: pick.id,
      sport: "other",
      probability: 0,
      confidence: "high",
      summary: "Not football or basketball.",
      reasons: [],
      risks: ["Sport is outside the desk."],
    });
  }
  const groups = chunk(playable, 2);
  const scored = await mapPool(groups, 3, (group) => scoreChunk(group));
  for (const group of scored) rows.push(...group);
  return {
    desk: `🧠 ${geminiReady() ? "Gemini" : seekaiReady() ? "Opus" : "AI"}${youKeys().length ? " + you.com" : ""} deep read of ${playable.length} selection${playable.length === 1 ? "" : "s"}.`,
    picks: rows,
  };
}

export async function analyzePicks(picks: TicketPick[], threshold = 45) {
  await refreshKeys();
  const analyzedRaw = await scorePicks(picks);
  return mergeAnalysis(picks, analyzedRaw, clampThreshold(threshold));
}

async function picksFromPaste(text: string, country?: string): Promise<{
  picks: TicketPick[];
  shareCode?: string;
} | { error: string }> {
  const url = firstUrl(text);
  if (url) {
    try {
      const parsedUrl = new URL(url);
      const shareFromUrl =
        extractShareCode(url) ||
        parsedUrl.searchParams.get("shareCode") ||
        parsedUrl.searchParams.get("code");
      if (shareFromUrl && /^[A-Z0-9]{4,16}$/i.test(shareFromUrl)) {
        return loadBookingCode(shareFromUrl.toUpperCase(), country);
      }
      const markdown = await youContents(url);
      const parsed = parseTicketText(markdown).slice(0, MAX_PICKS);
      if (parsed.length) return { picks: parsed };
      return { error: "That link did not contain football or basketball selections." };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Could not read that link.",
      };
    }
  }
  const maybeCode = extractShareCode(text);
  if (maybeCode && text.length < 80) {
    return loadBookingCode(maybeCode, country);
  }
  const picks = parseTicketText(text).slice(0, MAX_PICKS);
  if (!picks.length) return { error: "Could not read any games from that paste." };
  return { picks };
}

async function picksForInput(
  input: CutInput,
): Promise<{ picks: TicketPick[]; shareCode?: string } | { error: string }> {
  if (input.mode === "picks") {
    const picks = (input.picks ?? []).slice(0, MAX_PICKS);
    if (!picks.length) return { error: "No selections to analyze." };
    return { picks };
  }
  if (input.mode === "code") {
    const code = extractShareCode(input.code ?? "") || (input.code ?? "").trim().toUpperCase();
    if (!code) return { error: "Enter a SportyBet booking code." };
    return loadBookingCode(code, input.country);
  }
  if (input.mode === "text") {
    const text = (input.text ?? "").trim();
    if (!text) return { error: "Paste a ticket, link, or booking code." };
    return picksFromPaste(text, input.country);
  }
  return { error: "Image tickets are only supported on Telegram for now." };
}

export const loadTicket = createServerFn({ method: "POST" })
  .validator((input: { code?: string; country?: string; text?: string }) => input)
  .handler(async ({ data }): Promise<
    { ok: true; picks: TicketPick[]; shareCode?: string } | { ok: false; error: string }
  > => {
    const code = extractShareCode(data.code ?? data.text ?? "") || (data.code ?? "").trim().toUpperCase();
    if (code) {
      const loaded = await loadBookingCode(code, data.country);
      if ("error" in loaded) return { ok: false, error: loaded.error };
      return { ok: true, picks: loaded.picks, shareCode: loaded.shareCode };
    }
    if (data.text?.trim()) {
      const loaded = await picksFromPaste(data.text.trim(), data.country);
      if ("error" in loaded) return { ok: false, error: loaded.error };
      return { ok: true, picks: loaded.picks, shareCode: loaded.shareCode };
    }
    return { ok: false, error: "Enter a SportyBet booking code." };
  });

export const cutSlip = createServerFn({ method: "POST" })
  .validator((input: CutInput) => input)
  .handler(async ({ data }): Promise<CutResponse> => {
    const loaded = await picksForInput(data);
    if ("error" in loaded) return { ok: false, error: loaded.error };
    const analysis = await analyzePicks(loaded.picks, data.threshold);
    return { ok: true, shareCode: loaded.shareCode, ...analysis };
  });

export const bookSlip = createServerFn({ method: "POST" })
  .validator((input: { picks: TicketPick[]; country?: string }) => input)
  .handler(async ({ data }): Promise<
    { ok: true; shareCode: string; shareURL: string; unavailable: number } | { ok: false; error: string }
  > => {
    const selections = sportyOf(data.picks ?? []);
    if (!selections.length) {
      return { ok: false, error: "These legs can't be booked on SportyBet." };
    }
    const minted = await mintShare(selections, data.country);
    if ("error" in minted) return { ok: false, error: minted.error };
    return {
      ok: true,
      shareCode: minted.shareCode,
      shareURL: minted.shareURL,
      unavailable: minted.unavailable,
    };
  });

export const connectTelegram = createServerFn({ method: "POST" })
  .handler(async (): Promise<
    { ok: true; username: string } | { ok: false; error: string }
  > => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return {
        ok: false,
        error: "Add TELEGRAM_BOT_TOKEN in Vercel, then Redeploy.",
      };
    }
    const hook = process.env.TELEGRAM_WEBHOOK_URL || "https://slipcut.vercel.app/api/telegram";
    const set = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: hook, allowed_updates: ["message", "callback_query"] }),
    });
    const setBody = (await set.json()) as { ok?: boolean; description?: string };
    if (!setBody.ok) {
      return { ok: false, error: setBody.description || "Could not set Telegram webhook." };
    }
    const me = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const meBody = (await me.json()) as { ok?: boolean; result?: { username?: string } };
    const username = meBody.result?.username;
    if (!username) return { ok: false, error: "Bot token worked but had no username." };
    return { ok: true, username };
  });
