#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const sourcePath = "scripts/final-ui.mjs";
const runtimePath = "scripts/.final-ui-runtime.mjs";
let source = readFileSync(sourcePath, "utf8");
source = source.replace(
  '`Generate ${bookmakerLabel(targetBookmaker)} Code`',
  '"Generate " + bookmakerLabel(targetBookmaker) + " Code"',
);
writeFileSync(runtimePath, source);
try {
  await import(pathToFileURL(new URL(`../${runtimePath}`, import.meta.url).pathname).href + `?t=${Date.now()}`);
} finally {
  try {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(runtimePath);
  } catch {}
}
