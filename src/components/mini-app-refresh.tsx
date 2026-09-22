import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircle,
  Scissors,
  Ticket,
} from "lucide-react";
import { bookSlip, cutSlip } from "@/lib/analyze";
import { combinedOdds, formatOdds } from "@/lib/workbench";
import type { AnalyzedPick, CutResponse } from "@/lib/types";

const BOT_URL = "https://t.me/Slipcut_bot";
const PRESETS = { lenient: 40, standard: 45, strict: 55 } as const;
type Preset = keyof typeof PRESETS;
type Tab = "cut" | "cook";
type Pending = "cut" | "book" | null;
const PROMPTS = [
  "Find safer football games today",
  "Cook 5 basketball games",
  "2odds",
  "Weekend mix",
];

function telegramWebApp() {
  return (
    window as Window & {
      Telegram?: {
        WebApp?: {
          ready?: () => void;
          expand?: () => void;
          openTelegramLink?: (url: string) => void;
        };
      };
    }
  ).Telegram?.WebApp;
}

function openBot() {
  const webApp = telegramWebApp();
  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(BOT_URL);
  } else {
    window.open(BOT_URL, "_blank", "noopener,noreferrer");
  }
}

function surfaceError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

const field =
  "w-full min-w-0 rounded-2xl border border-[#80674f]/55 bg-[#171510]/80 px-4 py-3 text-base text-[#f9f1e4] outline-none transition focus:border-[#edc486] focus-visible:ring-2 focus-visible:ring-[#edc486]/30 placeholder:text-[#978772]";
const panel =
  "rounded-[24px] border border-[#917657]/30 bg-[#28231c]/85 p-4 shadow-[0_16px_40px_-26px_rgba(0,0,0,0.75)] backdrop-blur-xl";
const primary =
  "flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#e9bb7b] px-4 py-3 text-sm font-bold text-[#21170e] shadow-[0_10px_22px_-16px_#e9bb7b] transition active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f4d4a5] disabled:cursor-not-allowed disabled:opacity-50";
const secondary =
  "flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[#a88b64]/45 bg-[#30291f]/85 px-4 py-2.5 text-sm font-semibold text-[#f1d5ae] transition active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f4d4a5] disabled:opacity-50";

export function MiniAppRefresh() {
  const [tab, setTab] = useState<Tab>("cut");
  const [code, setCode] = useState("");
  const [preset, setPreset] = useState<Preset>("standard");
  const [threshold, setThreshold] = useState<number>(PRESETS.standard);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CutResponse | null>(null);
  const [mint, setMint] = useState<{
    code: string;
    url: string;
    unavailable: number;
  } | null>(null);
  const [prompt, setPrompt] = useState(PROMPTS[0]);
  const [copied, setCopied] = useState<"prompt" | "code" | null>(null);

  useEffect(() => {
    const app = telegramWebApp();
    app?.ready?.();
    app?.expand?.();
  }, []);

  const kept = useMemo<AnalyzedPick[]>(
    () => (result?.ok ? result.kept : []),
    [result],
  );
  const odds = useMemo(() => combinedOdds(kept), [kept]);

  function selectTab(next: Tab) {
    setTab(next);
    setError(null);
  }

  function choosePreset(next: Preset) {
    setPreset(next);
    setThreshold(PRESETS[next]);
    setMint(null);
    setResult(null);
    setError(null);
  }

  async function copy(value: string, which: "prompt" | "code") {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is not available here.");
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setError(null);
    } catch (err) {
      setError(surfaceError(err, "Copy failed. Please select and copy the text manually."));
    }
  }

  async function runCut() {
    if (pending) return;
    const cleaned = code.trim().replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z0-9]{4,16}$/.test(cleaned)) {
      setError("Enter a SportyBet booking code (4–16 letters or numbers).");
      return;
    }
    setError(null);
    setResult(null);
    setMint(null);
    setPending("cut");
    try {
      const response = await cutSlip({
        data: { mode: "code", code: cleaned, country: "ng", threshold },
      });
      if (!response.ok) {
        setError(response.error || "The code could not be analysed. No new code was created.");
      } else {
        setResult(response);
      }
    } catch (err) {
      setError(surfaceError(err, "Analysis failed. No new code was created."));
    } finally {
      setPending(null);
    }
  }

  async function bookKept() {
    if (pending || !kept.length) return;
    setError(null);
    setMint(null);
    setPending("book");
    try {
      const response = await bookSlip({ data: { picks: kept, country: "ng" } });
      if (!response.ok) {
        setError(response.error || "SportyBet could not create a booking code.");
      } else if (!response.shareCode) {
        setError("SportyBet did not return a booking code. Please try again later.");
      } else {
        setMint({
          code: response.shareCode,
          url: response.shareURL,
          unavailable: response.unavailable,
        });
      }
    } catch (err) {
      setError(surfaceError(err, "Booking failed. No new code was confirmed."));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mini-app min-h-dvh text-[#f7ead8]">
      <div
        className="mx-auto min-h-dvh max-w-lg px-4 pb-28 sm:px-6"
        style={{
          paddingTop:
            "calc(max(env(safe-area-inset-top), var(--tg-content-safe-area-inset-top, 0px)) + 24px)",
        }}
      >
        <header className="mb-5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#c6aa81]">
              Your Telegram toolkit
            </p>
            <h1 className="text-[29px] font-bold leading-none tracking-[-0.055em]">
              Slip<span className="text-[#e9bb7b]">Cut.</span>
            </h1>
          </div>
          <button
            type="button"
            onClick={openBot}
            className={`${secondary} min-h-10 shrink-0 rounded-full px-3 text-xs`}
            aria-label="Open SlipCut Telegram bot"
          >
            <MessageCircle aria-hidden="true" className="h-4 w-4" />
            Open bot
          </button>
        </header>

        <div className="mb-5 rounded-[25px] border border-[#c7a678]/25 bg-gradient-to-br from-[#3c3022]/90 via-[#29231b]/90 to-[#1c1a16]/95 px-5 py-5 shadow-[0_20px_40px_-26px_#000]">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#e4be85]">
            {tab === "cut" ? "Your ticket, simplified" : "Make a request"}
          </p>
          <h2 className="text-2xl font-bold leading-tight tracking-[-0.045em]">
            {tab === "cut" ? "Review every leg. Keep control." : "Tell SlipCut what to cook."}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#c9bca9]">
            {tab === "cut"
              ? "Paste a real SportyBet code, review the results, then choose whether to generate a new code."
              : "Copy a request and send it in the Telegram bot. Prompts are not submitted automatically."}
          </p>
        </div>

        <div
          role="tablist"
          aria-label="SlipCut tools"
          className="mb-5 grid grid-cols-2 gap-1 rounded-2xl border border-[#a78a64]/25 bg-[#14120f]/80 p-1"
        >
          {(["cut", "cook"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              onClick={() => selectTab(item)}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f4d4a5] ${
                tab === item
                  ? "bg-[#dfb37a] text-[#21170e] shadow-sm"
                  : "text-[#c8b49a] hover:text-[#f9ead6]"
              }`}
            >
              {item === "cut" ? <Scissors aria-hidden="true" className="h-4 w-4" /> : <MessageCircle aria-hidden="true" className="h-4 w-4" />}
              {item === "cut" ? "Cut a slip" : "Cook via bot"}
            </button>
          ))}
        </div>

        {tab === "cut" ? (
          <div role="tabpanel" className="space-y-4">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void runCut();
              }}
              className={panel}
            >
              <div className="mb-4 flex items-center justify-between gap-2">
                <h3 className="text-base font-bold">Paste your booking code</h3>
                <span className="rounded-full border border-[#8f7759]/50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#d1b993]">
                  SportyBet NG
                </span>
              </div>
              <label htmlFor="slipcut-code" className="mb-1.5 block text-xs font-semibold text-[#d6c0a1]">
                Booking code
              </label>
              <input
                id="slipcut-code"
                name="bookingCode"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.toUpperCase());
                  setError(null);
                  setResult(null);
                  setMint(null);
                }}
                maxLength={24}
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Enter code"
                className={`${field} mb-4 font-mono tracking-[0.12em]`}
              />

              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-[#d6c0a1]">Model-score threshold</span>
                <output className="rounded-lg bg-[#413322] px-2 py-1 font-mono text-sm font-semibold text-[#f1c88d]">
                  {threshold}/100
                </output>
              </div>
              <input
                aria-label="Model-score threshold"
                type="range"
                min={40}
                max={80}
                value={threshold}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setThreshold(value);
                  setPreset(value <= 42 ? "lenient" : value >= 52 ? "strict" : "standard");
                  setResult(null);
                  setMint(null);
                  setError(null);
                }}
                className="mini-range mb-3 w-full"
              />
              <div className="mb-3 grid grid-cols-3 gap-2">
                {(["lenient", "standard", "strict"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={preset === item}
                    onClick={() => choosePreset(item)}
                    className={`min-h-10 rounded-xl border px-1 text-xs font-semibold capitalize transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f4d4a5] ${
                      preset === item
                        ? "border-[#e9bb7b] bg-[#e9bb7b] text-[#21170e]"
                        : "border-[#8a7355]/50 text-[#d5bea0]"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <p className="mb-4 text-xs leading-5 text-[#ac9d89]">
                Model scores are estimates, not verified winning probabilities or guarantees.
              </p>
              <button type="submit" disabled={pending !== null} className={primary}>
                {pending === "cut" ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <Scissors aria-hidden="true" className="h-4 w-4" />
                )}
                {pending === "cut" ? "Analysing your code…" : "Analyse & cut slip"}
                {pending === null && <ArrowRight aria-hidden="true" className="h-4 w-4" />}
              </button>
            </form>

            {pending === "cut" && (
              <p role="status" className={`${panel} text-sm text-[#e7cba5]`}>
                Checking the actual booking code and reviewing available information. Please wait.
              </p>
            )}

            {result?.ok && (
              <section className={`${panel} space-y-4`} aria-label="Cut results">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#b9a283]">Analysis complete</p>
                    <h3 className="mt-1 text-lg font-bold">Your revised slip</h3>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-[#b9a283]">Combined odds</p>
                    <p className="font-mono text-xl font-bold text-[#f4c987]">
                      {odds ? formatOdds(odds) : "—"}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-[#254032]/65 p-2">
                    <p className="text-lg font-bold text-[#adf0bb]">{result.kept.length}</p>
                    <p className="text-[11px] text-[#cae8cf]">Kept</p>
                  </div>
                  <div className="rounded-xl bg-[#482c2b]/65 p-2">
                    <p className="text-lg font-bold text-[#f0b5ae]">{result.dropped.length}</p>
                    <p className="text-[11px] text-[#e3c2bd]">Dropped</p>
                  </div>
                  <div className="rounded-xl bg-[#403827]/65 p-2">
                    <p className="text-lg font-bold text-[#f1d59d]">{result.ignored.length}</p>
                    <p className="text-[11px] text-[#e7d7b9]">Unscored</p>
                  </div>
                </div>
                <p className="text-xs leading-5 text-[#b6a792]">
                  Estimates are model scores, not win probabilities. Review the event, market and current odds yourself.
                </p>
                {kept.length ? (
                  <ul className="space-y-2" aria-label="Kept selections">
                    {kept.map((pick, index) => (
                      <li key={`${pick.id}-${index}`} className="rounded-xl border border-[#857153]/35 bg-[#171510]/60 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[11px] text-[#ad9a80]">Selection {index + 1} · {pick.sport}</p>
                            <p className="mt-1 break-words text-sm font-semibold">{pick.home} vs {pick.away}</p>
                            <p className="mt-1 break-words text-xs text-[#d6b98c]">{pick.selection} · {pick.market}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-mono text-sm text-[#eac48e]">{pick.odds ? formatOdds(pick.odds) : "—"}</p>
                            <p className="mt-1 text-[10px] text-[#b9aa96]">Score {Math.round(pick.probability)}/100</p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl bg-[#342920] p-3 text-sm text-[#d2bda1]">
                    No selections met this threshold. No booking code was created.
                  </p>
                )}
                <button type="button" disabled={pending !== null || !kept.length} onClick={() => void bookKept()} className={primary}>
                  {pending === "book" ? (
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  ) : (
                    <Ticket aria-hidden="true" className="h-4 w-4" />
                  )}
                  {pending === "book" ? "Requesting booking code…" : "Create SportyBet code"}
                </button>
                {mint && (
                  <div className="rounded-2xl border border-[#5c946b]/65 bg-[#172e22] p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-bold uppercase tracking-wider text-[#ace5b7]">Code created</p>
                      <Check aria-hidden="true" className="h-4 w-4 text-[#ace5b7]" />
                    </div>
                    <p className="select-all break-all font-mono text-xl font-bold tracking-widest text-white">{mint.code}</p>
                    {mint.unavailable > 0 && (
                      <p className="mt-2 text-xs text-[#f7d59b]">
                        {mint.unavailable} selection(s) were unavailable. Verify the actual ticket before using the code.
                      </p>
                    )}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => void copy(mint.code, "code")} className={secondary}>
                        {copied === "code" ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
                        {copied === "code" ? "Copied" : "Copy code"}
                      </button>
                      {mint.url ? (
                        <a href={mint.url} target="_blank" rel="noopener noreferrer" className={secondary}>
                          <ExternalLink aria-hidden="true" className="h-4 w-4" />
                          SportyBet
                        </a>
                      ) : (
                        <button type="button" className={secondary} disabled>SportyBet link unavailable</button>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        ) : (
          <section role="tabpanel" className="space-y-4">
            <div className={panel}>
              <label htmlFor="slipcut-prompt" className="mb-2 block text-sm font-bold">Your request</label>
              <textarea
                id="slipcut-prompt"
                rows={3}
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  setCopied(null);
                  setError(null);
                }}
                placeholder="e.g. Cook 5 football games"
                className={`${field} resize-y text-sm leading-6`}
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" disabled={!prompt.trim()} onClick={() => void copy(prompt.trim(), "prompt")} className={primary}>
                  {copied === "prompt" ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
                  {copied === "prompt" ? "Prompt copied" : "Copy prompt"}
                </button>
                <button type="button" onClick={openBot} className={secondary}>
                  <MessageCircle aria-hidden="true" className="h-4 w-4" />
                  Open bot <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-3 text-xs leading-5 text-[#ac9d89]">
                Telegram does not automatically receive this text. Copy it, open @Slipcut_bot, and paste it in the chat.
              </p>
            </div>
            <div className={panel}>
              <h3 className="mb-3 text-sm font-bold">Quick requests</h3>
              <div className="grid grid-cols-2 gap-2">
                {PROMPTS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setPrompt(item);
                      setCopied(null);
                      setError(null);
                    }}
                    className="min-h-12 rounded-xl border border-[#887153]/40 bg-[#181510]/70 px-3 py-2 text-left text-xs font-medium leading-5 text-[#efdfc7] transition hover:border-[#e9bb7b]/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f4d4a5]"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {error && (
          <div role="alert" className="mt-4 rounded-2xl border border-[#bd6f68]/60 bg-[#4b2422]/75 px-4 py-3 text-sm leading-6 text-[#ffe5df]">
            {error}
          </div>
        )}
      </div>

      <nav
        aria-label="SlipCut navigation"
        className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg border-t border-[#a78a64]/25 bg-[#17140f]/90 px-4 pt-2 backdrop-blur-2xl sm:px-6"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        <div className="grid grid-cols-2 gap-2">
          <button type="button" aria-current={tab === "cut" ? "page" : undefined} onClick={() => selectTab("cut")} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold transition ${tab === "cut" ? "bg-[#e9bb7b] text-[#21170e]" : "text-[#bda788]"}`}>
            <Scissors aria-hidden="true" className="h-4 w-4" /> Cut slip
          </button>
          <button type="button" aria-current={tab === "cook" ? "page" : undefined} onClick={() => selectTab("cook")} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold transition ${tab === "cook" ? "bg-[#e9bb7b] text-[#21170e]" : "text-[#bda788]"}`}>
            <MessageCircle aria-hidden="true" className="h-4 w-4" /> Cook
          </button>
        </div>
      </nav>
    </div>
  );
}
