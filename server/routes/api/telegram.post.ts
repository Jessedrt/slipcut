import { defineHandler } from "nitro";

/**
 * Production Telegram webhook → SlipCut AI (Telegraf).
 * Uses bot.handleUpdate (webhook mode). Does not call bot.launch().
 */
let handleUpdate: ((update: unknown) => Promise<void>) | null = null;
let initError: string | null = null;

async function ensureHandler() {
  if (handleUpdate) return handleUpdate;
  if (initError) {
    return async () => {
      console.error("[telegram] previously failed to init:", initError);
    };
  }
  try {
    const { createBot } = await import("../../../slipcut-ai/src/bot/telegram.ts");
    const bot = createBot();
    if (!bot) {
      initError = "createBot returned null (check TELEGRAM_BOT_TOKEN)";
      console.error("[telegram]", initError);
      handleUpdate = async () => {};
      return handleUpdate;
    }
    handleUpdate = async (update: unknown) => {
      await bot.handleUpdate(update as Parameters<typeof bot.handleUpdate>[0]);
    };
    console.info("[telegram] SlipCut AI webhook handler ready");
    return handleUpdate;
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    console.error("[telegram] failed to load SlipCut AI bot:", initError);
    handleUpdate = async () => {};
    return handleUpdate;
  }
}

export default defineHandler(async (event) => {
  try {
    const update = await event.req.json();
    const run = await ensureHandler();
    await run(update);
  } catch (err) {
    console.error("[telegram] update error:", err instanceof Error ? err.message : err);
  }
  return { ok: true };
});
