import { defineHandler } from "nitro";
import { analyzePicks } from "../../../../src/lib/analyze";
import {
  getBookmakerAdapter,
  isBookmakerId,
} from "../../../../src/lib/bookmakers/adapters";
import { normalizePick } from "../../../../src/lib/bookmakers/normalize";
import { applyThreshold, combinedChance } from "../../../../src/lib/format";
import { authenticateMiniAppRequest } from "../../../../src/lib/telegram-miniapp-auth";
import type { AnalyzedPick, TicketPick } from "../../../../src/lib/types";

const ANALYSIS_BUDGET_MS = 28_000;

function fastMarketAnalysis(picks: TicketPick[], threshold: number) {
  const analyzed: AnalyzedPick[] = picks.map((pick) => {
    const odds = Number(pick.odds);
    const hasOdds = Number.isFinite(odds) && odds > 1;
    const probability = hasOdds
      ? Math.min(95, Math.max(4, Math.round(100 / odds)))
      : 50;
    return {
      ...pick,
      probability,
      confidence: "low",
      summary: hasOdds
        ? "Fast market-implied fallback used while live research was taking too long."
        : "Fast fallback used; this selection had no usable live price.",
      reasons: hasOdds ? [`Current listed odds ${odds.toFixed(2)}`] : [],
      risks: ["Deep live research did not finish inside the Mini App time budget."],
      verdict: "drop",
    };
  });
  const split = applyThreshold(analyzed, threshold);
  const tagged = new Map(
    [...split.kept, ...split.dropped, ...split.ignored].map((pick) => [pick.id, pick]),
  );
  return {
    desk: "Fast market-implied fallback. Retry later for the deeper live-research read.",
    picks: analyzed.map((pick) => tagged.get(pick.id) ?? pick),
    threshold,
    ...split,
    combinedKeepChance: combinedChance(split.kept),
  };
}

async function analyzeWithinBudget(picks: TicketPick[], threshold: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ANALYSIS_BUDGET_MS);
    });
    const deep = await Promise.race([analyzePicks(picks, threshold), timeout]);
    if (deep) return deep;
    console.warn("[miniapp.cut] deep analysis exceeded time budget; using fast fallback");
    return fastMarketAnalysis(picks, threshold);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export default defineHandler(async (event) => {
  const auth = authenticateMiniAppRequest(event.req);
  if (!auth.ok) return Response.json(auth, { status: 401 });
  let body: {
    code?: unknown;
    threshold?: unknown;
    bookmaker?: unknown;
    picks?: unknown;
    country?: unknown;
  };
  try {
    body = (await event.req.json()) as typeof body;
  } catch {
    return Response.json(
      { ok: false, code: "invalid_request", error: "The request body is not valid JSON." },
      { status: 400 },
    );
  }

  const threshold = Math.max(40, Math.min(80, Math.round(Number(body.threshold) || 45)));
  let picks: TicketPick[];
  let shareCode: string | undefined;
  let sourceBookmaker = isBookmakerId(body.bookmaker) ? body.bookmaker : "sportybet";
  let warnings: string[] = [];

  if (Array.isArray(body.picks)) {
    picks = (body.picks as TicketPick[]).slice(0, 40).map(normalizePick);
    if (!picks.length) {
      return Response.json(
        { ok: false, code: "invalid_request", error: "Selections are required." },
        { status: 400 },
      );
    }
  } else {
    const code = String(body.code ?? "").trim();
    if (!/^[A-Za-z0-9_-]{3,64}$/.test(code)) {
      return Response.json(
        { ok: false, code: "invalid_request", error: "Enter a valid booking code." },
        { status: 400 },
      );
    }
    const decoded = await getBookmakerAdapter(sourceBookmaker).decode(
      code,
      typeof body.country === "string" ? body.country : "ng",
    );
    if (!decoded.ok) {
      return Response.json(decoded, {
        status:
          decoded.code === "provider_timeout" || decoded.code === "provider_unavailable"
            ? 503
            : 422,
      });
    }
    picks = decoded.ticket.picks;
    shareCode = decoded.ticket.sourceCode;
    warnings = decoded.ticket.warnings ?? [];
  }

  try {
    const analysis = await analyzeWithinBudget(picks, threshold);
    return Response.json({
      ok: true,
      shareCode,
      sourceBookmaker,
      warnings,
      ...analysis,
    });
  } catch (error) {
    console.error(
      "[miniapp.cut] analysis failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json({
      ok: true,
      shareCode,
      sourceBookmaker,
      warnings,
      ...fastMarketAnalysis(picks, threshold),
    });
  }
});
