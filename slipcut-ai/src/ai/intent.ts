import { IntentSchema, type Intent } from "../types/index.js";

/** Deterministic NL fallback — always available even without LLM */
export function parseIntentDeterministic(text: string): Intent {
  const t = text.toLowerCase().trim();
  const raw = text.trim();

  let action: Intent["action"] = "unknown";
  if (/^(help|\/help)\b/.test(t)) action = "help";
  else if (/\/today\b|^today\b/.test(t)) action = "today";
  else if (/analyze.*(code|ticket|slip)|read (this )?code|booking code|\b[A-Z0-9]{5,10}\b/.test(raw) && /analy|read|check|load/.test(t))
    action = "analyze_code";
  else if (/screenshot|read this (image|photo|pic)|ocr/.test(t)) action = "analyze_screenshot";
  else if (/explore|all markets|every market|markets for/.test(t)) action = "explore_markets";
  else if (/split (this|it|ticket|slip)?\s*(into)?\s*\d/.test(t) || /\bsplit\b/.test(t)) action = "split_slip";
  else if (/remove|replace|make (this|it) safer|change (all|these)|keep only|get (this|it) close|increase|reduce|trim/.test(t))
    action = "edit_slip";
  else if (/book|generate (code|booking)|sportybet code/.test(t)) action = "book";
  else if (/give me|find|cook|build|want|need|games|matches|selections|odds/.test(t)) action = "cook";

  const sport: Intent["sport"] | undefined = /\bbasket(ball)?\b/.test(t)
    ? "basketball"
    : /\bfootball\b|\bsoccer\b/.test(t)
      ? "football"
      : undefined;

  const gameCount = numAfter(t, /(?:give me|find|want|need|build)?\s*(\d{1,2})\s*(?:football|basketball|games|matches|selections)/i)
    ?? numAfter(t, /(\d{1,2})\s*(?:games|matches)/i);

  const between = t.match(/between\s+(\d+)\s+and\s+(\d+)/i);
  const gameCountMin = between ? Number(between[1]) : undefined;
  const gameCountMax = between ? Number(between[2]) : undefined;

  const targetOdds =
    numAfter(t, /around\s+(\d+(?:\.\d+)?)\s*odds/i) ??
    numAfter(t, /(?:near|close to|target|to)\s+(\d+(?:\.\d+)?)\s*odds/i) ??
    numAfter(t, /(\d+(?:\.\d+)?)\s*odds/i) ??
    numAfter(t, /odds?\s*(?:of|around|near)?\s*(\d+(?:\.\d+)?)/i);

  const minimumConfidence =
    numAfter(t, /(?:at least|above|over|min(?:imum)?)\s*(\d{1,3})\s*%?\s*confidence/i) ??
    numAfter(t, /(\d{1,3})\s*%\s*confidence/i);

  const codeMatch = raw.match(/\b([A-Z0-9]{5,12})\b/);
  const bookingCode =
    action === "analyze_code" || /code|ticket|slip/.test(t) ? codeMatch?.[1] : undefined;

  const splitParts = numAfter(t, /split(?:\s+(?:this|it|ticket|slip))?(?:\s+into)?\s+(\d+)/i);

  let editOp: Intent["editOp"] = "none";
  if (/remove the weakest|remove weakest/.test(t)) editOp = "remove_weakest";
  else if (/below\s*\d+\s*%|remove anything below/.test(t)) editOp = "remove_below_confidence";
  else if (/replace.*(weak|lowest)/.test(t)) editOp = "replace_weakest";
  else if (/goal markets|to goals|over\/under|btts/.test(t) && /change|switch/.test(t)) editOp = "change_to_goals";
  else if (/keep only (football|basketball)/.test(t)) editOp = "keep_sport";
  else if (/close to|near|around|reduce|increase|trim/.test(t) && /odds/.test(t)) editOp = "trim_to_odds";

  const removeCount = numAfter(t, /remove the weakest\s+(\d+)/i) ?? numAfter(t, /remove\s+(\d+)/i);

  const riskMode: Intent["riskMode"] | undefined = /conservative|safer|safe/.test(t)
    ? "conservative"
    : /aggressive|risky/.test(t)
      ? "aggressive"
      : /balanced/.test(t)
        ? "balanced"
        : undefined;

  const dateHint: Intent["dateHint"] | undefined = /today/.test(t)
    ? "today"
    : /weekend/.test(t)
      ? "weekend"
      : /soon|upcoming/.test(t)
        ? "soon"
        : undefined;

  const fixtureQuery = t.match(/(?:markets? for|explore)\s+(.+)$/i)?.[1]?.trim();

  const parsed = IntentSchema.safeParse({
    action,
    sport,
    gameCount: gameCount ?? undefined,
    gameCountMin,
    gameCountMax,
    targetOdds: targetOdds ?? undefined,
    minimumConfidence: minimumConfidence ?? undefined,
    bookingCode,
    splitParts: splitParts ?? undefined,
    editOp,
    removeCount: removeCount ?? undefined,
    riskMode,
    dateHint,
    fixtureQuery,
    raw,
  });

  return parsed.success ? parsed.data : IntentSchema.parse({ action: "unknown", raw });
}

function numAfter(text: string, re: RegExp): number | null {
  const m = text.match(re);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export async function parseIntent(text: string, llm?: (prompt: string) => Promise<string>): Promise<Intent> {
  const fallback = parseIntentDeterministic(text);
  if (!llm) return fallback;
  try {
    const prompt = `Extract betting assistant intent as pure JSON matching keys:
action, sport, gameCount, gameCountMin, gameCountMax, targetOdds, minOdds, maxOdds,
minimumConfidence, league, dateHint, marketPreference, riskMode, bookingCode,
fixtureQuery, editOp, splitParts, removeCount.
User message: ${JSON.stringify(text)}`;
    const out = await llm(prompt);
    const json = JSON.parse(out.replace(/^```json\n?|\n?```$/g, "").trim());
    const merged = IntentSchema.safeParse({ ...fallback, ...json, raw: text });
    return merged.success ? merged.data : fallback;
  } catch {
    return fallback;
  }
}
