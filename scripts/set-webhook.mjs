#!/usr/bin/env node
/** Register the Telegram webhook only for production, with a shared secret. */
import {
  shouldSetTelegramWebhook,
  telegramWebhookSecret,
} from "./telegram-webhook-secret.mjs";

if (!shouldSetTelegramWebhook(process.env.VERCEL_ENV)) {
  console.log("[set-webhook] non-production build — skip webhook mutation");
} else {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const base = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.WEBHOOK_BASE_URL ||
      process.env.APP_URL ||
      "https://slipcut-jesse-5780.vercel.app";
  const url = `${base.replace(/\/$/, "")}/api/telegram`;

  if (!token) {
    console.error("[set-webhook] TELEGRAM_BOT_TOKEN missing; cannot secure webhook");
    process.exitCode = 1;
  } else {
    try {
      const secret = telegramWebhookSecret(token, process.env.TELEGRAM_WEBHOOK_SECRET);
      if (!secret) throw new Error("Missing webhook secret");
      const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          secret_token: secret,
          drop_pending_updates: false,
          allowed_updates: ["message", "callback_query"],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        // Do not print Telegram's response body, the token or the secret.
        throw new Error(`Telegram rejected webhook registration (HTTP ${res.status})`);
      }
      console.log("[set-webhook] production webhook registration succeeded");
    } catch (err) {
      console.error("[set-webhook] registration failed:", err instanceof Error ? err.message : "unknown error");
      process.exitCode = 1;
    }
  }
}
