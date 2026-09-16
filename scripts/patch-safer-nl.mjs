#!/usr/bin/env node
/**
 * Build-time patch: natural-language safer/find games cook instead of bare HELP.
 * Also ranks cookPredict by probability (one leg per event).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";

const path = "src/lib/telegram.ts";
if (!existsSync(path)) {
  console.warn("patch-safer-nl: no telegram.ts");
  process.exit(0);
}
let t = readFileSync(path, "utf8");
if (t.includes("FIND_SAFER_NL_V1")) {
  console.log("patch-safer-nl: already applied");
  process.exit(0);
}

const reTrig =
  /if \(\/check today\|book the best\|teams to score\|book \(me \)\?games\|from \(my \)\?instruction\/i\.test\(lower\)\)/;
if (reTrig.test(t)) {
  t = t.replace(
    reTrig,
    "if (/check today|book the best|teams to score|book (me )?games|from (my )?instruction|\\b(safer|safe|safest|high confidence)\\b|find .*games?|give me .*games?|football .*today|basketball .*today/i.test(lower))",
  );
  console.log("patch-safer-nl: expanded cook trigger");
} else {
  console.warn("patch-safer-nl: trigger regex miss");
}

const fallNeedle = 'await tg("sendMessage", { chat_id: chatId, text: HELP.slice(0, 3500) });';
const fallInsert =
  [
    "  // FIND_SAFER_NL_V1",
    '  if (/\\b(game|match|pick|football|basketball|odds|safer|safe)\\b/i.test(lower)) {',
    '    const sport = (parseSport(raw) || "football") as BookSport;',
    "    const nMatch = lower.match(/\\b(\\d{1,2})\\b/);",
    "    const n = nMatch ? clampLegs(Number(nMatch[1]), 10) : 5;",
    '    await tg("sendMessage", { chat_id: chatId, text: "Finding safest " + n + " " + sport + " picks… this can take a moment." });',
    '    await cookPredict(chatId, sport, n, parseCookWindow(raw) || "today");',
    "    return;",
    "  }",
    "",
  ].join("\n") + "\n  ";

const lastFall = t.lastIndexOf(fallNeedle);
if (lastFall >= 0 && !t.includes("FIND_SAFER_NL_V1")) {
  t = t.slice(0, lastFall) + fallInsert + t.slice(lastFall);
  console.log("patch-safer-nl: fallthrough safest cook");
}

if (t.includes("researched.keep.slice(0, n)") && !t.includes("SAFEST_RANK_V1")) {
  t = t.replace(
    "const researched = await researchPicks(pool, n);\n  const take = researched.keep.slice(0, n);",
    "/* SAFEST_RANK_V1 */ const researched = await researchPicks(pool, Math.max(n * 2, 12));\n" +
      "  const ranked = [...researched.keep].sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0) || (a.odds ?? 99) - (b.odds ?? 99));\n" +
      "  const seen = new Set();\n" +
      "  const take = [];\n" +
      "  for (const p of ranked) {\n" +
      '    const key = p.eventId || p.home + "|" + p.away;\n' +
      "    if (seen.has(key)) continue;\n" +
      "    seen.add(key);\n" +
      "    take.push(p);\n" +
      "    if (take.length >= n) break;\n" +
      "  }",
  );
  t = t.replace(
    "listUpcomingPicks(sport, Math.min(n + 12, 35), window)",
    "listUpcomingPicks(sport, Math.min(Math.max(n + 20, 40), 50), window)",
  );
  console.log("patch-safer-nl: safest ranking");
}

writeFileSync(path, t);
console.log("patch-safer-nl: done", t.length);
