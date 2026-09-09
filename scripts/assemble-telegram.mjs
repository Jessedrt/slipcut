import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chunkDir = join(root, "src/lib");
const chunks = [];
for (let i = 0; i < 20; i++) {
  const p = join(chunkDir, `tg.b64.${i}.txt`);
  if (!existsSync(p)) break;
  chunks.push(readFileSync(p, "utf8").trim());
}
if (!chunks.length) {
  console.log("[assemble-telegram] no b64 chunks");
  process.exit(0);
}
const body = Buffer.from(chunks.join(""), "base64").toString("utf8");
writeFileSync(join(chunkDir, "telegram.ts"), body);
console.log("[assemble-telegram] wrote telegram.ts bytes", body.length);
