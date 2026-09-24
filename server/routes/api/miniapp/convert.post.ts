import { defineHandler } from "nitro";
import { convertBookingCode } from "../../../../src/lib/bookmakers/convert";
import { isBookmakerId } from "../../../../src/lib/bookmakers/adapters";
import { authenticateMiniAppRequest } from "../../../../src/lib/telegram-miniapp-auth";

export default defineHandler(async (event) => {
  const auth = authenticateMiniAppRequest(event.req);
  if (!auth.ok) return Response.json(auth, { status: 401 });

  let body: { code?: unknown; from?: unknown; to?: unknown; fallback?: unknown; country?: unknown };
  try {
    body = (await event.req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, code: "invalid_request", error: "Invalid JSON." }, { status: 400 });
  }

  const code = String(body.code ?? "").trim();
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(code)) {
    return Response.json({ ok: false, code: "invalid_request", error: "Enter a valid booking code." }, { status: 400 });
  }
  if (!isBookmakerId(body.from) || !isBookmakerId(body.to)) {
    return Response.json({ ok: false, code: "invalid_request", error: "Choose a supported source and target bookmaker." }, { status: 400 });
  }

  const result = await convertBookingCode({
    code,
    from: body.from,
    to: body.to,
    country: typeof body.country === "string" ? body.country : "ng",
    fallback: body.fallback === "strict" ? "strict" : "drop-unavailable",
  });
  if (!result.ok) {
    return Response.json(result, {
      status:
        result.code === "provider_timeout" || result.code === "provider_unavailable"
          ? 503
          : result.code === "invalid_code"
            ? 404
            : 422,
    });
  }
  return Response.json(result);
});
