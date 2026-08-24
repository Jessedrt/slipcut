import { defineHandler } from "nitro";
import { handleTelegramUpdate } from "../../../src/lib/telegram";

export default defineHandler(async (event) => {
  try {
    const update = await event.req.json();
    await handleTelegramUpdate(update);
  } catch {
    // Telegram retries on non-200; acknowledge anyway.
  }
  return { ok: true };
});
