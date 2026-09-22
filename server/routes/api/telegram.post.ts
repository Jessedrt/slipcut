import { defineHandler } from "nitro";
import {
  telegramWebhookSecret,
  verifyTelegramWebhookSecret,
} from "../../../scripts/telegram-webhook-secret.mjs";

/** Accept only updates authenticated by our Telegram setWebhook secret. */
export default defineHandler(async (event) => {
  let secret: string | null;
  try {
    secret = telegramWebhookSecret(
      process.env.TELEGRAM_BOT_TOKEN,
      process.env.TELEGRAM_WEBHOOK_SECRET,
    );
  } catch {
    console.error("[telegram] webhook secret is misconfigured");
    return new Response("Service unavailable", { status: 503 });
  }

  if (!secret) {
    console.error("[telegram] bot token is not configured");
    return new Response("Service unavailable", { status: 503 });
  }
  const supplied = event.req.headers.get("x-telegram-bot-api-secret-token");
  if (!verifyTelegramWebhookSecret(supplied, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // PGLite's in-memory fallback is for local development, not Vercel Functions.
  // Without a persistent database this route previously crashed while loading
  // its WASM asset but still appeared to acknowledge Telegram's update.
  if (process.env.VERCEL === "1" && !process.env.DATABASE_URL?.trim()) {
    console.error("[telegram] DATABASE_URL is required on Vercel; refusing update");
    return new Response("Bot storage unavailable", { status: 503 });
  }

  let update: unknown;
  try {
    update = await event.req.json();
  } catch {
    return new Response("Invalid update", { status: 400 });
  }
  if (
    !update ||
    typeof update !== "object" ||
    !("update_id" in update) ||
    typeof update.update_id !== "number" ||
    !Number.isSafeInteger(update.update_id)
  ) {
    return new Response("Invalid update", { status: 400 });
  }

  try {
    // Do not load the bot/database before authenticating the webhook request.
    const { handleTelegramUpdate } = await import("../../../src/lib/telegram");
    await handleTelegramUpdate(update as Parameters<typeof handleTelegramUpdate>[0]);
    return { ok: true };
  } catch (err) {
    console.error("[telegram] update failed:", err instanceof Error ? err.message : "unknown error");
    // Telegram can retry failed updates; never acknowledge an unhandled failure.
    return new Response("Update failed", { status: 500 });
  }
});
