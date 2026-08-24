import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { kickoffLabel, pct } from "@/lib/format";
import { expectedValue, formatEv, formatOdds } from "@/lib/workbench";
import type { AnalyzedPick } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PickCard({
  pick,
  onToggle,
  selected,
}: {
  pick: AnalyzedPick;
  onToggle?: () => void;
  selected?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tone =
    pick.verdict === "keep" ? "keep" : pick.verdict === "drop" ? "drop" : "ignore";
  const ev = expectedValue(pick.probability, pick.odds);

  return (
    <article
      className={cn(
        "rounded-lg border bg-card p-4",
        tone === "keep" && "border-keep/30",
        tone === "drop" && "border-drop/25",
        tone === "ignore" && "border-border opacity-70",
        selected === false && "opacity-55",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={tone === "keep" ? "keep" : tone === "drop" ? "drop" : "muted"}>
              {tone === "ignore" ? "ignored" : tone}
            </Badge>
            <span className="text-[0.7rem] uppercase tracking-wider text-muted-foreground">
              {pick.sport === "other" ? "other sport" : pick.sport}
            </span>
            {onToggle && tone !== "ignore" ? (
              <button
                type="button"
                onClick={onToggle}
                className="h-8 rounded-full border border-border px-2.5 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                {selected === false ? "Add" : "Remove"}
              </button>
            ) : null}
          </div>
          <h3
            className={cn(
              "mt-2 font-serif text-lg leading-snug tracking-tight text-foreground",
              (tone === "drop" || selected === false) && "line-through decoration-drop/60",
            )}
          >
            {pick.home}
            <span className="mx-1.5 text-muted-foreground">vs</span>
            {pick.away}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {pick.market} · {pick.selection}
            {pick.league ? ` · ${pick.league}` : ""}
          </p>
          {kickoffLabel(pick.kickoff) ? (
            <p className="mt-1 font-mono text-[0.7rem] text-muted-foreground">
              {kickoffLabel(pick.kickoff)}
            </p>
          ) : null}
        </div>
        {tone !== "ignore" ? (
          <div className="shrink-0 text-right">
            <p className="font-mono text-2xl tabular-nums leading-none tracking-tight text-foreground">
              {pct(pick.probability)}
            </p>
            <p className="mt-1 text-[0.65rem] uppercase tracking-wider text-muted-foreground">
              form
            </p>
            {pick.odds ? (
              <p className="mt-2 font-mono text-[0.7rem] tabular-nums text-muted-foreground">
                {formatOdds(pick.odds)}
                {ev != null ? ` · EV ${formatEv(ev)}` : ""}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            tone === "keep" && "bg-keep",
            tone === "drop" && "bg-drop",
            tone === "ignore" && "bg-border",
          )}
          style={{ width: `${tone === "ignore" ? 0 : pick.probability}%` }}
        />
      </div>

      <p className="mt-3 text-sm leading-relaxed text-foreground/85">{pick.summary}</p>

      {(pick.reasons.length > 0 || pick.risks.length > 0) && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-3 inline-flex h-11 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={cn("size-3.5 transition-transform duration-150", open && "rotate-180")} />
          {open ? "Hide notes" : "Why"}
        </button>
      )}

      {open ? (
        <div className="mt-2 grid gap-3 border-t border-border pt-3 text-sm">
          {pick.reasons.length ? (
            <div>
              <p className="text-[0.7rem] uppercase tracking-wider text-muted-foreground">Reasons</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-foreground/85">
                {pick.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {pick.risks.length ? (
            <div>
              <p className="text-[0.7rem] uppercase tracking-wider text-muted-foreground">Risks</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-foreground/85">
                {pick.risks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
