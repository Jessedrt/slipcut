import { defineHandler } from "nitro";
import {
  LONGSHOT_LADDER,
  todayLongshotCards,
  type LongshotSport,
} from "../../../src/lib/longshot";

function parseSport(req: Request): LongshotSport {
  try {
    const value = new URL(req.url).searchParams.get("sport");
    return value === "basketball" ? "basketball" : "football";
  } catch {
    return "football";
  }
}

export default defineHandler(async (event) => {
  const sport = parseSport(event.req);
  try {
    const cards = await todayLongshotCards(sport);
    if ("error" in cards) {
      return Response.json({
        ok: false,
        sport,
        cards: [],
        ladder: LONGSHOT_LADDER,
        windowHours: 48,
        error: cards.error,
      });
    }
    return Response.json({
      ok: true,
      sport,
      cards,
      ladder: LONGSHOT_LADDER,
      windowHours: 48,
      warning:
        "Longshot only uses fixtures starting within the next 48 hours. It is intentionally higher variance; creating a code refreshes the exact SportyBet selections and prices. It is not a win guarantee.",
    });
  } catch (error) {
    console.error(
      "[longshot.public] failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json(
      {
        ok: false,
        sport,
        cards: [],
        ladder: LONGSHOT_LADDER,
        windowHours: 48,
        error: "Longshot data is temporarily unavailable.",
      },
      { status: 200 },
    );
  }
});