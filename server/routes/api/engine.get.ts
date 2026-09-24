import { defineHandler } from "nitro";
import { loadAccuracy } from "../../../src/lib/accuracy";
import { todayEngineCards } from "../../../src/lib/engine";

export default defineHandler(async () => {
  try {
    const [accuracy, cards] = await Promise.all([
      loadAccuracy(),
      todayEngineCards(),
    ]);

    if ("error" in cards) {
      return Response.json(
        {
          ok: false,
          error: cards.error,
          hitRate: accuracy.sampleCount > 0 ? accuracy.average : null,
          sampleCount: accuracy.sampleCount,
          qualifyingBar: accuracy.sampleCount > 0 ? accuracy.average : null,
        },
        { status: 200 },
      );
    }

    return Response.json({
      ok: true,
      cards,
      hitRate: accuracy.sampleCount > 0 ? accuracy.average : null,
      sampleCount: accuracy.sampleCount,
      qualifyingBar: accuracy.sampleCount > 0 ? accuracy.average : null,
      average: accuracy.average,
    });
  } catch (error) {
    console.error(
      "[engine.public] failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json(
      { ok: false, error: "Engine data is temporarily unavailable." },
      { status: 200 },
    );
  }
});
