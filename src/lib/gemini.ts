import { geminiKeys } from "./keys";

const MODELS = [
  process.env.GEMINI_MODEL?.trim(),
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
].filter((m): m is string => Boolean(m));

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
    for (const model of MODELS) {
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
              generationConfig: { temperature: 0.15, maxOutputTokens: 1400 },
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

export async function geminiVision(
  system: string,
  user: string,
  image: { mime: string; data: string },
  timeoutMs = 35_000,
): Promise<string> {
  const keys = geminiKeys();
  if (!keys.length) throw new Error("Gemini key no dey");

  let last = "Gemini vision unavailable.";
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const apiKey = takeKey(keys);
    for (const model of MODELS) {
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
              contents: [
                {
                  role: "user",
                  parts: [
                    { text: user },
                    { inlineData: { mimeType: image.mime, data: image.data } },
                  ],
                },
              ],
              generationConfig: { temperature: 0.1, maxOutputTokens: 2000 },
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
