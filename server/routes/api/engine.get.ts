import { defineHandler } from "nitro";
import { loadAccuracy } from "../../../src/lib/accuracy";
import { ENGINE_LADDER, loadEngineDay } from "../../../src/lib/engine";

export default defineHandler(async () => {
  try {
    const [accuracy, cards] = await Promise.all([
      loadAccuracy(),
      loadEngineDay(),
    ]);
    return Response.json({
      ok: true,
      cards: cards ?? [],
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
      { ok: false, error: "Engine data is temporarily unavailable." },
      { status: 200 },
    );
  }
});
