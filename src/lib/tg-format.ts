/**
 * How the desk talks.
 *
 * One visual language for every Telegram reply: a bold label, a rule, aligned
 * numbers in monospace, and a quiet footer saying where the number came from.
 * No emoji soup — the only glyphs are ✓ · ×, and they mean hold / watch / cut.
 *
 * Everything here is pure string work and returns Telegram-safe HTML. Parse
 * it with `parse_mode: "HTML"`, and fall back to `htmlToPlain()` if Telegram
 * rejects the markup — see `sendDeskText()` in telegram.ts.
 */

import { escapeHtml } from "./intent.ts";

/** Section divider. Long enough to read as a rule, short enough for a phone. */
export const RULE = "─────────────────";

/** hold / watch / cut. Deliberately not emoji: they must not shout. */
export function glyph(probability: number) {
  if (probability >= 55) return "✓";
  if (probability >= 45) return "·";
  return "×";
}

/** Telegram drops any message whose HTML is malformed, so escape on the way in. */
export function esc(value: unknown) {
  return escapeHtml(String(value ?? ""));
}

/** Monospace numerals: the whole point is that columns of digits line up. */
export function mono(value: string) {
  return `<code>${esc(value)}</code>`;
}

export function pct(value: number) {
  return `${Math.round(value)}%`;
}

/**
 * Message headline. `<b>READ</b> · 9 selections` — the label is what the
 * screen is, the meta is what it is about.
 */
export function head(label: string, ...meta: Array<string | null | undefined>) {
  const rest = meta.filter((m): m is string => Boolean(m && m.trim()));
  return rest.length ? `<b>${esc(label)}</b>  ${rest.map(esc).join("  ·  ")}` : `<b>${esc(label)}</b>`;
}

/** A quiet sub-heading inside a long reply. */
export function subhead(label: string) {
  return `<b>${esc(label.toLowerCase())}</b>`;
}

/** `label   value`, with the value in monospace. */
export function stat(label: string, value: string) {
  return `${esc(label)}  ${mono(value)}`;
}

/**
 * A stack of `label  value` lines with the labels padded to one column, so the
 * numbers start in the same place on every row.
 */
export function stats(rows: Array<[string, string]>) {
  if (!rows.length) return "";
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `${esc(label.padEnd(width))}  ${mono(value)}`).join("\n");
}

/** Two-space separated cells. Used where a table would be too wide. */
export function row(...cells: Array<string | null | undefined>) {
  return cells
    .filter((c): c is string => Boolean(c && String(c).length))
    .map((c) => (c.startsWith("<") ? c : esc(c)))
    .join("  ");
}

/**
 * One selection: fixture on its own line, then what we are actually judging.
 *
 * ```
 * 1  Arsenal v Chelsea
 *    Over 2.5  1.85  62%  ✓
 * ```
 */
export function leg(
  index: number,
  fixture: string,
  detail: string,
  mark?: string,
  meta?: string,
) {
  const first = `${String(index).padStart(2, "0")}  ${esc(fixture)}`;
  const second = `    ${esc(detail)}${meta ? `  ${esc(meta)}` : ""}${mark ? `  ${mark}` : ""}`;
  return `${first}\n${second}`;
}

/** Bullet list. `–` rather than `•`: quieter, and lines up with the rules. */
export function bullets(items: Array<string | null | undefined>, marker = "–") {
  return items
    .filter((i): i is string => Boolean(i && String(i).trim()))
    .map((i) => `${marker} ${esc(i)}`)
    .join("\n");
}

/** Provenance and timestamps. Always the last thing in a reply. */
export function tail(...parts: Array<string | null | undefined>) {
  const rest = parts.filter((p): p is string => Boolean(p && p.trim()));
  return rest.length ? `<i>${rest.map(esc).join("  ·  ")}</i>` : "";
}

/** Join blocks with a blank line, dropping anything empty. */
export function doc(...blocks: Array<string | null | undefined>) {
  return blocks.filter((b): b is string => Boolean(b && b.trim())).join("\n\n");
}

/** Telegram hard-caps a message at 4096 characters. Leave room for markup. */
export function cap(text: string, max = 3900) {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * A monospace block. Only for when columns have to line up exactly — a `<pre>`
 * in Telegram is its own box, so use `stats()` for anything lighter.
 */
export function pre(lines: string[]) {
  return `<pre>${esc(lines.join("\n"))}</pre>`;
}

/** Header plus rows, padded into columns inside a monospace block. */
export function table(header: string[], rows: string[][]) {
  const width = (i: number) =>
    Math.max(header[i]?.length ?? 0, ...rows.map((r) => (r[i] ?? "").length));
  const widths = header.map((_, i) => width(i));
  const fmt = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i] ?? c.length))
      .join("  ")
      .trimEnd();
  return pre([fmt(header), ...rows.map(fmt)]);
}

/** The code a punter pastes into SportyBet. Monospace so it is easy to read. */
export function codeBlock(code: string) {
  return `<code>${esc(code)}</code>`;
}
