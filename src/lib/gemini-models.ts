/**
 * How to talk to Gemini: which model to call, in what order, and how to read a
 * failed response.
 *
 * Kept dependency-free (it imports nothing) so all of it can be unit tested —
 * `gemini.ts` pulls in the key store, which pulls in the database. See
 * gemini-models.test.ts.
 */

/**
 * Model chain, best first — the first one that answers wins.
 *
 * `GEMINI_MODEL` overrides the lot. Otherwise: the current **stable** Flash,
 * then the previous stable Flash, then the proven 2.5 workhorses which are
 * cheaper and still live.
 *
 * Two rules for keeping this list healthy:
 *
 * - **Stable only.** No `-preview` and no `gemini-flash-latest` alias. Both can
 *   change or disappear under a running deployment, and this desk prices real
 *   slips.
 * - **No retired models.** The previous list fell back to `gemini-2.0-flash`
 *   (switched off June 2026) and `gemini-1.5-flash` (retired). Those 404s were
 *   swallowed by the caller, so a configured Gemini key silently contributed
 *   nothing — slips went out un-researched while every dashboard said the key
 *   was configured.
 *
 * Check https://ai.google.dev/gemini-api/docs/models before editing.
 */
export const GEMINI_DEFAULT_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

export function geminiModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  for (const raw of [env.GEMINI_MODEL?.trim(), ...GEMINI_DEFAULT_MODELS]) {
    if (!raw) continue;
    if (out.includes(raw)) continue;
    out.push(raw);
  }
  return out.length ? out : [...GEMINI_DEFAULT_MODELS];
}

// ---- transport policy ----------------------------------------------------

/**
 * Why a call failed. `key` and `quota` belong to the credential, so the caller
 * moves to the next key; `model` means this model is not served to this key
 * (very common on the free tier) and the next model in the chain may work.
 */
export type GeminiFailure = "key" | "quota" | "model" | "server" | "network" | "empty";

export type GeminiCall = {
  ok: boolean;
  model: string;
  text: string;
  /** 0 when the request never reached Google (network error / timeout). */
  status: number;
  detail: string;
  retryAfterMs: number;
  failure: GeminiFailure | null;
};

/**
 * Google reuses 403 for two very different things: "your API key is invalid"
 * and "this model is not available to you". Only the first one is fatal, so
 * read the body before deciding whether to keep walking the chain.
 */
export function geminiFailure(status: number, body: string): GeminiFailure {
  const b = body.toLowerCase();
  if (status === 0) return "network";
  if (status === 429) return "quota";
  if (status >= 500) return "server";
  const namesModel = /models?\//.test(b) || /not found/.test(b) || /not supported/.test(b);
  if (status === 401) return namesModel ? "model" : "key";
  if (status === 403) return namesModel ? "model" : "key";
  if (status === 404) return "model";
  return "model";
}

/** Turn an HTTP status into something a human can act on. */
export function geminiStatusDetail(
  status: number,
  model: string,
  failure?: GeminiFailure | null,
) {
  if (status === 0) return "network error";
  if (status === 429) return "rate limited — free tier quota";
  if (status >= 500) return `google busy (${status})`;
  if (failure === "model") return `${model}: not served to this key`;
  if (status === 401 || status === 403) return `key rejected (${status})`;
  if (status === 400) return `${model}: rejected the request (400)`;
  return `${model}: http ${status}`;
}
