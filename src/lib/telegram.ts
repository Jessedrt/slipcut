import { AsyncLocalStorage } from "node:async_hooks";
import { analyzePicks } from "./analyze";
import { extractShareCode } from "./parse-ticket";
import { normalizePidgin, pidginSmallTalk, slangHelp, splitChat, wantsCreate } from "./pidgin";
import { loadBookingCode, listUpcomingPicks, mintShare, parseMarketTarget, retargetPicks, sportyOf } from "./sportybet";
import { applyLessonScores, formatStudy, improvePicks, latestUnstudiedCode, recordSlip, studyCode } from "./study";
import { buildToOdds, combinedOdds, copyRebuild, formatOdds, keepTop, parseCommand, splitEven, trimToOdds } from "./workbench";
import type { TicketPick } from "./types";

const MAX_LEGS = 35;
const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || "";
const BANNER_URL = "https://slipcut.vercel.app/banner.jpg";
const KEEP_LINE = 45;

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

export type ChatBridge = {
  send: (method: string, payload: Record<string, unknown>) => Promise<void>;
};

export const chatBridge = new AsyncLocalStorage<ChatBridge>();

async function tg(method: string, payload: Record<string, unknown>) {
  const bridged = chatBridge.getStore();
  if (bridged) {
    await bridged.send(method, payload);
    return;
  }
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

function startKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "⚽ Cook 10× football", callback_data: "o:f:10" },
        { text: "🏀 Cook 10× basketball", callback_data: "o:b:10" },
      ],
      [
        { text: "⚽ 12 games football", callback_data: "c:f:12" },
        { text: "🏀 12 games basketball", callback_data: "c:b:12" },
      ],
      [{ text: "📓 Study last slip", callback_data: "y:LAST" }],
    ],
  };
}

function keyboard(code: string) {
  return {
    inline_keyboard: [
      [
        { text: "✂️ Trim am", callback_data: `g:${code}` },
        { text: "📓 Study am", callback_data: `y:${code}` },
      ],
      [
        { text: "➗ Split 2", callback_data: `s:${code}:2` },
        { text: "🎯 50×", callback_data: `t:${code}:50` },
        { text: "🎫 Book am", callback_data: `m:${code}` },
      ],
      [
        { text: "🔻 8 games", callback_data: `k:${code}:8` },
        { text: "🔻 12 games", callback_data: `k:${code}:12` },
        { text: "🔻 20 games", callback_data: `k:${code}:20` },
      ],
      [
        { text: "⚡ Over 2.5", callback_data: `ch:${code}:ou25` },
        { text: "🤝 GG", callback_data: `ch:${code}:gg` },
      ],
    ],
  };
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
      text: "Those games no get SportyBet ID. Send booking code first, my guy.",
    });
    return;
  }
  const minted = await mintShare(selections, country);
  if ("error" in minted && selections.length > 40) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `SportyBet no gree take ${selections.length} for one code. I dey split am.`,
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
        [{ text: "📓 Check if e cut", callback_data: `y:${code}` }],
        [{ text: "🌐 Open SportyBet", url: minted.shareURL }],
        [
          {
            text: "📤 Share give paddy",
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
    minted.unavailable ? `\n${minted.unavailable} game(s) no gree book.` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 3900);
  await tg("sendMessage", { chat_id: chatId, text: detail });
  await recordSlip(code, picks);
}

function esc(s: string) {
  return s.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
}

async function scorePlayable(picks: TicketPick[]) {
  return analyzePicks(picks, KEEP_LINE);
}

async function sureNAndReply(
  chatId: number,
  picks: TicketPick[],
  count: number,
  title = "",
) {
  const n = clampLegs(count, 2);
  if (!picks.length) {
    await tg("sendMessage", { chat_id: chatId, text: "No football or basketball for this one." });
    return;
  }
  await tg("sendMessage", {
    chat_id: chatId,
    text: `I dey pick the strongest ${n} games. Hold on.`,
  });
  const result = await scorePlayable(picks);
  const top = keepTop(await applyLessonScores(result.picks), n);
  if (!top.length) {
    await tg("sendMessage", { chat_id: chatId, text: `I no fit pick ${n} sure games from that ticket.` });
    return;
  }
  const note = top
    .map((p) => `${p.probability}% ${p.home} vs ${p.away} — ${p.selection}`)
    .join("\n");
  await mintAndReply(chatId, top, "ng", title || `${top.length} games\n${note}`);
}

async function createSportSlip(chatId: number, sport: "football" | "basketball", count: number) {
  const n = clampLegs(count, 5);
  const capNote = count > MAX_LEGS ? ` Max na ${MAX_LEGS} games.` : "";
  await tg("sendMessage", {
    chat_id: chatId,
    text: `${sportIcon(sport)} I dey cook ${n} games ${sport} slip — no be 1X2 alone. DC, over/under, GG, winner mix.${capNote}`,
  });
  const listed = await listUpcomingPicks(sport, Math.min(n + 8, 40));
  if ("error" in listed) {
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  await maybeStudyLast(chatId);
  const improved = await improvePicks(listed);
  const take = improved.slice(0, n);
  if (!take.length) {
    await tg("sendMessage", { chat_id: chatId, text: `No ${sport} dey for SportyBet now.` });
    return;
  }
  const title =
    take.length < n
      ? `${take.length} games ${sport} — na only ${take.length} games SportyBet get now`
      : `${take.length} games ${sport} — I don book am`;
  await mintAndReply(chatId, take, "ng", title);
}

async function createOddsSlip(chatId: number, sport: "football" | "basketball", targetRaw: number) {
  const target = clampOddsTarget(targetRaw);
  await tg("sendMessage", {
    chat_id: chatId,
    text: `${sportIcon(sport)} I dey cook about ${formatOdds(target)} ${sport} — no be ${Math.round(target)} games. I go pack games wey go reach that odds.`,
  });
  const listed = await listUpcomingPicks(sport, 35);
  if ("error" in listed) {
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  await maybeStudyLast(chatId);
  const improved = await improvePicks(listed);
  const take = buildToOdds(improved, target).slice(0, MAX_LEGS);
  if (!take.length) {
    await tg("sendMessage", { chat_id: chatId, text: `I no fit build ${formatOdds(target)} from the ${sport} wey dey now.` });
    return;
  }
  const actual = combinedOdds(take);
  const title =
    actual && actual < target * 0.75
      ? `${take.length} games ${sport} · ${formatOdds(actual)} — pool no reach ${formatOdds(target)}`
      : `${take.length} games ${sport} · ${actual ? formatOdds(actual) : "—"} (you ask ${formatOdds(target)})`;
  await mintAndReply(chatId, take, "ng", title);
}

function parseSport(text: string): "football" | "basketball" | null {
  if (/basket|hoop/i.test(text)) return "basketball";
  if (/foot|soccer|bola/i.test(text)) return "football";
  return null;
}

async function mintKeepersAndReply(chatId: number, picks: TicketPick[]) {
  await tg("sendMessage", { chat_id: chatId, text: "✂️ I dey trim am to the strong half." });
  const result = await scorePlayable(picks);
  const counted = result.picks.filter((p) => p.sport !== "other");
  const count = Math.max(2, Math.ceil(counted.length / 2));
  const strongest = keepTop(await applyLessonScores(result.picks), count).filter((p) => p.sporty);
  if (!strongest.length) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Nothing remain to book after I drop those ones.",
    });
    return;
  }
  await mintAndReply(chatId, strongest, "ng", `Strongest ${strongest.length} games`);
}

async function studyAndReply(chatId: number, code: string, picks?: TicketPick[]) {
  await tg("sendMessage", { chat_id: chatId, text: `📓 Make I check ${code} whether e cut.` });
  const report = await studyCode(code, picks);
  if ("error" in report) {
    await tg("sendMessage", { chat_id: chatId, text: report.error });
    return;
  }
  await tg("sendMessage", { chat_id: chatId, text: formatStudy(report) });
}

async function maybeStudyLast(chatId: number) {
  const code = await latestUnstudiedCode();
  if (!code) return;
  const report = await studyCode(code);
  if ("error" in report) return;
  if (report.pending === report.legs.length) return;
  await tg("sendMessage", { chat_id: chatId, text: formatStudy(report) });
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
      `🎫 ${loaded.shareCode} · ${loaded.picks.length} games · ${play.length} fit book`,
      "",
      listPicks(loaded.picks),
      "",
      "Trim am, study am, split, or change market. Talk to me like person.",
      "e.g. comot game 3 and 8 · split 2 · change to over 2.5 · study",
    ]
      .join("\n")
      .slice(0, 3900),
    reply_markup: keyboard(loaded.shareCode),
  });
  await recordSlip(loaded.shareCode, play);
}

const NOT_A_CODE = new Set([
  "CREATE",
  "START",
  "HELP",
  "LEGS",
  "GAMES",
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
  "STUDY",
  "CUT",
  "LOST",
  "COOK",
  "LIKE",
  "BOLA",
  "BOOK",
  "COMBINE",
  "WANT",
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
  const m = text.match(
    /(?:drop|remove|delete|comot)\s+(?:(?:legs?|games?|match(?:es)?)\s+)?(?:game\s+)?([\d,\s&and]+)/i,
  );
  if (!m) return null;
  if (!/(?:drop|remove|delete|comot)/i.test(text)) return null;
  const nums = [...m[1].matchAll(/\d+/g)].map((x) => Number(x[0])).filter((n) => n >= 1 && n <= 80);
  return nums.length ? nums : null;
}

function parseCombineCode(text: string): string | null {
  const m = text.match(
    /\b(?:combin(?:e|ing)|join|add|merge|plus)\s+(?:am\s+)?(?:with\s+)?(?:code\s+)?([A-Z0-9]{4,16})\b/i,
  );
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
      await tg("sendMessage", { chat_id: chatId, text: "Nothing remain after I drop those ones." });
      return true;
    }
    await mintAndReply(chatId, play, "ng", `🗑 Dropped ${drop.join(", ")} · ${play.length} games`);
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
    await mintAndReply(chatId, merged, "ng", `🔗 Combined ${loaded.shareCode} + ${extra.shareCode} · ${merged.length} games`);
    return true;
  }
  const market = wantsMarketChange(text);
  if (market) {
    await tg("sendMessage", { chat_id: chatId, text: `⚡ I dey change market for ${loaded.shareCode}.` });
    const next = playable(await retargetPicks(base, market));
    if (!next.length) {
      await tg("sendMessage", { chat_id: chatId, text: "That market no gree change." });
      return true;
    }
    await mintAndReply(chatId, next, "ng", `⚡ Market don change · ${next.length} games`);
    return true;
  }
  const cmd = parseCommand(text);
  if (cmd.type === "split") {
    const slips = splitEven(base, cmd.parts);
    for (let i = 0; i < slips.length; i++) {
      await mintAndReply(chatId, slips[i] ?? [], "ng", `Slip ${i + 1} · ${slips[i]?.length ?? 0} games`);
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
    await mintAndReply(chatId, trimmed, "ng", `Trimmed to ${cmd.targetOdds}× · ${trimmed.length} games`);
    return true;
  }
  if (cmd.type === "keepLegs") {
    await sureNAndReply(chatId, base, cmd.count);
    return true;
  }
  if (cmd.type === "sport") {
    const filtered = base.filter((p) => p.sport === cmd.sport);
    if (!filtered.length) {
      await tg("sendMessage", { chat_id: chatId, text: `That ticket no get ${cmd.sport} at all.` });
      return true;
    }
    await mintAndReply(chatId, filtered, "ng", `${cmd.sport} only · ${filtered.length} games`);
    return true;
  }
  return false;
}

function clampOddsTarget(n: number) {
  if (!Number.isFinite(n)) return 20;
  return Math.max(1.5, Math.min(1000, n));
}

function parseOddsTarget(text: string): number | null {
  if (/\b(?:legs?|games?)\b/i.test(text) && !/\bodds?\b|[x×]/i.test(text)) return null;
  const m =
    text.match(/(\d{1,4}(?:\.\d+)?)\s*odds?\b/i) ||
    text.match(/(\d{1,4}(?:\.\d+)?)\s*[x×]\b/i) ||
    (/\bodds?\b/i.test(text) ? text.match(/\blike\s+(\d{1,4}(?:\.\d+)?)\b/i) : null);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1.2) return null;
  return n;
}

function parseLegCount(text: string): number | null {
  if (/\bodds?\b/i.test(text) && !/\b(?:legs?|games?)\b/i.test(text)) return null;
  const m =
    text.match(/(?:sure\s*)?(\d{1,4})\s*(?:legs?|games?|matches)\b/i) ||
    text.match(/^\/(?:legs?|games?)(?:@\w+)?\s+(\d{1,4})\b/i) ||
    (parseSport(text) && !/\bodds?\b/i.test(text) ? text.match(/\b(\d{1,4})\b/) : null);
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
    if (kind === "o") {
      const sport = code === "b" ? "basketball" : "football";
      await createOddsSlip(chatId, sport, Number(arg || 10));
      return;
    }
    if (kind === "y" && code === "LAST") {
      const last = await latestUnstudiedCode();
      if (!last) {
        await tg("sendMessage", { chat_id: chatId, text: "No slip to study yet. Book one first." });
        return;
      }
      await studyAndReply(chatId, last);
      return;
    }
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await tg("sendMessage", { chat_id: chatId, text: loaded.error });
      return;
    }
    const base = playable(loaded.picks);
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
      await tg("sendMessage", { chat_id: chatId, text: `⚡ I dey change market for ${loaded.shareCode}.` });
      const next = playable(await retargetPicks(base, target));
      await mintAndReply(chatId, next, "ng", `⚡ Market don change · ${next.length} games`);
      return;
    }
    if (kind === "y") {
      await studyAndReply(chatId, loaded.shareCode, base);
      return;
    }
    if (kind === "m") {
      await mintAndReply(chatId, base, "ng", `🎫 SportyBet code · ${base.length} games`);
      return;
    }
    if (kind === "s") {
      const parts = Number(arg || 2);
      const slips = splitEven(base, parts);
      for (let i = 0; i < slips.length; i++) {
        await mintAndReply(chatId, slips[i] ?? [], "ng", `Slip ${i + 1} · ${slips[i]?.length ?? 0} games`);
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
      await mintAndReply(chatId, trimmed, "ng", `Trimmed to ${target}× · ${trimmed.length} games`);
    }
    return;
  }

  const msg = update.message;
  if (!msg?.text || !msg.chat) return;
  const raw = msg.text.trim();
  if (raw === "/start") {
    await tg("setMyCommands", {
      commands: [
        { command: "start", description: "How this thing dey work" },
        { command: "help", description: "All the commands" },
        { command: "study", description: "Check if the last slip cut" },
        { command: "slang", description: "Pidgin wey I sabi" },
      ],
    });
    await tg("setMyDescription", {
      description:
        "Convert SportyBet codes, change markets, edit tickets, and yarn pidgin with your padé.",
    });
    await tg("setMyShortDescription", {
      short_description: "Your SportyBet padé. Trim, study, book. We go yarn pidgin.",
    });
    await tg("sendPhoto", {
      chat_id: msg.chat.id,
      photo: BANNER_URL,
      caption: [
        "<b>WELCOME TO SLIPCUT</b>",
        "Omo! I dey here. Cut the slip, keep the sure games.",
      ].join("\n"),
      parse_mode: "HTML",
    });
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      parse_mode: "HTML",
      text: [
        "<b>How e work</b>",
        "",
        "Send your SportyBet code.",
        "Or yarn me like person:",
        "",
        "<code>cook 10 odds football</code>",
        "<code>12 games basketball</code>",
        "<code>how far help me cook like 30odds</code>",
        "",
        "<b>odds</b> = combined ×   ·   <b>games</b> = number of matches",
        "Football & basketball only · max 35 games",
        "",
        "Tap below or send /help for the full list.",
      ].join("\n"),
      reply_markup: startKeyboard(),
    });
    return;
  }
  if (raw === "/help") {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      parse_mode: "HTML",
      text: [
        "<b>After you send a code</b>",
        "",
        "<code>comot game 3 and 8</code> — remove those matches",
        "<code>split 2</code> — share into 2 slips",
        "<code>change to over 2.5</code>",
        "<code>change to GG</code>",
        "<code>trim to 50x</code>",
        "<code>add another booking code</code> — join two tickets",
        "<code>study</code> — after the games finish",
        "",
        "<b>Cook new slip</b>",
        "",
        "<code>cook 10 odds football</code> — about 10×",
        "<code>12 games basketball</code> — 12 matches",
        "",
        "Yarn pidgin. Send /slang if you want the dictionary.",
      ].join("\n"),
    });
    return;
  }
  if (raw === "/slang") {
    await tg("sendMessage", { chat_id: msg.chat.id, text: slangHelp() });
    return;
  }
  const chat = splitChat(raw);
  if (chat.greet && !chat.rest) {
    await tg("sendMessage", { chat_id: msg.chat.id, text: chat.greet });
    return;
  }
  const text = normalizePidgin(chat.rest || raw);
  if (chat.greet && chat.rest) {
    await tg("sendMessage", { chat_id: msg.chat.id, text: chat.greet });
  } else {
    const talk = pidginSmallTalk(raw) || pidginSmallTalk(text);
    if (talk && !codeFromText(text) && !parseLegCount(text) && !parseSport(text) && !wantsCreate(text) && !parseOddsTarget(text) && !parseOddsTarget(raw)) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: talk });
      return;
    }
  }
  const oddsTarget = parseOddsTarget(text) ?? parseOddsTarget(raw) ?? parseOddsTarget(chat.rest || "");
  const sportGuess = parseSport(text) ?? parseSport(raw);
  if (oddsTarget && !looksLikeShareCode(raw)) {
    await createOddsSlip(msg.chat.id, sportGuess ?? "football", oddsTarget);
    return;
  }
  if (raw === "/study" || /^(study|results|cut|lost|it cut|this cut)\b/i.test(text)) {
    const studyCodeToken =
      codeFromText(text) ||
      codeFromText(msg.reply_to_message?.text) ||
      (await latestUnstudiedCode());
    if (!studyCodeToken) {
      await tg("sendMessage", {
        chat_id: msg.chat.id,
        text: "Send booking code first, then talk study after the games don finish.",
      });
      return;
    }
    const loaded = await loadBookingCode(studyCodeToken, "ng");
    const picks = "error" in loaded ? undefined : playable(loaded.picks);
    await studyAndReply(msg.chat.id, studyCodeToken, picks);
    return;
  }
  const oddsOnTicket = parseOddsTarget(text) ?? parseOddsTarget(raw);
  const legCount = parseLegCount(text);
  const sport = parseSport(text) ?? parseSport(raw);
  const code = codeFromText(text) || codeFromText(msg.reply_to_message?.text);
  const isBareCode = Boolean(code && looksLikeShareCode(text));
  if (oddsOnTicket && code) {
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: loaded.error });
      return;
    }
    const base = playable(loaded.picks);
    const scored = base.map((p) => ({
      ...p,
      probability: p.odds ? Math.max(8, Math.min(90, Math.round(100 / p.odds))) : 50,
      confidence: "medium" as const,
      summary: "",
      reasons: [] as string[],
      risks: [] as string[],
      verdict: "keep" as const,
    }));
    const trimmed = trimToOdds(scored, clampOddsTarget(oddsOnTicket));
    await mintAndReply(
      msg.chat.id,
      trimmed,
      "ng",
      `Trimmed to about ${formatOdds(clampOddsTarget(oddsOnTicket))} · ${trimmed.length} games`,
    );
    return;
  }
  if (code && /\b(study|results|cut|lost)\b/i.test(text) && !isBareCode) {
    const loaded = await loadBookingCode(code, "ng");
    const picks = "error" in loaded ? undefined : playable(loaded.picks);
    await studyAndReply(msg.chat.id, code, picks);
    return;
  }
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
  if (code && /\bmint all\b/i.test(text)) {
    const loaded = await loadBookingCode(code, "ng");
    if ("error" in loaded) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: loaded.error });
      return;
    }
    const base = playable(loaded.picks);
    await mintAndReply(msg.chat.id, base, "ng", `🎫 SportyBet code · ${base.length} games`);
    return;
  }
  if (legCount && sport && !code) {
    await createSportSlip(msg.chat.id, sport, legCount);
    return;
  }
  if (legCount && !code && wantsCreate(text + " " + raw)) {
    await createSportSlip(msg.chat.id, sport ?? "football", legCount);
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
        text: `That ticket no get ${sport}. Make I cook fresh ${clampLegs(legCount, 5)} games ${sport} instead.`,
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
      text: `How many ${sport} games you want? Type: 12 games ${sport}`,
    });
    return;
  }
  if (legCount && !code) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: `Add the sport — type: ${clampLegs(legCount, 5)} games football`,
    });
    return;
  }
  if (!code) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: "I no too catch that. Yarn me like: how far help me cook like 30odds — or send SportyBet code.",
    });
    return;
  }
  await handleCode(msg.chat.id, code);
}
