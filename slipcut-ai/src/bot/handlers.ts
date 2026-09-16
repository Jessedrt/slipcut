import type { Context } from "telegraf";
import { parseIntent } from "../ai/intent.js";
import { analyzeMany, pickSafestN } from "../analysis/confidence.js";
import { diversifyForCook, rankMarkets } from "../markets/catalog.js";
import {
  getEventMarkets,
  listFixtures,
  loadBookingCode,
  mintShareCode,
} from "../sportybet/provider.js";
import {
  optimizeSlip,
  removeBelowConfidence,
  removeWeakest,
  splitSlip,
} from "../slips/optimizer.js";
import type { AnalyzedSelection, BuiltSlip } from "../types/index.js";
import { formatSelectionCard, formatSlip, START_TEXT } from "./format.js";
import { clearSession, getSession, saveSlip } from "./memory.js";
import { logger } from "../utils/logger.js";

async function buildCandidates(
  sport: "football" | "basketball",
  limitEvents = 28,
  marketPreference?: string,
): Promise<AnalyzedSelection[]> {
  const fixtures = await listFixtures(sport);
  if (!fixtures.length) return [];
  const slice = fixtures.slice(0, limitEvents);
  const all: AnalyzedSelection[] = [];
  for (let i = 0; i < slice.length; i += 3) {
    const batch = slice.slice(i, i + 3);
    const markets = await Promise.all(
      batch.map((f) =>
        getEventMarkets(f.eventId, sport, {
          home: f.home,
          away: f.away,
          league: f.league,
          kickoff: f.kickoff,
        }),
      ),
    );
    for (const ms of markets) {
      const diversified = diversifyForCook(ms, sport, {
        perCategory: 4,
        maxTotal: 40,
        marketPreference,
      });
      const keys = new Set(diversified.map((m) => `${m.providerMarketId}:${m.providerSelectionId}`));
      const extra = ms.filter(
        (m) => m.status === "open" && !keys.has(`${m.providerMarketId}:${m.providerSelectionId}`),
      );
      const analyzed = analyzeMany([...diversified, ...extra]);
      all.push(...pickSafestN(analyzed, 3));
    }
  }
  return all;
}

export async function handleStart(ctx: Context) {
  await ctx.reply(START_TEXT, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "5 Football", callback_data: "cook:football:5" },
          { text: "5 Basketball", callback_data: "cook:basketball:5" },
        ],
        [
          { text: "Around 10 odds", callback_data: "cook:football:6:10" },
          { text: "Goal markets", callback_data: "cook:football:5:goals" },
        ],
        [{ text: "Help", callback_data: "help" }],
      ],
    },
  });
}

export async function handleHelp(ctx: Context) {
  await ctx.reply(START_TEXT);
}

export async function handleText(ctx: Context) {
  const text = "text" in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : "";
  if (!text) return;
  const telegramId = String(ctx.from?.id || "");
  const session = getSession(telegramId);
  const intent = await parseIntent(text);
  session.lastIntent = intent;
  logger.info({ intent, telegramId }, "intent");

  if (intent.action === "help") return handleHelp(ctx);

  if (intent.action === "analyze_code" || intent.bookingCode) {
    const code = intent.bookingCode || text.trim().toUpperCase();
    await ctx.reply(`Loading code ${code}…`);
    const loaded = await loadBookingCode(code);
    if (!loaded.ok) {
      await ctx.reply(`Could not load code: ${loaded.error}`);
      return;
    }
    const analyzed = analyzeMany(loaded.selections);
    const slip: BuiltSlip = {
      legs: analyzed,
      combinedOdds: analyzed.reduce((a, l) => a * l.odds, 1),
      averageConfidence:
        (analyzed.reduce((s, l) => s + l.modelProbability, 0) / analyzed.length) * 100,
      riskMode: "conservative",
    };
    saveSlip(telegramId, slip);
    await ctx.reply(formatSlip(slip, "Slip Analysis"), {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Remove Weakest", callback_data: "edit:remove_weakest" },
            { text: "Split 2", callback_data: "edit:split:2" },
          ],
          [{ text: "Generate SportyBet Code", callback_data: "book" }],
        ],
      },
    });
    return;
  }

  if (intent.action === "edit_slip" && session.currentSlip) {
    let legs = session.currentSlip.legs;
    if (intent.editOp === "remove_weakest") legs = removeWeakest(legs, intent.removeCount || 1);
    if (intent.editOp === "remove_below_confidence" && intent.minimumConfidence)
      legs = removeBelowConfidence(legs, intent.minimumConfidence);
    if (intent.editOp === "change_to_goals") {
      await ctx.reply("Rebuilding with safest goal markets…");
      const sport = (legs[0]?.sport as "football" | "basketball") || "football";
      const candidates = await buildCandidates(sport, 28, "goals");
      const rebuilt = optimizeSlip({
        candidates,
        gameCount: legs.length,
        targetOdds: intent.targetOdds || session.currentSlip.targetOdds,
        riskMode: intent.riskMode || "conservative",
      });
      legs = rebuilt.legs;
    }
    if (intent.editOp === "trim_to_odds" && intent.targetOdds) {
      legs = optimizeSlip({
        candidates: legs,
        targetOdds: intent.targetOdds,
        gameCount: legs.length,
        riskMode: intent.riskMode || "conservative",
      }).legs;
    }
    const slip: BuiltSlip = {
      legs,
      combinedOdds: legs.reduce((a, l) => a * l.odds, 1),
      averageConfidence: legs.length
        ? (legs.reduce((s, l) => s + l.modelProbability, 0) / legs.length) * 100
        : 0,
      riskMode: intent.riskMode || session.currentSlip.riskMode || "conservative",
      targetOdds: intent.targetOdds,
    };
    saveSlip(telegramId, slip);
    await ctx.reply(formatSlip(slip, "Updated slip"), {
      reply_markup: {
        inline_keyboard: [[{ text: "Generate SportyBet Code", callback_data: "book" }]],
      },
    });
    return;
  }

  if (intent.action === "split_slip" && session.currentSlip) {
    const parts = intent.splitParts || 2;
    const slips = splitSlip(session.currentSlip.legs, parts);
    for (let i = 0; i < slips.length; i++) {
      await ctx.reply(formatSlip(slips[i], `Slip ${String.fromCharCode(65 + i)}`));
    }
    if (slips[0]) saveSlip(telegramId, slips[0]);
    return;
  }

  if (intent.action === "book" && session.currentSlip) {
    await ctx.reply("Refreshing odds & preparing code…");
    const sels = session.currentSlip.legs.map((l) => ({
      eventId: l.eventId,
      marketId: l.providerMarketId,
      outcomeId: l.providerSelectionId,
      specifier: l.specifier,
    }));
    const minted = await mintShareCode(sels);
    if (!minted.ok) {
      await ctx.reply(`Booking failed: ${minted.error}`);
      return;
    }
    await ctx.reply(
      `SportyBet code: ${minted.code}\nSelections: ${sels.length}\nOdds: ${session.currentSlip.combinedOdds.toFixed(2)}\n\nOdds may change. You control the stake.`,
      { reply_markup: { inline_keyboard: [[{ text: "Open SportyBet", url: minted.url }]] } },
    );
    return;
  }

  if (intent.action === "explore_markets" && intent.fixtureQuery) {
    await ctx.reply(`Searching markets for ${intent.fixtureQuery}…`);
    const sport = intent.sport || "football";
    const fixtures = await listFixtures(sport);
    const q = intent.fixtureQuery.toLowerCase();
    const hit = fixtures.find(
      (f) =>
        f.home.toLowerCase().includes(q.split(/\s+vs\s+|\s+v\s+/)[0] || q) ||
        `${f.home} ${f.away}`.toLowerCase().includes(q),
    );
    if (!hit) {
      await ctx.reply("Could not match that fixture on SportyBet right now.");
      return;
    }
    const markets = await getEventMarkets(hit.eventId, sport, hit);
    const analyzed = analyzeMany(rankMarkets(markets).slice(0, 20));
    await ctx.reply(
      `${hit.home} vs ${hit.away}\n${hit.league}\nOpen markets (sample):\n\n` +
        analyzed.map((a) => formatSelectionCard(a)).join("\n\n—\n\n"),
    );
    return;
  }

  const sport = intent.sport || session.lastSport || "football";
  session.lastSport = sport;

  if (!intent.gameCount && !intent.gameCountMin && !intent.targetOdds && !intent.marketPreference) {
    await ctx.reply("How many games do you want?", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "3", callback_data: `cook:${sport}:3` },
            { text: "5", callback_data: `cook:${sport}:5` },
            { text: "8", callback_data: `cook:${sport}:8` },
            { text: "10", callback_data: `cook:${sport}:10` },
          ],
          [
            { text: "Goals", callback_data: `cook:${sport}:5:goals` },
            { text: "BTTS", callback_data: `cook:${sport}:5:btts` },
            { text: "Handicap", callback_data: `cook:${sport}:5:handicap` },
          ],
        ],
      },
    });
    return;
  }

  await ctx.reply(
    `Scanning full market boards for safest ${sport} picks` +
      (intent.marketPreference ? ` (${intent.marketPreference})` : "") +
      `… this can take a moment.`,
  );
  const candidates = await buildCandidates(sport, 28, intent.marketPreference);
  if (!candidates.length) {
    await ctx.reply("SportyBet unavailable or no fixtures. Try again shortly.");
    return;
  }
  const slip = optimizeSlip({
    candidates,
    targetOdds: intent.targetOdds,
    gameCount: intent.gameCount,
    gameCountMin: intent.gameCountMin,
    gameCountMax: intent.gameCountMax,
    minimumConfidence: intent.minimumConfidence,
    riskMode: intent.riskMode || "conservative",
  });
  if (!slip.legs.length) {
    await ctx.reply("No selections passed your filters.");
    return;
  }
  saveSlip(telegramId, slip);
  await ctx.reply(formatSlip(slip), {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Remove Weakest", callback_data: "edit:remove_weakest" },
          { text: "Split 2", callback_data: "edit:split:2" },
        ],
        [{ text: "Generate SportyBet Code", callback_data: "book" }],
      ],
    },
  });
}

export async function handleCallback(ctx: Context) {
  const data = "data" in (ctx.callbackQuery ?? {}) ? (ctx.callbackQuery as { data: string }).data : "";
  await ctx.answerCbQuery().catch(() => undefined);
  if (data === "help") return handleHelp(ctx);
  if (data === "book") {
    (ctx as { message?: { text: string } }).message = { text: "book" };
    return handleText(ctx);
  }
  if (data.startsWith("cook:")) {
    const parts = data.split(":");
    const sport = parts[1] || "football";
    const n = parts[2] || "5";
    const market = parts[3];
    const bits = [`Give me ${n} ${sport} games`];
    if (market === "goals") bits.push("on goal markets");
    else if (market === "btts") bits.push("btts only");
    else if (market === "handicap") bits.push("handicap markets");
    else if (market && !Number.isNaN(Number(market))) bits.push(`around ${market} odds`);
    (ctx as { message?: { text: string } }).message = { text: bits.join(" ") };
    return handleText(ctx);
  }
  if (data === "edit:remove_weakest") {
    (ctx as { message?: { text: string } }).message = { text: "Remove the weakest" };
    return handleText(ctx);
  }
  if (data.startsWith("edit:split:")) {
    (ctx as { message?: { text: string } }).message = { text: `Split into ${data.split(":")[2]}` };
    return handleText(ctx);
  }
}

export async function handleClear(ctx: Context) {
  clearSession(String(ctx.from?.id || ""));
  await ctx.reply("Conversation cleared.");
}
