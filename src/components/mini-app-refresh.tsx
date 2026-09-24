import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  CircleGauge,
  ExternalLink,
  History,
  Loader2,
  RefreshCw,
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
import type { AnalyzedPick, BookmakerId, BookSport, TicketPick } from "@/lib/types";
import { combinedOdds, formatKickoff, formatOdds } from "@/lib/workbench";

type Tab = "build" | "cut" | "predict" | "engine" | "slips";
type Pending = "build" | "cut" | "ingest" | "predict" | "book" | "history" | null;
type BuildMode = "games" | "odds";
type CutApiResult =
  | { ok: true; kept: AnalyzedPick[]; dropped: AnalyzedPick[]; ignored: AnalyzedPick[]; sourceBookmaker?: BookmakerId; warnings?: string[] }
  | { ok: false; code?: string; error: string };
type BookApiResult =
  | {
      ok: true;
      shareCode: string;
      shareURL: string;
      combinedOdds: number | null;
      picks: TicketPick[];
      historyStored: boolean;
      bookmaker: BookmakerId;
      warnings?: string[];
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
type Minted = {
  code: string;
  url: string;
  combinedOdds: number | null;
  games: number;
  bookmaker: BookmakerId;
  warnings?: string[];
};
type IngestApiResult =
  | { ok: true; picks: TicketPick[]; warnings: string[]; source: "text" | "link" | "image" }
  | { ok: false; error: string };
type PredictionApiResult =
  | {
      ok: true;
      prediction: {
        pick: TicketPick;
        winProbability: number;
        expectedValue: number | null;
        confidence: "high" | "medium" | "low";
        summary: string;
        reasons: string[];
        risks: string[];
        provider: string;
        calibrated: false;
      };
    }
  | { ok: false; error: string };

type EngineCard = {
  n: number;
  code: string;
  url: string;
  odds: number | null;
  games: number;
  legs?: Array<{
    home: string;
    away: string;
    market: string;
    selection: string;
    odds?: number;
    sport: string;
  }>;
  hit?: boolean;
  graded?: boolean;
};
type EngineApiResult =
  | {
      ok: true;
      cards: EngineCard[];
      average: number;
      sampleCount: number;
      qualifyingBar: number | null;
      average: number;
    }
  | { ok: false; error: string };

const BOOKMAKERS: Array<{ value: BookmakerId; label: string }> = [
  { value: "sportybet", label: "SportyBet" },
  { value: "bet9ja", label: "Bet9ja" },
  { value: "1xbet", label: "1XBet" },
];

function bookmakerLabel(id: BookmakerId) {
  return BOOKMAKERS.find((item) => item.value === id)?.label ?? id;
}

const BOT_URL = "https://t.me/slipcut_bot";
const ODDS_PRESETS = [2, 3, 5, 10, 20];
const STAGES = [
  "Finding games…",
  "Reading SportyBet markets…",
  "Analysing selections…",
  "Reviewing final slip…",
];
const panel =
  "rounded-[22px] border border-[#7b5439]/16 bg-[#fffdfa] p-4 shadow-[0_18px_45px_-32px_rgba(82,50,31,.32)]";
const field =
  "w-full rounded-xl border border-[#7b5439]/20 bg-white px-3 py-3 text-[15px] text-[#352317] outline-none placeholder:text-[#a88f7d] focus:border-[#8b5e3c] focus-visible:ring-2 focus-visible:ring-[#8b5e3c]/15";
const primary =
  "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#6b452d] px-4 py-3 text-sm font-extrabold text-white transition active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-45";
const secondary =
  "flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#7b5439]/18 bg-[#f3e7dc] px-3 py-2.5 text-sm font-semibold text-[#5d3d29] transition active:scale-[.99] disabled:opacity-45";

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
      className="grid grid-flow-col auto-cols-fr gap-1 rounded-xl border border-[#7b5439]/12 bg-[#efe2d6] p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`min-h-10 rounded-lg px-2 text-xs font-bold transition ${value === option.value ? "bg-[#6b452d] text-white shadow-sm" : "text-[#7d6553]"}`}
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
              <p className="font-mono text-sm font-bold text-[#7d4e31]">
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
          <p className="mt-1 text-[11px] text-[#7d6959]">{formatKickoff(pick.kickoff)}</p>
          {"analysisBasis" in pick && (
            <>
              <p className="mt-2 text-[11px] font-semibold text-[#e4bd83]">
                AI-reviewed · match facts unverified
                {` · ${pick.confidenceLabel}`}
              </p>
              <p className="mt-1 text-[11px] text-[#7d6959]">
                {pick.trackRecord.status === "qualified"
                  ? `Settled record: ${pick.trackRecord.settled} comparable picks · ${Math.round((pick.trackRecord.hitRate ?? 0) * 100)}% hit rate (not a forecast)`
                  : pick.trackRecord.status === "insufficient_history"
                    ? "Track record: insufficient settled history"
                    : pick.trackRecord.status === "not_gradeable"
                      ? "Track record: this market cannot be graded from a final score"
                    : "Track record unavailable — no historical claim"}
              </p>
            </>
          )}
          <p className="mt-2 text-xs leading-5 text-[#6e5948]">{pick.summary}</p>
          {pick.reasons.length > 0 && (
            <p className="mt-1 text-[11px] leading-4 text-[#766151]">
              Basis: {pick.reasons.slice(0, 2).join(" ")}
            </p>
          )}
          {pick.risks[0] && (
            <p className="mt-1 text-[11px] leading-4 text-[#8b5547]">Risk: {pick.risks[0]}</p>
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
  const [sourceBookmaker, setSourceBookmaker] = useState<BookmakerId>("sportybet");
  const [targetBookmaker, setTargetBookmaker] = useState<BookmakerId>("sportybet");
  const [pasteText, setPasteText] = useState("");
  const [threshold, setThreshold] = useState(45);
  const [predictSport, setPredictSport] = useState<BookSport>("football");
  const [predictHome, setPredictHome] = useState("");
  const [predictAway, setPredictAway] = useState("");
  const [prediction, setPrediction] = useState<Extract<PredictionApiResult, { ok: true }>["prediction"] | null>(null);
  const [engineResult, setEngineResult] = useState<EngineApiResult | null>(null);
  const [engineBusy, setEngineBusy] = useState(false);
  const [engineCopied, setEngineCopied] = useState<string | null>(null);
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
    const cleaned = code.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9_-]{3,64}$/.test(cleaned)) {
      setError("Enter a valid booking code.");
      return;
    }
    clearBookingReview();
    setCutResult(null);
    setPending("cut");
    try {
      const result = await api<CutApiResult>("/api/miniapp/cut", {
        method: "POST",
        body: JSON.stringify({ code: cleaned, threshold, bookmaker: sourceBookmaker }),
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

  async function analyseImported(payload: { mode: "text"; text: string } | { mode: "image"; image: { mime: string; data: string } }) {
    if (pending) return;
    clearBookingReview();
    setCutResult(null);
    setPending("ingest");
    try {
      const extracted = await api<IngestApiResult>("/api/miniapp/ingest", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!extracted.ok) {
        setError(extracted.error);
        return;
      }
      const result = await api<CutApiResult>("/api/miniapp/cut", {
        method: "POST",
        body: JSON.stringify({ picks: extracted.picks, threshold }),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCutResult(result);
      setCutSelected(new Set(result.kept.map((pick) => pick.id)));
      setPasteText("");
      telegramWebApp()?.HapticFeedback?.impactOccurred?.("light");
    } catch (caught) {
      setError(errorText(caught, "Ticket import failed."));
    } finally {
      setPending(null);
    }
  }

  async function importScreenshot(file?: File) {
    if (!file) return;
    if (file.size > 8_000_000) {
      setError("Screenshot is too large.");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read screenshot."));
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.readAsDataURL(file);
    });
    const comma = dataUrl.indexOf(",");
    if (comma < 0) {
      setError("Could not read screenshot.");
      return;
    }
    await analyseImported({
      mode: "image",
      image: { mime: file.type || "image/jpeg", data: dataUrl.slice(comma + 1) },
    });
  }

  async function runPrediction() {
    if (pending) return;
    if (!predictHome.trim() || !predictAway.trim()) {
      setError("Enter both teams or players.");
      return;
    }
    clearMessages();
    setPrediction(null);
    setPending("predict");
    try {
      const result = await api<PredictionApiResult>("/api/miniapp/predict", {
        method: "POST",
        body: JSON.stringify({
          sport: predictSport,
          home: predictHome.trim(),
          away: predictAway.trim(),
        }),
      });
      if (!result.ok) setError(result.error);
      else setPrediction(result.prediction);
    } catch (caught) {
      setError(errorText(caught, "Prediction failed."));
    } finally {
      setPending(null);
    }
  }

  async function createCode() {
    if (pending || !activePicks.length) return;
    clearMessages();
    setPending("book");
    try {
      const body = JSON.stringify({ picks: activePicks, bookmaker: targetBookmaker });
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
        body: JSON.stringify({ picks: activePicks, requestId, bookmaker: targetBookmaker }),
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
        bookmaker: result.bookmaker,
        warnings: result.warnings,
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

  async function loadEngine() {
    if (engineBusy) return;
    setEngineBusy(true);
    try {
      const response = await fetch("/api/engine", { headers: { Accept: "application/json" } });
      setEngineResult((await response.json()) as EngineApiResult);
    } catch {
      setEngineResult({ ok: false, error: "Engine data is temporarily unavailable." });
    } finally {
      setEngineBusy(false);
    }
  }

  async function copyEngineCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setEngineCopied(code);
      window.setTimeout(
        () => setEngineCopied((current) => (current === code ? null : current)),
        1500,
      );
    } catch {
      setError("Copy failed. Press and hold the code to copy it manually.");
    }
  }

  function changeTab(next: Tab) {
    setTab(next);
    clearBookingReview();
    if (next === "slips") void loadHistory();
    if (next === "engine" && !engineResult) void loadEngine();
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
    <div className="mini-app min-h-dvh bg-[#f6efe8] text-[#2f2118]">
      <main
        className="mx-auto min-h-dvh max-w-lg px-3 pb-28"
        style={{
          paddingTop:
            "calc(max(env(safe-area-inset-top), var(--tg-content-safe-area-inset-top, 0px)) + 16px)",
        }}
      >
        <header className="mb-4 flex items-center justify-between gap-3 px-1">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[.2em] text-[#8d6d56]">
              Multi-bookmaker betting desk
            </p>
            <h1 className="mt-1 text-[27px] font-black leading-none tracking-[-.055em]">
              Slip<span className="text-[#7a4f33]">Cut.</span>
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
          <div className="mb-3 flex gap-2 rounded-xl border border-[#9b6f4e]/20 bg-[#f3e5d8] p-3 text-xs leading-5 text-[#6f4d35]">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            Live building, cutting and booking require the signed Mini App opened from @slipcut_bot.
          </div>
        )}

        {tab === "build" && (
          <section className="space-y-3">
            <div className={panel}>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#8f694e]">
                    New slip
                  </p>
                  <h2 className="mt-1 text-lg font-extrabold">Build from live markets</h2>
                </div>
                <Sparkles className="h-5 w-5 text-[#7a4f33]" />
              </div>
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-xs font-bold text-[#5f4635]">Sport</p>
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
                  <p className="mb-2 text-xs font-bold text-[#5f4635]">Build method</p>
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
                  <label className="block text-xs font-bold text-[#5f4635]">
                    Games <span className="float-right font-mono text-[#7d4e31]">{games}</span>
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
                    <p className="mb-2 text-xs font-bold text-[#5f4635]">Target combined odds</p>
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
                  <p className="mb-2 text-xs font-bold text-[#5f4635]">Risk mode</p>
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
                  <p className="mt-2 text-[11px] leading-4 text-[#7f6b5b]">
                    Changes score, odds and market-family limits. It is not a safety guarantee.
                  </p>
                </div>
                <div>
                  <p className="mb-2 text-xs font-bold text-[#5f4635]">When</p>
                  <div className="grid grid-cols-4 gap-1 rounded-xl border border-[#7b5439]/12 bg-[#efe2d6] p-1">
                    {(["today", "tomorrow", "weekend", "upcoming"] as BuildWindow[]).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setWindowChoice(item)}
                        className={`min-h-10 rounded-lg px-1 text-[11px] font-bold capitalize ${windowChoice === item ? "bg-[#6b452d] text-white shadow-sm" : "text-[#7d6553]"}`}
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
                <p className="px-1 text-[11px] leading-4 text-[#6e5948]">
                  AI reviewed the eligible options for every returned game. Unreviewed games are
                  excluded. It only has the supplied fixture and odds data here; match-specific form
                  and injuries are not source-verified. Scores are rankings, not win probabilities.
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
                targetBookmaker={targetBookmaker}
                onTargetBookmaker={setTargetBookmaker}
              />
            )}
          </section>
        )}

        {tab === "cut" && (
          <section className="space-y-3">
            <div className={panel}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#8f694e]">
                Existing code
              </p>
              <h2 className="mt-1 text-lg font-extrabold">Analyse and cut a slip</h2>
              <label className="mt-4 block text-xs font-bold text-[#5f4635]">
                Source bookmaker
                <select
                  value={sourceBookmaker}
                  onChange={(event) => {
                    setSourceBookmaker(event.target.value as BookmakerId);
                    setCutResult(null);
                    clearMessages();
                  }}
                  className={`${field} mt-2`}
                >
                  {BOOKMAKERS.map((bookmaker) => (
                    <option key={bookmaker.value} value={bookmaker.value}>
                      {bookmaker.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-4 block text-xs font-bold text-[#5f4635]">
                {bookmakerLabel(sourceBookmaker)} booking code
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
              <label className="mt-4 block text-xs font-bold text-[#5f4635]">
                Model-score threshold{" "}
                <span className="float-right font-mono text-[#7d4e31]">{threshold}/100</span>
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
              <p className="mt-2 text-[11px] text-[#7f6b5b]">
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
              <div className="my-4 flex items-center gap-3 text-[10px] uppercase tracking-widest text-[#9a8371]">
                <span className="h-px flex-1 bg-[#6b5843]/35" />
                or import
                <span className="h-px flex-1 bg-[#6b5843]/35" />
              </div>
              <textarea
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                placeholder="Paste picks, a tips link, or ticket text"
                className={`${field} min-h-24 resize-y`}
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={pending !== null || !pasteText.trim()}
                  onClick={() => void analyseImported({ mode: "text", text: pasteText })}
                  className={secondary}
                >
                  <Sparkles className="h-4 w-4" />
                  Read text/link
                </button>
                <label className={`${secondary} cursor-pointer`}>
                  <Ticket className="h-4 w-4" />
                  Screenshot
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    disabled={pending !== null}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      void importScreenshot(file);
                    }}
                  />
                </label>
              </div>
              {pending === "ingest" && (
                <p className="mt-2 text-[11px] text-[#d7ba91]">Reading ticket and analysing picks…</p>
              )}
            </div>
            {cutResult && (
              <ReviewHeader
                requested={`${allCut.length} loaded`}
                returned={`${chosenCut.length}/${allCut.length} selected`}
                odds={activeOdds}
                notice={
                  [
                    ...(cutResult.warnings ?? []),
                    ...(cutResult.dropped.length || cutResult.ignored.length
                      ? [`${cutResult.dropped.length} weak and ${cutResult.ignored.length} unscored selection(s) start deselected. You can restore them manually.`]
                      : []),
                  ].join(" ") || undefined
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
                targetBookmaker={targetBookmaker}
                onTargetBookmaker={setTargetBookmaker}
              />
            )}
          </section>
        )}

        {tab === "predict" && (
          <section className="space-y-3">
            <div className={panel}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#8f694e]">
                Match prediction
              </p>
              <h2 className="mt-1 text-lg font-extrabold">Research a match</h2>
              <p className="mt-2 text-[11px] leading-4 text-[#7f6b5b]">
                Uses the existing live research stack for form, injuries and H2H, then compares open markets and prices.
              </p>
              <label className="mt-4 block text-xs font-bold text-[#5f4635]">
                Sport
                <select
                  value={predictSport}
                  onChange={(event) => setPredictSport(event.target.value as BookSport)}
                  className={`${field} mt-2`}
                >
                  <option value="football">Football</option>
                  <option value="basketball">Basketball</option>
                  <option value="tennis">Tennis</option>
                  <option value="handball">Handball</option>
                </select>
              </label>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <input
                  value={predictHome}
                  onChange={(event) => setPredictHome(event.target.value)}
                  placeholder="Home / Player 1"
                  className={field}
                />
                <input
                  value={predictAway}
                  onChange={(event) => setPredictAway(event.target.value)}
                  placeholder="Away / Player 2"
                  className={field}
                />
              </div>
              <button
                type="button"
                disabled={pending !== null || !initData}
                onClick={() => void runPrediction()}
                className={`${primary} mt-4`}
              >
                {pending === "predict" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {pending === "predict" ? "Researching match…" : "Predict best market"}
              </button>
            </div>
            {prediction && (
              <article className={panel}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#4d7452]">Best reviewed market</p>
                <h3 className="mt-2 text-base font-extrabold">{prediction.pick.home} vs {prediction.pick.away}</h3>
                <p className="mt-1 text-sm font-bold text-[#7d4e31]">
                  {prediction.pick.market} · {prediction.pick.selection}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-[#f3e7dc] p-2">
                    <p className="text-[10px] text-[#7f6b5b]">Model probability</p>
                    <p className="mt-1 font-mono font-bold">{Math.round(prediction.winProbability)}%</p>
                  </div>
                  <div className="rounded-xl bg-[#f3e7dc] p-2">
                    <p className="text-[10px] text-[#7f6b5b]">Odds</p>
                    <p className="mt-1 font-mono font-bold">{prediction.pick.odds ? formatOdds(prediction.pick.odds) : "—"}</p>
                  </div>
                  <div className="rounded-xl bg-[#f3e7dc] p-2">
                    <p className="text-[10px] text-[#7f6b5b]">EV</p>
                    <p className="mt-1 font-mono font-bold">
                      {prediction.expectedValue == null ? "—" : `${prediction.expectedValue >= 0 ? "+" : ""}${(prediction.expectedValue * 100).toFixed(1)}%`}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-[#6e5948]">{prediction.summary}</p>
                {prediction.reasons.length > 0 && (
                  <p className="mt-2 text-[11px] leading-4 text-[#766151]">Basis: {prediction.reasons.join(" · ")}</p>
                )}
                {prediction.risks.length > 0 && (
                  <p className="mt-1 text-[11px] leading-4 text-[#8b5547]">Risks: {prediction.risks.join(" · ")}</p>
                )}
                <p className="mt-2 text-[10px] text-[#9a8371]">Model estimate is not calibrated probability.</p>
              </article>
            )}
          </section>
        )}

        {tab === "engine" && (
          <section className="space-y-3">
            <div className={panel}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#8f694e]">
                    Accuracy-led
                  </p>
                  <h2 className="mt-1 text-xl font-black tracking-[-.04em]">Engine Accumulators</h2>
                  <p className="mt-2 text-xs leading-5 text-[#7a6656]">
                    Daily cards built from market families that pass SlipCut's accuracy and quality gates.
                    Longer cards are still longer shots.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadEngine()}
                  disabled={engineBusy}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#7b5439]/15 bg-[#f3e7dc] text-[#6b452d]"
                >
                  <RefreshCw className={`h-4 w-4 ${engineBusy ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {engineResult?.ok && (
              <div className="grid grid-cols-3 gap-2">
                <div className={panel}>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-[#8f7663]">Hit rate</p>
                  <p className="mt-2 text-2xl font-black text-[#6b452d]">
                    {engineResult.average > 0 ? `${Math.round(engineResult.average * 100)}%` : "—"}
                  </p>
                  <p className="mt-1 text-[9px] text-[#8f7663]">{engineResult.sampleCount} settled</p>
                </div>
                <div className={panel}>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-[#8f7663]">Qualify</p>
                  <p className="mt-2 text-2xl font-black text-[#6b452d]">
                    {engineResult.qualifyingBar == null ? "—" : `${Math.round(engineResult.qualifyingBar * 100)}%`}
                  </p>
                  <p className="mt-1 text-[9px] text-[#8f7663]">rolling bar</p>
                </div>
                <div className={panel}>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-[#8f7663]">Cards</p>
                  <p className="mt-2 text-2xl font-black text-[#6b452d]">{engineResult.cards.length}</p>
                  <p className="mt-1 text-[9px] text-[#8f7663]">today</p>
                </div>
              </div>
            )}

            {engineBusy && !engineResult && (
              <div className={`${panel} flex items-center gap-3`}>
                <Loader2 className="h-5 w-5 animate-spin text-[#6b452d]" />
                <p className="text-xs font-bold">Loading today's engine ladder…</p>
              </div>
            )}

            {engineResult && !engineResult.ok && (
              <div className={`${panel} text-center`}>
                <CircleGauge className="mx-auto h-7 w-7 text-[#8b654d]" />
                <p className="mt-2 text-sm font-black">No engine cards right now</p>
                <p className="mt-1 text-xs leading-5 text-[#7a6656]">{engineResult.error}</p>
              </div>
            )}

            {engineResult?.ok &&
              engineResult.cards.map((card, index) => (
                <article key={card.code} className={panel}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[.16em] text-[#8f694e]">
                        Card {index + 1} · {card.n}-leg ladder
                      </p>
                      <div className="mt-2 flex items-end gap-2">
                        <p className="font-mono text-3xl font-black tracking-[-.04em] text-[#5d3d29]">
                          {card.odds ? formatOdds(card.odds) : "—"}
                        </p>
                        <span className="pb-1 text-[10px] font-bold text-[#8f7663]">odds</span>
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${
                        card.graded
                          ? card.hit
                            ? "bg-[#e4eee2] text-[#4d7452]"
                            : "bg-[#f5e3df] text-[#8b4e45]"
                          : "bg-[#f2e5c8] text-[#81632f]"
                      }`}
                    >
                      {card.graded ? (card.hit ? "Hit" : "Missed") : "Pending"}
                    </span>
                  </div>
                  {card.legs?.length ? (
                    <div className="mt-3 max-h-52 space-y-2 overflow-y-auto rounded-xl border border-[#7b5439]/10 bg-[#fbf7f2] p-3">
                      {card.legs.slice(0, 6).map((leg, legIndex) => (
                        <div key={`${card.code}-${legIndex}`} className="grid grid-cols-[20px_1fr_auto] items-center gap-2">
                          <span className="grid h-5 w-5 place-items-center rounded-full bg-[#6b452d] text-[9px] font-black text-white">
                            {legIndex + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[10px] font-black">{leg.home} vs {leg.away}</p>
                            <p className="truncate text-[9px] text-[#8f7663]">
                              {leg.market} · {leg.selection}
                            </p>
                          </div>
                          <span className="font-mono text-[10px] font-black text-[#6b452d]">
                            {leg.odds ? leg.odds.toFixed(2) : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-[#f3e7dc] p-3">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-[#8f7663]">Games</p>
                      <p className="mt-1 text-lg font-black">{card.games}</p>
                    </div>
                    <div className="rounded-xl bg-[#f3e7dc] p-3">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-[#8f7663]">Code</p>
                      <p className="mt-1 truncate font-mono text-sm font-black">{card.code}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => void copyEngineCode(card.code)}
                      className={secondary}
                    >
                      {engineCopied === card.code ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {engineCopied === card.code ? "Copied" : "Copy"}
                    </button>
                    <a href={card.url} target="_blank" rel="noreferrer" className={primary}>
                      Open <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                </article>
              ))}
          </section>
        )}

        {tab === "slips" && (
          <section className="space-y-3">
            <div className={panel}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#8f694e]">
                    History
                  </p>
                  <h2 className="mt-1 text-lg font-extrabold">My slips</h2>
                </div>
                {pending === "history" && (
                  <Loader2 className="h-5 w-5 animate-spin text-[#7a4f33]" />
                )}
              </div>
              <p className="mt-2 text-xs leading-5 text-[#7a6656]">
                Only real codes created through this Mini App are stored when persistent storage is
                configured.
              </p>
            </div>
            {historyNote && (
              <div className="flex gap-2 rounded-xl border border-[#8e6845]/45 bg-[#f2e5d9] p-3 text-xs leading-5 text-[#6e4e38]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {historyNote}
              </div>
            )}
            {!pending && !allHistory.length && (
              <div className={`${panel} py-8 text-center`}>
                <History className="mx-auto h-7 w-7 text-[#8f7a5e]" />
                <p className="mt-2 text-sm font-bold">No created slips yet</p>
                <p className="mt-1 text-xs text-[#7f6b5b]">
                  Build or cut a slip, then request a real code.
                </p>
              </div>
            )}
            {allHistory.map((item) => (
              <article key={item.id} className={`${panel} flex items-center gap-3`}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#ead9ca] text-[#7a4f33]">
                  <Ticket className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="select-all truncate font-mono text-sm font-bold tracking-wider">
                    {item.bookingCode}
                  </p>
                  <p className="mt-1 text-[11px] text-[#7a6656]">
                    {item.sport} · {item.selectionCount} games ·{" "}
                    {item.combinedOdds ? formatOdds(item.combinedOdds) : "odds unavailable"}
                  </p>
                  <p className="mt-1 text-[10px] text-[#9a8371]">
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
            className="mt-3 flex gap-2 rounded-xl border border-[#b56f64]/28 bg-[#f7e8e5] p-3 text-xs leading-5 text-[#8b4e45]"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </main>
      <nav
        aria-label="Mini App sections"
        className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg border-t border-[#7b5439]/15 bg-[#fffaf8]/95 px-3 pt-2 backdrop-blur-xl"
        style={{
          paddingBottom:
            "calc(max(env(safe-area-inset-bottom), var(--tg-content-safe-area-inset-bottom, 0px)) + 8px)",
        }}
      >
        <div className="grid grid-cols-5 gap-1">
          {(
            [
              { id: "build", label: "Build", icon: Sparkles },
              { id: "cut", label: "Cut", icon: Scissors },
              { id: "predict", label: "Predict", icon: Sparkles },
              { id: "engine", label: "Engine", icon: CircleGauge },
              { id: "slips", label: "My Slips", icon: History },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => changeTab(id)}
              className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-bold transition ${tab === id ? "bg-[#6b452d] text-white shadow-sm" : "text-[#8a735f]"}`}
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
          <p className="text-[10px] text-[#7f6b5b]">Requested</p>
          <p className="mt-1 text-xs font-bold">{requested}</p>
        </div>
        <div>
          <p className="text-[10px] text-[#7f6b5b]">Returned</p>
          <p className="mt-1 text-xs font-bold">{returned}</p>
        </div>
        <div>
          <p className="text-[10px] text-[#7f6b5b]">Actual odds</p>
          <p className="mt-1 font-mono text-sm font-bold text-[#7d4e31]">
            {odds ? formatOdds(odds) : "—"}
          </p>
        </div>
      </div>
      {notice && (
        <p className="mt-3 rounded-lg bg-[#f1e3d5] p-2 text-[11px] leading-4 text-[#6e4e38]">
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
  targetBookmaker,
  onTargetBookmaker,
}: {
  pending: Pending;
  count: number;
  onBook: () => void;
  minted: Minted | null;
  copied: boolean;
  onCopy: () => void;
  oddsChanges: Array<{ pick: TicketPick; beforeOdds: number; afterOdds: number }>;
  targetBookmaker: BookmakerId;
  onTargetBookmaker: (bookmaker: BookmakerId) => void;
}) {
  return (
    <section className={panel}>
      {!minted ? (
        <div>
          <label className="mb-3 block text-xs font-bold text-[#5f4635]">
            Create code on
            <select
              value={targetBookmaker}
              onChange={(event) => onTargetBookmaker(event.target.value as BookmakerId)}
              className={`${field} mt-2`}
            >
              {BOOKMAKERS.map((bookmaker) => (
                <option key={bookmaker.value} value={bookmaker.value}>
                  {bookmaker.label}
                </option>
              ))}
            </select>
          </label>
          {oddsChanges.length ? (
            <div className="mb-3 rounded-xl border border-[#9a6d4b]/20 bg-[#f3e6da] p-3">
              <p className="text-xs font-extrabold text-[#754a30]">Current odds changed</p>
              <div className="mt-2 space-y-2">
                {oddsChanges.map((change) => (
                  <div
                    key={change.pick.id}
                    className="flex items-center justify-between gap-3 text-[11px]"
                  >
                    <span className="min-w-0 truncate text-[#6f5a49]">
                      {change.pick.home} vs {change.pick.away}
                    </span>
                    <span className="shrink-0 font-mono">
                      <span className="text-[#7f6b5b] line-through">
                        {formatOdds(change.beforeOdds)}
                      </span>{" "}
                      <span className="text-[#7d4e31]">→ {formatOdds(change.afterOdds)}</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-4 text-[#7d6959]">
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
                : `Create ${bookmakerLabel(targetBookmaker)} code · ${count}`}
          </button>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#4d7452]">
              Real code created
            </p>
            <Check className="h-4 w-4 text-[#4d7452]" />
          </div>
          <p className="mt-2 select-all font-mono text-2xl font-black tracking-[.14em]">
            {minted.code}
          </p>
          <p className="mt-1 text-xs text-[#7d6959]">
            {minted.games} games ·{" "}
            {minted.combinedOdds ? formatOdds(minted.combinedOdds) : "odds unavailable"}
          </p>
          {minted.warnings?.length ? (
            <div className="mt-3 rounded-xl border border-[#9a6d4b]/20 bg-[#f3e6da] p-3 text-[11px] leading-4 text-[#6d4d37]">
              {minted.warnings.map((warning, index) => (
                <p key={`${warning}-${index}`}>{warning}</p>
              ))}
            </div>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={onCopy} className={secondary}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy code"}
            </button>
            {minted.url ? (
              <a href={minted.url} target="_blank" rel="noreferrer" className={secondary}>
                <ExternalLink className="h-4 w-4" />
                {bookmakerLabel(minted.bookmaker)}
              </a>
            ) : (
              <div className={`${secondary} opacity-60`}>{bookmakerLabel(minted.bookmaker)}</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
