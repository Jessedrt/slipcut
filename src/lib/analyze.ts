import { createServerFn } from "@tanstack/react-start";
import { applyThreshold, combinedChance } from "./format";
import { extractShareCode, parseTicketText } from "./parse-ticket";
import { picksFromShare, type SharePayload } from "./sportybet";
import type {
  AnalyzedPick,
  CutResponse,
  CutResult,
  SportKind,
  TicketPick,
} from "./types";

const COUNTRY_FALLBACKS = ["ng", "gh", "ke", "za", "tz", "ug", "zm", "cm"];
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
  if (!Number.isFinite(n)) return 58;
  return Math.min(80, Math.max(40, Math.round(n)));
}

function isSport(v: unknown): v is SportKind {
  return v === "football" || v === "basketball" || v === "other";
}

function youKey() {
  return (
    process.env.YDC_API_KEY ||
    process.env.YOU_API_KEY ||
    process.env.YOUCOM_API_KEY ||
    ""
  );
}

async function fetchShare(code: string, country: string): Promise<SharePayload | null> {
  const url = `https://www.sportybet.com/api/${country}/orders/share/${encodeURIComponent(code)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 SlipCut",
        Clientid: "web",
        OperId: "2",
        Platform: "web",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as SharePayload;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function loadBookingCode(code: string, preferred?: string): Promise<{
  picks: TicketPick[];
  shareCode: string;
} | { error: string }> {
  const order = [preferred, ...COUNTRY_FALLBACKS].filter(
    (c, i, arr): c is string => Boolean(c) && arr.indexOf(c) === i,
  );
  let lastMessage = "Booking code not found.";
  for (const country of order) {
    const payload = await fetchShare(code, country);
    if (!payload) continue;
    if (payload.bizCode === 10000 && payload.data) {
      const picks = picksFromShare(payload);
      if (!picks.length) return { error: "That code loaded, but the slip had no selections." };
      return { picks: picks.slice(0, MAX_PICKS), shareCode: payload.data.shareCode ?? code };
    }
    lastMessage = payload.message || lastMessage;
  }
  return { error: lastMessage };
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
  return {
    desk: typeof obj.desk === "string" ? obj.desk : "Form-first read of the slip.",
    picks: analyzed,
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

async function youAnswer(query: string): Promise<string> {
  const apiKey = youKey();
  if (!apiKey) throw new Error("AI is not available in this environment");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch("https://api.you.com/v1/answer", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        query,
        freshness: "week",
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Analyst unavailable (${res.status})${errText ? `: ${errText.slice(0, 180)}` : ""}`,
      );
    }
    const body = (await res.json()) as { answer?: string };
    return body.answer ?? "";
  } finally {
    clearTimeout(timer);
  }
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
    desk: `Live-web form read of ${picks.length} selection${picks.length === 1 ? "" : "s"}. Odds ignored.`,
    picks: rows,
  };
}

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
          error: "Screenshots need a vision model. Use a booking code or paste the slip.",
        };
      } else {
        const text = (data.text ?? "").trim();
        if (!text) return { ok: false, error: "Paste a slip or a booking code first." };
        const maybeCode = extractShareCode(text);
        if (maybeCode && text.length < 24) {
          const loaded = await loadBookingCode(maybeCode, data.country);
          if ("error" in loaded) return { ok: false, error: loaded.error };
          picks = loaded.picks;
          shareCode = loaded.shareCode;
        } else {
          picks = parseTicketText(text).slice(0, MAX_PICKS);
        }
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
