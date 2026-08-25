import { chatBridge, handleTelegramUpdate } from "./telegram";

const GRAPH = "https://graph.facebook.com/v21.0";
const TOKEN = () => process.env.WHATSAPP_TOKEN || "";
const PHONE_ID = () => process.env.WHATSAPP_PHONE_NUMBER_ID || "";
export const WA_VERIFY = () => process.env.WHATSAPP_VERIFY_TOKEN || "slipcut-wa-2026";

type WaMessage = {
  from?: string;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
};

type WaChange = {
  value?: {
    messages?: WaMessage[];
    metadata?: { display_phone_number?: string };
  };
};

async function graph(path: string, body: Record<string, unknown>) {
  const token = TOKEN();
  const phone = PHONE_ID();
  if (!token || !phone) return;
  await fetch(`${GRAPH}/${phone}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function flattenButtons(markup: unknown): Array<{ id: string; title: string }> {
  const kb = (markup as { inline_keyboard?: Array<Array<{ text?: string; callback_data?: string }>> })
    ?.inline_keyboard;
  if (!kb) return [];
  const out: Array<{ id: string; title: string }> = [];
  for (const row of kb) {
    for (const btn of row) {
      if (!btn.callback_data || !btn.text) continue;
      out.push({ id: btn.callback_data.slice(0, 256), title: btn.text.slice(0, 20) });
      if (out.length >= 3) return out;
    }
  }
  return out;
}

async function sendWhatsApp(to: string, method: string, payload: Record<string, unknown>) {
  if (method === "answerCallbackQuery" || method.startsWith("setMy")) return;
  if (method === "sendPhoto") {
    await graph("/messages", {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: {
        link: String(payload.photo ?? ""),
        caption: String(payload.caption ?? "").replace(/<[^>]+>/g, ""),
      },
    });
    return;
  }
  if (method !== "sendMessage") return;
  const text = String(payload.text ?? "")
    .replace(/<b>/g, "*")
    .replace(/<\/b>/g, "*")
    .replace(/<code>/g, "")
    .replace(/<\/code>/g, "")
    .replace(/&/g, "&")
    .replace(/<[^>]+>/g, "");
  const buttons = flattenButtons(payload.reply_markup);
  if (buttons.length) {
    await graph("/messages", {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: text.slice(0, 1024) || "SlipCut" },
        action: {
          buttons: buttons.map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    });
    return;
  }
  await graph("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text.slice(0, 4096) || " " },
  });
}

function toChatId(from: string): number {
  const digits = from.replace(/\D/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? n : 1;
}

export function verifyWhatsApp(mode?: string, token?: string, challenge?: string): string | null {
  if (mode === "subscribe" && token === WA_VERIFY() && challenge) return challenge;
  return null;
}

export async function handleWhatsAppWebhook(body: {
  entry?: Array<{ changes?: WaChange[] }>;
}) {
  if (!TOKEN() || !PHONE_ID()) return;
  const messages =
    body.entry?.flatMap((e) => e.changes ?? []).flatMap((c) => c.value?.messages ?? []) ?? [];
  for (const msg of messages) {
    if (!msg.from) continue;
    const from = msg.from;
    const buttonId = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id;
    const text = msg.text?.body || msg.image?.caption || "";
    await chatBridge.run(
      { send: (method, payload) => sendWhatsApp(from, method, payload) },
      async () => {
        if (buttonId) {
          await handleTelegramUpdate({
            callback_query: {
              id: `wa-${Date.now()}`,
              from: { id: toChatId(from) },
              data: buttonId,
              message: { message_id: 1, chat: { id: toChatId(from) }, text: "" },
            },
          });
          return;
        }
        if (!text.trim()) return;
        await handleTelegramUpdate({
          message: {
            message_id: 1,
            chat: { id: toChatId(from) },
            text: text.trim(),
          },
        });
      },
    );
  }
}
