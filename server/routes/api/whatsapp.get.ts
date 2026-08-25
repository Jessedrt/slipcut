import { defineHandler } from "nitro";
import { verifyWhatsApp } from "../../../src/lib/whatsapp";

export default defineHandler((event) => {
  const url = new URL(event.req.url, "https://slipcut.vercel.app");
  const ok = verifyWhatsApp(
    url.searchParams.get("hub.mode") ?? undefined,
    url.searchParams.get("hub.verify_token") ?? undefined,
    url.searchParams.get("hub.challenge") ?? undefined,
  );
  if (ok == null) {
    return new Response("forbidden", { status: 403 });
  }
  return new Response(ok, { status: 200, headers: { "content-type": "text/plain" } });
});
