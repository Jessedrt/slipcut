import { Telegraf } from "telegraf";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import {
  handleCallback,
  handleClear,
  handleHelp,
  handleStart,
  handleText,
} from "./handlers.js";

export function createBot() {
  if (!env.TELEGRAM_BOT_TOKEN) {
    logger.warn("TELEGRAM_BOT_TOKEN missing — bot not started");
    return null;
  }
  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

  bot.start(handleStart);
  bot.help(handleHelp);
  bot.command("today", async (ctx) => {
    (ctx as { message: { text: string } }).message = { text: "Give me 5 football games today" };
    return handleText(ctx);
  });
  bot.command("football", async (ctx) => {
    (ctx as { message: { text: string } }).message = { text: "Give me 5 football games" };
    return handleText(ctx);
  });
  bot.command("basketball", async (ctx) => {
    (ctx as { message: { text: string } }).message = { text: "Give me 5 basketball games" };
    return handleText(ctx);
  });
  bot.command("clear", handleClear);
  bot.command("subscription", async (ctx) =>
    ctx.reply("Free plan active. Pro unlocks higher limits — /pricing"),
  );
  bot.command("pricing", async (ctx) =>
    ctx.reply("Free: limited daily analyses\nPro: higher limits, advanced optimization"),
  );
  bot.on("text", handleText);
  bot.on("callback_query", handleCallback);
  bot.on("photo", async (ctx) => {
    await ctx.reply(
      "📸 Screenshot received. Vision analysis requires AI_API_KEY. Paste a booking code or type selections for now.",
    );
  });

  bot.catch((err) => logger.error({ err }, "bot error"));
  return bot;
}
