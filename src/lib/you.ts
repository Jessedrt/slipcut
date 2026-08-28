export function youKeys(): string[] {
  const listed = [
    process.env.YDC_API_KEY,
    process.env.YDC_API_KEY_2,
    process.env.YDC_API_KEY_3,
    process.env.YOU_API_KEY,
    process.env.YOUCOM_API_KEY,
  ];
  const extra = (process.env.YDC_API_KEYS ?? "").split(/[,;\n]+/);
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const raw of [...listed, ...extra]) {
    const key = (raw ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function youKey() {
  return youKeys()[0] ?? "";
}

let seq = 0;

function takeKey(keys: string[]) {
  return keys[seq++ % keys.length] ?? "";
}

async function youPost(
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const keys = youKeys();
  if (!keys.length) throw new Error("AI is not available in this environment");

  let lastError = "Analyst unavailable.";
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const apiKey = takeKey(keys);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`https://api.you.com${path}`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify(body),
      });
      if (res.status === 401 || res.status === 402 || res.status === 429) {
        lastError = `Analyst unavailable (${res.status})`;
        continue;
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `Analyst unavailable (${res.status})${errText ? `: ${errText.slice(0, 180)}` : ""}`,
        );
      }
      return await res.json();
    } catch (err) {
      if (attempt === keys.length - 1) throw err;
      lastError = err instanceof Error ? err.message : lastError;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastError);
}

export async function youAnswer(query: string, timeoutMs = 8_000): Promise<string> {
  const body = (await youPost(
    "/v1/answer",
    { query, freshness: "week" },
    timeoutMs,
  )) as { answer?: string };
  return body.answer ?? "";
}

export async function youContents(url: string): Promise<string> {
  const body = (await youPost(
    "/v1/contents",
    { urls: [url], formats: ["markdown"] },
    12_000,
  )) as
    | Array<{ markdown?: string | null }>
    | { data?: Array<{ markdown?: string | null }> };
  const rows = Array.isArray(body) ? body : body.data ?? [];
  const markdown = rows.map((row) => row.markdown ?? "").join("\n\n").trim();
  if (!markdown) throw new Error("That link had no readable ticket text.");
  return markdown;
}

export function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s)]+/i);
  if (!m) return null;
  return m[0].replace(/[.,;]+$/, "");
}
