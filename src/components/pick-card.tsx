import { ChevronDown } from "lucide-react";
import { useState } from "react";
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
  const stub =
    pick.sport === "other" ? "other" : pick.sport === "basketball" ? "hoops" : "football";

  return (
    <article
      className={cn(
        "ticket rounded-lg",
        selected === false && "opacity-50",
      )}
    >
      <div
        className={cn(
          "ticket-stub",
          tone === "keep" && "ticket-stub-keep",
          tone === "drop" && "ticket-stub-drop",
        )}
      >
        {stub}
      </div>
      <div className="min-w-0 flex-1 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex h-6 items-center rounded-full px-2 text-[0.65rem] font-medium uppercase tracking-wider",
                  tone === "keep" && "bg-keep/20 text-keep-ink",
                  tone === "drop" && "bg-drop/20 text-drop-ink",
                  tone === "ignore" && "bg-ink/10 text-ink/60",
                )}
              >
                {tone === "ignore" ? "ignored" : tone}
              </span>
              {onToggle && tone !== "ignore" ? (
                <button
                  type="button"
                  onClick={onToggle}
                  className="h-8 rounded-full border border-ink/15 px-2.5 text-[0.65rem] font-medium uppercase tracking-wider text-ink/55 hover:text-ink"
                >
                  {selected === false ? "Add" : "Remove"}
                </button>
              ) : null}
            </div>
            <h3
              className={cn(
                "mt-2 font-serif text-lg leading-snug tracking-tight text-ink",
                (tone === "drop" || selected === false) && "line-through decoration-drop-ink/50",
              )}
            >
              {pick.home}
              <span className="mx-1.5 text-ink/40">vs</span>
              {pick.away}
            </h3>
            <p className="mt-1 text-sm text-ink/55">
              {pick.market} · {pick.selection}
              {pick.league ? ` · ${pick.league}` : ""}
            </p>
            {kickoffLabel(pick.kickoff) ? (
              <p className="mt-1 font-mono text-[0.7rem] text-ink/45">
                {kickoffLabel(pick.kickoff)}
              </p>
            ) : null}
          </div>
          {tone !== "ignore" ? (
            <div className="shrink-0 text-right">
              <p className="font-mono text-2xl tabular-nums leading-none tracking-tight text-ink">
                {pct(pick.probability)}
              </p>
              <p className="mt-1 text-[0.65rem] uppercase tracking-wider text-ink/45">form</p>
              {pick.odds ? (
                <p className="mt-2 font-mono text-[0.7rem] tabular-nums text-ink/45">
                  {formatOdds(pick.odds)}
                  {ev != null ? ` · EV ${formatEv(ev)}` : ""}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mt-3 h-1 overflow-hidden rounded-full bg-ink/10">
          <div
            className={cn(
              "h-full rounded-full",
              tone === "keep" && "bg-keep-ink",
              tone === "drop" && "bg-drop-ink",
              tone === "ignore" && "bg-ink/20",
            )}
            style={{ width: `${tone === "ignore" ? 0 : pick.probability}%` }}
          />
        </div>

        <p className="mt-3 text-sm leading-relaxed text-ink/75">{pick.summary}</p>

        {(pick.reasons.length > 0 || pick.risks.length > 0) && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-3 inline-flex h-11 items-center gap-1 text-xs font-medium text-ink/50 hover:text-ink"
          >
            <ChevronDown className={cn("size-3.5 transition-transform duration-150", open && "rotate-180")} />
            {open ? "Hide notes" : "Why"}
          </button>
        )}

        {open ? (
          <div className="mt-2 grid gap-3 border-t border-ink/10 pt-3 text-sm">
            {pick.reasons.length ? (
              <div>
                <p className="text-[0.7rem] uppercase tracking-wider text-ink/45">Reasons</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-ink/75">
                  {pick.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {pick.risks.length ? (
              <div>
                <p className="text-[0.7rem] uppercase tracking-wider text-ink/45">Risks</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-ink/75">
                  {pick.risks.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
