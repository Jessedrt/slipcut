import { defineHandler } from "nitro";
import { ingestImage, ingestText } from "../../../../src/lib/ingest";
import { authenticateMiniAppRequest } from "../../../../src/lib/telegram-miniapp-auth";

export default defineHandler(async (event) => {
  const auth = authenticateMiniAppRequest(event.req);
  if (!auth.ok) return Response.json(auth, { status: 401 });

  let body: {
    mode?: unknown;
    text?: unknown;
    image?: { mime?: unknown; data?: unknown };
  };
  try {
    body = (await event.req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, code: "invalid_request", error: "Invalid JSON." }, { status: 400 });
  }

  try {
    const result =
      body.mode === "image"
        ? await ingestImage({
            mime: String(body.image?.mime ?? ""),
            data: String(body.image?.data ?? ""),
          })
        : await ingestText(String(body.text ?? ""));
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "ingest_failed",
        error: error instanceof Error ? error.message : "Ticket extraction failed.",
      },
      { status: 422 },
    );
  }
});
