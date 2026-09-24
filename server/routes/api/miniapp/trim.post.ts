import { defineHandler } from "nitro";
import { riskTrimToOdds } from "../../../../src/lib/workbench";
import { authenticateMiniAppRequest } from "../../../../src/lib/telegram-miniapp-auth";
import type { AnalyzedPick } from "../../../../src/lib/types";

export default defineHandler(async (event) => {
  const auth = authenticateMiniAppRequest(event.req);
  if (!auth.ok) return Response.json(auth, { status: 401 });

  let body: { picks?: unknown; targetOdds?: unknown };
  try {
    body = (await event.req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, code: "invalid_request", error: "Invalid JSON." }, { status: 400 });
  }
  if (!Array.isArray(body.picks) || !body.picks.length) {
    return Response.json({ ok: false, code: "invalid_request", error: "Selections are required." }, { status: 400 });
  }
  const targetOdds = Number(body.targetOdds);
  if (!Number.isFinite(targetOdds) || targetOdds < 1.2 || targetOdds > 1000) {
    return Response.json({ ok: false, code: "invalid_request", error: "Target odds must be between 1.2 and 1000." }, { status: 400 });
  }

  const result = riskTrimToOdds(body.picks as AnalyzedPick[], targetOdds);
  return Response.json({ ok: true, ...result, targetOdds });
});
