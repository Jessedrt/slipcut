import { geminiKeys } from "./keys";

const MODELS = [...new Set([
  process.env.GEMINI_MODEL?.trim(),
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
].filter((m): m is string => Boolean(m)))];

let seq = 0;

function takeKey(keys: string[]) {
  if (!keys.length) return "";
  return keys[seq++ % keys.length] ?? "";
}

export function geminiReady() {
  return geminiKeys().length > 0;
}

async function geminiGenerate(
  system: string,
  contents: unknown[],
  timeoutMs: number,
  maxOutputTokens: number,
): Promise<string> {
  const keys = geminiKeys();
  if (!keys.length) throw new Error("Gemini key is not configured.");

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
              contents,
              generationConfig: {
                temperature: 0.15,
                maxOutputTokens,
                responseMimeType: "application/json",
              },
            }),
          },
        );

        // 401 means the credential itself is unusable. 403/404 can be
        // model-access specific, so keep trying the next supported model.
        if (res.status === 401) {
          last = "Gemini unavailable (401)";
          break;
        }
        if (res.status === 429) {
          last = `Gemini ${model} rate limited (429)`;
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
        if (!text) {
          last = `Gemini ${model} returned empty`;
          continue;
        }
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

export async function geminiChat(
  system: string,
  user: string,
  timeoutMs = 28_000,
): Promise<string> {
  return geminiGenerate(
    system,
    [{ role: "user", parts: [{ text: user }] }],
    timeoutMs,
    1400,
  );
}

export async function geminiVision(
  system: string,
  user: string,
  image: { mime: string; data: string },
  timeoutMs = 35_000,
): Promise<string> {
  return geminiGenerate(
    system,
    [
      {
        role: "user",
        parts: [
          { text: user },
          { inlineData: { mimeType: image.mime, data: image.data } },
        ],
      },
    ],
    timeoutMs,
    2000,
  );
}
