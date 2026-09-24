import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  Gauge,
  History,
  Layers,
  MessageCircle,
  RefreshCw,
  ScanLine,
  Scissors,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  TicketCheck,
  Trophy,
  X,
  Zap,
} from "lucide-react";

const BOT = "https://t.me/Slipcut_bot";
const APP = "/app";

const C = {
  ink: "#2E2016",
  brown: "#6F4A2D",
  brown2: "#8B5E3C",
  tan: "#C89B6D",
  cream: "#F8F3ED",
  paper: "#FFFDF9",
  soft: "#F1E5D6",
  line: "#D8C3AE",
  muted: "#7A6554",
  green: "#2C7A4B",
  amber: "#A46620",
};

type EngineLeg = {
  home: string;
  away: string;
  market: string;
  selection: string;
  odds?: number;
  sport: string;
};

type EngineCard = {
  n: number;
  code: string;
  url: string;
  odds: number | null;
  games: number;
  legs?: EngineLeg[];
  hit?: boolean;
  graded?: boolean;
};

type EnginePayload = {
  ok: boolean;
  error?: string;
  average: number;
  sampleCount: number;
  qualifyingBar: number | null;
  ladder: number[];
  cards: EngineCard[];
};

const NAV = [
  { href: "#engine", label: "Engine" },
  { href: "#workflows", label: "Workflows" },
  { href: "#performance", label: "Performance" },
  { href: APP, label: "Mini App" },
];


const FEATURES = [
  {
    icon: Bot,
    title: "Build",
    body: "Choose sport, target odds, risk mode and time window. SlipCut reviews eligible markets before it builds.",
  },
  {
    icon: Scissors,
    title: "Cut",
    body: "Load a booking code, score every leg, remove weak selections and mint a cleaner code.",
  },
  {
    icon: Sparkles,
    title: "Predict",
    body: "Research a match, compare open markets and surface a preferred pick with probability and EV context.",
  },
  {
    icon: ScanLine,
    title: "Import",
    body: "Paste tips, links or screenshots. SlipCut turns them into structured selections and runs them through the same review flow.",
  },
  {
    icon: Layers,
    title: "Convert",
    body: "Move a reviewed ticket between supported bookmakers with fixture matching and conversion warnings.",
  },
  {
    icon: History,
    title: "Track",
    body: "Saved slips, settled picks and market-family results feed the engine's qualifying rules over time.",
  },
];

const FLOW = [
  ["01", "DISCOVER", "Pull eligible live events and a broad set of market lines."],
  ["02", "QUALIFY", "Filter sport, league, price, market family and settled-record quality."],
  ["03", "REVIEW", "Compare multiple options per match instead of defaulting to one market."],
  ["04", "BUILD", "Assemble the strongest unique-event combination near your target."],
  ["05", "VERIFY", "Refresh availability and odds before the final booking code is minted."],
];

function fmtPct(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "Learning";
  return `${Math.round(value * 100)}%`;
}

function fmtOdds(value: number | null | undefined) {
  return value && Number.isFinite(value) ? value.toFixed(2) : "—";
}

function statusLabel(card: EngineCard) {
  if (!card.graded) return "Pending";
  return card.hit ? "Hit" : "Missed";
}

export function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [engine, setEngine] = useState<EnginePayload | null>(null);
  const [engineLoading, setEngineLoading] = useState(true);
  const [copied, setCopied] = useState("");

  async function loadEngine() {
    setEngineLoading(true);
    try {
      const response = await fetch("/api/engine", { headers: { Accept: "application/json" } });
      const data = (await response.json()) as EnginePayload;
      if (response.ok) setEngine(data);
    } catch {
      // Landing page stays useful even if the data layer is unavailable.
    } finally {
      setEngineLoading(false);
    }
  }

  useEffect(() => {
    void loadEngine();
  }, []);

  const engineCards = engine?.cards ?? [];
  const ladder = engine?.ladder?.length ? engine.ladder : [2, 3, 5, 8, 12];
  const statCards = useMemo(
    () => [
      {
        label: "Engine hit rate",
        value: fmtPct(engine?.average ?? 0),
        meta: engine?.sampleCount ? `${engine.sampleCount.toLocaleString()} settled picks` : "Building settled sample",
        icon: Trophy,
      },
      {
        label: "Qualifying bar",
        value: fmtPct(engine?.qualifyingBar ?? 0),
        meta: "Market family must clear the engine baseline",
        icon: Gauge,
      },
      {
        label: "Today's ladder",
        value: engineCards.length ? `${engineCards.length}/5` : "0/5",
        meta: `${ladder[0]} → ${ladder[ladder.length - 1]} leg targets`,
        icon: Target,
      },
      {
        label: "Bookmakers",
        value: "3",
        meta: "SportyBet · Bet9ja · 1XBet",
        icon: TicketCheck,
      },
    ],
    [engine, engineCards.length, ladder],
  );

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied(""), 1400);
    } catch {
      // Clipboard can be unavailable in some embedded browsers.
    }
  }

  return (
    <div
      className="live-page relative min-h-dvh overflow-x-hidden"
      style={{
        color: C.ink,
        background:
          "radial-gradient(circle at 8% 2%, rgba(200,155,109,.22), transparent 24rem), radial-gradient(circle at 96% 18%, rgba(111,74,45,.12), transparent 28rem), #F8F3ED",
      }}
    >
      <div className="ambient-orb ambient-orb-a" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-b" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-c" aria-hidden="true" />
      <header className="live-header sticky top-0 z-50 border-b backdrop-blur-2xl" style={{ borderColor: C.line, background: "rgba(255,253,249,.88)" }}>
        <div className="mx-auto flex h-16 max-w-[1480px] items-center justify-between px-4 sm:px-6 lg:h-[72px] lg:px-8">
          <a href="/" className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-2xl border bg-white shadow-sm" style={{ borderColor: C.line }}>
              <img src="/logo.png" alt="" className="size-7 rounded-full" />
            </div>
            <div className="leading-none">
              <p className="text-[15px] font-black tracking-[-0.03em]">SLIPCUT</p>
              <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.24em]" style={{ color: C.muted }}>
                Betting co-pilot
              </p>
            </div>
          </a>

          <nav className="hidden items-center gap-1 rounded-2xl border bg-white p-1 lg:flex" style={{ borderColor: C.line }}>
            {NAV.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="rounded-xl px-4 py-2 text-xs font-bold transition hover:bg-[#F1E5D6]"
                style={{ color: C.brown }}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <a
              href={APP}
              className="hidden rounded-xl border bg-white px-4 py-2.5 text-xs font-extrabold sm:inline-flex"
              style={{ borderColor: C.line, color: C.brown }}
            >
              Open Mini App
            </a>
            <a
              href={BOT}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black text-white shadow-[0_12px_30px_-14px_rgba(111,74,45,.9)]"
              style={{ background: C.brown }}
            >
              <Send className="size-3.5" />
              Open Bot
            </a>
            <button
              type="button"
              aria-label="Toggle menu"
              onClick={() => setMenuOpen((value) => !value)}
              className="grid size-10 place-items-center rounded-xl border bg-white lg:hidden"
              style={{ borderColor: C.line }}
            >
              {menuOpen ? <X className="size-5" /> : <MenuIcon />}
            </button>
          </div>
        </div>

        {menuOpen ? (
          <div className="border-t bg-white px-4 py-4 lg:hidden" style={{ borderColor: C.line }}>
            <div className="grid gap-2">
              {NAV.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-xl px-3 py-3 text-sm font-bold hover:bg-[#F1E5D6]"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </header>

      <main>
        <section className="hero-stage mx-auto grid max-w-[1480px] gap-6 px-4 pb-8 pt-6 sm:px-6 lg:grid-cols-[1.35fr_.65fr] lg:px-8 lg:pb-10 lg:pt-8">
          <div className="hero-panel hero-enter relative overflow-hidden rounded-[32px] border bg-[#FFFDF9] p-6 shadow-[0_30px_80px_-48px_rgba(46,32,22,.42)] sm:p-8 lg:p-11" style={{ borderColor: C.line }}>
            <div
              aria-hidden="true"
              className="absolute inset-0 opacity-40"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(111,74,45,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(111,74,45,.06) 1px, transparent 1px)",
                backgroundSize: "34px 34px",
              }}
            />
            <div className="relative">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border bg-[#F1E5D6] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em]" style={{ borderColor: C.line, color: C.brown }}>
                  Multi-bookmaker
                </span>
                <span className="rounded-full border bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em]" style={{ borderColor: C.line, color: C.muted }}>
                  Telegram + Mini App
                </span>
                <span className="rounded-full border bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em]" style={{ borderColor: C.line, color: C.muted }}>
                  <span className="live-dot mr-1 inline-block size-1.5 rounded-full bg-[#6F4A2D]" />Accuracy-led engine
                </span>
              </div>

              <h1 className="mt-7 max-w-4xl text-[clamp(3.2rem,7vw,7.2rem)] font-black leading-[.83] tracking-[-.075em]">
                Build less.
                <span className="block" style={{ color: C.brown }}>
                  Review more.
                </span>
              </h1>

              <p className="mt-7 max-w-2xl text-base font-medium leading-7 sm:text-lg" style={{ color: C.muted }}>
                SlipCut is a betting co-pilot for building, cutting, researching and converting slips.
                It scans multiple market options per event, tracks what settles, and keeps the final ticket editable before booking.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href={APP}
                  className="shine-action inline-flex h-13 items-center gap-2 rounded-2xl px-6 text-sm font-black text-white shadow-[0_18px_40px_-18px_rgba(111,74,45,.85)]"
                  style={{ background: C.brown }}
                >
                  Launch Mini App
                  <ArrowRight className="size-4" />
                </a>
                <a
                  href={BOT}
                  className="soft-action inline-flex h-13 items-center gap-2 rounded-2xl border bg-white px-6 text-sm font-black"
                  style={{ borderColor: C.line, color: C.brown }}
                >
                  <Bot className="size-4" />
                  Chat @Slipcut_bot
                </a>
              </div>

              <div className="mt-10 grid gap-2 sm:grid-cols-3">
                {[
                  ["8", "market options / event"],
                  ["4", "sports supported"],
                  ["1.20", "conservative floor"],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-2xl border bg-white/80 p-4" style={{ borderColor: C.line }}>
                    <p className="text-2xl font-black tracking-[-0.05em]" style={{ color: C.brown }}>{value}</p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.13em]" style={{ color: C.muted }}>{label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <div className="motion-card motion-card-1 rounded-[28px] border bg-[#2E2016] p-6 text-[#FFFDF9] shadow-[0_28px_60px_-38px_rgba(46,32,22,.7)]" style={{ borderColor: C.brown }}>
              <div className="flex items-center justify-between">
                <span className="rounded-full border border-white/20 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-[#E8C7A6]">
                  Live engine
                </span>
                <Activity className="size-4 text-[#C89B6D]" />
              </div>
              <p className="mt-7 text-5xl font-black tracking-[-0.07em]">{fmtPct(engine?.average ?? 0)}</p>
              <p className="mt-2 text-xs font-bold uppercase tracking-[0.16em] text-[#C8B6A4]">settled engine hit rate</p>
              <div className="mt-6 h-px bg-white/10" />
              <div className="mt-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-[#C8B6A4]">Settled sample</p>
                  <p className="mt-1 text-lg font-black">{engine?.sampleCount?.toLocaleString() ?? "0"}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-[#C8B6A4]">Cards today</p>
                  <p className="mt-1 text-lg font-black">{engineCards.length}/5</p>
                </div>
              </div>
            </div>

            <div className="motion-card motion-card-2 rounded-[28px] border bg-[#F1E5D6] p-6" style={{ borderColor: C.line }}>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: C.brown }}>Desk status</p>
                <Zap className="size-4" style={{ color: C.brown }} />
              </div>
              <div className="mt-5 space-y-3">
                {[
                  ["Market review", "Broad"],
                  ["Conservative", "1.20+"],
                  ["Bookmakers", "3"],
                  ["Fallback engine", "Ready"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between rounded-xl border bg-white/75 px-3.5 py-3" style={{ borderColor: C.line }}>
                    <span className="text-xs font-semibold" style={{ color: C.muted }}>{label}</span>
                    <span className="text-xs font-black" style={{ color: C.ink }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1480px] px-4 sm:px-6 lg:px-8">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {statCards.map((card) => (
              <article key={card.label} className="motion-card stat-glow rounded-[24px] border bg-[#FFFDF9] p-5 shadow-[0_16px_45px_-34px_rgba(46,32,22,.45)]" style={{ borderColor: C.line }}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.17em]" style={{ color: C.muted }}>{card.label}</p>
                    <p className="mt-3 text-3xl font-black tracking-[-0.05em]" style={{ color: C.ink }}>{card.value}</p>
                  </div>
                  <div className="grid size-10 place-items-center rounded-2xl bg-[#F1E5D6]" style={{ color: C.brown }}>
                    <card.icon className="size-4" />
                  </div>
                </div>
                <p className="mt-4 text-xs leading-5" style={{ color: C.muted }}>{card.meta}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="engine" className="mx-auto max-w-[1480px] px-4 py-16 sm:px-6 lg:px-8">
          <div className="grid gap-7 xl:grid-cols-[.72fr_1.28fr]">
            <div className="xl:sticky xl:top-24 xl:self-start">
              <div className="rounded-[30px] border bg-[#FFFDF9] p-7" style={{ borderColor: C.line }}>
                <span className="inline-flex items-center gap-2 rounded-full border bg-[#F1E5D6] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em]" style={{ borderColor: C.line, color: C.brown }}>
                  <ShieldCheck className="size-3.5" />
                  Accuracy-led
                </span>
                <h2 className="mt-5 text-4xl font-black tracking-[-0.055em] sm:text-5xl">Engine Accumulators</h2>
                <p className="mt-4 text-sm leading-6" style={{ color: C.muted }}>
                  The engine builds these itself under one restriction: a market family must beat the engine's settled baseline before it is allowed into the ladder.
                </p>

                <div className="mt-6 rounded-2xl border bg-[#2E2016] p-5 text-white" style={{ borderColor: C.brown }}>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#C89B6D]">How the gate works</p>
                  <p className="mt-3 text-sm leading-6 text-[#E7D7C7]">
                    Settled results are grouped by sport and market family. Underperforming groups are filtered before research and card construction.
                  </p>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2">
                  {ladder.map((n, index) => (
                    <div key={n} className={`rounded-xl border px-3 py-3 ${index === ladder.length - 1 ? "col-span-2" : ""}`} style={{ borderColor: C.line, background: index === 0 ? C.soft : "#fff" }}>
                      <p className="text-[9px] font-black uppercase tracking-[0.16em]" style={{ color: C.muted }}>Card {index + 1}</p>
                      <p className="mt-1 text-lg font-black">{n} legs</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: C.brown }}>Today's ladder</p>
                  <h3 className="mt-1 text-2xl font-black tracking-[-0.04em]">Five cards. Every result graded.</h3>
                </div>
                <button
                  type="button"
                  onClick={() => void loadEngine()}
                  className="inline-flex items-center gap-2 rounded-xl border bg-white px-3.5 py-2.5 text-xs font-black"
                  style={{ borderColor: C.line, color: C.brown }}
                >
                  <RefreshCw className={`size-3.5 ${engineLoading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>

              {engine && !engine.ok && engine.error ? (
                <div
                  className="mb-4 rounded-2xl border bg-[#FFF7EE] px-4 py-3 text-xs font-bold leading-5"
                  style={{ borderColor: "#E2C8AD", color: C.brown }}
                >
                  {engine.error}
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-2">
                {(engineCards.length ? engineCards : ladder.map((n) => ({ n, code: "", url: "", odds: null, games: n } as EngineCard))).map((card, index) => (
                  <article
                    key={card.code || `pending-${card.n}`}
                    className={`engine-card overflow-hidden rounded-[26px] border bg-[#FFFDF9] ${index === 0 ? "lg:col-span-2" : ""}`}
                    style={{ borderColor: C.line }}
                  >
                    <div className="flex items-start justify-between gap-4 border-b p-5" style={{ borderColor: C.line, background: index === 0 ? "#F1E5D6" : "#FFFDF9" }}>
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: C.muted }}>
                          Target · {card.n} legs
                        </p>
                        <div className="mt-2 flex items-baseline gap-2">
                          <p className="text-3xl font-black tracking-[-0.05em]">{fmtOdds(card.odds)}</p>
                          <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: C.muted }}>combined odds</span>
                        </div>
                      </div>
                      <span
                        className="rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em]"
                        style={{
                          background: card.graded ? (card.hit ? "#E4F4EA" : "#F5E2DC") : "#F6E7C9",
                          color: card.graded ? (card.hit ? C.green : "#9D4438") : C.amber,
                        }}
                      >
                        {card.code ? statusLabel(card) : "Awaiting issue"}
                      </span>
                    </div>

                    <div className="p-5">
                      {card.legs?.length ? (
                        <div className="space-y-2">
                          {card.legs.slice(0, index === 0 ? 8 : 5).map((leg, legIndex) => (
                            <div key={`${card.code}-${legIndex}`} className="grid grid-cols-[24px_1fr_auto] items-start gap-2.5 rounded-xl border bg-white p-3" style={{ borderColor: "#E8DACA" }}>
                              <span className="grid size-6 place-items-center rounded-lg bg-[#F1E5D6] text-[9px] font-black" style={{ color: C.brown }}>{legIndex + 1}</span>
                              <div className="min-w-0">
                                <p className="truncate text-xs font-black">{leg.home} vs {leg.away}</p>
                                <p className="mt-1 truncate text-[10px]" style={{ color: C.muted }}>{leg.market} · {leg.selection}</p>
                              </div>
                              <span className="text-xs font-black" style={{ color: C.brown }}>{leg.odds?.toFixed(2) ?? "—"}</span>
                            </div>
                          ))}
                          {card.legs.length > (index === 0 ? 8 : 5) ? (
                            <p className="pt-1 text-[10px] font-bold" style={{ color: C.muted }}>
                              +{card.legs.length - (index === 0 ? 8 : 5)} more legs
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <div className="grid min-h-32 place-items-center rounded-2xl border border-dashed bg-[#FBF7F2] p-5 text-center" style={{ borderColor: C.line }}>
                          <div>
                            <Clock3 className="mx-auto size-5" style={{ color: C.tan }} />
                            <p className="mt-2 text-xs font-black">{card.code ? "Legacy card issued" : "Engine card not issued yet"}</p>
                            <p className="mt-1 text-[10px] leading-4" style={{ color: C.muted }}>
                              New engine cards include their full selection list here.
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="mt-4 flex flex-wrap gap-2">
                        {card.code ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void copyCode(card.code)}
                              className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-black text-white"
                              style={{ background: C.brown }}
                            >
                              <Copy className="size-3.5" />
                              {copied === card.code ? "Copied" : card.code}
                            </button>
                            {card.url ? (
                              <a href={card.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border bg-white px-3.5 py-2.5 text-xs font-black" style={{ borderColor: C.line, color: C.brown }}>
                                Open
                                <ExternalLink className="size-3.5" />
                              </a>
                            ) : null}
                          </>
                        ) : (
                          <span className="rounded-xl bg-[#F1E5D6] px-3.5 py-2.5 text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: C.brown }}>
                            Daily engine queue
                          </span>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="workflows" className="border-y bg-[#2E2016] py-16 text-[#FFFDF9]" style={{ borderColor: C.brown }}>
          <div className="mx-auto max-w-[1480px] px-4 sm:px-6 lg:px-8">
            <div className="grid gap-8 xl:grid-cols-[.78fr_1.22fr]">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C89B6D]">One desk, six workflows</p>
                <h2 className="mt-3 max-w-xl text-4xl font-black tracking-[-0.055em] sm:text-6xl">
                  More information on screen. Less guessing underneath.
                </h2>
                <p className="mt-5 max-w-lg text-sm leading-6 text-[#CDBBAA]">
                  The interface is intentionally dense: target, risk, bookmaker, market review, analysis source, result history and code actions all stay visible.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {FEATURES.map((feature, index) => (
                  <article key={feature.title} className="feature-pop group rounded-[24px] border border-white/12 bg-white/[.055] p-5 transition hover:-translate-y-1 hover:bg-white/[.08]">
                    <div className="flex items-center justify-between">
                      <div className="grid size-10 place-items-center rounded-2xl bg-[#C89B6D] text-[#2E2016]">
                        <feature.icon className="size-4" />
                      </div>
                      <span className="font-mono text-[10px] text-white/35">0{index + 1}</span>
                    </div>
                    <h3 className="mt-5 text-lg font-black">{feature.title}</h3>
                    <p className="mt-2 text-xs leading-5 text-[#CDBBAA]">{feature.body}</p>
                    <div className="mt-5 flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.12em] text-[#E5BE96]">
                      In SlipCut <ChevronRight className="size-3.5" />
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="performance" className="mx-auto max-w-[1480px] px-4 py-16 sm:px-6 lg:px-8">
          <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
            <div className="rounded-[30px] border bg-[#FFFDF9] p-6 sm:p-8" style={{ borderColor: C.line }}>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: C.brown }}>Decision pipeline</p>
                  <h2 className="mt-2 text-3xl font-black tracking-[-0.05em] sm:text-4xl">What happens before a leg gets booked</h2>
                </div>
                <BarChart3 className="size-5" style={{ color: C.brown }} />
              </div>
              <div className="mt-7 divide-y" style={{ borderColor: C.line }}>
                {FLOW.map(([n, title, body]) => (
                  <div key={n} className="grid gap-3 py-5 sm:grid-cols-[52px_130px_1fr] sm:items-center">
                    <span className="font-mono text-xs font-black" style={{ color: C.tan }}>{n}</span>
                    <span className="text-xs font-black tracking-[0.12em]" style={{ color: C.brown }}>{title}</span>
                    <p className="text-sm leading-6" style={{ color: C.muted }}>{body}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-5">
              <div className="rounded-[30px] border bg-[#F1E5D6] p-6 sm:p-8" style={{ borderColor: C.line }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: C.brown }}>Market coverage</p>
                    <h3 className="mt-2 text-2xl font-black tracking-[-0.045em]">Compare the lines, not just the market name.</h3>
                  </div>
                  <Target className="size-5" style={{ color: C.brown }} />
                </div>
                <div className="mt-6 flex flex-wrap gap-2">
                  {["1X2", "Double Chance", "DNB", "Game Totals", "Team Totals", "1H Totals", "2H Totals", "Handicap", "BTTS", "Corners"].map((market) => (
                    <span key={market} className="rounded-full border bg-white px-3 py-2 text-[10px] font-black" style={{ borderColor: C.line, color: C.brown }}>
                      {market}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-[30px] border bg-[#FFFDF9] p-6 sm:p-8" style={{ borderColor: C.line }}>
                <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: C.brown }}>Risk modes</p>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  {[
                    ["Conservative", "1.20+"],
                    ["Balanced", "wider"],
                    ["Aggressive", "widest"],
                  ].map(([name, note], index) => (
                    <div key={name} className="rounded-2xl border p-4" style={{ borderColor: C.line, background: index === 0 ? C.soft : "#fff" }}>
                      <p className="text-xs font-black">{name}</p>
                      <p className="mt-2 text-xl font-black" style={{ color: C.brown }}>{note}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs leading-5" style={{ color: C.muted }}>
                  Risk modes change price and market-family eligibility. They do not turn an uncertain event into a guaranteed result.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1480px] px-4 pb-16 sm:px-6 lg:px-8">
          <div className="overflow-hidden rounded-[34px] border bg-[#FFFDF9]" style={{ borderColor: C.line }}>
            <div className="grid lg:grid-cols-[1fr_.7fr]">
              <div className="p-7 sm:p-10 lg:p-12">
                <span className="inline-flex items-center gap-2 rounded-full bg-[#F1E5D6] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: C.brown }}>
                  <MessageCircle className="size-3.5" />
                  Telegram-native
                </span>
                <h2 className="mt-5 max-w-2xl text-4xl font-black tracking-[-0.055em] sm:text-6xl">
                  Start in chat. Finish with a real booking code.
                </h2>
                <p className="mt-5 max-w-xl text-sm leading-6" style={{ color: C.muted }}>
                  Use plain commands in Telegram or open the Mini App when you want the full dashboard, editable selections, bookmaker controls and prediction tools.
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <a href={BOT} className="inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-black text-white" style={{ background: C.brown }}>
                    <Send className="size-4" /> Open Telegram
                  </a>
                  <a href={APP} className="inline-flex items-center gap-2 rounded-2xl border bg-white px-5 py-3 text-sm font-black" style={{ borderColor: C.line, color: C.brown }}>
                    Open Mini App <ArrowRight className="size-4" />
                  </a>
                </div>
              </div>
              <ChatPanel />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-[#FFFDF9]" style={{ borderColor: C.line }}>
        <div className="mx-auto flex max-w-[1480px] flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="" className="size-8 rounded-full" />
            <div>
              <p className="text-sm font-black">SlipCut</p>
              <p className="text-[10px]" style={{ color: C.muted }}>Build · Cut · Predict · Convert · Track</p>
            </div>
          </div>
          <p className="text-[10px] leading-4 sm:max-w-lg sm:text-right" style={{ color: C.muted }}>
            Longer accumulators carry more outcome risk. Engine scores and probabilities are estimates, not guarantees.
          </p>
        </div>
      </footer>
    </div>
  );
}

function ChatPanel() {
  const lines = [
    ["you", "cook football 5 odds conservative"],
    ["bot", "Scanning eligible matches and comparing market options…"],
    ["bot", "6 selections reviewed · 5 kept · target 5.00"],
    ["you", "trim weakest"],
    ["bot", "Done. Refreshed odds and prepared the cleaner code."],
  ] as const;

  return (
    <div className="border-l bg-[#2E2016] p-6 text-white lg:p-8" style={{ borderColor: C.brown }}>
      <div className="mx-auto max-w-md rounded-[28px] border border-white/10 bg-[#17110D] p-4 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-white/10 pb-4">
          <img src="/logo.png" alt="" className="size-9 rounded-full" />
          <div>
            <p className="text-sm font-black">SlipCut Bot</p>
            <p className="mt-0.5 text-[10px] text-[#B9A795]">@Slipcut_bot · online</p>
          </div>
        </div>
        <div className="space-y-2.5 py-5">
          {lines.map(([who, text], index) => (
            <div
              key={index}
              className={`chat-pop max-w-[88%] rounded-2xl px-3.5 py-3 text-xs leading-5 ${
                who === "you"
                  ? "ml-auto rounded-br-md bg-[#C89B6D] text-[#2E2016]"
                  : "rounded-bl-md bg-white/8 text-[#EEE2D6]"
              }`}
            >
              {text}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[.04] p-2">
          <span className="flex-1 px-2 text-[11px] text-white/35">Ask SlipCut…</span>
          <div className="grid size-9 place-items-center rounded-xl bg-[#C89B6D] text-[#2E2016]">
            <Send className="size-4" />
          </div>
        </div>
      </div>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
    </svg>
  );
}
