import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  History,
  Loader2,
  Scissors,
  ShieldCheck,
  Sparkles,
  Ticket,
  X,
} from "lucide-react";
import type {
  BuildRisk,
  BuildSelection,
  BuildSlipRequest,
  BuildSlipResult,
  BuildSport,
  BuildWindow,
} from "@/lib/build-slip";
import type { AnalyzedPick, TicketPick } from "@/lib/types";
import { combinedOdds, formatKickoff, formatOdds } from "@/lib/workbench";

type Tab = "build" | "cut" | "slips";
type Pending = "build" | "cut" | "book" | "history" | null;
type BuildMode = "games" | "odds";
type CutApiResult =
  | { ok: true; kept: AnalyzedPick[]; dropped: AnalyzedPick[]; ignored: AnalyzedPick[] }
  | { ok: false; code?: string; error: string };
type BookApiResult =
  | {
      ok: true;
      shareCode: string;
      shareURL: string;
      combinedOdds: number | null;
      picks: TicketPick[];
      historyStored: boolean;
    }
  | {
      ok: false;
      code: string;
      error: string;
      available?: TicketPick[];
      unavailable?: Array<{ pick: TicketPick; reason: string }>;
      changes?: Array<{ pick: TicketPick; beforeOdds: number; afterOdds: number }>;
    };
type HistoryItem = {
  id: string;
  bookingCode: string;
  createdAt: string;
  sport: string;
  selectionCount: number;
  combinedOdds: number | null;
  status: string;
};
type HistoryApiResult =
  | { ok: true; persistent: true; slips: HistoryItem[] }
  | { ok: false; persistent: false; error: string };
type Minted = { code: string; url: string; combinedOdds: number | null; games: number };

const BOT_URL = "https://t.me/slipcut_bot";
const ODDS_PRESETS = [2, 3, 5, 10, 20];
const STAGES = [
  "Finding games…",
  "Reading SportyBet markets…",
  "Analysing selections…",
  "Reviewing final slip…",
];
const panel =
  "rounded-[20px] border border-[#917657]/30 bg-[#28231c]/88 p-4 shadow-[0_14px_38px_-28px_rgba(0,0,0,.85)] backdrop-blur-xl";
const field =
  "w-full rounded-xl border border-[#80674f]/55 bg-[#171510]/85 px-3 py-3 text-[15px] text-[#f9f1e4] outline-none focus:border-[#edc486] focus-visible:ring-2 focus-visible:ring-[#edc486]/30";
const primary =
  "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#e9bb7b] px-4 py-3 text-sm font-extrabold text-[#21170e] transition active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-45";
const secondary =
  "flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#a88b64]/45 bg-[#30291f]/90 px-3 py-2.5 text-sm font-semibold text-[#f1d5ae] transition active:scale-[.99] disabled:opacity-45";

function telegramWebApp() {
  return (
    window as Window & {
      Telegram?: {
        WebApp?: {
          initData?: string;
          ready?: () => void;
          expand?: () => void;
          openTelegramLink?: (url: string) => void;
          HapticFeedback?: { impactOccurred?: (style: "light" | "medium") => void };
        };
      };
    }
  ).Telegram?.WebApp;
}

function subscribeTelegramInitData() {
  return () => undefined;
}

function telegramInitData() {
  return typeof window === "undefined" ? "" : (telegramWebApp()?.initData ?? "");
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      aria-label={label}
      className="grid grid-flow-col auto-cols-fr gap-1 rounded-xl bg-[#15120e] p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`min-h-10 rounded-lg px-2 text-xs font-bold transition ${value === option.value ? "bg-[#e1b678] text-[#21170e]" : "text-[#bba98f]"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SelectionCard({
  pick,
  selected,
  onToggle,
  index,
}: {
  pick: BuildSelection | AnalyzedPick;
  selected: boolean;
  onToggle: () => void;
  index: number;
}) {
  const score = "modelScore" in pick ? pick.modelScore : pick.probability;
  return (
    <article
      className={`rounded-2xl border p-3 ${selected ? "border-[#9a7d59]/50 bg-[#191611]/80" : "border-[#5b5042]/30 bg-[#15130f]/45 opacity-60"}`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${selected ? "Remove" : "Restore"} ${pick.home} versus ${pick.away}`}
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${selected ? "border-[#d8ad72] bg-[#d8ad72] text-[#21170e]" : "border-[#6f6252] text-[#8d7c68]"}`}
        >
          {selected ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#a9967d]">
                {index + 1} · {pick.league || pick.sport}
              </p>
              <h4 className="mt-1 text-sm font-bold leading-5">
                {pick.home} vs {pick.away}
              </h4>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-sm font-bold text-[#efc88f]">
                {pick.odds ? formatOdds(pick.odds) : "—"}
              </p>
              <p className="text-[10px] text-[#a9967d]">
                {"analysisBasis" in pick ? "Ranking score" : "Uncalibrated AI score"}{" "}
                {Math.round(score)}/100
              </p>
            </div>
          </div>
          <p className="mt-1 text-xs font-semibold text-[#d8b982]">
            {pick.selection} · {pick.market}
          </p>
          <p className="mt-1 text-[11px] text-[#a99a87]">{formatKickoff(pick.kickoff)}</p>
          {"analysisBasis" in pick && (
            <p className="mt-2 text-[11px] font-semibold text-[#e4bd83]">
              {pick.analysisBasis === "ai_assisted_unverified"
                ? "AI-assisted · match facts unverified"
                : "Market rules only · no match research verified"}
              {` · ${pick.confidenceLabel}`}
            </p>
          )}
          <p className="mt-2 text-xs leading-5 text-[#c9bca9]">{pick.summary}</p>
          {pick.reasons.length > 0 && (
            <p className="mt-1 text-[11px] leading-4 text-[#b9ab98]">
              Basis: {pick.reasons.slice(0, 2).join(" ")}
            </p>
          )}
          {pick.risks[0] && (
            <p className="mt-1 text-[11px] leading-4 text-[#d8a99b]">Risk: {pick.risks[0]}</p>
          )}
        </div>
      </div>
    </article>
  );
}

export function MiniAppRefresh() {
  const [tab, setTab] = useState<Tab>("build");
  const [sport, setSport] = useState<BuildSport>("football");
  const [mode, setMode] = useState<BuildMode>("games");
  const [games, setGames] = useState(5);
  const [targetOdds, setTargetOdds] = useState(5);
  const [risk, setRisk] = useState<BuildRisk>("conservative");
  const [windowChoice, setWindowChoice] = useState<BuildWindow>("today");
  const [buildResult, setBuildResult] = useState<Extract<BuildSlipResult, { ok: true }> | null>(
    null,
  );
  const [buildSelected, setBuildSelected] = useState<Set<string>>(new Set());
  const [code, setCode] = useState("");
  const [threshold, setThreshold] = useState(45);
  const [cutResult, setCutResult] = useState<Extract<CutApiResult, { ok: true }> | null>(null);
  const [cutSelected, setCutSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending>(null);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<Minted | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const [oddsChanges, setOddsChanges] = useState<
    Array<{ pick: TicketPick; beforeOdds: number; afterOdds: number }>
  >([]);
  const [sessionSlips, setSessionSlips] = useState<HistoryItem[]>([]);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bookingAttemptRef = useRef<{ body: string; requestId: string } | null>(null);
  const initData = useSyncExternalStore(subscribeTelegramInitData, telegramInitData, () => "");

  useEffect(() => {
    const app = telegramWebApp();
    app?.ready?.();
    app?.expand?.();
  }, []);
  useEffect(() => {
    if (pending !== "build") return;
    const timer = window.setInterval(
      () => setStage((value) => Math.min(value + 1, STAGES.length - 1)),
      2200,
    );
    return () => window.clearInterval(timer);
  }, [pending]);

  const api = useCallback(
    async <T,>(path: string, options: RequestInit = {}) => {
      if (!initData) throw new Error("Open SlipCut from @slipcut_bot to use live tools.");
      const controller = new AbortController();
      abortRef.current = controller;
      const response = await fetch(path, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `tma ${initData}`,
          ...options.headers,
        },
      });
      const result = (await response.json()) as T;
      abortRef.current = null;
      return result;
    },
    [initData],
  );

  const chosenBuild = useMemo(
    () => buildResult?.selections.filter((pick) => buildSelected.has(pick.id)) ?? [],
    [buildResult, buildSelected],
  );
  const allCut = useMemo(
    () => (cutResult ? [...cutResult.kept, ...cutResult.dropped, ...cutResult.ignored] : []),
    [cutResult],
  );
  const chosenCut = useMemo(
    () => allCut.filter((pick) => cutSelected.has(pick.id)),
    [allCut, cutSelected],
  );
  const activePicks = tab === "build" ? chosenBuild : chosenCut;
  const activeOdds = combinedOdds(activePicks);

  function clearMessages() {
    setError(null);
    setMinted(null);
    setCopied(false);
  }
  function clearBookingReview() {
    clearMessages();
    setOddsChanges([]);
    bookingAttemptRef.current = null;
  }

  async function runBuild() {
    if (pending) return;
    clearBookingReview();
    setBuildResult(null);
    setStage(0);
    setPending("build");
    const request: BuildSlipRequest = {
      sport,
      mode,
      risk,
      window: windowChoice,
      ...(mode === "games" ? { games } : { targetOdds }),
    };
    try {
      const result = await api<BuildSlipResult>("/api/miniapp/build", {
        method: "POST",
        body: JSON.stringify(request),
      });
      if (!result.ok) {
        const suggestion =
          result.code === "no_events" && windowChoice === "today"
            ? " Try Upcoming to widen the fixture window."
            : result.code === "no_eligible_markets"
              ? " The filters were not weakened and no unsupported selection was added."
              : "";
        setError(`${result.error}${suggestion}`);
      } else {
        setBuildResult(result);
        setBuildSelected(new Set(result.selections.map((pick) => pick.id)));
        telegramWebApp()?.HapticFeedback?.impactOccurred?.("light");
      }
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError")
        setError("You stopped waiting. The server may still finish its current request.");
      else setError(errorText(caught, "SlipCut could not build this slip."));
    } finally {
      setPending(null);
    }
  }

  async function runCut() {
    if (pending) return;
    const cleaned = code.replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z0-9]{4,16}$/.test(cleaned)) {
      setError("Enter a valid SportyBet booking code.");
      return;
    }
    clearBookingReview();
    setCutResult(null);
    setPending("cut");
    try {
      const result = await api<CutApiResult>("/api/miniapp/cut", {
        method: "POST",
        body: JSON.stringify({ code: cleaned, threshold }),
      });
      if (!result.ok) setError(result.error);
      else {
        setCutResult(result);
        setCutSelected(new Set(result.kept.map((pick) => pick.id)));
      }
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError")
        setError("You stopped waiting. The server may still finish its current request.");
      else setError(errorText(caught, "Slip analysis failed. No code was created."));
    } finally {
      setPending(null);
    }
  }

  async function createCode() {
    if (pending || !activePicks.length) return;
    clearMessages();
    setPending("book");
    try {
      const body = JSON.stringify(activePicks);
      if (!bookingAttemptRef.current || bookingAttemptRef.current.body !== body) {
        bookingAttemptRef.current = {
          body,
          requestId:
            globalThis.crypto?.randomUUID?.() ??
            `book-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        };
      }
      const requestId = bookingAttemptRef.current.requestId;
      const result = await api<BookApiResult>("/api/miniapp/book", {
        method: "POST",
        body: JSON.stringify({ picks: activePicks, requestId }),
      });
      bookingAttemptRef.current = null;
      if (!result.ok) {
        if (
          (result.code === "selection_unavailable" || result.code === "odds_changed") &&
          result.available
        ) {
          const available = result.available;
          const ids = new Set(available.map((pick) => pick.id));
          const refreshed = new Map(available.map((pick) => [pick.id, pick]));
          if (tab === "build") {
            setBuildSelected((current) => new Set([...current].filter((id) => ids.has(id))));
            setBuildResult((current) =>
              current
                ? {
                    ...current,
                    selections: current.selections.map(
                      (pick) => (refreshed.get(pick.id) as BuildSelection | undefined) ?? pick,
                    ),
                  }
                : current,
            );
          } else {
            setCutSelected((current) => new Set([...current].filter((id) => ids.has(id))));
            setCutResult((current) =>
              current
                ? {
                    ...current,
                    kept: current.kept.map(
                      (pick) => (refreshed.get(pick.id) as AnalyzedPick | undefined) ?? pick,
                    ),
                    dropped: current.dropped.map(
                      (pick) => (refreshed.get(pick.id) as AnalyzedPick | undefined) ?? pick,
                    ),
                    ignored: current.ignored.map(
                      (pick) => (refreshed.get(pick.id) as AnalyzedPick | undefined) ?? pick,
                    ),
                  }
                : current,
            );
          }
        }
        if (result.code === "odds_changed" && result.changes?.length)
          setOddsChanges(result.changes);
        else setOddsChanges([]);
        const unavailableNames = result.unavailable
          ?.slice(0, 3)
          .map(({ pick }) => `${pick.home} vs ${pick.away}`)
          .join(", ");
        setError(
          unavailableNames ? `${result.error} Unavailable: ${unavailableNames}.` : result.error,
        );
        return;
      }
      setOddsChanges([]);
      const next = {
        code: result.shareCode,
        url: result.shareURL,
        combinedOdds: result.combinedOdds,
        games: result.picks.length,
      };
      setMinted(next);
      setSessionSlips((items) => [
        {
          id: `session-${Date.now()}`,
          bookingCode: next.code,
          createdAt: new Date().toISOString(),
          sport: tab === "build" ? sport : "cut",
          selectionCount: next.games,
          combinedOdds: next.combinedOdds,
          status: result.historyStored ? "stored" : "this session",
        },
        ...items,
      ]);
      telegramWebApp()?.HapticFeedback?.impactOccurred?.("medium");
    } catch (caught) {
      setError(
        caught instanceof Error && caught.name === "AbortError"
          ? "You stopped waiting. The server may still create a code. Retry to check this same request."
          : errorText(
              caught,
              "Could not confirm whether a code was created. Retry to check the same request.",
            ),
      );
    } finally {
      setPending(null);
    }
  }

  const loadHistory = useCallback(async () => {
    if (!initData) {
      setHistoryNote("Open SlipCut from @slipcut_bot to load stored slip history.");
      return;
    }
    setPending("history");
    setHistoryNote(null);
    try {
      const result = await api<HistoryApiResult>("/api/miniapp/history");
      if (result.ok) setHistory(result.slips);
      else setHistoryNote(`${result.error} Slips created in this open session are shown below.`);
    } catch (caught) {
      setHistoryNote(
        errorText(caught, "Stored history is unavailable. Session slips are shown below."),
      );
    } finally {
      setPending(null);
    }
  }, [api, initData]);

  function changeTab(next: Tab) {
    setTab(next);
    clearBookingReview();
    if (next === "slips") void loadHistory();
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
  }
  async function copyCode() {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.code);
      setCopied(true);
    } catch {
      setError("Copy failed. Press and hold the code to copy it manually.");
    }
  }
  function openBot() {
    const app = telegramWebApp();
    if (app?.openTelegramLink) app.openTelegramLink(BOT_URL);
    else window.open(BOT_URL, "_blank", "noopener,noreferrer");
  }
  const allHistory = useMemo(() => {
    const seen = new Set<string>();
    return [...sessionSlips, ...history].filter((item) => {
      if (seen.has(item.bookingCode)) return false;
      seen.add(item.bookingCode);
      return true;
    });
  }, [history, sessionSlips]);

  return (
    <div className="mini-app min-h-dvh text-[#f7ead8]">
      <main
        className="mx-auto min-h-dvh max-w-lg px-3 pb-28"
        style={{
          paddingTop:
            "calc(max(env(safe-area-inset-top), var(--tg-content-safe-area-inset-top, 0px)) + 16px)",
        }}
      >
        <header className="mb-4 flex items-center justify-between gap-3 px-1">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[.2em] text-[#b79b75]">
              SportyBet slip desk
            </p>
            <h1 className="mt-1 text-[27px] font-black leading-none tracking-[-.055em]">
              Slip<span className="text-[#e9bb7b]">Cut.</span>
            </h1>
          </div>
          <button
            type="button"
            onClick={openBot}
            className={`${secondary} min-h-10 rounded-full px-3 text-xs`}
          >
            @slipcut_bot
          </button>
        </header>
        {!initData && (
          <div className="mb-3 flex gap-2 rounded-xl border border-[#a67a49]/40 bg-[#3b2c1d]/75 p-3 text-xs leading-5 text-[#e7cba5]">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            Live building, cutting and booking require the signed Mini App opened from @slipcut_bot.
          </div>
        )}

        {tab === "build" && (
          <section className="space-y-3">
            <div className={panel}>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#bd9e73]">
                    New slip
                  </p>
                  <h2 className="mt-1 text-lg font-extrabold">Build from live markets</h2>
                </div>
                <Sparkles className="h-5 w-5 text-[#e9bb7b]" />
              </div>
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-xs font-bold text-[#d6c0a1]">Sport</p>
                  <Segmented
                    value={sport}
                    onChange={setSport}
                    label="Sport"
                    options={[
                      { value: "football", label: "Football" },
                      { value: "basketball", label: "Basketball" },
                    ]}
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs font-bold text-[#d6c0a1]">Build method</p>
                  <Segmented
                    value={mode}
                    onChange={setMode}
                    label="Build method"
                    options={[
                      { value: "games", label: "No. of games" },
                      { value: "odds", label: "Target odds" },
                    ]}
                  />
                </div>
                {mode === "games" ? (
                  <label className="block text-xs font-bold text-[#d6c0a1]">
                    Games <span className="float-right font-mono text-[#efc88f]">{games}</span>
                    <input
                      aria-label="Number of games"
                      type="range"
                      min={2}
                      max={15}
                      value={games}
                      onChange={(event) => setGames(Number(event.target.value))}
                      className="mini-range mt-3 w-full"
                    />
                  </label>
                ) : (
                  <div>
                    <p className="mb-2 text-xs font-bold text-[#d6c0a1]">Target combined odds</p>
                    <div className="grid grid-cols-5 gap-1">
                      {ODDS_PRESETS.map((odds) => (
                        <button
                          key={odds}
                          type="button"
                          onClick={() => setTargetOdds(odds)}
                          className={`min-h-10 rounded-lg text-xs font-bold ${targetOdds === odds ? "bg-[#e1b678] text-[#21170e]" : "bg-[#15120e] text-[#bba98f]"}`}
                        >
                          {odds.toFixed(2)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <p className="mb-2 text-xs font-bold text-[#d6c0a1]">Risk mode</p>
                  <Segmented
                    value={risk}
                    onChange={setRisk}
                    label="Risk mode"
                    options={[
                      { value: "conservative", label: "Conservative" },
                      { value: "balanced", label: "Balanced" },
                      { value: "aggressive", label: "Aggressive" },
                    ]}
                  />
                  <p className="mt-2 text-[11px] leading-4 text-[#9f917e]">
                    Changes score, odds and market-family limits. It is not a safety guarantee.
                  </p>
                </div>
                <div>
                  <p className="mb-2 text-xs font-bold text-[#d6c0a1]">When</p>
                  <div className="grid grid-cols-4 gap-1 rounded-xl bg-[#15120e] p-1">
                    {(["today", "tomorrow", "weekend", "upcoming"] as BuildWindow[]).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setWindowChoice(item)}
                        className={`min-h-10 rounded-lg px-1 text-[11px] font-bold capitalize ${windowChoice === item ? "bg-[#5a432c] text-[#f4d3a2]" : "text-[#a8967e]"}`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={pending !== null || !initData}
                  onClick={() => void runBuild()}
                  className={primary}
                >
                  {pending === "build" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {pending === "build" ? STAGES[stage] : "Build & analyse"}
                  <ChevronRight className="h-4 w-4" />
                </button>
                {pending === "build" && (
                  <button type="button" onClick={cancel} className={`${secondary} w-full`}>
                    <X className="h-4 w-4" />
                    Stop waiting
                  </button>
                )}
              </div>
            </div>
            {buildResult && (
              <>
                <ReviewHeader
                  requested={
                    buildResult.requested.mode === "games"
                      ? `${buildResult.requested.games} games`
                      : `${buildResult.requested.targetOdds?.toFixed(2)} odds`
                  }
                  returned={`${chosenBuild.length}/${buildResult.actualGames} selected`}
                  odds={activeOdds}
                  notice={buildResult.notice}
                />
                <p className="px-1 text-[11px] leading-4 text-[#c9bca9]">
                  {
                    buildResult.selections.filter(
                      (pick) => pick.analysisBasis === "ai_assisted_unverified",
                    ).length
                  }{" "}
                  of {buildResult.actualGames} returned picks received AI-assisted scoring; the rest
                  use market rules. Neither score is a verified win probability. Match-specific facts
                  are not source-verified.
                </p>
              </>
            )}
            {buildResult?.selections.map((pick, index) => (
              <SelectionCard
                key={pick.id}
                pick={pick}
                index={index}
                selected={buildSelected.has(pick.id)}
                onToggle={() =>
                  setBuildSelected((current) => {
                    const next = new Set(current);
                    if (next.has(pick.id)) next.delete(pick.id);
                    else next.add(pick.id);
                    setMinted(null);
                    setOddsChanges([]);
                    return next;
                  })
                }
              />
            ))}
            {buildResult && (
              <BookingAction
                pending={pending}
                count={chosenBuild.length}
                onBook={() => void createCode()}
                minted={minted}
                copied={copied}
                onCopy={() => void copyCode()}
                oddsChanges={oddsChanges}
              />
            )}
          </section>
        )}

        {tab === "cut" && (
          <section className="space-y-3">
            <div className={panel}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#bd9e73]">
                Existing code
              </p>
              <h2 className="mt-1 text-lg font-extrabold">Analyse and cut a slip</h2>
              <label className="mt-4 block text-xs font-bold text-[#d6c0a1]">
                SportyBet booking code
                <input
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value.toUpperCase());
                    setCutResult(null);
                    clearMessages();
                  }}
                  placeholder="Enter code"
                  className={`${field} mt-2 font-mono tracking-widest`}
                />
              </label>
              <label className="mt-4 block text-xs font-bold text-[#d6c0a1]">
                Model-score threshold{" "}
                <span className="float-right font-mono text-[#efc88f]">{threshold}/100</span>
                <input
                  aria-label="Model score threshold"
                  type="range"
                  min={40}
                  max={80}
                  value={threshold}
                  onChange={(event) => setThreshold(Number(event.target.value))}
                  className="mini-range mt-3 w-full"
                />
              </label>
              <p className="mt-2 text-[11px] text-[#9f917e]">
                Scores are model estimates, not calibrated win probabilities.
              </p>
              <button
                type="button"
                disabled={pending !== null || !initData}
                onClick={() => void runCut()}
                className={`${primary} mt-4`}
              >
                {pending === "cut" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Scissors className="h-4 w-4" />
                )}
                {pending === "cut" ? "Analysing real code…" : "Analyse & cut"}
              </button>
              {pending === "cut" && (
                <button type="button" onClick={cancel} className={`${secondary} mt-2 w-full`}>
                  <X className="h-4 w-4" />
                  Stop waiting
                </button>
              )}
            </div>
            {cutResult && (
              <ReviewHeader
                requested={`${allCut.length} loaded`}
                returned={`${chosenCut.length}/${allCut.length} selected`}
                odds={activeOdds}
                notice={
                  cutResult.dropped.length || cutResult.ignored.length
                    ? `${cutResult.dropped.length} weak and ${cutResult.ignored.length} unscored selection(s) start deselected. You can restore them manually.`
                    : undefined
                }
              />
            )}
            {cutResult &&
              (
                [
                  { title: "Recommended", note: "Selected by default", picks: cutResult.kept },
                  { title: "Weak legs", note: "Deselected by SlipCut", picks: cutResult.dropped },
                  {
                    title: "Unscored legs",
                    note: "Review before restoring",
                    picks: cutResult.ignored,
                  },
                ] as const
              ).map((group) =>
                group.picks.length ? (
                  <section key={group.title} className="space-y-2">
                    <div className="flex items-end justify-between px-1">
                      <h3 className="text-xs font-extrabold text-[#e7c89d]">{group.title}</h3>
                      <p className="text-[10px] text-[#8f806c]">{group.note}</p>
                    </div>
                    {group.picks.map((pick, index) => (
                      <SelectionCard
                        key={pick.id}
                        pick={pick}
                        index={index}
                        selected={cutSelected.has(pick.id)}
                        onToggle={() =>
                          setCutSelected((current) => {
                            const next = new Set(current);
                            if (next.has(pick.id)) next.delete(pick.id);
                            else next.add(pick.id);
                            setMinted(null);
                            setOddsChanges([]);
                            return next;
                          })
                        }
                      />
                    ))}
                  </section>
                ) : null,
              )}
            {cutResult && (
              <BookingAction
                pending={pending}
                count={chosenCut.length}
                onBook={() => void createCode()}
                minted={minted}
                copied={copied}
                onCopy={() => void copyCode()}
                oddsChanges={oddsChanges}
              />
            )}
          </section>
        )}

        {tab === "slips" && (
          <section className="space-y-3">
            <div className={panel}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#bd9e73]">
                    History
                  </p>
                  <h2 className="mt-1 text-lg font-extrabold">My slips</h2>
                </div>
                {pending === "history" && (
                  <Loader2 className="h-5 w-5 animate-spin text-[#e9bb7b]" />
                )}
              </div>
              <p className="mt-2 text-xs leading-5 text-[#aa9a85]">
                Only real codes created through this Mini App are stored when persistent storage is
                configured.
              </p>
            </div>
            {historyNote && (
              <div className="flex gap-2 rounded-xl border border-[#8e6845]/45 bg-[#34271c] p-3 text-xs leading-5 text-[#dfc39d]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {historyNote}
              </div>
            )}
            {!pending && !allHistory.length && (
              <div className={`${panel} py-8 text-center`}>
                <History className="mx-auto h-7 w-7 text-[#8f7a5e]" />
                <p className="mt-2 text-sm font-bold">No created slips yet</p>
                <p className="mt-1 text-xs text-[#9f917e]">
                  Build or cut a slip, then request a real code.
                </p>
              </div>
            )}
            {allHistory.map((item) => (
              <article key={item.id} className={`${panel} flex items-center gap-3`}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#47351f] text-[#e7bd82]">
                  <Ticket className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="select-all truncate font-mono text-sm font-bold tracking-wider">
                    {item.bookingCode}
                  </p>
                  <p className="mt-1 text-[11px] text-[#aa9a85]">
                    {item.sport} · {item.selectionCount} games ·{" "}
                    {item.combinedOdds ? formatOdds(item.combinedOdds) : "odds unavailable"}
                  </p>
                  <p className="mt-1 text-[10px] text-[#817564]">
                    {new Date(item.createdAt).toLocaleString()} · {item.status}
                  </p>
                </div>
              </article>
            ))}
          </section>
        )}

        {error && (
          <div
            role="alert"
            className="mt-3 flex gap-2 rounded-xl border border-[#a9534d]/50 bg-[#3c2220] p-3 text-xs leading-5 text-[#f2c0ba]"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </main>
      <nav
        aria-label="Mini App sections"
        className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg border-t border-[#876e50]/25 bg-[#15110d]/95 px-3 pt-2 backdrop-blur-xl"
        style={{
          paddingBottom:
            "calc(max(env(safe-area-inset-bottom), var(--tg-content-safe-area-inset-bottom, 0px)) + 8px)",
        }}
      >
        <div className="grid grid-cols-3 gap-1">
          {(
            [
              { id: "build", label: "Build", icon: Sparkles },
              { id: "cut", label: "Cut", icon: Scissors },
              { id: "slips", label: "My Slips", icon: History },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => changeTab(id)}
              className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-bold transition ${tab === id ? "bg-[#4a3825] text-[#efc88f]" : "text-[#958672]"}`}
            >
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function ReviewHeader({
  requested,
  returned,
  odds,
  notice,
}: {
  requested: string;
  returned: string;
  odds: number | null;
  notice?: string;
}) {
  return (
    <section className={panel}>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[10px] text-[#9f917e]">Requested</p>
          <p className="mt-1 text-xs font-bold">{requested}</p>
        </div>
        <div>
          <p className="text-[10px] text-[#9f917e]">Returned</p>
          <p className="mt-1 text-xs font-bold">{returned}</p>
        </div>
        <div>
          <p className="text-[10px] text-[#9f917e]">Actual odds</p>
          <p className="mt-1 font-mono text-sm font-bold text-[#efc88f]">
            {odds ? formatOdds(odds) : "—"}
          </p>
        </div>
      </div>
      {notice && (
        <p className="mt-3 rounded-lg bg-[#3a2c1d] p-2 text-[11px] leading-4 text-[#dfc39d]">
          {notice}
        </p>
      )}
    </section>
  );
}

function BookingAction({
  pending,
  count,
  onBook,
  minted,
  copied,
  onCopy,
  oddsChanges,
}: {
  pending: Pending;
  count: number;
  onBook: () => void;
  minted: Minted | null;
  copied: boolean;
  onCopy: () => void;
  oddsChanges: Array<{ pick: TicketPick; beforeOdds: number; afterOdds: number }>;
}) {
  return (
    <section className={panel}>
      {!minted ? (
        <div>
          {oddsChanges.length ? (
            <div className="mb-3 rounded-xl border border-[#b18451]/45 bg-[#392b1d] p-3">
              <p className="text-xs font-extrabold text-[#f0ca94]">Current odds changed</p>
              <div className="mt-2 space-y-2">
                {oddsChanges.map((change) => (
                  <div
                    key={change.pick.id}
                    className="flex items-center justify-between gap-3 text-[11px]"
                  >
                    <span className="min-w-0 truncate text-[#cdbda7]">
                      {change.pick.home} vs {change.pick.away}
                    </span>
                    <span className="shrink-0 font-mono">
                      <span className="text-[#9f917e] line-through">
                        {formatOdds(change.beforeOdds)}
                      </span>{" "}
                      <span className="text-[#efc88f]">→ {formatOdds(change.afterOdds)}</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-4 text-[#a99a87]">
                Review the updated prices. SlipCut will refresh them once more before minting.
              </p>
            </div>
          ) : null}
          <button
            type="button"
            disabled={pending !== null || count < 1}
            onClick={onBook}
            className={primary}
          >
            {pending === "book" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Ticket className="h-4 w-4" />
            )}
            {pending === "book"
              ? "Refreshing selections…"
              : oddsChanges.length
                ? `Confirm reviewed odds & create · ${count}`
                : `Create SportyBet code · ${count}`}
          </button>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#9ed8a9]">
              Real code created
            </p>
            <Check className="h-4 w-4 text-[#9ed8a9]" />
          </div>
          <p className="mt-2 select-all font-mono text-2xl font-black tracking-[.14em]">
            {minted.code}
          </p>
          <p className="mt-1 text-xs text-[#a99a87]">
            {minted.games} games ·{" "}
            {minted.combinedOdds ? formatOdds(minted.combinedOdds) : "odds unavailable"}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={onCopy} className={secondary}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy code"}
            </button>
            <a href={minted.url} target="_blank" rel="noreferrer" className={secondary}>
              <ExternalLink className="h-4 w-4" />
              SportyBet
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
