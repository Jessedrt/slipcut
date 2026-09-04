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
import { seekaiReady, seekChat } from "./seekai.ts";
import { geminiReady, geminiChat } from "./gemini.ts";
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

/** De-vigged market probability for a pick, or null when there is no price. */
export function marketProbOf(pick: TicketPick): number | null {
  return fairProbFromOdds(pick.odds, familyOf(pick), pick.sport);
}

// ---- prompts -------------------------------------------------------------

const SYSTEM = [
  "You are a sports-book pricing analyst, not a tipster. Your job is to say what each selection is really worth.",
  "",
  "Think about: league quality and how predictable it is, team style, recent form, injuries and rotation, rest and travel, head-to-head, motivation, and whether this specific MARKET fits this specific match.",
  "",
  "Reply with JSON only, one object per selection:",
  '{"picks":[{"i":<index from the list>,"probability":<true chance 0-100>,"fair_odds":<decimal price you believe is fair, e.g. 1.72>,"confidence":"high|medium|low","summary":"one short line","reasons":["...","..."],"risks":["..."]}]}',
  "",
  "Rules:",
  "- The price in the list is the BOOKMAKER price and it includes their margin. Read it as context, never just invert it. Form your own view.",
  "- probability and fair_odds must agree: fair_odds is about 100 / probability.",
  "- 50 means a coin flip. Only go above 68 if you would put your own money on it. Big favourites in chaotic leagues still bust.",
  "- If you do not have current information on a match, set confidence to \"low\" and keep probability near the market price.",
  "- Judge the selection as it stands: a weak pick is a weak pick, but do not refuse to score it — score it low and say why.",
  "- No preamble, no markdown, no commentary outside the JSON.",
].join("\n");

function pickLines(picks: TicketPick[]): string {
  return picks
    .map((p, i) => {
      const when = p.kickoff ? new Date(p.kickoff).toISOString().slice(0, 16) : "tba";
      return [
        `${i + 1}.`,
        p.sport,
        `| ${clip(p.league, 30)}`,
        `| ${clip(p.home, 34)} vs ${clip(p.away, 34)}`,
        `| ${clip(p.market, 30)} → ${clip(p.selection, 30)}`,
        `| book ${p.odds ?? "?"}`,
        `| KO ${when}`,
      ].join(" ");
    })
    .join("\n");
}

async function liveBrief(picks: TicketPick[]): Promise<string> {
  if (!picks.length) return "";
  const q = picks
    .slice(0, 6)
    .map(
      (p) =>
        `${clip(p.home, 24)} vs ${clip(p.away, 24)} ${clip(p.league, 18)} ${clip(p.market, 18)} ${clip(p.selection, 16)}`,
    )
    .join(" | ");
  try {
    return clip(
      await youAnswer(
        `For each match give: last 5 results both teams, injuries/absences, H2H goals or pace, and whether the listed selection is justified. Be specific, no odds. ${q}`,
        10_000,
      ),
      1400,
    );
  } catch {
    return "";
  }
}

// ---- engine plumbing -----------------------------------------------------

type EngineRow = {
  probability: number;
  fairOdds?: number;
  confidence: "high" | "medium" | "low";
  summary: string;
  reasons: string[];
  risks: string[];
};

/** One engine's reading of each pick, keyed by pick id. */
type EngineReading = Map<string, EngineRow>;

const CONFIDENCES = new Set(["high", "medium", "low"]);

function rowFrom(rec: Record<string, unknown>): EngineRow | null {
  const raw = Number(rec.probability);
  const fair = Number(rec.fair_odds ?? rec.fairOdds);
  let probability = Number.isFinite(raw) ? raw : Number.isFinite(fair) && fair > 1 ? 100 / fair : NaN;
  if (!Number.isFinite(probability)) {
    // Last resort: a lone "62%" somewhere in the text.
    const pct = String(rec.summary ?? "").match(/\b(\d{1,2}|100)\s*%/);
    probability = pct ? Number(pct[1]) : NaN;
  }
  if (!Number.isFinite(probability)) return null;
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
  return { probability, fairOdds, confidence, summary, reasons, risks };
}

/**
 * An engine that reports a probability wildly inconsistent with its own fair
 * price is not reporting a considered view. Treat that as low confidence so
 * the blend leans back on the market.
 */
function reconcile(row: EngineRow): EngineRow {
  if (!row.fairOdds) return row;
  const fromFair = clampProb(1 / row.fairOdds) * 100;
  if (Math.abs(fromFair - row.probability) > 14) {
    return { ...row, confidence: "low" };
  }
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
      rows.find(
        (r) => r && typeof r === "object" && Number((r as { i?: number }).i) === i + 1,
      ) ?? rows[i];
    if (!rec || typeof rec !== "object") continue;
    const row = rowFrom(rec as Record<string, unknown>);
    if (!row) continue;
    out.set(pick.id, reconcile({ ...row, confidence: row.confidence }));
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

async function readChunk(picks: TicketPick[], brief: string): Promise<Reading> {
  const lines = pickLines(picks);
  const user = [
    brief ? `LIVE RESEARCH (may be incomplete — verify, do not repeat it blindly):\n${brief}` : "",
    "Score each selection independently.",
    "Do not copy the same verdict across games; each matchup stands on its own.",
    "",
    lines,
  ]
    .filter(Boolean)
    .join("\n");

  const jobs: Promise<Reading | null>[] = [];
  if (geminiReady()) {
    jobs.push(
      withTimeout(geminiChat(SYSTEM, user, 28_000), 30_000).then((answer) =>
        answer ? tagReading(matchRows(picks, answer) ?? new Map(), "gemini") : null,
      ),
    );
  }
  if (seekaiReady()) {
    jobs.push(
      withTimeout(
        seekChat(
          [
            { role: "system", content: SYSTEM },
            { role: "user", content: user },
          ],
          28_000,
        ),
        30_000,
      ).then((answer) => (answer ? tagReading(matchRows(picks, answer) ?? new Map(), "opus") : null)),
    );
  }
  jobs.push(
    withTimeout(youAnswer(`${SYSTEM}\n\n${user}`, 14_000), 16_000).then((answer) =>
      answer ? tagReading(matchRows(picks, answer) ?? new Map(), "you.com") : null,
    ),
  );

  const settled = await Promise.all(jobs);
  const merged: Reading = new Map();
  for (const reading of settled) {
    if (!reading) continue;
    for (const [id, row] of reading) {
      if (!merged.has(id)) merged.set(id, row);
      else merged.set(id + `#${row.engine}`, row);
    }
  }
  return merged;
}

async function scoreChunk(picks: TicketPick[]): Promise<Reading> {
  const brief = await liveBrief(picks);
  return readChunk(picks, brief);
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

// ---- merge ---------------------------------------------------------------

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
  const groups = chunk(playable, 3);
  const parts = await mapPool(groups, 3, (group) => scoreChunk(group));
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

/**
 * Turn a pick plus whatever research came back into one honest probability.
 *
 * Pipeline: research engines → ensemble (logit mean, weighted by confidence)
 * → blend against the de-vigged market price, weighted by how much the
 * ensemble can be trusted → Platt calibration learned from settled legs.
 * With no research we simply quote the market, which beats guessing.
 */
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
    summary: "Not enough to score this pick cleanly.",
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

  let final01: number;
  let model01: number | null = null;
  let confidence: "high" | "medium" | "low" = "low";
  const reasons: string[] = [];
  const risks: string[] = [];
  let summary = base.summary;

  if (consensus && marketP != null) {
    model01 = consensus.probability;
    // Disagreement between engines is evidence of ignorance: trust it less.
    const trust = confidenceWeight(consensus.confidence) * (1 - 0.5 * consensus.disagreement);
    final01 = blendWithMarket(model01, marketP, trust);
    confidence = consensus.confidence;
    for (const row of rows) {
      for (const r of row.reasons) if (!reasons.includes(r)) reasons.push(r);
      for (const r of row.risks) if (!risks.includes(r)) risks.push(r);
    }
    summary =
      rows.find((r) => r.summary)?.summary ||
      `Rated ${Math.round(final01 * 100)}% against a market price of ${Math.round(marketP * 100)}%.`;
  } else if (consensus) {
    model01 = consensus.probability;
    final01 = consensus.probability;
    confidence = consensus.confidence;
    for (const row of rows) {
      for (const r of row.reasons) if (!reasons.includes(r)) reasons.push(r);
      for (const r of row.risks) if (!risks.includes(r)) risks.push(r);
    }
    summary = rows.find((r) => r.summary)?.summary || summary;
    risks.push("No price on this leg — the market could not anchor the read.");
  } else if (marketP != null) {
    final01 = marketP;
    confidence = "low";
    summary = `No research on this one, so this is the book's own price with the margin taken off.`;
    risks.push("Desk read only — no live research behind this number.");
  } else {
    final01 = 0.5;
    confidence = "low";
    summary = "No price and no research — treating it as a coin flip.";
    risks.push("Nothing to score this pick with.");
  }

  final01 = applyPlatt(final01, calibration);

  const edgePts = marketP == null ? null : Math.round((final01 - marketP) * 100);
  const ev = evPerStake(final01, pick.odds);
  if (pick.odds && pick.odds > 1) {
    if (edgePts != null && edgePts >= 4) {
      reasons.unshift(`Value: desk ${Math.round(final01 * 100)}% vs market ${Math.round(marketP! * 100)}%.`);
    } else if (edgePts != null && edgePts <= -4) {
      risks.unshift(`Short price: desk ${Math.round(final01 * 100)}% vs market ${Math.round(marketP! * 100)}%.`);
    }
  }

  return {
    ...base,
    probability: Math.round(final01 * 100),
    confidence,
    summary: clip(summary, 220),
    reasons: reasons.slice(0, 4),
    risks: risks.slice(0, 3),
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

/** Back-compat entry point used by the study loop and the (closed) web desk. */
export async function analyzePicks(picks: TicketPick[], threshold = 45) {
  await refreshKeys();
  const { picks: scored, engines } = await scorePicks(picks);
  const merged = toAnalyzed(scored, clampThreshold(threshold));
  const engineLabel = engines.length ? engines.join(" + ") : "market only";
  return {
    desk: `🧠 ${engineLabel} · market-anchored read of ${picks.length} selection${picks.length === 1 ? "" : "s"}.`,
    ...merged,
  };
}

/**
 * Score a pool for the cook pipeline: returns winning-chance-style
 * probabilities (0-100) ready for the slip builder.
 */
export async function researchScores<T extends TicketPick>(
  picks: T[],
  calibration?: Platt,
): Promise<{ scored: (T & { probability: number; confidence: string; edge: number | null })[]; researched: boolean }> {
  if (!picks.length) return { scored: [], researched: false };
  const cal = calibration ?? (await loadCalibration());
  const sample = picks.slice(0, 18);
  const { picks: scored, engines } = await scorePicks(sample, cal);
  const byId = new Map(scored.map((row) => [row.id, row]));
  const merged = picks.map((pick) => {
    const row = byId.get(pick.id);
    if (!row) {
      const marketP = marketProbOf(pick);
      return {
        ...pick,
        probability: Math.round((marketP ?? 0.5) * 100),
        confidence: "low",
        edge: null,
      } as T & { probability: number; confidence: string; edge: number | null };
    }
    return {
      ...pick,
      probability: row.probability,
      confidence: row.confidence,
      edge: row.edge,
    } as T & { probability: number; confidence: string; edge: number | null };
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
