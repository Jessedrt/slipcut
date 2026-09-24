import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  ChevronRight,
  CircleGauge,
  Copy,
  Crosshair,
  Layers3,
  MessageCircle,
  RefreshCw,
  ScanLine,
  Scissors,
  ShieldCheck,
  Sparkles,
  Target,
  Ticket,
  Trophy,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const BOT = "https://t.me/Slipcut_bot";

const NAV = [
  { href: "#engine", label: "Engine" },
  { href: "#features", label: "Features" },
  { href: "#workflow", label: "Workflow" },
  { href: "/app", label: "Mini App" },
];

const MARQUEE = [
  "ENGINE ACCUMULATORS",
  "COOK 12 FOOTBALL",
  "TRIM TO 5X",
  "MULTI-BOOKMAKER",
  "SCREENSHOT INGEST",
  "AI MARKET REVIEW",
  "BASKETBALL",
  "PREDICT",
  "TRACK RECORD",
  "BOOK REAL CODES",
];

const FEATURES = [
  {
    icon: Sparkles,
    eyebrow: "BUILD",
    title: "Build from live markets",
    body: "Choose sport, target odds or number of games, risk mode and timing. SlipCut compares multiple markets before constructing the card.",
    metric: "8 options / event",
  },
  {
    icon: Scissors,
    eyebrow: "CUT",
    title: "Trim oversized slips",
    body: "Paste a booking code and remove weak legs while preserving the strongest reviewed selections.",
    metric: "Risk-first trim",
  },
  {
    icon: Crosshair,
    eyebrow: "PREDICT",
    title: "Research a match",
    body: "Compare open markets with form, H2H, injuries and current pricing through the existing research pipeline.",
    metric: "Probability + EV",
  },
  {
    icon: ScanLine,
    eyebrow: "INGEST",
    title: "Read tips anywhere",
    body: "Import screenshots, pasted text and links into the same structured review flow instead of rebuilding the slip manually.",
    metric: "Vision + text",
  },
  {
    icon: Layers3,
    eyebrow: "BOOKMAKERS",
    title: "One neutral slip model",
    body: "SportyBet today, with Bet9ja and 1XBet conversion hooks in the same bookmaker-neutral ticket architecture.",
    metric: "3 adapters",
  },
  {
    icon: BarChart3,
    eyebrow: "LEARN",
    title: "Track what actually works",
    body: "Selections are recorded and graded so proven market families can influence future engine filtering.",
    metric: "Accuracy-led",
  },
];

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

type EnginePayload =
  | {
      ok: true;
      cards: EngineCard[];
      hitRate: number | null;
      sampleCount: number;
      qualifyingBar: number | null;
      average: number;
    }
  | { ok: false; error: string };

function pct(value: number | null) {
  return value == null ? "Learning" : `${Math.round(value * 100)}%`;
}

function odds(value: number | null) {
  return value && Number.isFinite(value) ? value.toFixed(2) : "—";
}

export function Landing() {
  const [open, setOpen] = useState(false);
  const [engine, setEngine] = useState<EnginePayload | null>(null);
  const [engineBusy, setEngineBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function loadEngine() {
    setEngineBusy(true);
    try {
      const res = await fetch("/api/engine", { headers: { Accept: "application/json" } });
      const json = (await res.json()) as EnginePayload;
      setEngine(json);
    } catch {
      setEngine({ ok: false, error: "Engine data is temporarily unavailable." });
    } finally {
      setEngineBusy(false);
    }
  }

  useEffect(() => {
    void loadEngine();
  }, []);

  const stats = useMemo(() => {
    if (!engine || !engine.ok) {
      return [
        { label: "Engine hit rate", value: "Learning", sub: "Settled selections" },
        { label: "Qualifying bar", value: "Dynamic", sub: "Must beat engine average" },
        { label: "Daily ladder", value: "2 → 12", sub: "Five engine cards" },
        { label: "Market review", value: "8×", sub: "Options checked per event" },
      ];
    }
    return [
      {
        label: "Engine hit rate",
        value: pct(engine.hitRate),
        sub: `${engine.sampleCount.toLocaleString()} settled selections`,
      },
      {
        label: "Qualifying bar",
        value: pct(engine.qualifyingBar),
        sub: "Market family must match/beat it",
      },
      { label: "Daily ladder", value: "2 → 12", sub: `${engine.cards.length || 5} cards issued daily` },
      { label: "Market review", value: "8×", sub: "Diversified options per event" },
    ];
  }, [engine]);

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied((current) => (current === code ? null : current)), 1500);
    } catch {
      // Clipboard may be unavailable in embedded browsers.
    }
  }

  return (
    <div className="landing-max min-h-dvh overflow-x-hidden bg-[#f5efe7] text-[#2d1f16]">
      <header className="sticky top-0 z-40 border-b border-[#6e4a32]/15 bg-[#fbf7f1]/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:h-20 lg:px-8">
          <a href="/" className="flex items-center gap-3">
            <img src="/logo.png" alt="" className="size-9 rounded-xl ring-1 ring-[#6e4a32]/15" />
            <div>
              <p className="text-base font-black tracking-[-.04em]">SlipCut</p>
              <p className="text-[9px] font-bold uppercase tracking-[.2em] text-[#8a6b55]">
                betting copilot
              </p>
            </div>
          </a>

          <nav className="hidden items-center gap-1 rounded-full border border-[#6e4a32]/15 bg-white/70 p-1 lg:flex">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-full px-4 py-2 text-xs font-bold text-[#705745] transition hover:bg-[#efe1d2] hover:text-[#4e321f]"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <a href="/app" className="hidden sm:block">
              <Button variant="outline" className="rounded-full border-[#6e4a32]/20 bg-white text-[#4c3322]">
                Mini App
              </Button>
            </a>
            <a href={BOT}>
              <Button className="rounded-full bg-[#6b452d] px-5 text-[#fffaf4] hover:bg-[#51321f]">
                Open Bot <ArrowRight className="size-4" />
              </Button>
            </a>
            <button
              type="button"
              aria-label="Toggle navigation"
              onClick={() => setOpen((value) => !value)}
              className="grid size-10 place-items-center rounded-full border border-[#6e4a32]/15 bg-white lg:hidden"
            >
              {open ? <X className="size-4" /> : <MenuIcon />}
            </button>
          </div>
        </div>
        {open && (
          <div className="border-t border-[#6e4a32]/10 bg-[#fbf7f1] px-5 py-4 lg:hidden">
            <div className="grid gap-2">
              {NAV.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="rounded-xl border border-[#6e4a32]/10 bg-white px-4 py-3 text-sm font-bold"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        )}
      </header>

      <div className="border-b border-[#6e4a32]/15 bg-[#6b452d] py-2 text-[#fff7ee]">
        <div className="marquee">
          {[...MARQUEE, ...MARQUEE].map((item, index) => (
            <span key={`${item}-${index}`} className="marquee-item">
              <span className="mr-3 inline-block size-1.5 rounded-full bg-[#d9b28f]" />
              {item}
            </span>
          ))}
        </div>
      </div>

      <main>
        <section className="relative overflow-hidden border-b border-[#6e4a32]/15">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(180,126,86,.18),transparent_30%),radial-gradient(circle_at_85%_15%,rgba(107,69,45,.12),transparent_28%)]" />
          <div className="relative mx-auto grid max-w-[1440px] gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.15fr_.85fr] lg:px-8 lg:py-14">
            <div className="rounded-[32px] border border-[#6e4a32]/15 bg-[#fffdfa] p-6 shadow-[0_30px_90px_-50px_rgba(76,45,26,.45)] sm:p-8 lg:p-10">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#6b452d] px-3 py-1.5 text-[10px] font-black uppercase tracking-[.18em] text-white">
                  SlipCut v4
                </span>
                <span className="rounded-full border border-[#6e4a32]/15 bg-[#f2e6da] px-3 py-1.5 text-[10px] font-black uppercase tracking-[.18em] text-[#6b452d]">
                  Multi-bookmaker
                </span>
                <span className="rounded-full border border-[#6e4a32]/15 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-[.18em] text-[#6b452d]">
                  Accuracy-led engine
                </span>
              </div>

              <h1 className="mt-7 max-w-4xl text-5xl font-black leading-[.92] tracking-[-.065em] sm:text-6xl lg:text-[78px]">
                A betting desk that
                <span className="block text-[#8b5e3c]">actually does the work.</span>
              </h1>

              <p className="mt-6 max-w-2xl text-base leading-7 text-[#725b4a] sm:text-lg">
                Build, analyse, cut, convert and book slips from one place. SlipCut checks multiple
                market options per event, tracks settled performance and can generate real booking
                codes after review.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <a href="/app">
                  <Button size="lg" className="h-13 rounded-full bg-[#6b452d] px-7 text-white hover:bg-[#51321f]">
                    Launch Mini App <ChevronRight className="size-4" />
                  </Button>
                </a>
                <a href="#engine">
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-13 rounded-full border-[#6e4a32]/25 bg-white px-7 text-[#4d3322]"
                  >
                    Explore Engine <CircleGauge className="size-4" />
                  </Button>
                </a>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ["4", "sports"],
                  ["3", "bookmaker adapters"],
                  ["8", "markets / event"],
                  ["24/7", "Telegram access"],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-2xl border border-[#6e4a32]/12 bg-[#f7efe7] p-4">
                    <p className="text-2xl font-black tracking-[-.05em] text-[#5c3b27]">{value}</p>
                    <p className="mt-1 text-[11px] font-bold uppercase tracking-[.15em] text-[#8c725f]">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <CommandDesk />
              <div className="grid grid-cols-2 gap-4">
                <MiniMetric icon={ShieldCheck} value="1.20+" label="Conservative floor" />
                <MiniMetric icon={Activity} value="Live" label="Odds refresh" />
                <MiniMetric icon={Ticket} value="Real" label="Booking codes" />
                <MiniMetric icon={RefreshCw} value="Auto" label="Provider fallback" />
              </div>
            </div>
          </div>
        </section>

        <section id="engine" className="border-b border-[#6e4a32]/15 bg-[#fffaf5]">
          <div className="mx-auto max-w-[1440px] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
            <div className="grid gap-8 xl:grid-cols-[.78fr_1.22fr]">
              <div>
                <div className="sticky top-28">
                  <p className="text-[10px] font-black uppercase tracking-[.22em] text-[#a17251]">
                    Accuracy-led
                  </p>
                  <h2 className="mt-3 text-4xl font-black tracking-[-.055em] sm:text-5xl">
                    Engine Accumulators
                  </h2>
                  <p className="mt-5 max-w-xl text-sm leading-6 text-[#725b4a]">
                    The engine builds these itself under one restriction: a proven market family must
                    perform at or above the engine’s rolling average before it becomes a preferred
                    source. Straight 1X2 wins stay outside the accuracy gate for football and basketball.
                  </p>
                  <p className="mt-4 max-w-xl text-xs leading-5 text-[#9a806c]">
                    Five cards are issued on the daily ladder and graded afterwards. Longer cards remain
                    longer shots regardless of previous hit rate.
                  </p>

                  <div className="mt-7 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void loadEngine()}
                      disabled={engineBusy}
                      className="inline-flex items-center gap-2 rounded-full border border-[#6e4a32]/20 bg-white px-4 py-2 text-xs font-black text-[#65432d] disabled:opacity-50"
                    >
                      <RefreshCw className={`size-3.5 ${engineBusy ? "animate-spin" : ""}`} />
                      Refresh engine
                    </button>
                    <a
                      href={BOT}
                      className="inline-flex items-center gap-2 rounded-full bg-[#6b452d] px-4 py-2 text-xs font-black text-white"
                    >
                      Get cards in Telegram <ArrowRight className="size-3.5" />
                    </a>
                  </div>
                </div>
              </div>

              <div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {stats.map((stat) => (
                    <div key={stat.label} className="rounded-[22px] border border-[#6e4a32]/15 bg-white p-5 shadow-sm">
                      <p className="text-[9px] font-black uppercase tracking-[.18em] text-[#9b7d67]">{stat.label}</p>
                      <p className="mt-3 text-3xl font-black tracking-[-.055em] text-[#5b3a26]">{stat.value}</p>
                      <p className="mt-1 text-[11px] text-[#8a7060]">{stat.sub}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-[28px] border border-[#6e4a32]/15 bg-[#efe0d1] p-4 sm:p-5">
                  <div className="flex flex-wrap items-end justify-between gap-3 px-1 pb-4">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[.18em] text-[#947158]">Today’s ladder</p>
                      <h3 className="mt-1 text-2xl font-black tracking-[-.045em]">Daily engine cards</h3>
                    </div>
                    <div className="rounded-full border border-[#6e4a32]/15 bg-[#fffaf5] px-3 py-1.5 text-[10px] font-bold text-[#765944]">
                      {engineBusy ? "Refreshing…" : engine?.ok ? `${engine.cards.length} active` : "Live engine"}
                    </div>
                  </div>

                  {engine?.ok && engine.cards.length ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {engine.cards.map((card, index) => (
                        <article
                          key={`${card.code}-${index}`}
                          className="group rounded-[22px] border border-[#6e4a32]/15 bg-[#fffdfa] p-5 transition hover:-translate-y-0.5 hover:shadow-[0_20px_50px_-34px_rgba(76,45,26,.5)]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[9px] font-black uppercase tracking-[.18em] text-[#9b7a62]">
                                Card {index + 1} · target {card.n} legs
                              </p>
                              <div className="mt-2 flex items-end gap-2">
                                <p className="text-3xl font-black tracking-[-.055em]">{odds(card.odds)}</p>
                                <span className="pb-1 text-[10px] font-bold uppercase tracking-wider text-[#9b7a62]">odds</span>
                              </div>
                            </div>
                            <span
                              className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[.12em] ${
                                card.graded
                                  ? card.hit
                                    ? "bg-[#e2eee1] text-[#37633a]"
                                    : "bg-[#f2dfda] text-[#8b463a]"
                                  : "bg-[#f1e4c5] text-[#8a682c]"
                              }`}
                            >
                              {card.graded ? (card.hit ? "Hit" : "Missed") : "Pending"}
                            </span>
                          </div>

                          {card.legs?.length ? (
                            <div className="mt-4 max-h-48 space-y-2 overflow-y-auto rounded-2xl border border-[#6e4a32]/10 bg-[#fbf7f2] p-3">
                              {card.legs.slice(0, 6).map((leg, legIndex) => (
                                <div key={`${card.code}-${legIndex}`} className="grid grid-cols-[22px_1fr_auto] items-center gap-2">
                                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#6b452d] text-[9px] font-black text-white">
                                    {legIndex + 1}
                                  </span>
                                  <div className="min-w-0">
                                    <p className="truncate text-[10px] font-black text-[#493124]">
                                      {leg.home} vs {leg.away}
                                    </p>
                                    <p className="truncate text-[9px] text-[#8f7663]">
                                      {leg.market} · {leg.selection}
                                    </p>
                                  </div>
                                  <span className="font-mono text-[10px] font-black text-[#6b452d]">
                                    {leg.odds ? leg.odds.toFixed(2) : "—"}
                                  </span>
                                </div>
                              ))}
                              {card.legs.length > 6 ? (
                                <p className="pt-1 text-center text-[9px] font-bold text-[#8f7663]">
                                  +{card.legs.length - 6} more selections
                                </p>
                              ) : null}
                            </div>
                          ) : null}

                          <div className="mt-5 grid grid-cols-2 gap-2">
                            <div className="rounded-xl bg-[#f4ece4] p-3">
                              <p className="text-[9px] font-bold uppercase tracking-wider text-[#a0836c]">Legs</p>
                              <p className="mt-1 text-lg font-black">{card.games}</p>
                            </div>
                            <div className="rounded-xl bg-[#f4ece4] p-3">
                              <p className="text-[9px] font-bold uppercase tracking-wider text-[#a0836c]">Code</p>
                              <p className="mt-1 truncate font-mono text-sm font-black">{card.code}</p>
                            </div>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => void copyCode(card.code)}
                              className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#6e4a32]/15 bg-white px-3 py-2.5 text-xs font-black text-[#5e402b]"
                            >
                              {copied === card.code ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                              {copied === card.code ? "Copied" : "Copy code"}
                            </button>
                            <a
                              href={card.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#6b452d] px-3 py-2.5 text-xs font-black text-white"
                            >
                              Open card <ArrowRight className="size-3.5" />
                            </a>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[22px] border border-dashed border-[#6e4a32]/25 bg-[#fffaf5] p-8 text-center">
                      <CircleGauge className="mx-auto size-8 text-[#9a7256]" />
                      <p className="mt-3 text-sm font-black">
                        {engine && !engine.ok ? "Engine cards are unavailable right now" : "Preparing today’s ladder"}
                      </p>
                      <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[#8e7461]">
                        {engine && !engine.ok
                          ? engine.error
                          : "The engine only publishes cards when enough eligible markets pass the accuracy and quality gates."}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="border-b border-[#6e4a32]/15">
          <div className="mx-auto max-w-[1440px] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.22em] text-[#a17251]">Full desk</p>
                <h2 className="mt-3 max-w-3xl text-4xl font-black tracking-[-.055em] sm:text-5xl">
                  More information. More control. Less empty space.
                </h2>
              </div>
              <p className="max-w-lg text-sm leading-6 text-[#7d6553]">
                The interface is intentionally dense: the important numbers, actions and review states
                stay visible instead of being hidden behind decorative hero space.
              </p>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {FEATURES.map((feature, index) => (
                <article
                  key={feature.title}
                  className={`rounded-[26px] border border-[#6e4a32]/15 p-6 ${
                    index === 0 || index === 5 ? "bg-[#6b452d] text-white" : "bg-[#fffdfa]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div
                      className={`grid size-11 place-items-center rounded-2xl ${
                        index === 0 || index === 5 ? "bg-white/12" : "bg-[#efe0d1] text-[#69442d]"
                      }`}
                    >
                      <feature.icon className="size-5" />
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-[.16em] ${
                        index === 0 || index === 5 ? "bg-white/12 text-[#f5dcc7]" : "bg-[#f3e8de] text-[#8a654c]"
                      }`}
                    >
                      {feature.metric}
                    </span>
                  </div>
                  <p className={`mt-6 text-[9px] font-black uppercase tracking-[.2em] ${index === 0 || index === 5 ? "text-[#dbb99d]" : "text-[#a17a5d]"}`}>
                    {feature.eyebrow}
                  </p>
                  <h3 className="mt-2 text-2xl font-black tracking-[-.045em]">{feature.title}</h3>
                  <p className={`mt-3 text-sm leading-6 ${index === 0 || index === 5 ? "text-[#ead9ca]" : "text-[#7f6755]"}`}>
                    {feature.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="workflow" className="bg-[#efe1d3]">
          <div className="mx-auto max-w-[1440px] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
            <div className="grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
              <div className="rounded-[30px] bg-[#2f2118] p-7 text-[#fffaf4] sm:p-9">
                <p className="text-[10px] font-black uppercase tracking-[.22em] text-[#d6ad8c]">Workflow</p>
                <h2 className="mt-3 text-4xl font-black tracking-[-.055em]">
                  One request. Four layers of checking.
                </h2>
                <div className="mt-8 space-y-3">
                  {[
                    ["01", "Discover", "Pull current fixtures and eligible bookmaker markets."],
                    ["02", "Compare", "Keep diversified alternatives instead of one hard-coded line."],
                    ["03", "Analyse", "Run AI/research or the internal fallback when providers are unavailable."],
                    ["04", "Verify", "Refresh selections and prices before a real booking code is minted."],
                  ].map(([number, title, body]) => (
                    <div key={number} className="grid grid-cols-[44px_1fr] gap-3 rounded-2xl border border-white/10 bg-white/[.055] p-4">
                      <span className="font-mono text-xs font-black text-[#d5ae8e]">{number}</span>
                      <div>
                        <p className="text-sm font-black">{title}</p>
                        <p className="mt-1 text-xs leading-5 text-[#cbb9aa]">{body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <ScoreCard title="Market breadth" value="8" suffix=" / event" icon={Layers3} note="Diversified candidate options can reach the reviewer." />
                <ScoreCard title="Conservative floor" value="1.20" suffix=" odds" icon={ShieldCheck} note="Short prices no longer start at 1.40." />
                <ScoreCard title="Sports" value="4" suffix="" icon={Trophy} note="Football, basketball, tennis and handball." />
                <ScoreCard title="Booking flow" value="Live" suffix="" icon={Zap} note="Refreshes before code creation instead of trusting stale odds." />
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#fffaf5]">
          <div className="mx-auto max-w-[1440px] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
            <div className="rounded-[34px] border border-[#6e4a32]/15 bg-[#f3e7dc] p-7 sm:p-10 lg:flex lg:items-center lg:justify-between lg:gap-10">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.22em] text-[#9a6e4d]">Open the desk</p>
                <h2 className="mt-3 text-4xl font-black tracking-[-.055em] sm:text-5xl">
                  Build in the Mini App or talk to the bot.
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-[#775f4d]">
                  The same engine, bookmaker adapters and review logic sit behind both interfaces.
                </p>
              </div>
              <div className="mt-7 flex flex-wrap gap-3 lg:mt-0">
                <a href="/app">
                  <Button size="lg" className="h-13 rounded-full bg-[#6b452d] px-7 text-white hover:bg-[#51321f]">
                    Open Mini App <ArrowRight className="size-4" />
                  </Button>
                </a>
                <a href={BOT}>
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-13 rounded-full border-[#6e4a32]/20 bg-white px-7 text-[#533722]"
                  >
                    Telegram Bot <MessageCircle className="size-4" />
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#6e4a32]/15 bg-[#2d2017] text-[#f8eee5]">
        <div className="mx-auto grid max-w-[1440px] gap-8 px-4 py-10 sm:px-6 md:grid-cols-2 lg:px-8">
          <div>
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="" className="size-8 rounded-xl" />
              <p className="font-black">SlipCut</p>
            </div>
            <p className="mt-3 max-w-md text-xs leading-5 text-[#c9b7a7]">
              Sports betting analysis is uncertain. Odds and historical hit rates do not guarantee future results.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 md:justify-end">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="text-xs font-bold text-[#d6c4b4] hover:text-white">
                {item.label}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}

function MiniMetric({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof ShieldCheck;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-[24px] border border-[#6e4a32]/15 bg-[#fffdfa] p-5">
      <div className="flex items-center justify-between">
        <Icon className="size-4 text-[#986b4b]" />
        <span className="size-2 rounded-full bg-[#9e744f]" />
      </div>
      <p className="mt-6 text-2xl font-black tracking-[-.05em] text-[#5b3b27]">{value}</p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-[.14em] text-[#947966]">{label}</p>
    </div>
  );
}

function ScoreCard({
  title,
  value,
  suffix,
  icon: Icon,
  note,
}: {
  title: string;
  value: string;
  suffix: string;
  icon: typeof Target;
  note: string;
}) {
  return (
    <article className="rounded-[28px] border border-[#6e4a32]/15 bg-[#fffdfa] p-6">
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-black uppercase tracking-[.18em] text-[#9a7a63]">{title}</p>
        <Icon className="size-4 text-[#8d6246]" />
      </div>
      <p className="mt-8 text-4xl font-black tracking-[-.06em] text-[#5f3f2a]">
        {value}
        <span className="text-base font-bold text-[#9b7f6a]">{suffix}</span>
      </p>
      <p className="mt-3 text-xs leading-5 text-[#826a58]">{note}</p>
    </article>
  );
}

function CommandDesk() {
  return (
    <div className="rounded-[28px] border border-[#6e4a32]/15 bg-[#6b452d] p-5 text-white shadow-[0_28px_70px_-42px_rgba(66,39,24,.75)] sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[.18em] text-[#ddb899]">Live command desk</p>
          <h2 className="mt-1 text-xl font-black">What do you want to build?</h2>
        </div>
        <div className="grid size-10 place-items-center rounded-2xl bg-white/10">
          <Bot className="size-5" />
        </div>
      </div>

      <div className="mt-5 space-y-2">
        {[
          ["you", "cook basketball 5 odds conservative"],
          ["bot", "Checking live games and wider market alternatives…"],
          ["bot", "7 eligible events · 41 market options reviewed"],
          ["bot", "Slip ready · refresh odds before booking"],
        ].map(([who, text], index) => (
          <div
            key={`${who}-${text}`}
            className={`rounded-2xl px-4 py-3 text-xs leading-5 ${
              who === "you" ? "ml-8 bg-[#d5a77e] text-[#332116]" : "mr-5 bg-white/[.09] text-[#f1dfd0]"
            }`}
          >
            <span className="mr-2 text-[9px] font-black uppercase tracking-wider opacity-60">{who}</span>
            {text}
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {["Build", "Cut", "Predict", "Convert", "Screenshot"].map((item) => (
          <span key={item} className="rounded-full border border-white/12 bg-white/[.06] px-3 py-1.5 text-[9px] font-black uppercase tracking-[.12em] text-[#ead7c7]">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
    </svg>
  );
}
