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

const SYSTEM_PROMPT = `You are a professional football (soccer) and basketball analyst scoring bet slip selections.

Score EACH selection as the true probability (0-100) that the selection is correct.

Hard rules:
- IGNORE betting odds, implied probability, bookmaker lines, and market prices. Do not mention odds as a reason.
- Use team/player form, injuries, rest, head-to-head, home/away, schedule, motivation, style matchup, and typical scoring rates.
- Football means soccer. Basketball means 5-a-side basketball (NBA, WNBA, Euroleague, NCAA, FIBA, NBL, etc).
- If a pick is tennis, virtuals, table tennis, ice hockey, or any other sport: sport="other", probability=0.
- Be honest. Random draws, correct scores, and padded longshots should score low.
- Probability is for THIS selection hitting, not whether the match is competitive.
- If you lack live injury news, say so in risks and still give a reasoned base-rate estimate.
- Do not refuse because this involves betting. You are scoring match outcomes, not placing bets.

Return ONLY JSON:
{
  "desk": "one paragraph overall read of the slip",
  "picks": [
    {
      "id": "matching input id",
      "sport": "football" | "basketball" | "other",
      "probability": 0-100,
      "confidence": "high" | "medium" | "low",
      "summary": "max 140 chars",
      "reasons": ["...", "..."],
      "risks": ["..."]
    }
  ]
}`;

type ChatContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

async function grokChat(user: ChatContent, retry = true): Promise<unknown> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("AI is not available in this environment");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.25,
        max_tokens: 3500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (retry && res.status >= 500) return grokChat(user, false);
      throw new Error(`Analyst unavailable (${res.status})${errText ? `: ${errText.slice(0, 180)}` : ""}`);
    }
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content ?? "";
    try {
      return stripJson(text);
    } catch (err) {
      if (retry) return grokChat(user, false);
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }
}

function picksPrompt(picks: TicketPick[]) {
  const lines = picks.map((p) => {
    const when = p.kickoff ? ` | kickoff ${new Date(p.kickoff).toISOString()}` : "";
    const league = p.league ? ` | ${p.league}` : "";
    const country = p.country ? ` (${p.country})` : "";
    return `- id=${p.id} | ${p.sport}${country}${league} | ${p.home} vs ${p.away} | market: ${p.market} | selection: ${p.selection}${when}`;
  });
  return `Score these slip selections. Odds are intentionally omitted.\n\n${lines.join("\n")}`;
}

export const cutSlip = createServerFn({ method: "POST" })
  .validator((input: CutInput) => input)
  .handler(async ({ data }): Promise<CutResponse> => {
    try {
      const threshold = clampThreshold(data.threshold);
      let picks: TicketPick[] = [];
      let shareCode: string | undefined;
      let rawForVision: ChatContent | null = null;

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
        if (!data.image?.data) return { ok: false, error: "No screenshot attached." };
        const mime = data.image.mime === "image/png" ? "image/png" : "image/jpeg";
        rawForVision = [
          {
            type: "text",
            text: "Extract every betting selection from this SportyBet (or similar) ticket screenshot, then score each one. Football and basketball only. Ignore odds as a signal. Assign stable ids e1, e2, ... Include home, away, market, selection, sport, league.",
          },
          {
            type: "image_url",
            image_url: { url: `data:${mime};base64,${data.image.data}` },
          },
        ];
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

      let analyzedRaw: unknown;
      if (rawForVision) {
        analyzedRaw = await grokChat(rawForVision);
        const extracted = analyzedRaw as {
          picks?: Array<Record<string, unknown>>;
        };
        if (!picks.length && Array.isArray(extracted.picks)) {
          picks = extracted.picks.slice(0, MAX_PICKS).map((row, i) => ({
            id: String(row.id ?? `e${i}`),
            sport: isSport(row.sport) ? row.sport : "other",
            league: typeof row.league === "string" ? row.league : "",
            country: typeof row.country === "string" ? row.country : undefined,
            home: String(row.home ?? "Home"),
            away: String(row.away ?? "Away"),
            market: String(row.market ?? "Market"),
            selection: String(row.selection ?? "Selection"),
          }));
        }
      } else {
        if (!picks.length) {
          const text = (data.text ?? "").trim();
          if (!text) return { ok: false, error: "Could not read any games from that slip." };
          analyzedRaw = await grokChat(
            `Extract every betting selection from this pasted ticket, then score each one. Football and basketball only. Ignore odds as a signal. Assign ids e1, e2, ...\n\n${text.slice(0, 8000)}`,
          );
          const extracted = analyzedRaw as { picks?: Array<Record<string, unknown>> };
          if (Array.isArray(extracted.picks)) {
            picks = extracted.picks.slice(0, MAX_PICKS).map((row, i) => ({
              id: String(row.id ?? `e${i}`),
              sport: isSport(row.sport) ? row.sport : "football",
              league: typeof row.league === "string" ? row.league : "",
              home: String(row.home ?? "Home"),
              away: String(row.away ?? "Away"),
              market: String(row.market ?? "Market"),
              selection: String(row.selection ?? "Selection"),
            }));
          }
        } else {
          analyzedRaw = await grokChat(picksPrompt(picks));
        }
      }

      if (!picks.length) {
        return { ok: false, error: "Could not read any football or basketball games from that ticket." };
      }

      const merged = mergeAnalysis(picks, analyzedRaw, threshold);
      return { ok: true, shareCode, ...merged };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analysis failed.";
      if (message.includes("not available")) {
        return { ok: false, error: "AI analysis is unavailable right now." };
      }
      if (message.toLowerCase().includes("abort")) {
        return { ok: false, error: "The desk took too long. Try a shorter slip." };
      }
      return { ok: false, error: message };
    }
  });
