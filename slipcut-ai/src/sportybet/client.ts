import { logger } from "../utils/logger.js";

const COUNTRY_FALLBACKS = ["ng", "gh", "ke", "za", "tz", "ug", "zm", "cm"];

export function sportyHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 SlipCutAI",
    Clientid: "web",
    OperId: "2",
    Platform: "web",
  };
}

export async function sportyGet(path: string, country = "ng"): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`https://www.sportybet.com/api/${country}${path}`, {
      signal: controller.signal,
      headers: sportyHeaders(),
    });
    if (!res.ok) {
      logger.warn({ path, status: res.status }, "sporty GET failed");
      return null;
    }
    return await res.json();
  } catch (err) {
    logger.warn({ path, err: String(err) }, "sporty GET error");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function sportyPost(path: string, body: unknown, country = "ng"): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`https://www.sportybet.com/api/${country}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: { ...sportyHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (err) {
    logger.warn({ path, err: String(err) }, "sporty POST error");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export { COUNTRY_FALLBACKS };
