import { defineHandler } from "nitro";
import { mintLongshotCard, type LongshotSport } from "../../../../src/lib/longshot";

function parseSport(value: unknown): LongshotSport | null {
  return value === "football" || value === "basketball" ? value : null;
}

export default defineHandler(async (event) => {
  try {
    const body = (await event.req.json()) as { sport?: unknown; cardId?: unknown };
    const sport = parseSport(body?.sport);
    const cardId = typeof body?.cardId === "string" ? body.cardId.trim() : "";
    if (!sport || !cardId) {
      return Response.json(
        { ok: false, error: "A valid sport and Longshot card are required." },
        { status: 400 },
      );
    }

    const card = await mintLongshotCard(sport, cardId);
    if ("error" in card) {
      return Response.json({ ok: false, error: card.error }, { status: 409 });
    }
    return Response.json({ ok: true, sport, card });
  } catch (error) {
    console.error(
      "[longshot.book] failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json(
      { ok: false, error: "Longshot booking is temporarily unavailable." },
      { status: 500 },
    );
  }
});
