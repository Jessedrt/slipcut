import { analyzePicks } from "./analyze";
import { extractShareCode } from "./parse-ticket";
import { loadBookingCode, listUpcomingPicks, mintShare, sportyOf } from "./sportybet";
import { copyRebuild, keepTop, splitEven, trimToOdds } from "./workbench";
import type { AnalyzedPick, TicketPick } from "./types";

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || "";
const KEEP_LINE = 48;

type TgUser = { id: number; username?: string };
type TgChat = { id: number };
type TgMessage = {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  reply_to_message?: TgMessage;
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

function oddsButtons(code: string) {
  return [2, 3, 4, 5, 6].map((n) => ({
    text: `${n} odds`,
    callback_data: `k:${code}:${n}`,
  }));
}

function keyboard(code: string) {
  const odds = oddsButtons(code);
  return {
    inline_keyboard: [
      [{ text: "Analyze", callback_data: `a:${code}` }],
      odds.slice(0, 3),
      odds.slice(3),
      [
        { text: "Mint all", callback_data: `m:${code}` },
        { text: "Split 2", callback_data: `s:${code}:2` },
        { text: "Trim 50×", callback_data: `t:${code}:50` },
      ],
    ],
  };
}

function afterAnalyzeKeyboard(code: string) {
  const odds = oddsButtons(code);
  return {
    inline_keyboard: [
      odds.slice(0, 3),
      odds.slice(3),
      [
        { text: "Mint all", callback_data: `m:${code}` },
        { text: "Split 2", callback_data: `s:${code}:2` },
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

function formatAnalysis(picks: AnalyzedPick[], desk: string) {
  const ranked = picks
    .filter((p) => p.sport !== "other")
    .slice()
    .sort((a, b) => b.probability - a.probability);
  const lines = ranked.slice(0, 18).map((p, i) => {
    const summary = p.summary ? `\n   ${p.summary}` : "";
    return `${i + 1}. ${p.probability}%  ${p.home} vs ${p.away}\n   ${p.market} — ${p.selection}${summary}`;
  });
  return [
    "Analyze · live form",
    desk,
    "",
    ...lines,
    "",
    `Scored ${ranked.length} legs. Strongest first.`,
  ]
    .join("\n")
    .slice(0, 3900);
}

async function scorePlayable(picks: TicketPick[]) {
  return analyzePicks(picks, KEEP_LINE);
}

async function analyzeAndReply(chatId: number, picks: TicketPick[], code: string) {
  if (!picks.length) {
    await tg("sendMessage", { chat_id: chatId, text: "No football or basketball legs to score." });
    return;
  }
  await tg("sendMessage", { chat_id: chatId, text: "Reading live form. Odds ignored." });
  const result = await scorePlayable(picks);
  await tg("sendMessage", {
    chat_id: chatId,
    text: formatAnalysis(result.picks, result.desk),
    reply_markup: afterAnalyzeKeyboard(code),
  });
}

async function sureNAndReply(
  chatId: number,
  picks: TicketPick[],
  count: number,
  title = "",
) {
  const n = Math.max(1, Math.min(10, Math.round(count) || 2));
  if (!picks.length) {
    await tg("sendMessage", { chat_id: chatId, text: "No football or basketball legs to score." });
    return;
  }
  await tg("sendMessage", {
    chat_id: chatId,
    text: `Picking the ${n} strongest legs from live form.`,
  });
  const result = await scorePlayable(picks);
  const top = keepTop(result.picks, n);
  if (!top.length) {
    await tg("sendMessage", { chat_id: chatId, text: `Could not pick ${n} sure legs from that ticket.` });
    return;
  }
  const note = top
    .map((p) => `${p.probability}% ${p.home} vs ${p.away} — ${p.selection}`)
    .join("\n");
  await mintAndReply(chatId, top, "ng", title || `${top.length} odds\n${note}`);
}

async function createSportSlip(chatId: number, sport: "football" | "basketball", count: number) {
  const n = Math.max(1, Math.min(10, Math.round(count) || 5));
  await tg("sendMessage", {
    chat_id: chatId,
    text: `Building a ${n} odds ${sport} slip — not only 1X2. Mixing double chance, over/under, GG, and winners.`,
  });
  const listed = await listUpcomingPicks(sport, Math.min(14, Math.max(n + 4, 10)));
  if ("error" in listed) {
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  await sureNAndReply(chatId, listed, n, `${n} odds ${sport}`);
}

function parseSport(text: string): "football" | "basketball" | null {
  if (/basket|hoop/i.test(text)) return "basketball";
  if (/foot|soccer/i.test(text)) return "football";
  return null;
}

async function mintKeepersAndReply(chatId: number, picks: TicketPick[]) {
  await tg("sendMessage", { chat_id: chatId, text: "Minting the strongest legs from live form." });
  const result = await scorePlayable(picks);
  const count = Math.max(2, Math.ceil(result.picks.filter((p) => p.sport !== "other").length / 2));
  const strongest = keepTop(result.picks, count).filter((p) => p.sporty);
  if (!strongest.length) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: formatAnalysis(result.picks, "No legs to mint."),
    });
    return;
  }
  await mintAndReply(chatId, strongest, "ng", `Strongest ${strongest.length} legs`);
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
      "Analyze the form, then tap how many odds you want.",
    ]
      .join("\n")
      .slice(0, 3900),
    reply_markup: keyboard(loaded.shareCode),
  });
}

function codeFromText(raw?: string): string | null {
  if (!raw) return null;
  return (
    extractShareCode(raw) ||
    raw.match(/^([A-Z0-9]{4,16})(?:\s|$|·)/i)?.[1]?.toUpperCase() ||
    null
  );
}

function parseOddsCount(text: string): number | null {
  const m =
    text.match(/(?:sure\s*)?(\d{1,2})\s*odds?\b/i) ||
    text.match(/^\/odds(?:@\w+)?\s+(\d{1,2})\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 10) return null;
  return n;
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
    if (kind === "c") {
      const sport = code === "b" ? "basketball" : "football";
      await createSportSlip(chatId, sport, Number(arg || 10));
      return;
    }
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await tg("sendMessage", { chat_id: chatId, text: loaded.error });
      return;
    }
    const base = playable(loaded.picks);
    if (kind === "a") {
      await analyzeAndReply(chatId, base, loaded.shareCode);
      return;
    }
    if (kind === "k") {
      await sureNAndReply(chatId, base, Number(arg || 2));
      return;
    }
    if (kind === "g") {
      await mintKeepersAndReply(chatId, base);
      return;
    }
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
        "Send a SportyBet booking code — or ask me to build one:",
        "create a 10 odds football slip",
        "create a 10 odds basketball slip",
        "",
        "Football and basketball only.",
      ].join("\n"),
      reply_markup: {
        inline_keyboard: [
          [
            { text: "10 odds football", callback_data: "c:f:10" },
            { text: "10 odds basketball", callback_data: "c:b:10" },
          ],
          [
            { text: "5 odds football", callback_data: "c:f:5" },
            { text: "5 odds basketball", callback_data: "c:b:5" },
          ],
        ],
      },
    });
    return;
  }
  const oddsCount = parseOddsCount(text);
  const sport = parseSport(text);
  const code = codeFromText(text) || codeFromText(msg.reply_to_message?.text);
  if (oddsCount && sport && !code) {
    await createSportSlip(msg.chat.id, sport, oddsCount);
    return;
  }
  if (oddsCount && code) {
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: loaded.error });
      return;
    }
    const base = playable(loaded.picks);
    const filtered = sport ? base.filter((p) => p.sport === sport) : base;
    if (sport && !filtered.length) {
      await tg("sendMessage", {
        chat_id: msg.chat.id,
        text: `That ticket has no ${sport} legs. Building a fresh ${oddsCount} odds ${sport} slip instead.`,
      });
      await createSportSlip(msg.chat.id, sport, oddsCount);
      return;
    }
    await sureNAndReply(msg.chat.id, filtered, oddsCount);
    return;
  }
  if (sport && !oddsCount && !code) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: `How many ${sport} odds? Example: 10 odds ${sport}`,
    });
    return;
  }
  if (oddsCount && !code) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: `Say the sport too — example: ${oddsCount} odds football\nor send a booking code: MQVZ70 ${oddsCount} odds.`,
    });
    return;
  }
  if (!code) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: "Send a SportyBet booking code, or ask: create a 10 odds football slip.",
    });
    return;
  }
  await handleCode(msg.chat.id, code);
}
