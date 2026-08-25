import { defineHandler } from "nitro";
import { handleWhatsAppWebhook } from "../../../src/lib/whatsapp";

export default defineHandler(async (event) => {
  try {
    const body = await event.req.json();
    await handleWhatsAppWebhook(body);
  } catch {
    // Meta retries on non-200
  }
  return { ok: true };
});
