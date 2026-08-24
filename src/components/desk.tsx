import {
  ClipboardPaste,
  ImageIcon,
  Loader2,
  ScanLine,
  Ticket,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Mark } from "@/components/mark";
import { Workbench } from "@/components/workbench";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { cutSlip, loadTicket } from "@/lib/analyze";
import { applyThreshold, combinedChance, slipLabel } from "@/lib/format";
import { useHistory } from "@/lib/history";
import { SAMPLE_SLIPS } from "@/lib/samples";
import type { CutInput } from "@/lib/analyze";
import type { CutResult, InputMode, TicketPick } from "@/lib/types";
import { COUNTRIES, DEFAULT_THRESHOLD } from "@/lib/types";
import { cn } from "@/lib/utils";

const MODES: { id: InputMode; label: string; icon: typeof Ticket }[] = [
  { id: "code", label: "Code", icon: Ticket },
  { id: "text", label: "Paste", icon: ClipboardPaste },
  { id: "image", label: "Shot", icon: ImageIcon },
];

const PRESETS = [
  { label: "Lenient", value: 48 },
  { label: "Standard", value: 58 },
  { label: "Strict", value: 68 },
];

const LOADING = [
  "Loading the ticket",
  "Keeping football and basketball",
  "Reading live form",
  "Cutting the weak legs",
];

async function fileToJpeg(file: File): Promise<{ mime: string; data: string }> {
  const bitmap = await createImageBitmap(file);
  const max = 1280;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read image");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.72),
  );
  if (!blob) throw new Error("Could not compress image");
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return { mime: "image/jpeg", data: btoa(binary) };
}

export function Desk() {
  const [mode, setMode] = useState<InputMode>("code");
  const [country, setCountry] = useState("ng");
  const [code, setCode] = useState("");
  const [text, setText] = useState("");
  const [imageName, setImageName] = useState<string | null>(null);
  const [image, setImage] = useState<{ mime: string; data: string } | null>(null);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [busy, setBusy] = useState(false);
  const [busyNote, setBusyNote] = useState(LOADING[0]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CutResult | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
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

  async function attachFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Use a screenshot image.");
      return;
    }
    try {
      const packed = await fileToJpeg(file);
      setImage(packed);
      setImageName(file.name);
      setMode("image");
    } catch {
      toast.error("Could not read that image.");
    }
  }

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
    if (mode === "code") {
      return run({ mode: "code", code, country, threshold });
    }
    if (mode === "image") {
      if (!image) {
        setError("Attach a screenshot of the ticket.");
        return;
      }
      return run({ mode: "image", image, threshold });
    }
    return run({ mode: "text", text, country, threshold });
  }

  function loadSample(id: string) {
    const sample = SAMPLE_SLIPS.find((s) => s.id === id);
    if (!sample) return;
    setMode("text");
    setText(sample.text);
    setImage(null);
    setImageName(null);
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
      <header className="sticky top-0 z-20 border-b border-border/80 bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <Mark className="size-8" />
            <div className="leading-none">
              <p className="font-serif text-lg tracking-tight">SlipCut</p>
              <p className="mt-0.5 text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                private desk
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
            History
            {history.items.length ? (
              <span className="font-mono text-[0.7rem] tabular-nums text-muted-foreground">
                {history.items.length}
              </span>
            ) : null}
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-8 sm:pt-12">
        <section className="rise-in max-w-2xl">
          <p className="text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
            Analyze · split · trim · rebuild
          </p>
          <h1 className="mt-3 font-serif text-4xl leading-[1.05] tracking-tight sm:text-5xl">
            Cut the weak legs.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            Load a SportyBet code, paste a slip, or drop an X link. Football and basketball
            are scored on live form — not the price. Then split, trim, edit, and copy a rebuild list.
          </p>
        </section>

        <section className="rise-in mt-8 rounded-xl border border-border bg-card p-4 sm:p-6">
          <div
            role="tablist"
            className="grid grid-cols-3 rounded-lg bg-muted p-1"
          >
            {MODES.map((m) => {
              const Icon = m.icon;
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setMode(m.id)}
                  className={cn(
                    "inline-flex h-11 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors duration-150",
                    active
                      ? "bg-card text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="mt-5">
            {mode === "code" ? (
              <div className="grid gap-4 sm:grid-cols-[1fr_9.5rem]">
                <div>
                  <Label htmlFor="code">Booking code</Label>
                  <Input
                    id="code"
                    className="mt-1.5 font-mono uppercase tracking-wider"
                    placeholder="MQVZ70"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
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
            ) : null}

            {mode === "text" ? (
              <div>
                <Label htmlFor="slip">Paste the slip</Label>
                <Textarea
                  id="slip"
                  className="mt-1.5 min-h-48 font-mono text-[0.8rem] leading-relaxed"
                  placeholder={"Arsenal vs Chelsea\n1X2 Home\n\nOr paste an X / SportyBet link"}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onPaste={(e) => {
                    const item = [...e.clipboardData.items].find((i) =>
                      i.type.startsWith("image/"),
                    );
                    const file = item?.getAsFile();
                    if (file) {
                      e.preventDefault();
                      void attachFile(file);
                    }
                  }}
                />
              </div>
            ) : null}

            {mode === "image" ? (
              <div>
                <Label>Ticket screenshot</Label>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  onPaste={(e) => {
                    const item = [...e.clipboardData.items].find((i) =>
                      i.type.startsWith("image/"),
                    );
                    const file = item?.getAsFile();
                    if (file) void attachFile(file);
                  }}
                  className="mt-1.5 flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted px-4 text-center"
                >
                  <ScanLine className="size-5 text-muted-foreground" />
                  <span className="text-sm text-foreground">
                    {imageName ?? "Drop, paste, or choose a screenshot"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Vision is off on this desk. Use a booking code or paste the slip.
                  </span>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void attachFile(file);
                  }}
                />
              </div>
            ) : null}
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
            <p className="mt-4 rounded-md border border-drop/30 bg-drop-dim px-3 py-2 text-sm text-drop">
              {error}
            </p>
          ) : null}
        </section>

        {busy && !view ? (
          <section className="mt-8 grid gap-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-lg border border-border bg-card"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </section>
        ) : null}

        {view ? (
          <Workbench
            result={view}
            threshold={threshold}
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
                d: "Copy a clean match list. This desk does not book or mint other-book codes.",
              },
            ].map((item) => (
              <div key={item.t} className="rounded-lg border border-border bg-card p-4">
                <p className="text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
                  {item.t}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-foreground/85">{item.d}</p>
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
