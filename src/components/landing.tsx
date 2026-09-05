import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Bot,
  Check,
  Layers,
  MessageCircle,
  ScanLine,
  Scissors,
  Ticket,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const BOT = "https://t.me/Slipcut_bot";

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#fix", label: "How it works" },
  { href: "#desk", label: "Desk" },
];

const CHIPS = ["Cook", "Trim", "Study", "Mix", "Handball", "Tennis", "Pidgin"];

const FIXES = [
  {
    bad: "40-game tickets take forever to edit by hand",
    good: "Say trim 12 — SlipCut keeps the strongest legs and mints a new code.",
  },
  {
    bad: "Same matches keep coming back on every cook",
    good: "The desk skips games it just booked, so the next slip is a new set.",
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
    body: "Paste a code. Cut weak legs. Get a shorter booking code you can copy in one tap.",
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
    icon: Ticket,
    title: "Web desk too",
    body: "Paste a code here if you prefer a screen. Same cut, same SportyBet mint.",
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
            <a
              href={BOT}
              className="hidden text-foreground/60 transition-colors hover:text-foreground sm:block"
              aria-label="Telegram"
            >
              <SendIcon />
            </a>
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

      <main className="relative z-10">
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-10 md:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:pt-16">
          <div className="rise-in">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted-foreground">
              SportyBet desk · Telegram
            </p>
            <h1 className="mt-4 text-5xl font-bold leading-[0.95] sm:text-6xl lg:text-7xl">
              Your AI betting
              <span className="block text-primary">co-pilot.</span>
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
              Cook, trim, and book SportyBet slips in one chat. Football, basketball, tennis,
              handball — no hopping between stats sites and the app.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href={BOT}>
                <Button size="lg" className="relative overflow-hidden rounded-md uppercase tracking-wide">
                  <span className="cta-sheen pointer-events-none absolute inset-0" />
                  Start on Telegram
                  <ArrowRight />
                </Button>
              </a>
              <Link to="/desk">
                <Button size="lg" variant="outline" className="rounded-md glass">
                  Try the web desk
                </Button>
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-2">
              {CHIPS.map((chip) => (
                <span
                  key={chip}
                  className="glass rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-foreground/70"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>
          <PhoneMock />
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
          <h2 className="mt-3 max-w-xl text-3xl font-bold sm:text-5xl">Everything you need, in one desk.</h2>
          <p className="mt-4 max-w-xl text-muted-foreground">
            Manage tickets, scan form, and mint a fresh SportyBet code — Telegram or the web.
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

        <section id="desk" className="mx-auto max-w-6xl px-5 py-16 md:px-8">
          <div className="glass-strong overflow-hidden rounded-2xl px-6 py-12 text-center md:px-16">
            <ScanLine className="mx-auto size-6 text-primary" />
            <h2 className="mt-4 text-3xl font-bold sm:text-5xl">Paste a code. Cut the weak legs.</h2>
            <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
              The web desk is back — liquid glass, same engine as the bot. Or stay in Telegram if that is
              where you live.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/desk">
                <Button size="lg" className="rounded-md uppercase tracking-wide">
                  Open web desk
                  <ArrowRight />
                </Button>
              </Link>
              <a href={BOT}>
                <Button size="lg" variant="outline" className="rounded-md">
                  t.me/Slipcut_bot
                </Button>
              </a>
            </div>
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
          <p className="text-sm text-muted-foreground">Private SportyBet desk. 18+ only.</p>
        </div>
      </footer>
    </div>
  );
}

function PhoneMock() {
  return (
    <div className="rise-in mx-auto w-full max-w-sm">
      <div className="glass-strong relative mx-auto w-72 overflow-hidden rounded-[2rem] p-3">
        <div className="rounded-[1.55rem] bg-foreground px-4 pb-6 pt-5 text-background">
          <div className="mx-auto mb-5 h-1.5 w-16 rounded-full bg-background/20" />
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-background/50">SlipCut</p>
          <p className="mt-3 font-mono text-2xl font-bold tracking-widest">K8P2QX</p>
          <p className="mt-1 text-xs text-background/55">8 games football · gemini</p>
          <div className="mt-5 space-y-2">
            {[
              ["Arsenal vs Villa", "Over 1.5"],
              ["Barça vs Girona", "GG"],
              ["Napoli vs Roma", "1X"],
              ["Ajax vs PSV", "Over 2.5"],
            ].map(([m, s]) => (
              <div key={m} className="flex items-center justify-between rounded-lg bg-background/10 px-3 py-2">
                <span className="text-xs">{m}</span>
                <span className="text-xs font-semibold text-primary-foreground/90">{s}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-lg bg-primary py-2.5 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground">
            Copy code
          </div>
        </div>
      </div>
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 5 2 12.5l7.5 1.5L18 8l-7 8 8.5 2.5L21 5Z" strokeLinejoin="round" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 5h16M4 12h16M4 19h16" strokeLinecap="round" />
    </svg>
  );
}
