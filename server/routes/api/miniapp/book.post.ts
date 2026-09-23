import { defineHandler } from "nitro";
import { mintReviewedSlip } from "../../../../src/lib/book-slip";
import { recordMiniAppSlip } from "../../../../src/lib/miniapp-history";
import { authenticateMiniAppRequest } from "../../../../src/lib/telegram-miniapp-auth";
import type { TicketPick } from "../../../../src/lib/types";

export default defineHandler(async (event) => {
  const auth = authenticateMiniAppRequest(event.req);
  if (!auth.ok) return Response.json(auth, { status: 401 });
  let body: { picks?: unknown };
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
  const result = await mintReviewedSlip(body.picks as TicketPick[], "ng");
  if (!result.ok) {
    return Response.json(result, {
      status: result.code === "selection_unavailable" ? 409 : 422,
    });
  }
  const sports = [...new Set(result.picks.map((pick) => pick.sport))];
  let historyStored = false;
  try {
    historyStored = await recordMiniAppSlip({
      telegramUserId: String(auth.auth.user.id),
      bookingCode: result.shareCode,
      sport: sports.length === 1 ? sports[0] ?? "unknown" : "mixed",
      combinedOdds: result.combinedOdds,
      picks: result.picks,
    });
  } catch (error) {
    console.error(
      "[miniapp.history] write failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
  return Response.json({ ...result, historyStored });
});
