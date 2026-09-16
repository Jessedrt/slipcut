#!/usr/bin/env node
/**
 * If sportybet.ts is PLACEHOLDER/broken, restore from last known good commit then apply SlipPilot mint.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";

const path = "src/lib/sportybet.ts";
const GOOD_URL =
  "https://raw.githubusercontent.com/Jessedrt/slipcut/f8c4ce99be6e1b9cd92654c51f8412287a3a4a7c/src/lib/sportybet.ts";

function isValid(src) {
  return src && src.length > 10000 && src.includes("mintShare") && !src.includes("PLACEHOLDER");
}

let t = existsSync(path) ? readFileSync(path, "utf8") : "";
if (!isValid(t)) {
  console.warn("sportybet.ts broken — restoring from known-good commit");
  const res = await fetch(GOOD_URL);
  if (!res.ok) {
    console.error("restore fetch failed", res.status);
    process.exit(1);
  }
  t = await res.text();
  if (!isValid(t)) {
    console.error("restored content still invalid");
    process.exit(1);
  }
  writeFileSync(path, t);
  console.log("sportybet.ts restored", t.length);
}

if (t.includes("refreshSportySelections") && t.includes("toSportyTuple")) {
  console.log("SlipPilot mint already present");
  process.exit(0);
}

const oldHeaders = `function sportyHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 SlipCut",
    Clientid: "web",
    OperId: "2",
    Platform: "web",
  };
}`;

const newHeaders = `function sportyHeaders(method: "GET" | "POST" = "GET", country = "ng"): Record<string, string> {
  const base = "https://www.sportybet.com";
  return {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json;charset=UTF-8",
    "Current-Country": country.toUpperCase(),
    Origin: base,
    Referer: \`${base}/${country}/\`,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    Clientid: "web",
    Platform: "web",
    ...(method === "POST" ? { OperId: "2" } : {}),
  };
}`;

if (t.includes(oldHeaders)) {
  t = t.replace(oldHeaders, newHeaders);
  console.log("headers → SlipPilot browser style");
}

const marker = "export async function mintShare(";
const idx = t.indexOf(marker);
if (idx < 0) {
  writeFileSync(path, t);
  console.warn("mintShare not found");
  process.exit(0);
}
let i = idx;
let depth = 0;
let started = false;
for (; i < t.length; i++) {
  if (t[i] === "{") {
    depth++;
    started = true;
  } else if (t[i] === "}") {
    depth--;
    if (started && depth === 0) {
      i++;
      break;
    }
  }
}

const newMint = `function toSportyTuple(s: SportySelection) {
  return {
    eventId: s.eventId,
    marketId: s.marketId,
    outcomeId: s.outcomeId,
    specifier: s.specifier ? s.specifier : null,
  };
}

async function refreshSportySelections(
  selections: SportySelection[],
  country: string,
): Promise<SportySelection[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(\`https://www.sportybet.com/api/\${country}/factsCenter/Outcomes\`, {
      method: "POST",
      signal: controller.signal,
      headers: sportyHeaders("POST", country),
      body: JSON.stringify(selections.map(toSportyTuple)),
    });
    const payload = (await res.json()) as { bizCode?: number; message?: string };
    if (payload.bizCode !== 10000) throw new Error(payload.message || "Outcomes refresh failed");
    return selections;
  } finally {
    clearTimeout(timer);
  }
}

export async function mintShare(
  selections: SportySelection[],
  country = "ng",
): Promise<MintResult | { error: string }> {
  if (!selections.length) return { error: "No SportyBet selections to book." };
  let live = selections;
  try {
    live = await refreshSportySelections(selections, country);
  } catch (err) {
    console.warn("[mint] outcomes refresh skipped:", err instanceof Error ? err.message : err);
  }
  const body = { selections: live.map(toSportyTuple) };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(\`https://www.sportybet.com/api/\${country}/orders/share\`, {
      method: "POST",
      signal: controller.signal,
      headers: sportyHeaders("POST", country),
      body: JSON.stringify(body),
    });
    const payload = (await res.json()) as SharePayload;
    const code = payload.data?.shareCode;
    if (payload.bizCode === 10000 && code) {
      const shareURL =
        payload.data?.shareURL || \`https://www.sportybet.com/\${country}/?shareCode=\${code}\`;
      return {
        shareCode: code,
        shareURL,
        unavailable: Array.isArray(payload.data?.unavailableOutcomes)
          ? payload.data.unavailableOutcomes.length
          : 0,
      };
    }
    return { error: payload.message || "SportyBet did not return a booking code." };
  } catch {
    return { error: "Could not reach SportyBet to mint a code." };
  } finally {
    clearTimeout(timer);
  }
}
`;

t = t.slice(0, idx) + newMint + t.slice(i);
writeFileSync(path, t);
console.log("SlipPilot mint flow applied", t.length);
