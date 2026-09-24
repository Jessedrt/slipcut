import { defineHandler } from "nitro";
import { predictMatch } from "../../../../src/lib/prediction";
import { authenticateMiniAppRequest } from "../../../../src/lib/telegram-miniapp-auth";
import type { BookSport, TicketPick } from "../../../../src/lib/types";

function isSport(value: unknown): value is BookSport {
  return value === "football" || value === "basketball" || value === "tennis" || value === "handball";
}

export default defineHandler(async (event) => {
  const auth = authenticateMiniAppRequest(event.req);
  if (!auth.ok) return Response.json(auth, { status: 401 });

  let body: {
    sport?: unknown;
    home?: unknown;
    away?: unknown;
    league?: unknown;
    kickoff?: unknown;
    options?: unknown;
  };
  try {
    body = (await event.req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, code: "invalid_request", error: "Invalid JSON." }, { status: 400 });
  }

  const home = String(body.home ?? "").trim();
  const away = String(body.away ?? "").trim();
  if (!isSport(body.sport) || !home || !away) {
    return Response.json(
      { ok: false, code: "invalid_request", error: "Sport, home and away are required." },
      { status: 400 },
    );
  }

  try {
    const prediction = await predictMatch({
      sport: body.sport,
      home,
      away,
      league: typeof body.league === "string" ? body.league : undefined,
      kickoff: Number.isFinite(Number(body.kickoff)) ? Number(body.kickoff) : undefined,
      options: Array.isArray(body.options) ? (body.options as TicketPick[]) : undefined,
    });
    return Response.json({ ok: true, prediction });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "prediction_failed",
        error: error instanceof Error ? error.message : "Prediction failed.",
      },
      { status: 422 },
    );
  }
});
