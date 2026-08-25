import { analyzePicks } from "./analyze";
import { extractShareCode } from "./parse-ticket";
import { loadBookingCode, listUpcomingPicks, mintShare, parseMarketTarget, retargetPicks, sportyOf } from "./sportybet";
import { buildToOdds, combinedOdds, copyRebuild, formatOdds, keepTop, parseCommand, splitEven, trimToOdds } from "./workbench";
import type { AnalyzedPick, TicketPick } from "./types";

const MAX_LEGS = 35;
const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || "";
const KEEP_LINE = 48;

function clampLegs(n: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(MAX_LEGS, Math.round(n)));
}

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

function sportIcon(sport: string) {
  if (sport === "basketball") return "🏀";
  if (sport === "football") return "⚽";
  return "🎟️";
}

function keyboard(code: string) {
  return {
    inline_keyboard: [
      [
        { text: "🔍 Analyze", callback_data: `a:${code}` },
        { text: "✂️ Trim", callback_data: `g:${code}` },
      ],
      [
        { text: "➗ Split 2", callback_data: `s:${code}:2` },
        { text: "🎯 Optimize 50×", callback_data: `t:${code}:50` },
      ],
      [
        { text: "🔻 8 legs", callback_data: `k:${code}:8` },
        { text: "🔻 12 legs", callback_data: `k:${code}:12` },
        { text: "🔻 20 legs", callback_data: `k:${code}:20` },
      ],
      [
        { text: "⚡ Over 2.5", callback_data: `ch:${code}:ou25` },
        { text: "🤝 GG", callback_data: `ch:${code}:gg` },
        { text: "🎫 Mint all", callback_data: `m:${code}` },
      ],
    ],
  };
}

function afterAnalyzeKeyboard(code: string) {
  return keyboard(code);
}

function listPicks(picks: TicketPick[]) {
  const shown = picks.slice(0, 35);
  const lines = shown.map((p, i) => {
    const mark = p.sport === "other" ? "· skip" : "";
    return `${i + 1}. ${sportIcon(p.sport)} ${p.home} vs ${p.away}\n   ${p.market} — ${p.selection} ${mark}`.trim();
  });
  if (picks.length > shown.length) lines.push(`… +${picks.length - shown.length} more`);
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
  if ("error" in minted && selections.length > 40) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `SportyBet would not take ${selections.length} in one code. Splitting into 50-leg slips.`,
    });
    const size = 50;
    for (let i = 0; i < picks.length; i += size) {
      await mintAndReply(
        chatId,
        picks.slice(i, i + size),
        country,
        `${title} · part ${Math.floor(i / size) + 1}`,
      );
    }
    return;
  }
  if ("error" in minted) {
    await tg("sendMessage", { chat_id: chatId, text: minted.error });
    return;
  }
  const code = minted.shareCode;
  await tg("sendMessage", {
    chat_id: chatId,
    text: `✅ <code>${esc(code)}</code>`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "📋 Copy code", copy_text: { text: code } }],
        [{ text: "🌐 Open on SportyBet", url: minted.shareURL }],
        [
          {
            text: "📤 Share",
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
    const heat = p.probability >= 70 ? "🔥" : p.probability >= 55 ? "✨" : "❄️";
    const summary = p.summary ? `\n   ${p.summary}` : "";
    return `${i + 1}. ${heat} ${p.probability}%  ${sportIcon(p.sport)} ${p.home} vs ${p.away}\n   ${p.market} — ${p.selection}${summary}`;
  });
  return [
    "🔍 Analyze · live form",
    desk,
    "",
    ...lines,
    "",
    `📊 Scored ${ranked.length} legs. Strongest first.`,
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
  await tg("sendMessage", { chat_id: chatId, text: "📡 Reading live form. Odds ignored." });
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
  const n = clampLegs(count, 2);
  if (!picks.length) {
    await tg("sendMessage", { chat_id: chatId, text: "No football or basketball legs to score." });
    return;
  }
  await tg("sendMessage", {
    chat_id: chatId,
    text: `🧠 Picking the ${n} strongest legs from live form.`,
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
  await mintAndReply(chatId, top, "ng", title || `${top.length} legs\n${note}`);
}

async function createSportSlip(chatId: number, sport: "football" | "basketball", count: number) {
  const n = clampLegs(count, 5);
  const capNote = count > MAX_LEGS ? ` Max is ${MAX_LEGS} legs.` : "";
  await tg("sendMessage", {
    chat_id: chatId,
    text: `${sportIcon(sport)} Building a ${n}-leg ${sport} slip — not only 1X2. Mixing double chance, over/under, GG, and winners.${capNote}`,
  });
  const listed = await listUpcomingPicks(sport, n);
  if ("error" in listed) {
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  const take = listed.slice(0, n);
  if (!take.length) {
    await tg("sendMessage", { chat_id: chatId, text: `No upcoming ${sport} to book.` });
    return;
  }
  const title =
    take.length < n
      ? `${take.length} legs ${sport} — only ${take.length} upcoming games on SportyBet`
      : `${take.length} legs ${sport}`;
  if (take.length <= 8) {
    await sureNAndReply(chatId, take, take.length, title);
    return;
  }
  await mintAndReply(chatId, take, "ng", title);
}

function parseSport(text: string): "football" | "basketball" | null {
  if (/basket|hoop/i.test(text)) return "basketball";
  if (/foot|soccer/i.test(text)) return "football";
  return null;
}

async function mintKeepersAndReply(chatId: number, picks: TicketPick[]) {
  await tg("sendMessage", { chat_id: chatId, text: "✂️ Trimming to the strongest half." });
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
      `🎫 ${loaded.shareCode} · ${loaded.picks.length} legs · ${play.length} can be booked`,
      "",
      listPicks(loaded.picks),
      "",
      "✂️ Trim  ·  ➗ Split  ·  🎯 Optimize  ·  ⚡ change markets in chat.",
      "💬 drop 3 8 · split 2 · change to over 2.5 · trim to 50x · combine NXPSTB",
    ]
      .join("\n")
      .slice(0, 3900),
    reply_markup: keyboard(loaded.shareCode),
  });
}

const NOT_A_CODE = new Set([
  "CREATE",
  "START",
  "HELP",
  "LEGS",
  "ODDS",
  "TRIM",
  "MINT",
  "ANALYZE",
  "FOOTBALL",
  "BASKETBALL",
  "SOCCER",
  "SLIPCUT",
  "SPORT",
  "SHARE",
  "CODE",
  "KEEP",
  "DROP",
  "HOME",
  "AWAY",
  "OVER",
  "UNDER",
  "SPLIT",
  "REDUCE",
]);

function looksLikeShareCode(token: string): boolean {
  const t = token.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(t)) return false;
  if (NOT_A_CODE.has(t)) return false;
  return true;
}

function codeFromText(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (looksLikeShareCode(trimmed)) return trimmed.toUpperCase();
  const labeled = extractShareCode(trimmed);
  if (labeled && looksLikeShareCode(labeled)) return labeled;
  const head = trimmed.match(/^([A-Z0-9]{4,16})(?:\s|$|·)/i)?.[1];
  if (head && looksLikeShareCode(head)) return head.toUpperCase();
  return null;
}

function parseDropIndexes(text: string): number[] | null {
  const m = text.match(/^(?:drop|remove|delete)\s+(?:legs?\s+)?([\d,\s&and]+)$/i);
  if (!m) return null;
  const nums = [...m[1].matchAll(/\d+/g)].map((x) => Number(x[0])).filter((n) => n >= 1);
  return nums.length ? nums : null;
}

function parseCombineCode(text: string): string | null {
  const m = text.match(/\bcombin(?:e|ing)\s+(?:with\s+)?([A-Z0-9]{4,16})\b/i);
  if (!m?.[1] || !looksLikeShareCode(m[1])) return null;
  return m[1].toUpperCase();
}

function wantsMarketChange(text: string) {
  const target = parseMarketTarget(text);
  if (!target) return null;
  if (/change|convert|swap|make|all\b|to over|to gg|to double|to dnb|to 1x2/i.test(text)) return target;
  if (/^(over\s*[123]\.5|gg|btts|double chance|draw no bet|1x2)\b/i.test(text.trim())) return target;
  return null;
}

async function runTicketCommand(chatId: number, code: string, text: string): Promise<boolean> {
  const loaded = await loadBookingCode(code, "ng");
  if ("error" in loaded) {
    await tg("sendMessage", { chat_id: chatId, text: loaded.error });
    return true;
  }
  const base = playable(loaded.picks);
  const drop = parseDropIndexes(text);
  if (drop) {
    const kept = loaded.picks.filter((_, i) => !drop.includes(i + 1));
    const play = playable(kept);
    if (!play.length) {
      await tg("sendMessage", { chat_id: chatId, text: "Nothing left to book after that drop." });
      return true;
    }
    await mintAndReply(chatId, play, "ng", `🗑 Dropped ${drop.join(", ")} · ${play.length} legs`);
    return true;
  }
  const other = parseCombineCode(text);
  if (other && other !== loaded.shareCode) {
    const extra = await loadBookingCode(other, "ng");
    if ("error" in extra) {
      await tg("sendMessage", { chat_id: chatId, text: extra.error });
      return true;
    }
    const seen = new Set<string>();
    const merged = playable([...loaded.picks, ...extra.picks]).filter((p) => {
      const id = p.sporty?.eventId ?? p.id;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    await mintAndReply(chatId, merged, "ng", `🔗 Combined ${loaded.shareCode} + ${extra.shareCode} · ${merged.length} legs`);
    return true;
  }
  const market = wantsMarketChange(text);
  if (market) {
    await tg("sendMessage", { chat_id: chatId, text: `⚡ Changing markets on ${loaded.shareCode}.` });
    const next = playable(await retargetPicks(base, market));
    if (!next.length) {
      await tg("sendMessage", { chat_id: chatId, text: "Could not change those markets." });
      return true;
    }
    await mintAndReply(chatId, next, "ng", `⚡ Changed markets · ${next.length} legs`);
    return true;
  }
  const cmd = parseCommand(text);
  if (cmd.type === "split") {
    const slips = splitEven(base, cmd.parts);
    for (let i = 0; i < slips.length; i++) {
      await mintAndReply(chatId, slips[i] ?? [], "ng", `Slip ${i + 1} · ${slips[i]?.length ?? 0} legs`);
    }
    return true;
  }
  if (cmd.type === "trim") {
    const scored = base.map((p) => ({
      ...p,
      probability: p.odds ? Math.max(8, Math.min(90, Math.round(100 / p.odds))) : 50,
      confidence: "medium" as const,
      summary: "",
      reasons: [] as string[],
      risks: [] as string[],
      verdict: "keep" as const,
    }));
    const trimmed = trimToOdds(scored, cmd.targetOdds);
    await mintAndReply(chatId, trimmed, "ng", `Trimmed to ${cmd.targetOdds}× · ${trimmed.length} legs`);
    return true;
  }
  if (cmd.type === "keepLegs") {
    await sureNAndReply(chatId, base, cmd.count);
    return true;
  }
  if (cmd.type === "sport") {
    const filtered = base.filter((p) => p.sport === cmd.sport);
    if (!filtered.length) {
      await tg("sendMessage", { chat_id: chatId, text: `No ${cmd.sport} legs on that ticket.` });
      return true;
    }
    await mintAndReply(chatId, filtered, "ng", `${cmd.sport} only · ${filtered.length} legs`);
    return true;
  }
  return false;
}

function parseLegCount(text: string): number | null {
  const m =
    text.match(/(?:sure\s*)?(\d{1,4})\s*(?:legs?|odds?)\b/i) ||
    text.match(/^\/(?:legs?|odds)(?:@\w+)?\s+(\d{1,4})\b/i) ||
    (parseSport(text) ? text.match(/\b(\d{1,4})\b/) : null);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return null;
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
    if (kind === "ch") {
      const target = parseMarketTarget(arg || "ou25") ?? "ou25";
      await tg("sendMessage", { chat_id: chatId, text: `⚡ Changing markets on ${loaded.shareCode}.` });
      const next = playable(await retargetPicks(base, target));
      await mintAndReply(chatId, next, "ng", `⚡ Changed markets · ${next.length} legs`);
      return;
    }
    if (kind === "m") {
      await mintAndReply(chatId, base, "ng", `🎫 SportyBet code · ${base.length} legs`);
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
    await tg("setMyCommands", {
      commands: [
        { command: "start", description: "👋 How to use SlipCut" },
        { command: "help", description: "✂️ Edit, split, change markets" },
      ],
    });
    await tg("setMyDescription", {
      description:
        "Convert SportyBet codes, change markets, edit tickets in seconds, and get AI predictions by chatting.",
    });
    await tg("setMyShortDescription", {
      short_description: "Edit SportyBet tickets, change markets, and get AI predictions.",
    });
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: [
        "✂️ SlipCut on Telegram",
        "",
        "🎫 Send a SportyBet booking code, then:",
        "🗑  drop 3 8",
        "➗  split 2",
        "⚡  change to over 2.5",
        "🤝  change to GG",
        "🎯  trim to 50x",
        "🔗  combine NXPSTB",
        "🔻  12 legs",
        "",
        "⚽ Or build one: 12 legs football",
        "🏀 Or: 12 legs basketball",
        "",
        "Football and basketball only. Max 35 new legs.",
      ].join("\n"),
    });
    return;
  }
  const legCount = parseLegCount(text);
  const sport = parseSport(text);
  const code = codeFromText(text) || codeFromText(msg.reply_to_message?.text);
  const isBareCode = Boolean(code && looksLikeShareCode(text));
  if (code && !isBareCode) {
    const handled = await runTicketCommand(msg.chat.id, code, text);
    if (handled) return;
  }
  if (code && !legCount && /^\s*trim\s*$/i.test(text)) {
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: loaded.error });
      return;
    }
    await mintKeepersAndReply(msg.chat.id, playable(loaded.picks));
    return;
  }
  if (legCount && sport && !code) {
    await createSportSlip(msg.chat.id, sport, legCount);
    return;
  }
  if (legCount && code) {
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
        text: `That ticket has no ${sport} legs. Building a fresh ${clampLegs(legCount, 5)}-leg ${sport} slip instead.`,
      });
      await createSportSlip(msg.chat.id, sport, legCount);
      return;
    }
    await sureNAndReply(msg.chat.id, filtered, legCount);
    return;
  }
  if (sport && !legCount && !code) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: `How many ${sport} legs? Example: 12 legs ${sport}`,
    });
    return;
  }
  if (legCount && !code) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: `Say the sport too — example: ${clampLegs(legCount, 5)} legs football`,
    });
    return;
  }
  if (!code) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: "Send a SportyBet booking code, or ask: 12 legs football ⚽",
    });
    return;
  }
  await handleCode(msg.chat.id, code);
}
