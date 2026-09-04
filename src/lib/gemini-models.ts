/**
 * Which Gemini model to call, and in what order.
 *
 * Kept dependency-free (it imports nothing) so the chain can be unit tested —
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
