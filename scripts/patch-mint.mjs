#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "fs";
const path = "src/lib/telegram.ts";
if (!existsSync(path)) process.exit(0);
let t = readFileSync(path, "utf8");
if (t.includes("Could not mint SportyBet code")) {
  console.log("patch-mint: already applied");
  process.exit(0);
}
const bad = 'await tg("sendMessage", { chat_id: chatId, text: minted.error });';
if (!t.includes(bad)) {
  console.warn("patch-mint: target not found");
  process.exit(0);
}
const good =
  'console.error("[mint]", minted.error);\n' +
  '    {\n' +
  '      const lines = work.map((p, i) => {\n' +
  '        const price = p.odds ? formatOdds(p.odds) : "";\n' +
  '        return `${i + 1}. ${esc(p.home)} vs ${esc(p.away)} · ${esc(p.selection)}${price ? ` · ${price}` : ""}`;\n' +
  '      });\n' +
  '      await tg("sendMessage", {\n' +
  '        chat_id: chatId,\n' +
  '        parse_mode: "HTML",\n' +
  '        text: [esc(title), "Could not mint SportyBet code — safest picks:", "", ...lines].join("\\n").slice(0, 3900),\n' +
  '      });\n' +
  '    }';
t = t.replace(bad, good);
writeFileSync(path, t);
console.log("patch-mint: applied");
