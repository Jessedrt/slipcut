import { defineHandler } from "nitro";
import { loadAccuracy } from "../../../src/lib/accuracy";
import { ENGINE_LADDER, loadEngineDay } from "../../../src/lib/engine";

export default defineHandler(async () => {
  const [accuracy, cards] = await Promise.all([
    loadAccuracy(),
    loadEngineDay(),
  ]);

  return Response.json({
    ok: true,
    average: accuracy.average,
    sampleCount: accuracy.sampleCount,
    qualifyingBar: accuracy.average,
    ladder: ENGINE_LADDER,
    cards: cards ?? [],
  });
});
