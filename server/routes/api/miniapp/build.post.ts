import { defineHandler } from "nitro";
import {
  buildSlip,
  validateBuildRequest,
  type BuildDependencies,
  type BuildSlipFailure,
  type BuildSlipResult,
} from "../../../../src/lib/build-slip";
import { researchSelectionEvidence } from "../../../../src/lib/selection-evidence";
import { listUpcomingPicks } from "../../../../src/lib/sportybet";
import { loadRecord } from "../../../../src/lib/track-record";
import { authenticateMiniAppRequest } from "../../../../src/lib/telegram-miniapp-auth";
import { recordRecommendations } from "../../../../src/lib/track-record";

const BUILD_ROUTE_TIMEOUT_MS = 52_000;

async function withBuildDeadline(work: Promise<BuildSlipResult>): Promise<BuildSlipResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<BuildSlipFailure>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              ok: false,
              code: "provider_timeout",
              error: "SlipCut stopped this build because live market analysis took too long. Try again or use Upcoming for a fresh fixture scan.",
              retryable: true,
            }),
          BUILD_ROUTE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export default defineHandler(async (event) => {
  const auth = authenticateMiniAppRequest(event.req);
  if (!auth.ok) return Response.json(auth, { status: 401 });
  let body: unknown;
  try {
    body = await event.req.json();
  } catch {
    return Response.json(
      { ok: false, code: "invalid_request", error: "The request body is not valid JSON." },
      { status: 400 },
    );
  }
  const request = validateBuildRequest(body);
  if (!request.ok) return Response.json(request, { status: 400 });

  const startedAt = Date.now();

  // Football exposes hundreds of market lines per fixture. The normal 42-event
  // scan can therefore spend most of a serverless request hydrating fixtures,
  // then immediately refetch the same fixtures during validation. Aggressive
  // football uses a bounded live scan and reuses those just-hydrated prices for
  // analysis; booking still performs its own final SportyBet validation.
  let dependencies: BuildDependencies | undefined;
  if (request.value.sport === "football" && request.value.risk === "aggressive") {
    const requestedFixtureCount =
      request.value.mode === "games" ? Math.min(18, Math.max(10, request.value.games ?? 10)) : 12;
    dependencies = {
      discover: (sport, _limit, window) =>
        listUpcomingPicks(sport, requestedFixtureCount, window),
      refresh: async (picks) => ({ available: picks, unavailable: [] }),
      evidence: researchSelectionEvidence,
      record: loadRecord,
      analysisTimeoutMs: 18_000,
    };
  }

  const result = await withBuildDeadline(
    dependencies ? buildSlip(request.value, dependencies) : buildSlip(request.value),
  );
  if (result.ok) {
    try {
      await recordRecommendations(result.selections);
    } catch (error) {
      console.error("[slipcut.record] save failed", error instanceof Error ? error.name : "unknown");
    }
  }
  console.info(
    "[miniapp.build]",
    JSON.stringify({
      sport: request.value.sport,
      mode: request.value.mode,
      risk: request.value.risk,
      window: request.value.window,
      ok: result.ok,
      code: result.ok ? "ok" : result.code,
      selected: result.ok ? result.actualGames : 0,
      targetReached: result.ok ? result.targetReached : null,
      durationMs: Date.now() - startedAt,
      analysis: result.analysis,
    }),
  );
  const status = result.ok
    ? 200
    : result.code === "provider_timeout" ||
        result.code === "provider_unavailable" ||
        result.code === "analysis_failed"
      ? 503
      : 422;
  return Response.json(result, { status });
});
