import { geminiKeys } from "./keys.ts";
import {
  geminiFailure,
  geminiModels,
  geminiStatusDetail,
  type GeminiCall,
} from "./gemini-models.ts";

/**
 * Thinking models spend part of the output budget on reasoning before they emit
 * a token of JSON. The old 1400 cap could therefore truncate a reply
 * mid-object, which the parser turned into "no answer" — indistinguishable from
 * the engine being down. Leave room for the thinking plus the scored legs.
 */
const MAX_OUTPUT_TOKENS = 4096;

/**
 * A free-tier key is rate limited, not broken. Most 429s are a per-minute
 * burst, so one short retry gets the answer instead of dropping the whole
 * chunk. Capped hard: the research budget is 30s per chunk.
 */
const RATE_LIMIT_RETRY_MS = 1_500;
const RATE_LIMIT_MAX_WAIT_MS = 4_000;

let seq = 0;

function takeKey(keys: string[]) {
  if (!keys.length) return "";
  return keys[seq++ % keys.length] ?? "";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(res: Response) {
  const raw = res.headers.get("retry-after");
  if (!raw) return RATE_LIMIT_RETRY_MS;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.min(Math.max(secs * 1000, 250), RATE_LIMIT_MAX_WAIT_MS);
  const at = Date.parse(raw);
  if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 250), RATE_LIMIT_MAX_WAIT_MS);
  return RATE_LIMIT_RETRY_MS;
}

async function callModel(
  model: string,
  apiKey: string,
  system: string,
  user: string,
  timeoutMs: number,
): Promise<GeminiCall> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            temperature: 0.15,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            // We always want the JSON object and nothing else — no preamble,
            // no ```json fences for the parser to strip.
            responseMimeType: "application/json",
          },
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const failure = geminiFailure(res.status, body);
      return {
        ok: false,
        model,
        text: "",
        status: res.status,
        detail: geminiStatusDetail(res.status, model, failure),
        retryAfterMs: res.status === 429 ? retryAfterMs(res) : 0,
        failure,
      };
    }
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text =
      body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
    if (!text) {
      return {
        ok: false,
        model,
        text: "",
        status: res.status,
        detail: `${model}: empty reply`,
        retryAfterMs: 0,
        failure: "empty",
      };
    }
    return { ok: true, model, text, status: res.status, detail: "ok", retryAfterMs: 0, failure: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, model, text: "", status: 0, detail: message, retryAfterMs: 0, failure: "network" };
  } finally {
    clearTimeout(timer);
  }
}

export function geminiReady() {
  return geminiKeys().length > 0;
}

export async function geminiChat(
  system: string,
  user: string,
  timeoutMs = 28_000,
): Promise<string> {
  const keys = geminiKeys();
  if (!keys.length) throw new Error("Gemini key no dey");

  let last = "Gemini unavailable.";
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const apiKey = takeKey(keys);
    for (const model of geminiModels()) {
      let call = await callModel(model, apiKey, system, user, timeoutMs);
      if (call.status === 429) {
        // Free tier bursts clear in seconds. Try once before we write the key off.
        await sleep(Math.min(Math.max(call.retryAfterMs, 250), RATE_LIMIT_MAX_WAIT_MS));
        call = await callModel(model, apiKey, system, user, timeoutMs);
      }
      if (call.ok) return call.text;
      last = call.detail;
      // Key and quota problems belong to the credential, so move to the next
      // key rather than burning the rest of the chain. A model that this key
      // is not entitled to says nothing about the next model — keep walking.
      if (call.failure === "key" || call.failure === "quota") break;
    }
  }
  throw new Error(last);
}

export type GeminiProbe = {
  ok: boolean;
  keys: number;
  model: string;
  detail: string;
};

/**
 * Cheapest possible real request: proves the key authenticates AND that at
 * least one model in the chain actually serves it. `model` is the one that
 * answered, which is how you find out a free-tier key landed on 2.5-flash
 * instead of 3.8.
 */
export async function geminiProbe(timeoutMs = 15_000): Promise<GeminiProbe> {
  const keys = geminiKeys();
  if (!keys.length) return { ok: false, keys: 0, model: "", detail: "no key" };

  let first = "";
  for (const apiKey of keys) {
    for (const model of geminiModels()) {
      const call = await callModel(
        model,
        apiKey,
        "You are a connectivity probe. Answer with JSON only.",
        'Reply with exactly: {"ok":true}',
        timeoutMs,
      );
      if (call.ok) return { ok: true, keys: keys.length, model, detail: "ok" };
      if (!first || call.failure === "key") first = call.detail;
      if (call.failure === "key") break;
    }
  }
  return { ok: false, keys: keys.length, model: "", detail: first || "no answer" };
}
