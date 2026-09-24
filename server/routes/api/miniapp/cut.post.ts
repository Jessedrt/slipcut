import { defineHandler } from "nitro";
import { analyzePicks } from "../../../../src/lib/analyze";
import {
  getBookmakerAdapter,
  isBookmakerId,
} from "../../../../src/lib/bookmakers/adapters";
import { normalizePick } from "../../../../src/lib/bookmakers/normalize";
import { authenticateMiniAppRequest } from "../../../../src/lib/telegram-miniapp-auth";
import type { TicketPick } from "../../../../src/lib/types";

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
    const analysis = await analyzePicks(picks, threshold);
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
    return Response.json(
      { ok: false, code: "analysis_failed", error: "Slip analysis failed. No code was created." },
      { status: 500 },
    );
  }
});
