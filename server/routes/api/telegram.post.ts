import { defineHandler } from "nitro";
import { handleTelegramUpdate } from "../../../src/lib/telegram";

/**
 * Production Telegram webhook — classic SlipCut handler
 * (natural-language safer-cook, trim, split, codes).
 */
export default defineHandler(async (event) => {
  try {
    const update = await event.req.json();
    await handleTelegramUpdate(update);
  } catch (err) {
    console.error("[telegram] update error:", err instanceof Error ? err.message : err);
  }
  return { ok: true };
});
