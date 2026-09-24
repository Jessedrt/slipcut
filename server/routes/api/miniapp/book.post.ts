import { createHash } from "node:crypto";
import { defineHandler } from "nitro";
import { mintReviewedSlip, defaultBookDependencies } from "../../../../src/lib/book-slip";
import { runIdempotent } from "../../../../src/lib/booking-idempotency";
import { convertTicket } from "../../../../src/lib/bookmakers/convert";
import { isBookmakerId } from "../../../../src/lib/bookmakers/adapters";
import { normalizeTicket } from "../../../../src/lib/bookmakers/normalize";
import { recordMiniAppSlip } from "../../../../src/lib/miniapp-history";
import { authenticateMiniAppRequest } from "../../../../src/lib/telegram-miniapp-auth";
import type { BookmakerId, TicketPick } from "../../../../src/lib/types";
import { combinedOdds } from "../../../../src/lib/workbench";

export default defineHandler(async (event) => {
  const auth = authenticateMiniAppRequest(event.req);
  if (!auth.ok) return Response.json(auth, { status: 401 });
  let body: { picks?: unknown; requestId?: unknown; bookmaker?: unknown; country?: unknown };
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

  const bookmaker: BookmakerId = isBookmakerId(body.bookmaker) ? body.bookmaker : "sportybet";
  const country = typeof body.country === "string" && body.country.trim() ? body.country.trim() : "ng";
  const picks = body.picks as TicketPick[];
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ bookmaker, country, picks }))
    .digest("hex");
  const userId = String(auth.auth.user.id);

  const result = await runIdempotent(userId, requestId, requestHash, async () => {
    let booked:
      | Awaited<ReturnType<typeof mintReviewedSlip>>
      | {
          ok: true;
          shareCode: string;
          shareURL: string;
          unavailable: 0;
          picks: TicketPick[];
          combinedOdds: number | null;
          warnings: string[];
          bookmaker: BookmakerId;
        };

    if (bookmaker === "sportybet") {
      booked = await mintReviewedSlip(picks, country, defaultBookDependencies, {
        acceptOddsChanges: false,
      });
    } else {
      const converted = await convertTicket(
        normalizeTicket({
          sourceBookmaker: "sportybet",
          picks,
          country,
          currency: country === "ng" ? "NGN" : undefined,
        }),
        bookmaker,
        { country, fallback: "drop-unavailable" },
      );
      if (!converted.ok) {
        return {
          ok: false as const,
          code: converted.code,
          error: converted.error,
        };
      }
      booked = {
        ok: true,
        shareCode: converted.code,
        shareURL: converted.url ?? "",
        unavailable: 0,
        picks: converted.ticket.picks,
        combinedOdds: combinedOdds(converted.ticket.picks),
        warnings: converted.warnings,
        bookmaker,
      };
    }

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
    return {
      ...booked,
      bookmaker,
      warnings: "warnings" in booked ? booked.warnings : [],
      historyStored,
    };
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
