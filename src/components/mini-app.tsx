import { useMemo, useState } from "react";
import { Loader2, Scissors, Send } from "lucide-react";
import { toast } from "sonner";
import { bookSlip, cutSlip } from "@/lib/analyze";
import type { AnalyzedPick, CutResponse } from "@/lib/types";
import { formatOdds, combinedOdds } from "@/lib/workbench";

type Tab = "cook" | "cut";
type Preset = "lenient" | "standard" | "strict";

const PRESET_THRESHOLD: Record<Preset, number> = {
  lenient: 40,
  standard: 45,
  strict: 55,
};

const COOK_CHIPS = [
  "cook 12 football",
  "ucl",
  "weekend mix",
  "8 games basketball",
  "draw today",
  "how far cook tennis",
];

const QUICK_PAD = [
  "Predict",
  "UCL",
  "Engine",
  "Football",
  "Basketball",
  "Tennis",
  "Handball",
  "Mix",
  "Weekend",
  "Today",
  "Draw",
  "Open bot",
] as const;

const BOT = "https://t.me/WOLEMARVEL";

function openBot(text?: string) {
  const url = text
    ? `https://t.me/WOLEMARVEL?text=${encodeURIComponent(text)}`
    : BOT;
  try {
    const tg = (
      window as unknown as {
        Telegram?: { WebApp?: { openTelegramLink?: (u: string) => void } };
      }
    ).Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(url);
      return;
    }
  } catch {
    /* fall through */
  }
  window.open(url, "_blank");
}

function padPrompt(label: string): string {
  const map: Record<string, string> = {
    Predict: "predict",
    UCL: "cook ucl",
    Engine: "engine",
    Football: "cook 10 games football",
    Basketball: "cook 8 games basketball",
    Tennis: "how far cook tennis",
    Handball: "cook handball",
    Mix: "weekend mix",
    Weekend: "weekend mix",
    Today: "2odds",
    Draw: "draw today",
    "Open bot": "",
  };
  return map[label] ?? label.toLowerCase();
}

export function MiniApp() {
  const [tab, setTab] = useState<Tab>("cut");
  const [code, setCode] = useState("");
  const [country] = useState("ng");
  const [preset, setPreset] = useState<Preset>("standard");
  const [threshold, setThreshold] = useState(45);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CutResponse | null>(null);
  const [mintCode, setMintCode] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("cook 12 football · ucl · mix · pa");

  const kept = useMemo(
    () => (result && result.ok ? result.kept : []) as AnalyzedPick[],
    [result],
  );

  function applyPreset(p: Preset) {
    setPreset(p);
    setThreshold(PRESET_THRESHOLD[p]);
  }

  async function runCut() {
    const cleaned = code.trim().toUpperCase().replace(/\s+/g, "");
    if (!cleaned) {
      toast.error("Paste a booking code first.");
      return;
    }
    setBusy(true);
    setResult(null);
    setMintCode(null);
    try {
      const res = await cutSlip({
        data: {
          mode: "code",
          code: cleaned,
          country,
          threshold,
        },
      });
      if (!res.ok) {
        toast.error(res.error || "Cut failed");
        return;
      }
      setResult(res);
      toast.success(
        `Kept ${res.kept?.length ?? 0} / ${res.picks?.length ?? 0} at ${threshold}%`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cut failed");
    } finally {
      setBusy(false);
    }
  }

  async function runBookKeepers() {
    if (!kept.length) {
      toast.error("Nothing to book — run Cut first.");
      return;
    }
    setBusy(true);
    try {
      const res = await bookSlip({ data: { picks: kept, country } });
      if (!res.ok) {
        toast.error(res.error || "Book failed");
        return;
      }
      setMintCode(res.shareCode);
      toast.success(`Booked ${res.shareCode}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Book failed");
    } finally {
      setBusy(false);
    }
  }

  function sendCook(text: string) {
    const t = text.trim();
    if (!t) {
      toast.error("Type what you want to cook.");
      return;
    }
    openBot(t);
  }

  function onPad(label: string) {
    if (label === "Open bot") {
      openBot();
      return;
    }
    const p = padPrompt(label);
    setPrompt(p);
    if (label === "Predict" || label === "Today") sendCook(p);
  }

  return (
    <div className="mini-app min-h-dvh text-[#f3e6d4]">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-28 pt-3">
        <header className="mb-4 flex flex-col items-center gap-2">
          <div className="rounded-full border border-[#c9a06a]/35 bg-[#2a1c12]/80 px-3 py-1 text-[10px] font-semibold tracking-[0.14em] text-[#e8c896]">
            TELEGRAM MINI APP · @WOLEMARVEL
          </div>
        </header>

        <div className="mb-5 grid grid-cols-2 gap-1 rounded-full bg-[#1a110c]/90 p-1 shadow-inner">
          <button
            type="button"
            onClick={() => setTab("cook")}
            className={
              tab === "cook"
                ? "rounded-full bg-[#c9a06a] py-2.5 text-sm font-semibold text-[#1a110c]"
                : "rounded-full py-2.5 text-sm font-medium text-[#b89a78]/80"
            }
          >
            Cook
          </button>
          <button
            type="button"
            onClick={() => setTab("cut")}
            className={
              tab === "cut"
                ? "rounded-full bg-[#c9a06a] py-2.5 text-sm font-semibold text-[#1a110c]"
                : "rounded-full py-2.5 text-sm font-medium text-[#b89a78]/80"
            }
          >
            Cut slip
          </button>
        </div>

        {tab === "cut" ? (
          <section className="space-y-4">
            <div className="rounded-3xl border border-[#c9a06a]/18 bg-[#241810]/75 p-4 shadow-[0_20px_50px_-28px_rgba(0,0,0,0.8)] backdrop-blur-md">
              <label className="mb-1.5 block text-xs font-medium text-[#c9a06a]/90">
                Booking code
              </label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="MQVZ70"
                className="mb-4 w-full rounded-2xl border border-[#c9a06a]/15 bg-[#1a120e]/90 px-4 py-3 text-base tracking-widest text-[#f3e6d4] placeholder:text-[#8a7360] outline-none focus:border-[#c9a06a]/45"
                autoCapitalize="characters"
                autoCorrect="off"
              />

              <label className="mb-1.5 block text-xs font-medium text-[#c9a06a]/90">
                Market
              </label>
              <div className="mb-5 flex items-center justify-between rounded-2xl border border-[#c9a06a]/15 bg-[#1a120e]/90 px-4 py-3 text-[#f3e6d4]">
                <span>Nigeria</span>
                <span className="text-[#8a7360]">▾</span>
              </div>

              <div className="mb-2 flex items-center justify-between text-xs text-[#c9a06a]/90">
                <span>Keep picks at or above {threshold}%</span>
                <span className="font-mono text-[#e8c896]">{threshold}%</span>
              </div>
              <input
                type="range"
                min={40}
                max={80}
                step={1}
                value={threshold}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setThreshold(n);
                  if (n <= 42) setPreset("lenient");
                  else if (n >= 52) setPreset("strict");
                  else setPreset("standard");
                }}
                className="mini-range mb-4 w-full"
              />

              <div className="mb-5 grid grid-cols-3 gap-2">
                {(["lenient", "standard", "strict"] as Preset[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className={
                      preset === p
                        ? "rounded-full bg-[#c9a06a] py-2 text-sm font-semibold capitalize text-[#1a110c]"
                        : "rounded-full border border-[#c9a06a]/20 bg-[#1a120e]/60 py-2 text-sm capitalize text-[#b89a78]"
                    }
                  >
                    {p}
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => void runCut()}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#d4b07a] to-[#b8955a] py-3.5 text-sm font-bold tracking-wide text-[#1a110c] shadow-[0_12px_28px_-12px_rgba(201,160,106,0.7)] disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Scissors className="h-4 w-4" />
                )}
                CUT SLIP
              </button>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPrompt("weekend football fold");
                    setTab("cook");
                  }}
                  className="flex-1 rounded-full border border-[#c9a06a]/20 py-2 text-xs text-[#c9a06a]"
                >
                  Try weekend football fold
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPrompt("pitch and court");
                    setTab("cook");
                  }}
                  className="flex-1 rounded-full border border-[#c9a06a]/20 py-2 text-xs text-[#c9a06a]"
                >
                  Try pitch and court
                </button>
              </div>
            </div>

            {result?.ok && (
              <div className="rounded-3xl border border-[#c9a06a]/18 bg-[#241810]/75 p-4">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-[#e8c896]">
                    Kept {kept.length}
                    {result.picks ? ` / ${result.picks.length}` : ""}
                  </span>
                  <span className="font-mono text-[#c9a06a]">
                    {combinedOdds(kept) ? formatOdds(combinedOdds(kept)!) : "—"}
                  </span>
                </div>
                <ul className="mb-3 max-h-56 space-y-2 overflow-y-auto text-xs text-[#e8dcc8]/90">
                  {kept.map((p, i) => (
                    <li key={p.id} className="rounded-xl bg-[#1a120e]/70 px-3 py-2">
                      {i + 1}. {p.home} vs {p.away} · {p.selection}
                      {p.odds ? ` · ${formatOdds(p.odds)}` : ""} ·{" "}
                      {Math.round(p.probability)}%
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={busy || !kept.length}
                  onClick={() => void runBookKeepers()}
                  className="w-full rounded-2xl bg-[#c9a06a] py-3 text-sm font-semibold text-[#1a110c] disabled:opacity-50"
                >
                  Book keepers on SportyBet
                </button>
                {mintCode && (
                  <p className="mt-2 text-center font-mono text-lg tracking-widest text-[#e8c896]">
                    {mintCode}
                  </p>
                )}
              </div>
            )}
          </section>
        ) : (
          <section className="space-y-4">
            <div className="flex gap-2">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="cook 12 football · ucl · mix"
                className="min-w-0 flex-1 rounded-full border border-[#c9a06a]/20 bg-[#241810]/80 px-4 py-3 text-sm text-[#f3e6d4] placeholder:text-[#8a7360] outline-none focus:border-[#c9a06a]/45"
              />
              <button
                type="button"
                onClick={() => sendCook(prompt)}
                className="flex items-center gap-1.5 rounded-full bg-[#c9a06a] px-4 text-sm font-semibold text-[#1a110c]"
              >
                <Send className="h-4 w-4" />
                Send
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {COOK_CHIPS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setPrompt(c);
                    sendCook(c);
                  }}
                  className="rounded-full border border-[#c9a06a]/22 bg-[#241810]/70 px-3 py-1.5 text-xs text-[#e8c896]"
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="rounded-3xl border border-[#c9a06a]/18 bg-[#241810]/75 p-4">
              <div className="mb-1 text-[10px] font-semibold tracking-[0.18em] text-[#c9a06a]/85">
                QUICK PAD
              </div>
              <p className="mb-3 text-xs text-[#8a7360]">Or type above — same as Telegram.</p>
              <div className="grid grid-cols-3 gap-2">
                {QUICK_PAD.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => onPad(label)}
                    className="rounded-2xl border border-[#c9a06a]/15 bg-[#1a120e]/85 py-3 text-xs font-medium text-[#e8dcc8] active:bg-[#c9a06a]/25"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        {tab === "cut" ? (
          <button
            type="button"
            onClick={() => {
              const v = window.prompt("Paste SportyBet booking code");
              if (v) setCode(v.toUpperCase().replace(/\s+/g, ""));
            }}
            className="w-full rounded-full bg-[#22c55e] py-3.5 text-base font-bold text-white shadow-[0_12px_30px_-10px_rgba(34,197,94,0.55)]"
          >
            Paste a code
          </button>
        ) : (
          <button
            type="button"
            onClick={() => sendCook(prompt || "predict")}
            className="w-full rounded-full bg-[#22c55e] py-3.5 text-base font-bold text-white shadow-[0_12px_30px_-10px_rgba(34,197,94,0.55)]"
          >
            Predict
          </button>
        )}
      </div>
    </div>
  );
}
