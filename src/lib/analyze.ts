import { createServerFn } from "@tanstack/react-start";
import { applyThreshold, combinedChance } from "./format.ts";
import {
  clampProb,
  ensembleScores,
  evPerStake,
  fairOddsFromProb,
  fairProbFromOdds,
  blendWithMarket,
  confidenceWeight,
  applyPlatt,
  type EngineScore,
  type Platt,
} from "./odds.ts";
import { marketFamily } from "./sportybet.ts";
import { youAnswer } from "./you.ts";
import { refreshKeys } from "./keys.ts";
import { loadCalibration } from "./study.ts";
import type { AnalyzedPick, CutResponse, SportKind, TicketPick } from "./types.ts";

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

function stripJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model returned no JSON");
  return JSON.parse(body.slice(start, end + 1));
}

function clip(s: string, n: number) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, Math.max(0, n - 1)).trim();
}

export function familyOf(pick: TicketPick): string {
  return marketFamily(pick.sporty?.marketId, pick.market);
}

export function marketProbOf(pick: TicketPick): number | null {
  return fairProbFromOdds(pick.odds, familyOf(pick), pick.sport);
}

/** Pure match analysis — form, H2H, injuries, motivation. Not book-price inversion. */
const SYSTEM = [
  "You are a football/basketball/tennis match analyst.",
  "Judge each selection using: recent form, head-to-head, home/away record, injuries/suspensions, rest, motivation, and whether THIS market fits THIS match.",
  "Do NOT invert the bookmaker odds. Form your own view from match facts.",
  "Reply with JSON only:",
  '{"picks":[{"i":1,"keep":true,"probability":62,"confidence":"high","summary":"one line H2H/form reason","reasons":["form","h2h"],"risks":["injury"]}]}',
  "Rules:",
  "- keep=true only if you would back it yourself from form/H2H analysis.",
  "- probability is your true chance 0-100 from analysis (not the book price).",
  "- confidence high|medium|low from how strong the evidence is.",
  "- summary must mention form or H2H or a concrete match fact.",
  "- No markdown, no text outside JSON.",
].join(" ");

function pickLines(picks: TicketPick[]): string {
  return picks
    .map((p, i) => {
      const when = p.kickoff ? new Date(p.kickoff).toISOString().slice(0, 16) : "tba";
      return [
        `${i + 1}.`,
        p.sport,
        `| ${clip(p.league, 28)}`,
        `| ${clip(p.home, 28)} vs ${clip(p.away, 28)}`,
        `| ${clip(p.market, 24)} → ${clip(p.selection, 24)}`,
        `| book ${p.odds ?? "?"}`,
        `| KO ${when}`,
      ].join(" ");
    })
    .join("\n");
}

type EngineRow = {
  probability: number;
  fairOdds?: number;
  confidence: "high" | "medium" | "low";
  summary: string;
  reasons: string[];
  risks: string[];
  keep?: boolean;
};

type EngineReading = Map<string, EngineRow>;
const CONFIDENCES = new Set(["high", "medium", "low"]);

function rowFrom(rec: Record<string, unknown>): EngineRow | null {
  const raw = Number(rec.probability);
  const fair = Number(rec.fair_odds ?? rec.fairOdds);
  let probability = Number.isFinite(raw) ? raw : Number.isFinite(fair) && fair > 1 ? 100 / fair : NaN;
  if (!Number.isFinite(probability)) {
    const pct = String(rec.summary ?? "").match(/\b(\d{1,2}|100)\s*%/);
    probability = pct ? Number(pct[1]) : NaN;
  }
  // If model only gave keep/drop, map confidence to a soft chance.
  if (!Number.isFinite(probability)) {
    const keep =
      rec.keep === true ||
      String(rec.verdict ?? "").toLowerCase() === "keep" ||
      String(rec.pick ?? "").toLowerCase() === "yes";
    const conf = String(rec.confidence ?? "medium").toLowerCase();
    if (keep) probability = conf === "high" ? 68 : conf === "low" ? 52 : 58;
    else probability = conf === "high" ? 28 : conf === "low" ? 42 : 35;
  }
  probability = Math.min(97, Math.max(3, Math.round(probability)));
  const fairOdds = Number.isFinite(fair) && fair > 1 ? Math.min(50, Math.max(1.01, fair)) : undefined;
  const confidence = CONFIDENCES.has(String(rec.confidence))
    ? (String(rec.confidence) as EngineRow["confidence"])
    : "medium";
  const reasons = Array.isArray(rec.reasons)
    ? rec.reasons.filter((x): x is string => typeof x === "string" && x.trim().length > 1).slice(0, 4)
    : [];
  const risks = Array.isArray(rec.risks)
    ? rec.risks.filter((x): x is string => typeof x === "string" && x.trim().length > 1).slice(0, 3)
    : [];
  const summary =
    typeof rec.summary === "string" && rec.summary.trim()
      ? clip(rec.summary.replace(/[#*_]/g, ""), 150)
      : "";
  const keep =
    rec.keep === true ||
    String(rec.verdict ?? "").toLowerCase() === "keep" ||
    (rec.keep !== false && probability >= 52);
  return { probability, fairOdds, confidence, summary, reasons, risks, keep };
}

function reconcile(row: EngineRow): EngineRow {
  if (!row.fairOdds) return row;
  const fromFair = clampProb(1 / row.fairOdds) * 100;
  if (Math.abs(fromFair - row.probability) > 14) return { ...row, confidence: "low" };
  return row;
}

function matchRows(picks: TicketPick[], answer: string): EngineReading | null {
  let parsed: { picks?: unknown };
  try {
    parsed = stripJson(answer.replace(/\[\[\d+(?:\s*,\s*\d+)*\]\]/g, "")) as { picks?: unknown };
  } catch {
    return null;
  }
  const rows = Array.isArray(parsed.picks) ? parsed.picks : [];
  if (!rows.length) return null;
  const out: EngineReading = new Map();
  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i]!;
    const rec =
      rows.find((r) => r && typeof r === "object" && Number((r as { i?: number }).i) === i + 1) ??
      rows[i];
    if (!rec || typeof rec !== "object") continue;
    const row = rowFrom(rec as Record<string, unknown>);
    if (!row) continue;
    out.set(pick.id, reconcile(row));
  }
  return out.size ? out : null;
}

function matchProse(picks: TicketPick[], answer: string): EngineReading | null {
  const out: EngineReading = new Map();
  const lines = answer.split(/\n+/);
  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i]!;
    const needle = `${i + 1}`;
    const hit =
      lines.find((ln) => new RegExp(`(?:^|\b)${needle}[\.\):\s]`).test(ln)) ??
      lines.find((ln) => ln.toLowerCase().includes(pick.home.slice(0, 8).toLowerCase()));
    if (!hit) continue;
    const m = hit.match(/(\d{1,2}|100)\s*%/);
    const keep = /\b(keep|back|solid|strong|yes)\b/i.test(hit) && !/\b(drop|avoid|skip|no)\b/i.test(hit);
    const probability = m
      ? Math.min(97, Math.max(3, Number(m[1])))
      : keep
        ? 60
        : 40;
    out.set(pick.id, {
      probability,
      confidence: keep ? "medium" : "low",
      summary: clip(hit, 120),
      reasons: [],
      risks: [],
      keep,
    });
  }
  return out.size ? out : null;
}

function tagReading(reading: EngineReading, engine: string): Map<string, EngineRow & { engine: string }> {
  const out = new Map<string, EngineRow & { engine: string }>();
  for (const [id, row] of reading) out.set(id, { ...row, engine });
  return out;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type Reading = Map<string, EngineRow & { engine: string }>;

async function readChunk(picks: TicketPick[]): Promise<Reading> {
  const lines = pickLines(picks);
  const user = [
    "Analyse each selection from form and H2H. JSON only.",
    lines,
  ].join("\n");

  const answer = await withTimeout(youAnswer(`${SYSTEM}\n\n${user}`, 24_000), 26_000);
  if (!answer) return new Map();
  const reading = matchRows(picks, answer) ?? matchProse(picks, answer);
  if (!reading?.size) return new Map();
  return tagReading(reading, "you.com");
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

export type ScoredPick = {
  id: string;
  sport: SportKind;
  home: string;
  away: string;
  market: string;
  selection: string;
  league: string;
  probability: number;
  confidence: "high" | "medium" | "low";
  summary: string;
  reasons: string[];
  risks: string[];
  verdict: "keep" | "drop" | "ignore";
  marketProb: number | null;
  modelProb: number | null;
  fairOdds: number | null;
  edge: number | null;
  ev: number | null;
  engine: string | null;
  agreement: number | null;
};

async function readAll(picks: TicketPick[]): Promise<Reading> {
  const playable = picks.filter((p) => p.sport !== "other");
  if (!playable.length) return new Map();
  const groups = chunk(playable, 2);
  const parts = await mapPool(groups, 1, (group) => readChunk(group));
  const merged: Reading = new Map();
  for (const part of parts) for (const [id, row] of part) merged.set(id, row);
  return merged;
}

function rowsFor(reading: Reading, pick: TicketPick): Array<EngineRow & { engine: string }> {
  const exact = reading.get(pick.id);
  const out: Array<EngineRow & { engine: string }> = [];
  if (exact) out.push(exact);
  for (const [key, row] of reading) {
    if (key.startsWith(`${pick.id}#`)) out.push(row);
  }
  return out;
}

export async function scorePick(
  pick: TicketPick,
  reading: Reading,
  calibration: Platt,
): Promise<ScoredPick> {
  const marketP = marketProbOf(pick);
  const rows = rowsFor(reading, pick);
  const engines: EngineScore[] = rows.map((r) => ({
    engine: r.engine,
    probability: r.probability,
    confidence: r.confidence,
  }));
  const consensus = ensembleScores(engines);

  const base: ScoredPick = {
    ...pick,
    probability: 50,
    confidence: "low",
    summary: "Not enough analysis on this pick.",
    reasons: [],
    risks: [],
    verdict: "drop",
    marketProb: marketP == null ? null : Math.round(marketP * 100),
    modelProb: null,
    fairOdds: null,
    edge: null,
    ev: null,
    engine: consensus ? rows.map((r) => r.engine).join("+") : null,
    agreement: consensus ? Math.round((1 - consensus.disagreement) * 100) : null,
  };

  if (pick.sport === "other") {
    return {
      ...base,
      probability: 0,
      confidence: "high",
      summary: "Not football, basketball or tennis.",
      risks: ["Sport is outside the desk."],
      verdict: "ignore",
    };
  }

  // Pure analysis path: trust model view, light market blend only for edge display.
  let final01: number;
  let model01: number | null = null;
  let confidence: "high" | "medium" | "low" = "low";
  const reasons: string[] = [];
  const risks: string[] = [];
  let summary = base.summary;
  let verdict: "keep" | "drop" | "ignore" = "drop";

  if (consensus) {
    model01 = consensus.probability;
    // Prefer analysis over market — only 20% market pull when we have research.
    final01 =
      marketP != null
        ? blendWithMarket(model01, marketP, confidenceWeight(consensus.confidence) * 0.35)
        : model01;
    confidence = consensus.confidence;
    for (const row of rows) {
      for (const r of row.reasons) if (!reasons.includes(r)) reasons.push(r);
      for (const r of row.risks) if (!risks.includes(r)) risks.push(r);
      if (row.keep) verdict = "keep";
    }
    if (verdict !== "keep" && final01 >= 0.55 && confidence !== "low") verdict = "keep";
    summary = rows.find((r) => r.summary)?.summary || summary;
  } else if (marketP != null) {
    final01 = marketP;
    confidence = "low";
    summary = "No analysis returned for this leg.";
    risks.push("No live form/H2H read.");
  } else {
    final01 = 0.5;
    confidence = "low";
    summary = "No analysis and no price.";
    risks.push("Nothing to score this pick with.");
  }

  final01 = applyPlatt(final01, calibration);

  const edgePts = marketP == null ? null : Math.round((final01 - marketP) * 100);
  const ev = evPerStake(final01, pick.odds);

  return {
    ...base,
    probability: Math.round(final01 * 100),
    confidence,
    summary: clip(summary, 220),
    reasons: reasons.slice(0, 4),
    risks: risks.slice(0, 3),
    verdict,
    modelProb: model01 == null ? null : Math.round(model01 * 100),
    marketProb: marketP == null ? null : Math.round(marketP * 100),
    fairOdds: fairOddsFromProb(final01),
    edge: edgePts,
    ev: ev == null ? null : Math.round(ev * 1000) / 1000,
  };
}

export async function scorePicks(
  picks: TicketPick[],
  calibration?: Platt,
): Promise<{ picks: ScoredPick[]; engines: string[] }> {
  const cal = calibration ?? (await loadCalibration());
  const reading = await readAll(picks);
  const engines = new Set<string>();
  for (const row of reading.values()) engines.add(row.engine);
  const scored = await Promise.all(picks.map((pick) => scorePick(pick, reading, cal)));
  return { picks: scored, engines: [...engines] };
}

function toAnalyzed(picks: ScoredPick[], threshold: number) {
  const analyzed = picks as AnalyzedPick[];
  const split = applyThreshold(analyzed, threshold);
  const tagged = new Map(
    [...split.kept, ...split.dropped, ...split.ignored].map((p) => [p.id, p]),
  );
  return {
    picks: analyzed.map((p) => tagged.get(p.id) ?? p),
    threshold,
    ...split,
    combinedKeepChance: combinedChance(split.kept),
  };
}

export async function analyzePicks(picks: TicketPick[], threshold = 45) {
  await refreshKeys();
  const { picks: scored, engines } = await scorePicks(picks);
  const merged = toAnalyzed(scored, clampThreshold(threshold));
  const engineLabel = engines.length ? engines.join(" + ") : "no analysis";
  return {
    desk: `🧠 ${engineLabel} · form/H2H read of ${picks.length} selection${picks.length === 1 ? "" : "s"}.`,
    ...merged,
  };
}

export async function researchScores<T extends TicketPick>(
  picks: T[],
  calibration?: Platt,
): Promise<{
  scored: (T & {
    probability: number;
    confidence: string;
    edge: number | null;
    verdict?: string;
    summary?: string;
  })[];
  researched: boolean;
}> {
  if (!picks.length) return { scored: [], researched: false };
  const cal = calibration ?? (await loadCalibration());
  const sample = picks.slice(0, 8);
  const { picks: scored, engines } = await scorePicks(sample, cal);
  const byId = new Map(scored.map((row) => [row.id, row]));
  const merged = picks.map((pick) => {
    const row = byId.get(pick.id);
    if (!row) {
      return {
        ...pick,
        probability: 40,
        confidence: "low",
        edge: null,
        verdict: "drop",
      } as T & {
        probability: number;
        confidence: string;
        edge: number | null;
        verdict?: string;
        summary?: string;
      };
    }
    return {
      ...pick,
      probability: row.probability,
      confidence: row.confidence,
      edge: row.edge,
      verdict: row.verdict,
      summary: row.summary,
    } as T & {
      probability: number;
      confidence: string;
      edge: number | null;
      verdict?: string;
      summary?: string;
    };
  });
  return { scored: merged, researched: engines.length > 0 };
}

const DESK_CLOSED = "The website desk is closed. Use t.me/Slipcut_bot.";

export const loadTicket = createServerFn({ method: "POST" })
  .validator((input: { code?: string; country?: string; text?: string }) => input)
  .handler(async (): Promise<
    { ok: true; picks: TicketPick[]; shareCode?: string } | { ok: false; error: string }
  > => {
    return { ok: false, error: DESK_CLOSED };
  });

export const cutSlip = createServerFn({ method: "POST" })
  .validator((input: CutInput) => input)
  .handler(async (): Promise<CutResponse> => {
    return { ok: false, error: DESK_CLOSED };
  });

export const bookSlip = createServerFn({ method: "POST" })
  .validator((input: { picks: TicketPick[]; country?: string }) => input)
  .handler(async (): Promise<
    { ok: true; shareCode: string; shareURL: string; unavailable: number } | { ok: false; error: string }
  > => {
    return { ok: false, error: DESK_CLOSED };
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
