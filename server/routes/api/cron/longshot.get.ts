import { defineHandler } from "nitro";
import { runDeskCron } from "../../../../src/lib/telegram";

export default defineHandler(async (event) => {
  const auth = event.req.headers.get("authorization") ?? "";
  const cron = event.req.headers.get("x-vercel-cron");
  const secret = process.env.CRON_SECRET;
  const ok = Boolean(cron) || (secret && auth === `Bearer ${secret}`);
  if (!ok) return new Response("forbidden", { status: 403 });
  return runDeskCron();
});
