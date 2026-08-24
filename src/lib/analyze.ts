import { createServerFn } from "@tanstack/react-start";
import { applyThreshold, combinedChance } from "./format";
import { extractShareCode, parseTicketText } from "./parse-ticket";
import { loadBookingCode, mintShare, sportyOf } from "./sportybet";
import { firstUrl, youAnswer, youContents } from "./you";
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
  if (!Number.isFinite(n)) return 48;
  return Math.min(80, Math.max(40, Math.round(n)));
}

function isSport(v: unknown): v is SportKind {
  return v === "football" || v === "basketball" || v === "other";
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
    " Live form and news only. IGNORE betting odds/prices. Reply ONLY JSON {\"probability\":0-100,\"confidence\":\"high|medium|low\",\"summary\":\"short\",\"reasons\":[\"x\"],\"risks\":[\"x\"]}";
  return (core + tail).slice(0, 400);
}

function parsePickScore(text: string): Record<string, unknown> {
  const cleaned = text.replace(/\[\[\d+(?:\s*,\s*\d+)*\]\]/g, "").trim();
  try {
    return stripJson(cleaned) as Record<string, unknown>;
  } catch {
    const pct = cleaned.match(/\b(\d{1,2}|100)\s*%/);
    return {
      probability: pct ? Number(pct[1]) : 50,
      confidence: "low",
      summary: clip(cleaned.replace(/[#*_]/g, ""), 140) || "Live brief had no clean score.",
      reasons: [],
      risks: ["Could not parse a structured score from live research."],
    };
  }
}

async function scorePicks(picks: TicketPick[]): Promise<unknown> {
  const rows = await Promise.all(
    picks.map(async (pick) => {
      if (pick.sport === "other") {
        return {
          id: pick.id,
          sport: "other",
          probability: 0,
          confidence: "high",
          summary: "Not football or basketball.",
          reasons: [],
          risks: ["Sport is outside the desk."],
        };
      }
      try {
        const answer = await youAnswer(pickQuery(pick));
        return { id: pick.id, sport: pick.sport, ...parsePickScore(answer) };
      } catch {
        return {
          id: pick.id,
          sport: pick.sport,
          probability: 50,
          confidence: "low",
          summary: "Live research missed this pick.",
          reasons: [],
          risks: ["No current form brief returned."],
        };
      }
    }),
  );
  return {
    desk: `Live-web form read of ${picks.length} selection${picks.length === 1 ? "" : "s"}. Odds ignored as a signal.`,
    picks: rows,
  };
}

export async function analyzePicks(picks: TicketPick[], threshold = 48) {
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

export const loadTicket = createServerFn({ method: "POST" })
  .validator((input: { code?: string; country?: string; text?: string }) => input)
  .handler(async ({ data }): Promise<
    { ok: true; picks: TicketPick[]; shareCode?: string } | { ok: false; error: string }
  > => {
    const code =
      extractShareCode(data.code ?? "") ||
      extractShareCode(data.text ?? "") ||
      (data.code ?? "").trim().toUpperCase();
    if (code && /^[A-Z0-9]{4,16}$/.test(code)) {
      const loaded = await loadBookingCode(code, data.country);
      if ("error" in loaded) return { ok: false, error: loaded.error };
      return { ok: true, ...loaded };
    }
    const text = (data.text ?? data.code ?? "").trim();
    if (!text) return { ok: false, error: "Paste a booking code or slip first." };
    const loaded = await picksFromPaste(text, data.country);
    if ("error" in loaded) return { ok: false, error: loaded.error };
    return { ok: true, ...loaded };
  });

export const cutSlip = createServerFn({ method: "POST" })
  .validator((input: CutInput) => input)
  .handler(async ({ data }): Promise<CutResponse> => {
    try {
      const threshold = clampThreshold(data.threshold);
      let picks: TicketPick[] = [];
      let shareCode: string | undefined;

      if (data.mode === "picks" && data.picks?.length) {
        picks = data.picks.slice(0, MAX_PICKS);
      } else if (data.mode === "code") {
        const code =
          extractShareCode(data.code ?? "") ||
          extractShareCode(data.text ?? "") ||
          (data.code ?? "").trim().toUpperCase();
        if (!code || !/^[A-Z0-9]{4,16}$/.test(code)) {
          return { ok: false, error: "That does not look like a SportyBet booking code." };
        }
        const loaded = await loadBookingCode(code, data.country);
        if ("error" in loaded) return { ok: false, error: loaded.error };
        picks = loaded.picks;
        shareCode = loaded.shareCode;
      } else if (data.mode === "image") {
        return {
          ok: false,
          error: "Screenshots need a vision model. Use a booking code, paste, or drop an X link.",
        };
      } else {
        const text = (data.text ?? "").trim();
        if (!text) return { ok: false, error: "Paste a slip, a booking code, or a link first." };
        const loaded = await picksFromPaste(text, data.country);
        if ("error" in loaded) return { ok: false, error: loaded.error };
        picks = loaded.picks;
        shareCode = loaded.shareCode;
      }

      if (!picks.length) {
        return { ok: false, error: "Could not read any football or basketball games from that ticket." };
      }

      const analyzedRaw = await scorePicks(picks);
      const merged = mergeAnalysis(picks, analyzedRaw, threshold);
      return { ok: true, shareCode, ...merged };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analysis failed.";
      if (message.includes("not available")) {
        return { ok: false, error: "AI analysis is unavailable right now. Add YDC_API_KEY in Vercel." };
      }
      if (message.toLowerCase().includes("abort")) {
        return { ok: false, error: "The desk took too long. Try a shorter slip." };
      }
      return { ok: false, error: message };
    }
  });

export const bookSlip = createServerFn({ method: "POST" })
  .validator((input: { picks: TicketPick[]; country?: string }) => input)
  .handler(async ({ data }): Promise<
    { ok: true; shareCode: string; shareURL: string; unavailable: number } | { ok: false; error: string }
  > => {
    const selections = sportyOf(data.picks);
    if (!selections.length) {
      return {
        ok: false,
        error: "Those picks have no SportyBet IDs. Load a SportyBet booking code first, then edit.",
      };
    }
    const minted = await mintShare(selections, data.country || "ng");
    if ("error" in minted) return { ok: false, error: minted.error };
    return { ok: true, ...minted };
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
