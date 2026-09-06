import { Loader2, ScanLine, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Workbench } from "@/components/workbench";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { cutSlip, loadTicket, connectTelegram } from "@/lib/analyze";
import { applyThreshold, combinedChance, slipLabel } from "@/lib/format";
import { useHistory } from "@/lib/history";
import { SAMPLE_SLIPS } from "@/lib/samples";
import type { CutInput } from "@/lib/analyze";
import type { CutResult, TicketPick } from "@/lib/types";
import { COUNTRIES, DEFAULT_THRESHOLD } from "@/lib/types";
import { cn } from "@/lib/utils";

const PRESETS = [
  { label: "Lenient", value: 40 },
  { label: "Standard", value: 45 },
  { label: "Strict", value: 62 },
];

const LOADING = [
  "Loading the ticket",
  "Keeping football and basketball",
  "Reading live form",
  "Cutting the weak legs",
];

export function Desk() {
  const [country, setCountry] = useState("ng");
  const [code, setCode] = useState("");
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [busy, setBusy] = useState(false);
  const [busyNote, setBusyNote] = useState(LOADING[0]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CutResult | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [tgBusy, setTgBusy] = useState(false);
  const history = useHistory();

  const view = useMemo(() => {
    if (!result) return null;
    const split = applyThreshold(result.picks, threshold);
    return {
      ...result,
      threshold,
      ...split,
      combinedKeepChance: combinedChance(split.kept),
    };
  }, [result, threshold]);

  async function run(input: CutInput, label?: string) {
    setBusy(true);
    setError(null);
    let step = 0;
    setBusyNote(LOADING[0]);
    const timer = window.setInterval(() => {
      step = (step + 1) % LOADING.length;
      setBusyNote(LOADING[step]);
    }, 2200);
    try {
      const res = await cutSlip({ data: input });
      if (!res.ok) {
        setError(res.error);
        setResult(null);
        return;
      }
      setResult(res);
      history.push({
        label: label ?? slipLabel(res.picks, res.shareCode),
        result: res,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cut that slip.");
    } finally {
      window.clearInterval(timer);
      setBusy(false);
    }
  }

  function onAnalyze() {
    if (!code.trim()) {
      setError("Enter a SportyBet booking code.");
      return;
    }
    return run({ mode: "code", code, country, threshold });
  }

  function loadSample(id: string) {
    const sample = SAMPLE_SLIPS.find((s) => s.id === id);
    if (!sample) return;
    void run(
      { mode: "picks", picks: sample.picks as TicketPick[], threshold },
      sample.title,
    );
  }

  async function combineCode(code: string) {
    if (!result) return;
    const loaded = await loadTicket({ data: { code, country } });
    if (!loaded.ok) {
      toast.error(loaded.error);
      return;
    }
    const seen = new Set(result.picks.map((p) => `${p.home}|${p.away}|${p.market}|${p.selection}`));
    const fresh = loaded.picks.filter(
      (p) => !seen.has(`${p.home}|${p.away}|${p.market}|${p.selection}`),
    );
    if (!fresh.length) {
      toast.message("That code added no new games.");
      return;
    }
    await run(
      { mode: "picks", picks: [...result.picks, ...fresh].slice(0, 20), threshold },
      `${result.shareCode ?? "slip"} + ${loaded.shareCode ?? code}`,
    );
  }

  return (
    <div className="desk-grid min-h-dvh">
      <div className="liquid-scene" aria-hidden="true">
        <div className="liquid-blob liquid-blob-a" />
        <div className="liquid-blob liquid-blob-b" />
        <div className="liquid-blob liquid-blob-c" />
      </div>
      <header className="glass-nav sticky top-0 z-20">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <a href="/" className="flex items-center gap-3">
            <img src="/logo.png" alt="" className="size-9 rounded-full outline-none" />
            <div className="leading-none">
              <p className="text-xl font-bold tracking-tight">
                Slip<span className="text-primary">Cut</span>
              </p>
              <p className="mt-1 text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
                web desk
              </p>
            </div>
          </a>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={tgBusy}
              onClick={() => {
                void (async () => {
                  setTgBusy(true);
                  try {
                    const res = await connectTelegram();
                    if (!res.ok) {
                      toast.error(res.error);
                      return;
                    }
                    toast.success(`Bot ready: t.me/${res.username}`);
                    window.open(`https://t.me/${res.username}`, "_blank", "noreferrer");
                  } finally {
                    setTgBusy(false);
                  }
                })();
              }}
            >
              Telegram
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
            History
            {history.items.length ? (
              <span className="font-mono text-[0.7rem] tabular-nums text-muted-foreground">
                {history.items.length}
              </span>
            ) : null}
          </Button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-24 pt-8 sm:pt-12">
        <section className="rise-in grid items-start gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
          <div className="lg:sticky lg:top-24 lg:pt-4">
            <p className="text-[0.7rem] uppercase tracking-[0.24em] text-muted-foreground">
              Analyze · split · trim · rebuild
            </p>
            <h1 className="mt-4 text-5xl font-bold leading-[0.95] tracking-tight sm:text-6xl">
              Cut the weak legs.
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-muted-foreground">
              Load a SportyBet code. Football and basketball are scored on live form — not the
              price. Then split, trim, and mint a new code.
            </p>
          </div>

        <section className="paper rounded-xl p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-[1fr_9.5rem]">
            <div>
              <Label htmlFor="code">Booking code</Label>
              <Input
                id="code"
                className="mt-1.5 font-mono uppercase tracking-wider"
                placeholder="MQVZ70"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void onAnalyze();
                }}
                autoCapitalize="characters"
                autoCorrect="off"
              />
            </div>
            <div>
              <Label htmlFor="country">Market</Label>
              <select
                id="country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="mt-1.5 flex h-11 w-full rounded-md border border-border bg-muted px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Separator className="my-5" />

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <Label>Keep picks at or above {threshold}%</Label>
                <span className="font-mono text-sm tabular-nums text-foreground">{threshold}%</span>
              </div>
              <Slider
                className="mt-2"
                min={40}
                max={80}
                step={1}
                value={[threshold]}
                onValueChange={(v) => setThreshold(v[0] ?? DEFAULT_THRESHOLD)}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setThreshold(p.value)}
                    className={cn(
                      "h-9 rounded-full border px-3 text-xs font-medium",
                      threshold === p.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <Button
              size="lg"
              className="w-full sm:w-auto sm:min-w-44"
              disabled={busy}
              onClick={() => void onAnalyze()}
            >
              {busy ? <Loader2 className="animate-spin" /> : <ScanLine />}
              {busy ? busyNote : "Cut slip"}
            </Button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {SAMPLE_SLIPS.map((s) => (
              <Button
                key={s.id}
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => loadSample(s.id)}
              >
                Try {s.title.toLowerCase()}
              </Button>
            ))}
          </div>

          {error ? (
            <p className="mt-4 rounded-md border border-drop-ink/25 bg-drop/15 px-3 py-2 text-sm text-drop-ink">
              {error}
            </p>
          ) : null}
        </section>
        </section>

        {busy && !view ? (
          <section className="mt-8 grid gap-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="ticket h-28 animate-pulse rounded-lg"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </section>
        ) : null}

        {view ? (
          <Workbench
            result={view}
            threshold={threshold}
            country={country}
            onThreshold={setThreshold}
            onCombine={combineCode}
            busy={busy}
          />
        ) : (
          <section className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                t: "Analyze",
                d: "Live form and news. Odds are stored for size and EV, never used as the score.",
              },
              {
                t: "Split",
                d: "Cut a fat accumulator into 2, 3, or 4 even slips. No duplicated legs.",
              },
              {
                t: "Trim",
                d: "Drop the weakest legs until the ticket sits near 20×, 50×, or 100×.",
              },
              {
                t: "Edit",
                d: "Add or remove a pick from the working slip without reloading the code.",
              },
              {
                t: "Combine",
                d: "Fold another SportyBet booking code into the desk, then rescore.",
              },
              {
                t: "Rebuild",
                d: "Mint a new SportyBet booking code from the edited legs.",
              },
            ].map((item) => (
              <div key={item.t} className="ticket rounded-lg">
                <div className="ticket-stub">{item.t}</div>
                <div className="p-4">
                  <p className="font-serif text-lg text-ink">{item.t}</p>
                  <p className="mt-2 text-sm leading-relaxed text-ink/65">{item.d}</p>
                </div>
              </div>
            ))}
          </section>
        )}

        <p className="mt-14 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          Personal analysis desk. Not a bookmaker, not a tipster, not financial advice.
          Matches move. Injuries land late. You still decide whether to stake.
        </p>
      </main>

      {historyOpen ? (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            className="absolute inset-0 bg-background/70"
            aria-label="Close history"
            onClick={() => setHistoryOpen(false)}
          />
          <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-border bg-card">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <p className="font-serif text-lg">History</p>
              <div className="flex gap-1">
                {history.items.length ? (
                  <Button variant="ghost" size="sm" onClick={() => history.clear()}>
                    <Trash2 />
                    Clear
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {history.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Cuts you run stay on this device.</p>
              ) : (
                <ul className="grid gap-2">
                  {history.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="w-full rounded-md border border-border bg-background px-3 py-3 text-left hover:bg-muted"
                        onClick={() => {
                          setResult(item.result);
                          setThreshold(item.result.threshold);
                          setHistoryOpen(false);
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate font-medium">{item.label}</p>
                          <Badge variant="keep">{item.result.kept.length} keep</Badge>
                        </div>
                        <p className="mt-1 font-mono text-[0.7rem] text-muted-foreground">
                          {new Date(item.at).toLocaleString()}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
