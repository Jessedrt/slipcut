#!/usr/bin/env node
/**
 * Ensures natural-language "safer/find football games" cooks instead of bare HELP.
 * Runs at build time after restore-telegram.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";

const path = "src/lib/telegram.ts";
if (!existsSync(path)) {
  console.warn("patch-safer-nl: no telegram.ts");
  process.exit(0);
}
let t = readFileSync(path, "utf8");
if (t.includes("Finding safest") && t.includes("Natural-language cook")) {
  console.log("patch-safer-nl: already applied");
  process.exit(0);
}

const marker =
  '  if (/check today|book the best|teams to score|book (me )?games|from (my )?instruction/i.test(lower)) {\n' +
  '    await tg("sendMessage", { chat_id: chatId, text: "Checking today’s board…" });\n' +
  '    await cookInstruction(chatId, raw);\n' +
  '    return;\n' +
  '  }';

const replacement =
  '  // Natural-language cook: safer games, find games, give me N games, etc.\n' +
  '  if (\n' +
  '    /check today|book the best|teams to score|book (me )?games|from (my )?instruction/i.test(lower) ||\n' +
  '    /\\b(safer|safe|safest|high confidence)\\b/i.test(lower) ||\n' +
  '    /\\b(find|give me|get me|need|want|cook|build)\\b.*\\b(game|match|pick|selection|football|basketball)/i.test(lower) ||\n' +
  '    /\\b(football|basketball)\\b.*\\b(game|match|pick|today)/i.test(lower)\n' +
  '  ) {\n' +
  '    const sport = (parseSport(raw) || "football") as BookSport;\n' +
  '    const window = parseCookWindow(raw) || "today";\n' +
  '    const nMatch =\n' +
  '      lower.match(/\\b(\\d{1,2})\\s*(?:football|basketball|games|matches|picks|selections)\\b/) ||\n' +
  '      lower.match(/\\b(?:games|matches|picks)\\s*[:=]?\\s*(\\d{1,2})\\b/);\n' +
  '    const n = nMatch ? clampLegs(Number(nMatch[1]), 10) : 5;\n' +
  '    await tg("sendMessage", {\n' +
  '      chat_id: chatId,\n' +
  '      text: /safer|safe|safest|high confidence/i.test(lower)\n' +
  '        ? `Finding safest ${n} ${sport} picks (${window})… scanning boards, this can take a moment.`\n' +
  '        : `Cooking ${n} ${sport} (${window})…`,\n' +
  '    });\n' +
  '    await cookPredict(chatId, sport, n, window);\n' +
  '    return;\n' +
  '  }';

if (!t.includes(marker)) {
  console.warn("patch-safer-nl: trigger block not found — check telegram.ts");
  process.exit(0);
}
t = t.replace(marker, replacement);

const fall =
  '  await tg("sendMessage", { chat_id: chatId, text: HELP.slice(0, 3500) });\n' +
  '}';
const fallNew =
  '  if (/\\b(game|match|pick|football|basketball|odds)\\b/i.test(lower)) {\n' +
  '    const sport = (parseSport(raw) || "football") as BookSport;\n' +
  '    await tg("sendMessage", {\n' +
  '      chat_id: chatId,\n' +
  '      text: `I will pick safest ${sport} options for you…`,\n' +
  '    });\n' +
  '    await cookPredict(chatId, sport, 5, parseCookWindow(raw) || "today");\n' +
  '    return;\n' +
  '  }\n' +
  '\n' +
  '  await tg("sendMessage", { chat_id: chatId, text: HELP.slice(0, 3500) });\n' +
  '}';
const fi = t.lastIndexOf(fall);
if (fi >= 0) {
  t = t.slice(0, fi) + fallNew + t.slice(fi + fall.length);
}

const cp =
  'async function cookPredict(chatId: number, sport: BookSport, n: number, window: CookWindow) {\n' +
  '  const band = await loadOddsBand();\n' +
  '  const listed = await listUpcomingPicks(sport, Math.min(n + 12, 35), window);\n' +
  '  if ("error" in listed) {\n' +
  '    await tg("sendMessage", { chat_id: chatId, text: listed.error });\n' +
  '    return;\n' +
  '  }\n' +
  '  const pool = await cookPool(listed.filter(cookablePick), band);\n' +
  '  const researched = await researchPicks(pool, n);\n' +
  '  const take = researched.keep.slice(0, n);\n' +
  '  if (!take.length) {\n' +
  '    await tg("sendMessage", { chat_id: chatId, text: `No ${sport} picks open now.` });\n' +
  '    return;\n' +
  '  }\n' +
  '  await analyzeThenMintAll(chatId, take, `Predict · ${take.length} ${sport}`);\n' +
  '}';

const cpNew =
  'async function cookPredict(chatId: number, sport: BookSport, n: number, window: CookWindow) {\n' +
  '  const band = await loadOddsBand();\n' +
  '  const listed = await listUpcomingPicks(sport, Math.min(Math.max(n + 20, 40), 50), window);\n' +
  '  if ("error" in listed) {\n' +
  '    await tg("sendMessage", { chat_id: chatId, text: listed.error });\n' +
  '    return;\n' +
  '  }\n' +
  '  let pool = await cookPool(listed.filter(cookablePick), band);\n' +
  '  const safeish = pool.filter((p) => !p.odds || (p.odds >= 1.15 && p.odds <= 2.4));\n' +
  '  if (safeish.length >= n) pool = safeish;\n' +
  '  const researched = await researchPicks(pool, Math.max(n * 2, 12));\n' +
  '  const ranked = [...researched.keep].sort(\n' +
  '    (a, b) => (b.probability ?? 0) - (a.probability ?? 0) || (a.odds ?? 99) - (b.odds ?? 99),\n' +
  '  );\n' +
  '  const seen = new Set();\n' +
  '  const take = [];\n' +
  '  for (const p of ranked) {\n' +
  '    const key = p.eventId || `${p.home}|${p.away}`;\n' +
  '    if (seen.has(key)) continue;\n' +
  '    seen.add(key);\n' +
  '    take.push(p);\n' +
  '    if (take.length >= n) break;\n' +
  '  }\n' +
  '  if (!take.length) {\n' +
  '    await tg("sendMessage", { chat_id: chatId, text: `No ${sport} picks open now.` });\n' +
  '    return;\n' +
  '  }\n' +
  '  await analyzeThenMintAll(chatId, take, `Safest · ${take.length} ${sport}`);\n' +
  '}';

if (t.includes(cp)) {
  t = t.replace(cp, cpNew);
  console.log("patch-safer-nl: cookPredict biased to safest");
} else {
  console.warn("patch-safer-nl: cookPredict block not found");
}

writeFileSync(path, t);
console.log("patch-safer-nl: applied", t.length);
