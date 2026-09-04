import { geminiProbe } from "./gemini.ts";
import { seekChat, seekaiReady } from "./seekai.ts";
import { youAnswer } from "./you.ts";
import { geminiKeys, refreshKeys, seekaiKeys, youKeys } from "./keys.ts";
import { formatProbe, type ProbeResult } from "./probe.ts";

/**
 * `/keytest` — the difference between "a key is configured" and "a key works".
 * Every engine here is called through the exact function the scoring pipeline
 * uses, so a pass here means research is really running.
 */

const PROBE_PROMPT = 'Reply with exactly: {"ok":true}';

async function timed(fn: () => Promise<string>) {
  const t0 = Date.now();
  try {
    const text = await fn();
    const ms = Date.now() - t0;
    if (!text || !text.trim()) return { ok: false, detail: "empty reply", ms };
    return { ok: true, detail: "ok", ms };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
    };
  }
}

export async function probeEngines(): Promise<ProbeResult[]> {
  await refreshKeys();

  const gemCount = geminiKeys().length;
  const seekCount = seekaiKeys().length;
  const youCount = youKeys().length;

  const jobs: Array<Promise<ProbeResult>> = [];

  if (gemCount) {
    jobs.push(
      (async () => {
        const t0 = Date.now();
        const r = await geminiProbe();
        return {
          engine: "gemini",
          keys: r.keys,
          ok: r.ok,
          model: r.model,
          detail: r.detail,
          ms: Date.now() - t0,
        };
      })(),
    );
  } else {
    jobs.push(Promise.resolve({ engine: "gemini", keys: 0, ok: false, model: "", detail: "no key", ms: 0 }));
  }

  if (seekCount && seekaiReady()) {
    jobs.push(
      timed(() => seekChat([{ role: "user", content: PROBE_PROMPT }], 15_000)).then((r) => ({
        engine: "opus",
        keys: seekCount,
        ok: r.ok,
        model: "",
        detail: r.detail,
        ms: r.ms,
      })),
    );
  } else {
    jobs.push(Promise.resolve({ engine: "opus", keys: seekCount, ok: false, model: "", detail: "no key", ms: 0 }));
  }

  if (youCount) {
    jobs.push(
      timed(() => youAnswer(PROBE_PROMPT, 15_000)).then((r) => ({
        engine: "you.com",
        keys: youCount,
        ok: r.ok,
        model: "",
        detail: r.detail,
        ms: r.ms,
      })),
    );
  } else {
    jobs.push(
      Promise.resolve({ engine: "you.com", keys: 0, ok: false, model: "", detail: "no key", ms: 0 }),
    );
  }

  return Promise.all(jobs);
}

export async function probeText(): Promise<string> {
  return formatProbe(await probeEngines());
}
