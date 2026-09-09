import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parts = ["telegram.p1.ts", "telegram.p2.ts", "telegram.p3.ts"].map((f) => join(root, "src/lib", f));
const out = join(root, "src/lib/telegram.ts");
if (parts.every((p) => existsSync(p))) {
  const body = parts.map((p) => readFileSync(p, "utf8")).join("");
  writeFileSync(out, body);
  console.log("[assemble-telegram] wrote", out, "bytes", body.length);
} else {
  console.log("[assemble-telegram] parts missing, keeping existing telegram.ts");
}
