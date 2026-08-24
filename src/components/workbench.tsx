import { Copy, GitBranch, Loader2, Scissors, Send, Ticket, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PickCard } from "@/components/pick-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bookSlip } from "@/lib/analyze";
import { combinedChance, copyKeepers, pct } from "@/lib/format";
import {
  combinedOdds,
  copyRebuild,
  copySplitBook,
  formatOdds,
  keepTop,
  parseCommand,
  splitEven,
  trimToOdds,
} from "@/lib/workbench";
import type { AnalyzedPick, CutResult } from "@/lib/types";
import { cn } from "@/lib/utils";

type Minted = { shareCode: string; shareURL: string };

export function Workbench({
  result,
  threshold,
  country,
  onThreshold,
  onCombine,
  busy,
}: {
  result: CutResult;
  threshold: number;
  country: string;
  onThreshold: (n: number) => void;
  onCombine: (code: string) => Promise<void>;
  busy: boolean;
}) {
  const [workingIds, setWorkingIds] = useState<string[]>(() => result.kept.map((p) => p.id));
  const [splits, setSplits] = useState<AnalyzedPick[][] | null>(null);
  const [command, setCommand] = useState("");
  const [combineCode, setCombineCode] = useState("");
  const [minting, setMinting] = useState(false);
  const [minted, setMinted] = useState<Minted | null>(null);
  const [splitMints, setSplitMints] = useState<Minted[] | null>(null);

  useEffect(() => {
    setWorkingIds(result.kept.map((p) => p.id));
    setSplits(null);
    setMinted(null);
    setSplitMints(null);
  }, [result]);

  const byId = useMemo(() => new Map(result.picks.map((p) => [p.id, p])), [result.picks]);
  const working = workingIds.map((id) => byId.get(id)).filter((p): p is AnalyzedPick => Boolean(p));
  const odds = combinedOdds(working);
  const form = combinedChance(working);

  function toggle(id: string) {
    setSplits(null);
    setMinted(null);
    setWorkingIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  function applySplit(parts: number) {
    if (working.length < 2) {
      toast.error("Need at least two working picks to split.");
      return;
    }
    const next = splitEven(
      working.slice().sort((a, b) => b.probability - a.probability),
      parts,
    );
    setSplits(next);
    setMinted(null);
    setSplitMints(null);
    toast.success(`Split into ${next.length} slips.`);
  }

  function applyTrim(target: number) {
    const next = trimToOdds(working, target);
    if (!next.length) {
      toast.error("Nothing left to keep.");
      return;
    }
    setWorkingIds(next.map((p) => p.id));
    setSplits(null);
    setMinted(null);
    setSplitMints(null);
    toast.success(`Trimmed to ${next.length} legs${combinedOdds(next) ? ` · ${formatOdds(combinedOdds(next)!)}` : ""}.`);
  }

  function runCommand() {
    const parsed = parseCommand(command);
    if (parsed.type === "split") return applySplit(parsed.parts);
    if (parsed.type === "trim") return applyTrim(parsed.targetOdds);
    if (parsed.type === "keepLegs") {
      const next = keepTop(working, parsed.count);
      setWorkingIds(next.map((p) => p.id));
      setSplits(null);
      toast.success(`Kept the top ${next.length} legs.`);
      return;
    }
    if (parsed.type === "threshold") {
      onThreshold(Math.min(80, Math.max(40, parsed.value)));
      toast.success(`Bar set to ${parsed.value}%.`);
      return;
    }
    if (parsed.type === "sport") {
      setWorkingIds(working.filter((p) => p.sport === parsed.sport).map((p) => p.id));
      setSplits(null);
      toast.success(`Working set is ${parsed.sport} only.`);
      return;
    }
    if (parsed.type === "dropOther") {
      setWorkingIds(working.filter((p) => p.sport !== "other").map((p) => p.id));
      toast.success("Dropped other sports.");
      return;
    }
    toast.message(parsed.hint);
  }

  async function copyText(text: string, ok: string) {
    await navigator.clipboard.writeText(text);
    toast.success(ok);
  }

  async function mintWorking() {
    if (!working.length) return;
    setMinting(true);
    try {
      const res = await bookSlip({ data: { picks: working, country } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setMinted({ shareCode: res.shareCode, shareURL: res.shareURL });
      toast.success(`SportyBet ${res.shareCode}`);
    } finally {
      setMinting(false);
    }
  }

  async function mintSplits() {
    if (!splits?.length) return;
    setMinting(true);
    try {
      const out: Minted[] = [];
      for (const slip of splits) {
        const res = await bookSlip({ data: { picks: slip, country } });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        out.push({ shareCode: res.shareCode, shareURL: res.shareURL });
      }
      setSplitMints(out);
      toast.success("Split SportyBet codes ready.");
    } finally {
      setMinting(false);
    }
  }

  function telegramHref(code: string, url: string) {
    const text = `SlipCut ${code}\n${url}`;
    return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  }

  return (
    <section className="mt-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">Desk note</p>
          <p className="mt-2 max-w-2xl font-serif text-xl leading-snug text-foreground">{result.desk}</p>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          <WandSparkles className="size-3.5" />
          Say what you want
        </div>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            runCommand();
          }}
        >
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="split into 3 · trim to 50x · keep 6 legs · keep football"
            className="h-12"
          />
          <Button type="submit" className="h-12 sm:w-32" disabled={busy}>
            Run
          </Button>
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          {[2, 3, 4].map((n) => (
            <Button key={n} type="button" variant="outline" size="sm" onClick={() => applySplit(n)}>
              <GitBranch />
              Split {n}
            </Button>
          ))}
          {[20, 50, 100].map((n) => (
            <Button key={n} type="button" variant="outline" size="sm" onClick={() => applyTrim(n)}>
              <Scissors />
              Trim {n}×
            </Button>
          ))}
        </div>

        <form
          className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!combineCode.trim()) return;
            void onCombine(combineCode.trim());
            setCombineCode("");
          }}
        >
          <Input
            value={combineCode}
            onChange={(e) => setCombineCode(e.target.value)}
            placeholder="Combine another SportyBet code"
            className="font-mono uppercase tracking-wider"
            autoCapitalize="characters"
          />
          <Button type="submit" variant="outline" disabled={busy || !combineCode.trim()}>
            Combine
          </Button>
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" disabled={minting || !working.length} onClick={() => void mintWorking()}>
            {minting ? <Loader2 className="animate-spin" /> : <Ticket />}
            Get SportyBet code
          </Button>
          {splits?.length ? (
            <Button
              type="button"
              variant="outline"
              disabled={minting}
              onClick={() => void mintSplits()}
            >
              <GitBranch />
              Codes for splits
            </Button>
          ) : null}
        </div>

        {minted ? (
          <div className="mt-4 rounded-lg border border-keep/30 bg-keep-dim px-4 py-3">
            <p className="text-[0.7rem] uppercase tracking-[0.18em] text-keep">SportyBet code</p>
            <p className="mt-1 font-mono text-2xl tracking-[0.2em] text-foreground">{minted.shareCode}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void copyText(minted.shareCode, "Code copied.")}
              >
                <Copy />
                Copy code
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={minted.shareURL} target="_blank" rel="noreferrer">
                  Open SportyBet
                </a>
              </Button>
              <Button asChild size="sm">
                <a href={telegramHref(minted.shareCode, minted.shareURL)} target="_blank" rel="noreferrer">
                  <Send />
                  Send on Telegram
                </a>
              </Button>
            </div>
          </div>
        ) : null}

        {splitMints?.length ? (
          <div className="mt-3 grid gap-2">
            {splitMints.map((m, i) => (
              <div key={m.shareCode} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                <p className="font-mono text-sm tracking-wider">
                  Slip {i + 1} · {m.shareCode}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void copyText(m.shareCode, "Copied.")}>
                    Copy
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a href={telegramHref(m.shareCode, m.shareURL)} target="_blank" rel="noreferrer">
                      Telegram
                    </a>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Get SportyBet code books the working legs as a new share code. Load from a SportyBet
          booking code first — pasted text has no event IDs. Send on Telegram shares that code.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Working" value={String(working.length)} tone="keep" />
        <Stat label="On slip" value={String(result.picks.length)} />
        <Stat label="Combined form" value={form == null ? "—" : pct(form)} />
        <Stat label="Combined odds" value={odds == null ? "—" : formatOdds(odds)} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!working.length}
          onClick={() => void copyText(copyKeepers(working), "Working slip copied.")}
        >
          <Copy />
          Copy working
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!working.length}
          onClick={() => void copyText(copyRebuild(working), "Rebuild list copied.")}
        >
          <Copy />
          Rebuild list
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!splits?.length}
          onClick={() => splits && void copyText(copySplitBook(splits), "Split slips copied.")}
        >
          <Copy />
          Copy splits
        </Button>
      </div>

      {splits?.length ? (
        <div className={cn("mt-8 grid gap-4", splits.length > 2 ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
          {splits.map((slip, i) => {
            const slipOdds = combinedOdds(slip);
            return (
              <div key={i} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-serif text-xl">Slip {i + 1}</h3>
                  <p className="font-mono text-xs tabular-nums text-muted-foreground">
                    {slip.length} legs{slipOdds ? ` · ${formatOdds(slipOdds)}` : ""}
                  </p>
                </div>
                <div className="mt-3 grid gap-2">
                  {slip.map((p) => (
                    <p key={p.id} className="text-sm leading-snug">
                      <span className="font-medium">{p.home} vs {p.away}</span>
                      <span className="block text-muted-foreground">
                        {p.market} — {p.selection} · {pct(p.probability)}
                      </span>
                    </p>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => void copyText(copyRebuild(slip), `Slip ${i + 1} copied.`)}
                >
                  <Copy />
                  Copy
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="font-serif text-2xl tracking-tight">Keep</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            At or above {threshold}% form. Remove a pick from the working slip, or add one back from Cut.
          </p>
          <div className="mt-4 grid gap-3">
            {result.kept.length ? (
              result.kept.map((p) => (
                <PickCard
                  key={p.id}
                  pick={p}
                  selected={workingIds.includes(p.id)}
                  onToggle={() => toggle(p.id)}
                />
              ))
            ) : (
              <EmptyNote text="Nothing cleared the bar. Lower the threshold or combine a stronger code." />
            )}
          </div>
        </div>
        <div>
          <h2 className="font-serif text-2xl tracking-tight">Cut</h2>
          <p className="mt-1 text-sm text-muted-foreground">Weak form, or the wrong sport.</p>
          <div className="mt-4 grid gap-3">
            {result.dropped.length || result.ignored.length ? (
              <>
                {result.dropped.map((p) => (
                  <PickCard
                    key={p.id}
                    pick={p}
                    selected={workingIds.includes(p.id)}
                    onToggle={() => toggle(p.id)}
                  />
                ))}
                {result.ignored.map((p) => (
                  <PickCard key={p.id} pick={p} />
                ))}
              </>
            ) : (
              <EmptyNote text="Every football and basketball pick held up." />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "keep" | "drop";
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-3">
      <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 font-mono text-2xl tabular-nums tracking-tight",
          tone === "keep" && "text-keep",
          tone === "drop" && "text-drop",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
      {text}
    </p>
  );
}
