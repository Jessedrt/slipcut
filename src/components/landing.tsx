import { useState } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  Layers,
  MessageCircle,
  ScanLine,
  Scissors,
  Send,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const BOT = "https://t.me/Slipcut_bot";

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#fix", label: "How it works" },
  { href: "#open", label: "Open bot" },
];

const MARQUEE = [
  "cook 12 football",
  "trim 50x",
  "weekend mix",
  "10 games handball",
  "cook basketball overs",
  "12 games tennis",
  "how far cook 30 odds",
  "study",
  "comot game 3",
  "8 draw football",
];

const CHIPS = ["Cook", "Trim", "Study", "Mix", "Handball", "Tennis", "Pidgin"];

const FIXES = [
  {
    bad: "40-game tickets take forever to edit by hand",
    good: "Say trim 12 in Telegram. SlipCut keeps the strongest legs and drops a new code.",
  },
  {
    bad: "Same matches keep coming back on every cook",
    good: "The bot skips games it just booked, so the next slip is a new set.",
  },
  {
    bad: "Blind picks on vibes",
    good: "Live form first, then Gemini / Opus scores each market before it books.",
  },
  {
    bad: "Football, basketball, tennis, handball in four apps",
    good: "One chat. Cook the sport you named — not a football default.",
  },
];

const FEATURES = [
  {
    icon: Bot,
    title: "Cook from chat",
    body: "10 games football. Cook basketball overs. Weekend mix. The bot books SportyBet codes.",
  },
  {
    icon: Scissors,
    title: "Trim the risk",
    body: "Paste a code. Cut weak legs. Copy the shorter booking code in one tap.",
  },
  {
    icon: ScanLine,
    title: "Study the cut",
    body: "When a slip dies, SlipCut studies the markets that failed and leans off them next time.",
  },
  {
    icon: Layers,
    title: "Four sports",
    body: "Football, basketball, tennis, and handball. Overs, 1H, DC, DNB — you name the market.",
  },
  {
    icon: MessageCircle,
    title: "Yarn pidgin",
    body: "How far, cook 30 odds, comot game 3. The desk talks the way you talk.",
  },
  {
    icon: Send,
    title: "Telegram only",
    body: "No web forms. Open the bot, paste a code or just say what you want.",
  },
];

export function Landing() {
  const [open, setOpen] = useState(false);

  return (
    <div className="desk-grid relative min-h-dvh overflow-x-hidden">
      <div className="liquid-scene" aria-hidden="true">
        <div className="liquid-blob liquid-blob-a" />
        <div className="liquid-blob liquid-blob-b" />
        <div className="liquid-blob liquid-blob-c" />
      </div>

      <header className="glass-nav sticky top-0 z-30">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:h-20 md:px-8">
          <a href="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="" className="size-9 rounded-full outline-none md:size-10" />
            <span className="text-lg font-bold tracking-tight">
              Slip<span className="text-primary">Cut</span>
            </span>
          </a>
          <nav className="hidden items-center gap-8 lg:flex">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-sm font-medium text-foreground/70 transition-colors hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="live-pill hidden sm:inline-flex">Live on Telegram</span>
            <a href={BOT} className="hidden sm:block">
              <Button className="relative overflow-hidden rounded-md px-5 uppercase tracking-wide">
                <span className="cta-sheen pointer-events-none absolute inset-0" />
                Open Telegram
                <ArrowRight />
              </Button>
            </a>
            <button
              type="button"
              className="rounded-md p-2 text-foreground lg:hidden"
              aria-label="Open menu"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <X className="size-6" /> : <MenuIcon />}
            </button>
          </div>
        </div>
        {open ? (
          <div className="glass mx-5 mb-4 rounded-xl p-6 lg:hidden">
            <div className="flex flex-col gap-4">
              {NAV.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="text-lg font-medium"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </a>
              ))}
              <a href={BOT} onClick={() => setOpen(false)}>
                <Button className="w-full">Open Telegram</Button>
              </a>
            </div>
          </div>
        ) : null}
      </header>

      <div className="relative z-10 overflow-hidden border-y border-white/40 py-2.5">
        <div className="marquee">
          {[...MARQUEE, ...MARQUEE].map((line, i) => (
            <span key={`${line}-${i}`} className="marquee-item">
              {line}
            </span>
          ))}
        </div>
      </div>

      <main className="relative z-10">
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-10 md:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:pt-14">
          <div className="rise-in">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted-foreground">
              SportyBet · Telegram desk
            </p>
            <h1 className="mt-4 text-5xl font-bold leading-[0.95] sm:text-6xl lg:text-7xl">
              Yarn am.
              <span className="block text-primary">E go cook.</span>
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
              SlipCut lives in Telegram. Cook, trim, study, and book football, basketball, tennis,
              and handball — one chat, one code.
            </p>
            <div className="mt-8">
              <a href={BOT}>
                <Button size="lg" className="relative h-14 overflow-hidden rounded-md px-8 text-base uppercase tracking-wide">
                  <span className="cta-sheen pointer-events-none absolute inset-0" />
                  Open @Slipcut_bot
                  <ArrowRight />
                </Button>
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-2">
              {CHIPS.map((chip, i) => (
                <span
                  key={chip}
                  className="glass float-chip rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-foreground/70"
                  style={{ animationDelay: `${i * 0.18}s` }}
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>
          <ChatMock />
        </section>

        <section id="fix" className="mx-auto max-w-6xl px-5 py-16 md:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">The problem → the fix</p>
          <h2 className="mt-3 text-3xl font-bold sm:text-5xl">Betting is noisy. SlipCut is one chat.</h2>
          <div className="mt-10 grid gap-4">
            {FIXES.map((row) => (
              <div key={row.bad} className="glass grid gap-3 rounded-xl p-5 md:grid-cols-2 md:gap-8">
                <p className="flex gap-3 text-sm text-muted-foreground">
                  <X className="mt-0.5 size-4 shrink-0 text-drop" />
                  {row.bad}
                </p>
                <p className="flex gap-3 text-sm font-medium">
                  <Check className="mt-0.5 size-4 shrink-0 text-keep" />
                  {row.good}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl px-5 py-16 md:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted-foreground">Features</p>
          <h2 className="mt-3 max-w-xl text-3xl font-bold sm:text-5xl">Everything you need, in Telegram.</h2>
          <p className="mt-4 max-w-xl text-muted-foreground">
            Type it the way you talk. The bot researches, cuts the weak legs, and mints a SportyBet code.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <article key={f.title} className="glass rounded-xl p-6">
                <f.icon className="size-5 text-primary" />
                <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="open" className="mx-auto max-w-6xl px-5 py-16 md:px-8">
          <div className="glass-strong overflow-hidden rounded-2xl px-6 py-14 text-center md:px-16">
            <span className="live-pill mx-auto">Online now</span>
            <h2 className="mt-5 text-3xl font-bold sm:text-5xl">The desk is the bot.</h2>
            <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
              No paste form. No extra login. Open Telegram and tell SlipCut what to cook.
            </p>
            <a href={BOT} className="mt-8 inline-flex">
              <Button size="lg" className="relative h-14 overflow-hidden rounded-md px-8 uppercase tracking-wide">
                <span className="cta-sheen pointer-events-none absolute inset-0" />
                Chat @Slipcut_bot
                <ArrowRight />
              </Button>
            </a>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-border/70 px-5 py-10 md:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="" className="size-7 rounded-full outline-none" />
            <span className="font-bold">
              Slip<span className="text-primary">Cut</span>
            </span>
          </div>
          <a href={BOT} className="text-sm font-medium text-primary">
            t.me/Slipcut_bot
          </a>
        </div>
      </footer>
    </div>
  );
}

function ChatMock() {
  const lines = [
    { who: "you", text: "how far cook 12 football overs" },
    { who: "bot", text: "Cooking 12 football · overs" },
    { who: "bot", text: "K8P2QX  ·  tap to copy" },
    { who: "you", text: "trim 50x" },
    { who: "bot", text: "M4N9LC  ·  6 games remain" },
  ];
  return (
    <div className="rise-in mx-auto w-full max-w-sm">
      <div className="glass-strong relative mx-auto w-72 overflow-hidden rounded-[2rem] p-3">
        <div className="rounded-[1.55rem] bg-foreground px-3.5 pb-5 pt-4 text-background">
          <div className="mb-4 flex items-center gap-2">
            <img src="/logo.png" alt="" className="size-7 rounded-full outline-none" />
            <div>
              <p className="text-xs font-bold">SlipCut</p>
              <p className="text-[0.65rem] text-background/50">@Slipcut_bot · typing</p>
            </div>
          </div>
          <div className="space-y-2">
            {lines.map((line, i) => (
              <div
                key={i}
                className={
                  line.who === "you"
                    ? "chat-in ml-8 rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-xs text-primary-foreground"
                    : "chat-in mr-8 rounded-2xl rounded-bl-sm bg-background/12 px-3 py-2 text-xs"
                }
                style={{ animationDelay: `${0.18 + i * 0.16}s` }}
              >
                {line.text}
              </div>
            ))}
            <div className="typing mr-8 inline-flex gap-1 rounded-2xl bg-background/12 px-3 py-2">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 5h16M4 12h16M4 19h16" strokeLinecap="round" />
    </svg>
  );
}
