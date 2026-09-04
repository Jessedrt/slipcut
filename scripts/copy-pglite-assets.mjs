#!/usr/bin/env node
/**
 * `vite build` (nitro) bundles @electric-sql/pglite into
 * `.vercel/output/functions/__server.func/_libs/electric-sql__pglite.mjs`, but
 * it does NOT copy the native sidecar assets that module loads at runtime
 * (`pglite.data`, `pglite.wasm`, `initdb.wasm` — they live in pglite's dist).
 * Without them, PGLite dies at boot, the dashboard reads "Database down", and
 * the desk cron can't record hits. Rebuilding the output dir wipes the assets
 * again, so this script must run after every `vite build` — it is wired into
 * the `build` script in package.json.
 */
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "node_modules/@electric-sql/pglite/dist");
const to = path.join(root, ".vercel/output/functions/__server.func/_libs");

await mkdir(to, { recursive: true });
for (const name of ["pglite.data", "pglite.wasm", "initdb.wasm"]) {
  const dest = path.join(to, name);
  await rm(dest, { force: true });
  await copyFile(path.join(from, name), dest);
  console.log(`[pglite-assets] copied ${name}`);
}
