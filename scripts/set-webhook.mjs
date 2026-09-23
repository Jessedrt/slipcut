#!/usr/bin/env node
/** Register the Telegram webhook and default Mini App menu only for production. */
import {
  shouldSetTelegramWebhook,
  telegramWebhookSecret,
} from "./telegram-webhook-secret.mjs";

if (!shouldSetTelegramWebhook(process.env.VERCEL_ENV)) {
  console.log("[set-webhook] non-production build — skip Telegram mutations");
} else {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const base = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.WEBHOOK_BASE_URL ||
      process.env.APP_URL ||
      "https://slipcut-jesse-5780.vercel.app";
  const publicBase = base.replace(/\/$/, "");
  const webhookUrl = `${publicBase}/api/telegram`;
  const buildId = String(process.env.VERCEL_GIT_COMMIT_SHA || "production").slice(0, 12);
  const miniAppUrl = `${publicBase}/app?build=${encodeURIComponent(buildId)}`;

  async function telegramPost(method, payload = {}) {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      // Never print Telegram's response body, token, webhook secret, or bot credentials.
      throw new Error(`Telegram rejected ${method} (HTTP ${res.status})`);
    }
    return data.result;
  }

  if (!token) {
    console.error("[set-webhook] TELEGRAM_BOT_TOKEN missing; cannot configure Telegram");
    process.exitCode = 1;
  } else {
    try {
      const secret = telegramWebhookSecret(token, process.env.TELEGRAM_WEBHOOK_SECRET);
      if (!secret) throw new Error("Missing webhook secret");

      await telegramPost("setWebhook", {
        url: webhookUrl,
        secret_token: secret,
        drop_pending_updates: false,
        allowed_updates: ["message", "callback_query"],
      });
      console.log("[set-webhook] production webhook registration succeeded");

      await telegramPost("setChatMenuButton", {
        menu_button: {
          type: "web_app",
          text: "Open SlipCut",
          web_app: { url: miniAppUrl },
        },
      });

      const menu = await telegramPost("getChatMenuButton");
      const configuredUrl =
        menu &&
        typeof menu === "object" &&
        menu.type === "web_app" &&
        menu.web_app &&
        typeof menu.web_app === "object" &&
        typeof menu.web_app.url === "string"
          ? menu.web_app.url
          : "";

      if (configuredUrl !== miniAppUrl) {
        throw new Error("Telegram did not return the expected Mini App menu URL");
      }
      console.log("[set-webhook] default Telegram Mini App menu points to the current production build");
    } catch (err) {
      console.error(
        "[set-webhook] registration failed:",
        err instanceof Error ? err.message : "unknown error",
      );
      process.exitCode = 1;
    }
  }
}
