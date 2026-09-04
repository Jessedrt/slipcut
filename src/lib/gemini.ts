import { geminiKeys } from "./keys.ts";
import { geminiModels } from "./gemini-models.ts";

/**
 * Thinking models spend part of the output budget on reasoning before they emit
 * a token of JSON. The old 1400 cap could therefore truncate a reply
 * mid-object, which the parser turned into "no answer" — indistinguishable from
 * the engine being down. Leave room for the thinking plus the scored legs.
 */
const MAX_OUTPUT_TOKENS = 4096;

let seq = 0;

function takeKey(keys: string[]) {
  if (!keys.length) return "";
  return keys[seq++ % keys.length] ?? "";
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
        if (res.status === 401 || res.status === 403 || res.status === 429) {
          last = `Gemini unavailable (${res.status})`;
          break;
        }
        if (!res.ok) {
          last = `Gemini ${model} (${res.status})`;
          continue;
        }
        const body = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text =
          body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
        if (!text) throw new Error("Gemini returned empty");
        return text;
      } catch (err) {
        last = err instanceof Error ? err.message : last;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw new Error(last);
}
