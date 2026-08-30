import { getSetting, setSetting } from "./study";

export type KeyKind = "you" | "seekai" | "gemini";

const extra: Record<KeyKind, string[]> = { you: [], seekai: [], gemini: [] };

function unique(list: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const key = raw.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function parseList(raw: string | null) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return unique(parsed.map((x) => String(x)));
  } catch {
    /* csv fallback */
  }
  return unique(raw.split(/[,;\n]+/));
}

function envYou() {
  return unique([
    process.env.YDC_API_KEY ?? "",
    process.env.YDC_API_KEY_2 ?? "",
    process.env.YDC_API_KEY_3 ?? "",
    process.env.YOU_API_KEY ?? "",
    process.env.YOUCOM_API_KEY ?? "",
    ...(process.env.YDC_API_KEYS ?? "").split(/[,;\n]+/),
  ]);
}

function envSeekai() {
  return unique([
    process.env.SEEKAI_API_KEY ?? "",
    process.env.SEEKAI_API_KEY_2 ?? "",
    process.env.SEEKAI_API_KEY_3 ?? "",
    ...(process.env.SEEKAI_API_KEYS ?? "").split(/[,;\n]+/),
  ]);
}

function envGemini() {
  return unique([
    process.env.GEMINI_API_KEY ?? "",
    process.env.GOOGLE_AI_API_KEY ?? "",
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "",
    process.env.GEMINI_API_KEY_2 ?? "",
    ...(process.env.GEMINI_API_KEYS ?? "").split(/[,;\n]+/),
  ]);
}

export async function refreshKeys() {
  extra.you = parseList(await getSetting("keys_you"));
  extra.seekai = parseList(await getSetting("keys_seekai"));
  extra.gemini = parseList(await getSetting("keys_gemini"));
}

export function youKeys() {
  return unique([...envYou(), ...extra.you]);
}

export function seekaiKeys() {
  return unique([...envSeekai(), ...extra.seekai]);
}

export function geminiKeys() {
  return unique([...envGemini(), ...extra.gemini]);
}

export function extraCount(kind: KeyKind) {
  return extra[kind].length;
}

export function maskKey(key: string) {
  const t = key.trim();
  if (t.length <= 8) return "••••";
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

export function detectKey(raw: string): { kind: KeyKind; key: string } | null {
  const t = raw.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (/^ydc-sk-[A-Za-z0-9_-]{12,}$/i.test(t) || /^ydc-[A-Za-z0-9_-]{16,}$/i.test(t)) {
    return { kind: "you", key: t };
  }
  if (/^sk-[A-Za-z0-9]{20,}$/.test(t)) return { kind: "seekai", key: t };
  // Google AI Studio / Gemini keys
  if (/^AIza[0-9A-Za-z_-]{30,}$/.test(t)) return { kind: "gemini", key: t };
  if (/^AQ\.[A-Za-z0-9_-]{20,}$/.test(t)) return { kind: "gemini", key: t };
  return null;
}

export async function addDeskKey(kind: KeyKind, key: string) {
  await refreshKeys();
  extra[kind] = unique([...extra[kind], key]);
  await setSetting(`keys_${kind}`, JSON.stringify(extra[kind]));
}

export async function delDeskKey(kind: KeyKind, index: number) {
  await refreshKeys();
  if (index < 1 || index > extra[kind].length) return false;
  extra[kind] = extra[kind].filter((_, i) => i !== index - 1);
  await setSetting(`keys_${kind}`, JSON.stringify(extra[kind]));
  return true;
}

export function formatKeyList() {
  const youEnv = envYou();
  const seekEnv = envSeekai();
  const gemEnv = envGemini();
  const lines = ["Keys on this desk", ""];
  lines.push(`you.com env: ${youEnv.length}`);
  extra.you.forEach((k, i) => lines.push(`you extra ${i + 1}: ${maskKey(k)}`));
  if (!youEnv.length && !extra.you.length) lines.push("you.com: none");
  lines.push("");
  lines.push(`seekai env: ${seekEnv.length}`);
  extra.seekai.forEach((k, i) => lines.push(`seekai extra ${i + 1}: ${maskKey(k)}`));
  if (!seekEnv.length && !extra.seekai.length) lines.push("seekai: none");
  lines.push("");
  lines.push(`gemini env: ${gemEnv.length}`);
  extra.gemini.forEach((k, i) => lines.push(`gemini extra ${i + 1}: ${maskKey(k)}`));
  if (!gemEnv.length && !extra.gemini.length) lines.push("gemini: none");
  lines.push("");
  lines.push("/key you ydc-sk-…");
  lines.push("/key seekai sk-…");
  lines.push("/key gemini AIza…");
  lines.push("/key del you 1");
  lines.push("/key del seekai 1");
  lines.push("/key del gemini 1");
  return lines.join("\n");
}
