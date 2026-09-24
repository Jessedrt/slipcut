import { defineHandler } from "nitro";
import { buildSlip, validateBuildRequest } from "../../../../src/lib/build-slip";
import { authenticateMiniAppRequest } from "../../../../src/lib/telegram-miniapp-auth";

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
  const result = await buildSlip(request.value);
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
