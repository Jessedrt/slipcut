import { defineHandler } from "nitro";
import { listMiniAppSlips } from "../../../../src/lib/miniapp-history";
import { authenticateMiniAppRequest } from "../../../../src/lib/telegram-miniapp-auth";

export default defineHandler(async (event) => {
  const auth = authenticateMiniAppRequest(event.req);
  if (!auth.ok) return Response.json(auth, { status: 401 });
  const result = await listMiniAppSlips(String(auth.auth.user.id));
  return Response.json(result, { status: result.ok ? 200 : 503 });
});
