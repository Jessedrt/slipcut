import { createBot } from "./bot/telegram.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";

async function main() {
  const bot = createBot();
  if (!bot) {
    logger.error("TELEGRAM_BOT_TOKEN is required");
    process.exit(1);
  }
  await bot.launch();
  logger.info("SlipCut AI Telegram bot is running");
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
