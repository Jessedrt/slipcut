import { defineHandler } from "nitro";
import { loadAccuracy } from "../../../src/lib/accuracy";
import { ENGINE_LADDER, todayEngineCards } from "../../../src/lib/engine";

export default defineHandler(async () => {
  try {
    const accuracy = await loadAccuracy();
    const cards = await todayEngineCards();

    if ("error" in cards) {
      return Response.json({
        ok: false,
        error: cards.error,
        cards: [],
        hitRate: accuracy.sampleCount > 0 ? accuracy.average : null,
        sampleCount: accuracy.sampleCount,
        qualifyingBar: accuracy.sampleCount > 0 ? accuracy.average : null,
        average: accuracy.average,
        ladder: ENGINE_LADDER,
      });
    }

    return Response.json({
      ok: true,
      cards,
      hitRate: accuracy.sampleCount > 0 ? accuracy.average : null,
      sampleCount: accuracy.sampleCount,
      qualifyingBar: accuracy.sampleCount > 0 ? accuracy.average : null,
      average: accuracy.average,
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
