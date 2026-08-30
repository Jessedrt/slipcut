import { geminiKeys } from "./keys";

const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";

let seq = 0;

function takeKey(keys: string[]) {
  if (!keys.length) return "";
  return keys[seq++ % keys.length] ?? "";
}

export function geminiReady() {
  return geminiKeys().length > 0;
}

export async function geminiChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  timeoutMs = 20_000,
): Promise<string> {
  const keys = geminiKeys();
  if (!keys.length) throw new Error("Gemini key no dey");

  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  let last = "Gemini unavailable.";
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const apiKey = takeKey(keys);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          contents,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 900,
          },
        }),
      });
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        last = `Gemini unavailable (${res.status})`;
        continue;
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `Gemini unavailable (${res.status})${errText ? `: ${errText.slice(0, 160)}` : ""}`,
        );
      }
      const body = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text =
        body.candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? "")
          .join("")
          .trim() ?? "";
      if (!text) throw new Error("Gemini returned empty");
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
