import { defineHandler } from "nitro";
import { analyzePicks } from "../../../../src/lib/analyze";
import { loadBookingCode } from "../../../../src/lib/sportybet";
import { authenticateMiniAppRequest } from "../../../../src/lib/telegram-miniapp-auth";

export default defineHandler(async (event) => {
  const auth = authenticateMiniAppRequest(event.req);
  if (!auth.ok) return Response.json(auth, { status: 401 });
  let body: { code?: unknown; threshold?: unknown };
  try {
    body = (await event.req.json()) as typeof body;
  } catch {
    return Response.json(
      { ok: false, code: "invalid_request", error: "The request body is not valid JSON." },
      { status: 400 },
    );
  }
  const code = String(body.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(code)) {
    return Response.json(
      { ok: false, code: "invalid_request", error: "Enter a valid SportyBet booking code." },
      { status: 400 },
    );
  }
  const threshold = Math.max(40, Math.min(80, Math.round(Number(body.threshold) || 45)));
  const loaded = await loadBookingCode(code, "ng");
  if ("error" in loaded) {
    return Response.json(
      { ok: false, code: "provider_rejected", error: loaded.error },
      { status: 422 },
    );
  }
  try {
    const analysis = await analyzePicks(loaded.picks, threshold);
    return Response.json({ ok: true, shareCode: loaded.shareCode, ...analysis });
  } catch (error) {
    console.error(
      "[miniapp.cut] analysis failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json(
      { ok: false, code: "analysis_failed", error: "Slip analysis failed. No code was created." },
      { status: 500 },
    );
  }
});
