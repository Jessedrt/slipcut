import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  AI_PROVIDER: z.string().default("gemini"),
  AI_API_KEY: z.string().optional().default(""),
  AI_MODEL: z.string().default("gemini-2.0-flash"),
  SPORTYBET_PROVIDER_ENABLED: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v !== "false"),
  SPORTYBET_COUNTRY: z.string().default("ng"),
  LOG_LEVEL: z.string().default("info"),
});

export const env = schema.parse({
  NODE_ENV: process.env.NODE_ENV,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? "",
  AI_PROVIDER: process.env.AI_PROVIDER,
  AI_API_KEY: process.env.AI_API_KEY ?? "",
  AI_MODEL: process.env.AI_MODEL,
  SPORTYBET_PROVIDER_ENABLED: process.env.SPORTYBET_PROVIDER_ENABLED,
  SPORTYBET_COUNTRY: process.env.SPORTYBET_COUNTRY,
  LOG_LEVEL: process.env.LOG_LEVEL,
});
