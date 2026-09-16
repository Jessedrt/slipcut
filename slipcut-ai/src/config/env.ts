import { z } from "zod";
import "dotenv/config";

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

export const env = schema.parse(process.env);
