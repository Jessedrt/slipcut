import { defineHandler } from "nitro";
import { runDeskCron } from "../../../../src/lib/telegram";
import { gradeRecommendations } from "../../../../src/lib/track-record";

export default defineHandler(async (event) => {
  const auth = event.req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  const ok = Boolean(secret && auth === `Bearer ${secret}`);
  if (!ok) return new Response("forbidden", { status: 403 });
  const grades = await gradeRecommendations();
  await runDeskCron();
  return Response.json({ ok: true, grades });
});
