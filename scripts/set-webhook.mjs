#!/usr/bin/env node
/** Register the Telegram webhook and default Mini App menu only for production. */
import {
  shouldSetTelegramWebhook,
  telegramWebhookSecret,
} from "./telegram-webhook-secret.mjs";

if (
  !shouldSetTelegramWebhook(
    process.env.VERCEL_ENV,
    process.env.VERCEL_GIT_COMMIT_REF,
    process.env.VERCEL,
  )
) {
  console.log("[set-webhook] non-production build — skip Telegram mutations");
} else {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  // Keep Telegram on the canonical SlipCut domain. Generic APP_URL values have
  // previously pointed this bot at an unrelated legacy Mini App.
  const base = process.env.SLIPCUT_PUBLIC_URL || "https://slipcut-jesse-5780.vercel.app";
  const publicBase = base.replace(/\/$/, "");
  const webhookUrl = `${publicBase}/api/telegram`;
  const buildId = String(process.env.VERCEL_GIT_COMMIT_SHA || "production").slice(0, 12);
  const miniAppUrl = `${publicBase}/app?build=${encodeURIComponent(buildId)}`;

  async function telegramPost(method, payload = {}) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
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
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 750));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Telegram ${method} failed`);
  }

  if (!token) {
    console.warn("[set-webhook] TELEGRAM_BOT_TOKEN missing; leaving the existing Telegram webhook unchanged");
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
      console.log(`[set-webhook] production webhook registered at ${webhookUrl}`);

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
      console.log(`[set-webhook] default Telegram Mini App menu registered at ${miniAppUrl}`);
    } catch (err) {
      // A deploy must never be blocked by a transient Telegram outage. The
      // currently registered production webhook remains valid and can be
      // refreshed on the next deploy or from the app's connect action.
      console.warn(
        "[set-webhook] registration failed; keeping the existing webhook:",
        err instanceof Error ? err.message : "unknown error",
      );
    }
  }
}
