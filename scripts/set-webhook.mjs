#!/usr/bin/env node
/**
 * Point Telegram webhook at production after each successful Vercel build.
 */
const token = process.env.TELEGRAM_BOT_TOKEN || "";
const base =
  process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.WEBHOOK_BASE_URL ||
      process.env.APP_URL ||
      "https://slipcut-jesse-5780.vercel.app";

const url = `${base.replace(/\/$/, "")}/api/telegram`;

if (!token) {
  console.warn("[set-webhook] TELEGRAM_BOT_TOKEN missing — skip");
  process.exit(0);
}

try {
  const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const info = await infoRes.json();
  console.log("[set-webhook] current:", info?.result?.url || "(none)");

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      drop_pending_updates: false,
      allowed_updates: ["message", "callback_query"],
    }),
  });
  const data = await res.json();
  console.log("[set-webhook] set to", url, "→", data.ok ? "OK" : JSON.stringify(data));
} catch (e) {
  console.warn("[set-webhook] failed:", e instanceof Error ? e.message : e);
}
process.exit(0);
