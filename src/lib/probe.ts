/**
 * Presentation for `/keytest`. Kept free of imports on purpose: the probing
 * module drags in the key store (and through it the database), so this is the
 * part that stays unit-testable.
 */

export type ProbeResult = {
  engine: string;
  keys: number;
  ok: boolean;
  /** Model that actually answered, when the engine names more than one. */
  model: string;
  detail: string;
  ms: number;
};

const ICON = { live: "✅", dead: "❌", none: "➖" } as const;

function seconds(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "0.0s";
  return `${(ms / 1000).toFixed(1)}s`;
}

function keyCount(n: number) {
  return `${n} key${n === 1 ? "" : "s"}`;
}

function line(r: ProbeResult) {
  if (!r.keys) return `${ICON.none} ${r.engine} — no key`;
  if (r.ok) {
    const via = r.model && r.model !== r.engine ? ` · ${r.model}` : "";
    return `${ICON.live} ${r.engine} live${via} · ${seconds(r.ms)} · ${keyCount(r.keys)}`;
  }
  return `${ICON.dead} ${r.engine} no answer — ${r.detail} · ${keyCount(r.keys)}`;
}

export function formatProbe(results: ProbeResult[]): string {
  const live = results.filter((r) => r.ok);
  const out = ["🧪 Engine test", "", ...results.map(line), ""];

  if (live.length) {
    out.push(`${live.map((r) => r.engine).join(" + ")} dey answer — slips go out researched.`);
  } else if (results.some((r) => r.keys)) {
    out.push("No engine answer. Slips still comot, but na market read only — weaker.");
  } else {
    out.push("No key set. Add one: /key gemini AQ.…");
  }
  out.push("", "Each slip cost ~6 research calls per engine. Free tier go burst, e no spoil.");
  return out.join("\n");
}

/** Rough call count for a slip, so `/keytest` can warn about daily quota. */
export function researchCallsPerSlip(picks: number, chunkSize = 3) {
  const shortlist = Math.min(Math.max(picks, 1), 18);
  return Math.max(1, Math.ceil(shortlist / Math.max(1, chunkSize)));
}
