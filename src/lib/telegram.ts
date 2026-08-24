import { extractShareCode } from "./parse-ticket";
import { loadBookingCode, mintShare, sportyOf } from "./sportybet";
import { copyRebuild, splitEven, trimToOdds } from "./workbench";
import type { TicketPick } from "./types";

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || "";

type TgUser = { id: number; username?: string };
type TgChat = { id: number };
type TgMessage = {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
};
type TgCallback = {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
};
type TgUpdate = {
  message?: TgMessage;
  callback_query?: TgCallback;
};

async function tg(method: string, payload: Record<string, unknown>) {
  const token = TOKEN();
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function keyboard(code: string) {
  return {
    inline_keyboard: [
      [
        { text: "Mint SportyBet code", callback_data: `m:${code}` },
        { text: "Split 2", callback_data: `s:${code}:2` },
      ],
      [
        { text: "Split 3", callback_data: `s:${code}:3` },
        { text: "Trim 50×", callback_data: `t:${code}:50` },
      ],
    ],
  };
}

function listPicks(picks: TicketPick[]) {
  const lines = picks.slice(0, 18).map((p, i) => {
    const mark = p.sport === "other" ? "· skip" : "";
    return `${i + 1}. ${p.home} vs ${p.away}\n   ${p.market} — ${p.selection} ${mark}`.trim();
  });
  if (picks.length > 18) lines.push(`… +${picks.length - 18} more`);
  return lines.join("\n");
}

function playable(picks: TicketPick[]) {
  return picks.filter((p) => p.sport !== "other" && p.sporty);
}

async function mintAndReply(chatId: number, picks: TicketPick[], country: string, title: string) {
  const selections = sportyOf(picks);
  if (!selections.length) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Those legs have no SportyBet IDs. Send a SportyBet booking code first.",
    });
    return;
  }
  const minted = await mintShare(selections, country);
  if ("error" in minted) {
    await tg("sendMessage", { chat_id: chatId, text: minted.error });
    return;
  }
  const code = minted.shareCode;
  await tg("sendMessage", {
    chat_id: chatId,
    text: `<code>${esc(code)}</code>`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "Copy code", copy_text: { text: code } }],
        [{ text: "Open on SportyBet", url: minted.shareURL }],
        [
          {
            text: "Share",
            url: `https://t.me/share/url?url=${encodeURIComponent(minted.shareURL)}&text=${encodeURIComponent(code)}`,
          },
        ],
      ],
    },
  });
  const detail = [
    title,
    "",
    copyRebuild(picks),
    minted.unavailable ? `\n${minted.unavailable} leg(s) were unavailable.` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 3900);
  await tg("sendMessage", { chat_id: chatId, text: detail });
}

function esc(s: string) {
  return s.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
}

async function handleCode(chatId: number, code: string) {
  const loaded = await loadBookingCode(code, "ng");
  if ("error" in loaded) {
    await tg("sendMessage", { chat_id: chatId, text: loaded.error });
    return;
  }
  const play = playable(loaded.picks);
  await tg("sendMessage", {
    chat_id: chatId,
    text: [
      `${loaded.shareCode} · ${loaded.picks.length} legs · ${play.length} can be booked`,
      "",
      listPicks(loaded.picks),
      "",
      "Mint a new SportyBet code from the football/basketball legs, or split/trim first.",
    ].join("\n").slice(0, 3900),
    reply_markup: keyboard(loaded.shareCode),
  });
}

export async function handleTelegramUpdate(update: TgUpdate) {
  if (!TOKEN()) return;

  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id;
    const data = cq.data ?? "";
    await tg("answerCallbackQuery", { callback_query_id: cq.id });
    if (!chatId) return;
    const [kind, code, arg] = data.split(":");
    if (!code) return;
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await tg("sendMessage", { chat_id: chatId, text: loaded.error });
      return;
    }
    const base = playable(loaded.picks);
    if (kind === "m") {
      await mintAndReply(chatId, base, "ng", `SportyBet code · ${base.length} legs`);
      return;
    }
    if (kind === "s") {
      const parts = Number(arg || 2);
      const slips = splitEven(base, parts);
      for (let i = 0; i < slips.length; i++) {
        await mintAndReply(chatId, slips[i] ?? [], "ng", `Slip ${i + 1} · ${slips[i]?.length ?? 0} legs`);
      }
      return;
    }
    if (kind === "t") {
      const target = Number(arg || 50);
      const scored = base.map((p) => ({
        ...p,
        probability: p.odds ? Math.max(8, Math.min(90, Math.round(100 / p.odds))) : 50,
        confidence: "medium" as const,
        summary: "",
        reasons: [] as string[],
        risks: [] as string[],
        verdict: "keep" as const,
      }));
      const trimmed = trimToOdds(scored, target);
      await mintAndReply(chatId, trimmed, "ng", `Trimmed to ${target}× · ${trimmed.length} legs`);
    }
    return;
  }

  const msg = update.message;
  if (!msg?.text || !msg.chat) return;
  const text = msg.text.trim();
  if (text === "/start" || text === "/help") {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: [
        "SlipCut on Telegram.",
        "",
        "Send a SportyBet booking code.",
        "I list the legs, then you mint a new code after a cut, split, or trim.",
        "",
        "Football and basketball only.",
      ].join("\n"),
    });
    return;
  }
  const code = extractShareCode(text) || (/^[A-Z0-9]{4,16}$/i.test(text) ? text.toUpperCase() : null);
  if (!code) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: "Send a SportyBet booking code (example MQVZ70).",
    });
    return;
  }
  await handleCode(msg.chat.id, code);
}
