export function youKey() {
  return (
    process.env.YDC_API_KEY ||
    process.env.YOU_API_KEY ||
    process.env.YOUCOM_API_KEY ||
    ""
  );
}

export async function youAnswer(query: string): Promise<string> {
  const apiKey = youKey();
  if (!apiKey) throw new Error("AI is not available in this environment");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch("https://api.you.com/v1/answer", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        query,
        freshness: "week",
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Analyst unavailable (${res.status})${errText ? `: ${errText.slice(0, 180)}` : ""}`,
      );
    }
    const body = (await res.json()) as { answer?: string };
    return body.answer ?? "";
  } finally {
    clearTimeout(timer);
  }
}

export async function youContents(url: string): Promise<string> {
  const apiKey = youKey();
  if (!apiKey) throw new Error("AI is not available in this environment");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch("https://api.you.com/v1/contents", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        urls: [url],
        formats: ["markdown"],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Could not read that link (${res.status})${errText ? `: ${errText.slice(0, 160)}` : ""}`,
      );
    }
    const body = (await res.json()) as
      | Array<{ markdown?: string | null; title?: string }>
      | { data?: Array<{ markdown?: string | null }> };
    const rows = Array.isArray(body) ? body : body.data ?? [];
    const markdown = rows.map((row) => row.markdown ?? "").join("\n\n").trim();
    if (!markdown) throw new Error("That link had no readable ticket text.");
    return markdown;
  } finally {
    clearTimeout(timer);
  }
}

export function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s)]+/i);
  if (!m) return null;
  return m[0].replace(/[.,;]+$/, "");
}
