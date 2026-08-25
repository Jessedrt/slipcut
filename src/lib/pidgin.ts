/** Nigerian Pidgin + SportyBet desk slang the bot should understand. */
export const PIDGIN_SLANG: Array<{ slang: string; meaning: string; use: string }> = [
  { slang: "how far", meaning: "hello / how's it", use: "greet" },
  { slang: "wetin dey", meaning: "what's up", use: "greet" },
  { slang: "wetin dey sup", meaning: "what's happening", use: "greet" },
  { slang: "omo", meaning: "guy / exclaim", use: "greet" },
  { slang: "my guy", meaning: "friend", use: "greet" },
  { slang: "paddy / padé", meaning: "friend", use: "greet" },
  { slang: "abeg", meaning: "please", use: "soften" },
  { slang: "make I", meaning: "let me", use: "intent" },
  { slang: "yarn", meaning: "talk", use: "chat" },
  { slang: "sabi", meaning: "know / understand", use: "chat" },
  { slang: "wahala", meaning: "trouble", use: "chat" },
  { slang: "sharp sharp", meaning: "quickly", use: "chat" },
  { slang: "correct", meaning: "good / valid", use: "chat" },
  { slang: "ehn / ehen", meaning: "okay / go on", use: "chat" },
  { slang: "bola", meaning: "football", use: "sport" },
  { slang: "round leather", meaning: "football", use: "sport" },
  { slang: "soccer", meaning: "football", use: "sport" },
  { slang: "hoop / basket", meaning: "basketball", use: "sport" },
  { slang: "legs / games", meaning: "number of matches on a slip", use: "ticket" },
  { slang: "odds", meaning: "combined multiplier, e.g. 30odds ≈ 30×", use: "ticket" },
  { slang: "code", meaning: "SportyBet booking code", use: "ticket" },
  { slang: "slip / ticket", meaning: "accumulator", use: "ticket" },
  { slang: "cook / arrange / pack", meaning: "build a new slip", use: "create" },
  { slang: "book am / mint am", meaning: "give me a SportyBet code", use: "mint" },
  { slang: "trim am / cut am down / reduce am", meaning: "keep the strongest half", use: "trim" },
  { slang: "comot / remove / kolo out", meaning: "drop those games", use: "drop" },
  { slang: "join / mix", meaning: "combine two codes", use: "combine" },
  { slang: "split am / share am", meaning: "split the slip", use: "split" },
  { slang: "e cut / the slip cut / e no hit / e dry", meaning: "the acca lost — study it", use: "study" },
  { slang: "e hit / e run / e bang / e chop", meaning: "the acca won — still study it", use: "study" },
  { slang: "sure 2 / sure odds", meaning: "few strongest games", use: "keep" },
  { slang: "over two five / o2.5", meaning: "over 2.5", use: "market" },
  { slang: "gg / both team", meaning: "both teams to score", use: "market" },
  { slang: "1x / dc", meaning: "double chance", use: "market" },
  { slang: "comot virtuals", meaning: "drop other sports", use: "filter" },
];

const PHRASES: Array<[RegExp, string]> = [
  [/\bround leather\b/gi, "football"],
  [/\bboth teams?(?: to score)?\b/gi, "gg"],
  [/\bover two five\b/gi, "over 2.5"],
  [/\bo\s*2\.5\b/gi, "over 2.5"],
  [/\bover one five\b/gi, "over 1.5"],
  [/\bchange am to\b/gi, "change to"],
  [/\bturn am to\b/gi, "change to"],
  [/\bhelp me cook\b/gi, "create"],
  [/\bhelp me\b/gi, ""],
  [/\bcook me\b/gi, "create"],
  [/\barrange me\b/gi, "create"],
  [/\bpack me\b/gi, "create"],
  [/\bcook\b/gi, "create"],
  [/\barrange\b/gi, "create"],
  [/\btrim am\b/gi, "trim"],
  [/\bcut am down\b/gi, "trim"],
  [/\breduce am\b/gi, "trim"],
  [/\bbook am\b/gi, "mint all"],
  [/\bmint am\b/gi, "mint all"],
  [/\bgive me (?:the )?code\b/gi, "mint all"],
  [/\bstudy am\b/gi, "study"],
  [/\bcheck am\b/gi, "study"],
  [/\bthe (?:slip|ticket) cut\b/gi, "study"],
  [/\be no hit\b/gi, "study"],
  [/\be dry\b/gi, "study"],
  [/\be cut\b/gi, "study"],
  [/\be hit\b/gi, "study"],
  [/\be run\b/gi, "study"],
  [/\be bang\b/gi, "study"],
  [/\be chop\b/gi, "study"],
  [/\bsplit am\b/gi, "split 2"],
  [/\bshare am into\b/gi, "split"],
  [/\bjoin (?:am )?with\b/gi, "combine"],
  [/\bmix with\b/gi, "combine"],
  [/\bcomot virtuals?\b/gi, "drop other"],
  [/\bcomot game\b/gi, "drop game"],
  [/\bcomot\b/gi, "drop"],
  [/\bkolo out\b/gi, "drop"],
  [/\bsure\s+(\d{1,2})\b/gi, "$1 games"],
  [/\blike\s+(\d{1,4})\s*odds?\b/gi, "$1 odds"],
  [/\b(\d{1,4})odds?\b/gi, "$1 odds"],
  [/\bmatches\b/gi, "games"],
  [/\bbola\b/gi, "football"],
  [/\bhoops?\b/gi, "basketball"],
  [/\bbasket\b/gi, "basketball"],
];

const GREET = /^(how far|wetin dey(?: sup)?|wetin you dey|you dey(?: there)?|hello|hi|hey|yo+|boss|omo|my guy|paddy|pad[eé]|good (?:morning|afternoon|evening)|sup)\b/i;
const THANKS = /^(thanks?|thank you|cheers|god bless|e se|na you)\b/i;

const GREET_REPLIES = [
  "How far my guy. Send code or tell me how many games you want.",
  "I dey. Drop booking code make I load am, or yarn 12 games football.",
  "Omo I dey available. Code, or cook slip — your call.",
];

const THANKS_REPLIES = [
  "No wahala. Anytime you ready, drop code.",
  "E easy. Make we book another one when you ready.",
  "Correct. I dey here.",
];

function pick(list: string[]) {
  return list[Math.floor(Math.random() * list.length)] ?? list[0] ?? "";
}

const GREET_SHORT = ["How far.", "I dey.", "Omo I hear you.", "Sharp."];

export function splitChat(raw: string): { greet: string | null; rest: string } {
  const t = raw.trim();
  const m = t.match(
    /^(how far|wetin dey(?: sup)?|wetin you dey|you dey(?: there)?|hello|hi|hey|yo+|boss|omo|my guy|paddy|pad[eé]|good (?:morning|afternoon|evening)|sup)\b\s*[,.!]?\s*(.*)$/i,
  );
  if (!m) return { greet: null, rest: t };
  const rest = (m[2] ?? "").trim();
  if (!rest) return { greet: pick(GREET_REPLIES), rest: "" };
  return { greet: pick(GREET_SHORT), rest };
}

export function wantsCreate(text: string): boolean {
  return /\b(create|cook|pack|arrange|build|make me|help me|slip|i want|give me)\b/i.test(text);
}

/** Rewrite pidgin so the rest of the bot can parse it. */
export function normalizePidgin(raw: string): string {
  let text = raw.trim();
  for (const [pattern, into] of PHRASES) {
    text = text.replace(pattern, into);
  }
  return text.replace(/\s+/g, " ").trim();
}

/** Small talk so the bot can relate, not only take codes. */
export function pidginSmallTalk(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (GREET.test(t)) return pick(GREET_REPLIES);
  if (THANKS.test(t)) return pick(THANKS_REPLIES);
  if (/^(you sabi|you dey hear|you understand)\b/i.test(t)) {
    return "I sabi. Send code, or tell me: cook 12 games bola.";
  }
  if (/^(ok|okay|ehn|ehen|na so|correct|sharp)\s*[.!]?\s*$/i.test(t)) {
    return "Sharp. Drop the next code when you ready.";
  }
  return null;
}

export function slangHelp(): string {
  return [
    "Pidgin wey I sabi:",
    "",
    "how far — I go yarn you back",
    "how far help me cook like 30odds — about 30×, not 30 games",
    "12 games bola — 12 matches",
    "trim am — keep strong half",
    "comot game 3 and 8 — remove those matches",
    "e cut — study why e no hit",
    "book am — give SportyBet code",
    "change am to over 2.5",
    "add another booking code — join two tickets",
    "",
    "Code and market name remain English. The rest, yarn pidgin.",
  ].join("\n");
}
