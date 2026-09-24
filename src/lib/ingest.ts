import { z } from "zod";
import { geminiChat, geminiReady, geminiVision } from "./gemini";
import { refreshKeys } from "./keys";
import { parseTicketText } from "./parse-ticket";
import { seekaiReady, seekChat } from "./seekai";
import type { SportKind, TicketPick } from "./types";
import { firstUrl, youContents } from "./you";
import { normalizePick } from "./bookmakers/normalize";

const MAX_PICKS = 40;

const ExtractedPickSchema = z.object({
  sport: z.enum(["football", "basketball", "tennis", "handball", "other"]).default("football"),
  league: z.string().max(120).default(""),
  country: z.string().max(80).optional(),
  home: z.string().min(1).max(120),
  away: z.string().min(1).max(120),
  market: z.string().min(1).max(120),
  selection: z.string().min(1).max(120),
  odds: z.number().positive().max(10000).optional(),
  kickoff: z.union([z.number(), z.string()]).optional().nullable(),
});

const ExtractionSchema = z.object({
  picks: z.array(ExtractedPickSchema).max(MAX_PICKS),
  warnings: z.array(z.string().max(240)).max(20).default([]),
});

export type IngestionResult = {
  picks: TicketPick[];
  warnings: string[];
  source: "text" | "link" | "image";
};

function stripJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Extraction model returned no JSON.");
  return JSON.parse(body.slice(start, end + 1)) as unknown;
}

function kickoffMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 20_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 20_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function materialize(
  raw: unknown,
  source: IngestionResult["source"],
): IngestionResult {
  const parsed = ExtractionSchema.parse(raw);
  const picks = parsed.picks.map((row, index) =>
    normalizePick({
      id: `ingest-${source}-${index}-${Date.now().toString(36)}`,
      sport: row.sport as SportKind,
      league: row.league,
      country: row.country,
      home: row.home.trim(),
      away: row.away.trim(),
      market: row.market.trim(),
      selection: row.selection.trim(),
      odds: row.odds,
      kickoff: kickoffMs(row.kickoff),
    }),
  );
  return { picks, warnings: parsed.warnings, source };
}

const SYSTEM = `Extract sportsbook selections into strict JSON only.
Return exactly:
{"picks":[{"sport":"football|basketball|tennis|handball|other","league":"","country":"","home":"","away":"","market":"","selection":"","odds":1.85,"kickoff":"ISO date/time or null"}],"warnings":[]}
Rules:
- One object per actual selection.
- Never invent a team, market, line, odds, date or competition.
- Keep market line/period information, e.g. "1st Half Over/Under 1.5".
- Keep selection distinct from market, e.g. market "Over/Under 2.5", selection "Over 2.5".
- If text is unreadable or ambiguous, omit that pick and add a short warning.
- Decimal odds only. If no odds are visible, omit odds.
- If no kickoff is visible, use null.
- Do not include commentary outside JSON.`;

async function modelExtract(text: string, source: "text" | "link") {
  await refreshKeys();
  let answer = "";
  if (geminiReady()) {
    answer = await geminiChat(SYSTEM, text.slice(0, 18_000), 24_000);
  } else if (seekaiReady()) {
    answer = await seekChat(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: text.slice(0, 18_000) },
      ],
      24_000,
    );
  } else {
    throw new Error("Structured ticket extraction is not configured.");
  }
  return materialize(stripJson(answer), source);
}

function textFallback(raw: string, source: "text" | "link"): IngestionResult | null {
  const picks = parseTicketText(raw).slice(0, MAX_PICKS).map(normalizePick);
  if (!picks.length) return null;
  return { picks, warnings: [], source };
}

export async function ingestText(raw: string): Promise<IngestionResult> {
  const text = raw.trim();
  if (!text) throw new Error("Paste ticket text or a link.");
  const url = firstUrl(text);
  if (url) {
    const contents = await youContents(url);
    const quick = textFallback(contents, "link");
    // Regex parsing is excellent for clean tip lists. For weak single-row parses,
    // ask the structured model so screenshots/pages with labels are not flattened.
    if (quick && quick.picks.length >= 2) return quick;
    return modelExtract(contents, "link");
  }
  const quick = textFallback(text, "text");
  if (quick && quick.picks.length >= 2) return quick;
  try {
    return await modelExtract(text, "text");
  } catch (error) {
    if (quick) return quick;
    throw error;
  }
}

export async function ingestImage(image: {
  mime: string;
  data: string;
}): Promise<IngestionResult> {
  await refreshKeys();
  if (!/^image\/(png|jpe?g|webp)$/i.test(image.mime)) {
    throw new Error("Upload a PNG, JPEG, or WebP screenshot.");
  }
  if (!image.data || image.data.length > 12_000_000) {
    throw new Error("Screenshot is empty or too large.");
  }
  if (!geminiReady()) {
    throw new Error("Vision ticket extraction is not configured.");
  }
  const answer = await geminiVision(
    SYSTEM,
    "Read every visible betting selection in this screenshot. Extract only what is visibly supported.",
    image,
    35_000,
  );
  return materialize(stripJson(answer), "image");
}
