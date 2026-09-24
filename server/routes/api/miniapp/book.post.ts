import { defineHandler } from "nitro";
import { createHash } from "node:crypto";
import { defaultBookDependencies, mintReviewedSlip } from "../../../../src/lib/book-slip";
import { runIdempotent } from "../../../../src/lib/booking-idempotency";
import { recordMiniAppSlip } from "../../../../src/lib/miniapp-history";
import { authenticateMiniAppRequest } from "../../../../src/lib/telegram-miniapp-auth";
import type { TicketPick } from "../../../../src/lib/types";

export default defineHandler(async (event) => {
  const auth = authenticateMiniAppRequest(event.req);
  if (!auth.ok) return Response.json(auth, { status: 401 });
  let body: { picks?: unknown; requestId?: unknown };
  try {
    body = (await event.req.json()) as typeof body;
  } catch {
    return Response.json(
      { ok: false, code: "invalid_request", error: "The request body is not valid JSON." },
      { status: 400 },
    );
  }
  if (!Array.isArray(body.picks)) {
    return Response.json(
      { ok: false, code: "invalid_request", error: "Selections are required." },
      { status: 400 },
    );
  }
  if (body.picks.length < 1 || body.picks.length > 15) {
    return Response.json(
      {
        ok: false,
        code: "invalid_request",
        error: "Choose between 1 and 15 selections before creating a code.",
      },
      { status: 400 },
    );
  }
  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
    return Response.json(
      { ok: false, code: "invalid_request", error: "A valid booking request ID is required." },
      { status: 400 },
    );
  }
  const picks = body.picks as TicketPick[];
  const requestHash = createHash("sha256").update(JSON.stringify(picks)).digest("hex");
  const userId = String(auth.auth.user.id);
  const result = await runIdempotent(userId, requestId, requestHash, async () => {
    const booked = await mintReviewedSlip(picks, "ng", defaultBookDependencies, {
      acceptOddsChanges: false,
    });
    if (!booked.ok) return booked;

    const sports = [...new Set(booked.picks.map((pick) => pick.sport))];
    let historyStored = false;
    try {
      historyStored = await recordMiniAppSlip({
        telegramUserId: userId,
        bookingCode: booked.shareCode,
        sport: sports.length === 1 ? (sports[0] ?? "unknown") : "mixed",
        combinedOdds: booked.combinedOdds,
        picks: booked.picks,
      });
    } catch (error) {
      console.error(
        "[miniapp.history] write failed:",
        error instanceof Error ? error.message : "unknown error",
      );
    }
    return { ...booked, historyStored };
  });
  if (!result.ok) {
    return Response.json(result, {
      status:
        result.code === "selection_unavailable" ||
        result.code === "odds_changed" ||
        result.code === "request_in_progress"
          ? 409
          : result.code === "provider_timeout" || result.code === "provider_unavailable"
            ? 503
            : 422,
    });
  }
  return Response.json(result);
});
