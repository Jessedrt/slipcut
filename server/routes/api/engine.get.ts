import { defineHandler } from "nitro";
import { loadAccuracy } from "../../../src/lib/accuracy";
import {
  ENGINE_LADDER,
  todayEngineCards,
  type EngineSport,
} from "../../../src/lib/engine";

function parseEngineSport(req: Request): EngineSport | "all" {
  try {
    const value = new URL(req.url).searchParams.get("sport");
    return value === "football" || value === "basketball" ? value : "all";
  } catch {
    return "all";
  }
}

function scopedAccuracy(
  accuracy: Awaited<ReturnType<typeof loadAccuracy>>,
  sport: EngineSport | "all",
) {
  if (sport === "all") {
    return {
      average: accuracy.average,
      sampleCount: accuracy.sampleCount,
    };
  }

  let won = 0;
  let lost = 0;
  for (const [key, group] of Object.entries(accuracy.groups)) {
    if (!key.startsWith(`${sport}|`)) continue;
    won += group.won;
    lost += group.lost;
  }
  const sampleCount = won + lost;
  return {
    average: sampleCount > 0 ? won / sampleCount : 0,
    sampleCount,
  };
}

export default defineHandler(async (event) => {
  const sport = parseEngineSport(event.req);
  try {
    const accuracy = await loadAccuracy();
    const scoped = scopedAccuracy(accuracy, sport);
    const cards = await todayEngineCards(sport);

    if ("error" in cards) {
      return Response.json({
        ok: false,
        error: cards.error,
        sport,
        cards: [],
        hitRate: scoped.sampleCount > 0 ? scoped.average : null,
        sampleCount: scoped.sampleCount,
        qualifyingBar: scoped.sampleCount > 0 ? scoped.average : null,
        average: scoped.average,
        ladder: ENGINE_LADDER,
      });
    }

    return Response.json({
      ok: true,
      sport,
      cards,
      hitRate: scoped.sampleCount > 0 ? scoped.average : null,
      sampleCount: scoped.sampleCount,
      qualifyingBar: scoped.sampleCount > 0 ? scoped.average : null,
      average: scoped.average,
      ladder: ENGINE_LADDER,
    });
  } catch (error) {
    console.error(
      "[engine.public] failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json(
      {
        ok: false,
        error: "Engine data is temporarily unavailable.",
        sport,
        cards: [],
        hitRate: null,
        sampleCount: 0,
        qualifyingBar: null,
        average: 0,
        ladder: ENGINE_LADDER,
      },
      { status: 200 },
    );
  }
});
