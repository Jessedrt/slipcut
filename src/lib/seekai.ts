import { seekaiKeys } from "./keys";

const BASE = "https://seekai.cc/v1";
const MODEL = process.env.SEEKAI_MODEL?.trim() || "claude-opus-4-8";

let seq = 0;

function takeKey(keys: string[]) {
  if (!keys.length) return "";
  return keys[seq++ % keys.length] ?? "";
}

export function seekaiReady() {
  return seekaiKeys().length > 0;
}

export async function seekChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  timeoutMs = 20_000,
): Promise<string> {
  const keys = seekaiKeys();
  if (!keys.length) throw new Error("SeekAI key no dey");

  let last = "Opus unavailable.";
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const apiKey = takeKey(keys);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 900,
          temperature: 0.2,
          messages,
        }),
      });
      if (res.status === 401 || res.status === 402 || res.status === 429) {
        last = `Opus unavailable (${res.status})`;
        continue;
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Opus unavailable (${res.status})${errText ? `: ${errText.slice(0, 160)}` : ""}`);
      }
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = body.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) throw new Error("Opus returned empty");
      return text;
    } catch (err) {
      last = err instanceof Error ? err.message : last;
      if (attempt === keys.length - 1) throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(last);
}
