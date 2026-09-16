import Fastify from "fastify";
import { env } from "./config/env.js";
import { createBot } from "./bot/telegram.js";
import { logger } from "./utils/logger.js";

async function main() {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({
    ok: true,
    service: "slipcut-ai",
    time: new Date().toISOString(),
  }));

  app.get("/admin/health", async (req, reply) => {
    const secret = (req.headers["x-admin-secret"] || "") as string;
    if (env.ADMIN_SECRET && secret !== env.ADMIN_SECRET) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return {
      ok: true,
      sportybetEnabled: env.SPORTYBET_PROVIDER_ENABLED,
      telegram: Boolean(env.TELEGRAM_BOT_TOKEN),
      redis: Boolean(env.REDIS_URL),
      database: Boolean(env.DATABASE_URL),
    };
  });

  const bot = createBot();
  if (bot) {
    bot.launch().then(() => logger.info("Telegram bot launched"));
    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
  }

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info(`SlipCut AI listening on :${env.PORT}`);
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
