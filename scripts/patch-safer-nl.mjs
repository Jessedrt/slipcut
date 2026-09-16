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

const marker = `  if (/check today|book the best|teams to score|book (me )?games|from (my )?instruction/i.test(lower)) {
    await tg("sendMessage", { chat_id: chatId, text: "Checking today’s board…" });
    await cookInstruction(chatId, raw);
    return;
  }`;

const replacement = `  // Natural-language cook: safer games, find games, give me N games, etc.
  if (
    /check today|book the best|teams to score|book (me )?games|from (my )?instruction/i.test(lower) ||
    /\\b(safer|safe|safest|high confidence)\\b/i.test(lower) ||
    /\\b(find|give me|get me|need|want|cook|build)\\b.*\\b(game|match|pick|selection|football|basketball)/i.test(lower) ||
    /\\b(football|basketball)\\b.*\\b(game|match|pick|today)/i.test(lower)
  ) {
    const sport = (parseSport(raw) || "football") as BookSport;
    const window = parseCookWindow(raw) || "today";
    const nMatch =
      lower.match(/\\b(\\d{1,2})\\s*(?:football|basketball|games|matches|picks|selections)\\b/) ||
      lower.match(/\\b(?:games|matches|picks)\\s*[:=]?\\s*(\\d{1,2})\\b/);
    const n = nMatch ? clampLegs(Number(nMatch[1]), 10) : 5;
    await tg("sendMessage", {
      chat_id: chatId,
      text: /safer|safe|safest|high confidence/i.test(lower)
        ? `Finding safest ${n} ${sport} picks (${window})… scanning boards, this can take a moment.`
        : `Cooking ${n} ${sport} (${window})…`,
    });
    await cookPredict(chatId, sport, n, window);
    return;
  }`;

if (!t.includes(marker)) {
  console.warn("patch-safer-nl: trigger block not found — check telegram.ts");
  process.exit(0);
}
t = t.replace(marker, replacement);

const fall = `  await tg("sendMessage", { chat_id: chatId, text: HELP.slice(0, 3500) });
}`;
const fallNew = `  if (/\\b(game|match|pick|football|basketball|odds)\\b/i.test(lower)) {
    const sport = (parseSport(raw) || "football") as BookSport;
    await tg("sendMessage", {
      chat_id: chatId,
      text: `I will pick safest ${sport} options for you…`,
    });
    await cookPredict(chatId, sport, 5, parseCookWindow(raw) || "today");
    return;
  }

  await tg("sendMessage", { chat_id: chatId, text: HELP.slice(0, 3500) });
}`;
const fi = t.lastIndexOf(fall);
if (fi >= 0) {
  t = t.slice(0, fi) + fallNew + t.slice(fi + fall.length);
}

const cp = `async function cookPredict(chatId: number, sport: BookSport, n: number, window: CookWindow) {
  const band = await loadOddsBand();
  const listed = await listUpcomingPicks(sport, Math.min(n + 12, 35), window);
  if ("error" in listed) {
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  const pool = await cookPool(listed.filter(cookablePick), band);
  const researched = await researchPicks(pool, n);
  const take = researched.keep.slice(0, n);
  if (!take.length) {
    await tg("sendMessage", { chat_id: chatId, text: `No ${sport} picks open now.` });
    return;
  }
  await analyzeThenMintAll(chatId, take, `Predict · ${take.length} ${sport}`);
}`;

const cpNew = `async function cookPredict(chatId: number, sport: BookSport, n: number, window: CookWindow) {
  const band = await loadOddsBand();
  const listed = await listUpcomingPicks(sport, Math.min(Math.max(n + 20, 40), 50), window);
  if ("error" in listed) {
    await tg("sendMessage", { chat_id: chatId, text: listed.error });
    return;
  }
  let pool = await cookPool(listed.filter(cookablePick), band);
  const safeish = pool.filter((p) => !p.odds || (p.odds >= 1.15 && p.odds <= 2.4));
  if (safeish.length >= n) pool = safeish;
  const researched = await researchPicks(pool, Math.max(n * 2, 12));
  const ranked = [...researched.keep].sort(
    (a, b) => (b.probability ?? 0) - (a.probability ?? 0) || (a.odds ?? 99) - (b.odds ?? 99),
  );
  const seen = new Set();
  const take = [];
  for (const p of ranked) {
    const key = p.eventId || `${p.home}|${p.away}`;
    if (seen.has(key)) continue;
    seen.add(key);
    take.push(p);
    if (take.length >= n) break;
  }
  if (!take.length) {
    await tg("sendMessage", { chat_id: chatId, text: `No ${sport} picks open now.` });
    return;
  }
  await analyzeThenMintAll(chatId, take, `Safest · ${take.length} ${sport}`);
}`;

if (t.includes(cp)) {
  t = t.replace(cp, cpNew);
  console.log("patch-safer-nl: cookPredict biased to safest");
}

writeFileSync(path, t);
console.log("patch-safer-nl: applied", t.length);
