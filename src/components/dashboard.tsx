import { useCallback, useEffect, useState } from "react";
import { Mark } from "@/components/mark";
import { deskSnapshot, type DeskSnapshot } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

/**
 * The read-only desk.
 *
 * Same visual language as the bot: quiet labels, numbers in monospace, one
 * idea per row. It cannot cut or book anything — it only shows what the desk
 * already believes, so the numbers have somewhere to live outside Telegram.
 */

const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const pct = (n: number) => `${Math.round(n)}%`;

const STATUS = {
  hit: { label: "hit", className: "text-keep" },
  cut: { label: "cut", className: "text-drop" },
  open: { label: "open", className: "text-warn" },
} as const;

function Panel({
  label,
  note,
  className,
  children,
}: {
  label: string;
  note?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("panel p-5", className)}>
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="panel-label">{label}</h2>
        {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="panel-label">{label}</div>
      <div className={cn("num mt-1 text-2xl", tone ?? "text-foreground")}>{value}</div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="panel-row flex items-baseline justify-between gap-4 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("num text-sm", tone ?? "text-foreground")}>{value}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-sm text-muted-foreground">{children}</p>;
}

export function Dashboard() {
  const [data, setData] = useState<DeskSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloading, setReloading] = useState(false);

  const load = useCallback(async () => {
    setReloading(true);
    try {
      setData(await deskSnapshot());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setReloading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cal = data?.calibration;
  const bins = cal?.bins ?? [];

  return (
    <main className="desk-grid min-h-dvh px-6 py-10 text-foreground">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Mark className="size-9" />
            <div>
              <h1 className="font-serif text-2xl italic tracking-tight">SlipCut</h1>
              <p className="text-xs text-muted-foreground">Read-only desk</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {data ? (
              <span className="num hidden text-xs text-muted-foreground sm:inline">
                {new Date(data.at).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Africa/Lagos",
                })}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void load()}
              disabled={reloading}
              className="text-xs text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground disabled:opacity-50"
            >
              {reloading ? "Reading…" : "Refresh"}
            </button>
            <a
              href="https://t.me/Slipcut_bot"
              className="text-xs text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
            >
              Open the bot
            </a>
          </div>
        </header>

        {failed ? (
          <Panel label="desk">
            <Empty>The desk is unreachable right now. Try again in a moment.</Empty>
          </Panel>
        ) : !data ? (
          <Panel label="desk">
            <Empty>Reading the book…</Empty>
          </Panel>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Panel label="record" note="last 12 slips">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="hit" value={String(data.book.hit)} tone="text-keep" />
                <Stat label="cut" value={String(data.book.cut)} tone="text-drop" />
                <Stat label="open" value={String(data.book.open)} tone="text-warn" />
              </div>
            </Panel>

            <Panel label="money">
              {data.money ? (
                <div>
                  <Row label="staked" value={naira(data.money.staked)} />
                  <Row label="returned" value={naira(data.money.returned)} />
                  <Row
                    label="P/L"
                    value={naira(data.money.pl)}
                    tone={data.money.pl >= 0 ? "text-keep" : "text-drop"}
                  />
                  <Row label="open" value={String(data.money.open)} />
                </div>
              ) : (
                <Empty>No stakes recorded yet.</Empty>
              )}
            </Panel>

            <Panel label="engines">
              <div>
                {data.engines.map((e) => (
                  <Row
                    key={e.key}
                    label={e.key}
                    value={e.keys ? `${e.keys} key${e.keys === 1 ? "" : "s"}` : "none"}
                    tone={e.keys ? "text-keep" : "text-muted-foreground"}
                  />
                ))}
              </div>
            </Panel>

            <Panel
              label="database"
              note={data.database.ok ? `ping ${data.database.ms} ms` : "not answering"}
            >
              <div>
                <Row label="backend" value={data.database.backend} />
                <Row
                  label="state"
                  value={data.database.ok ? "ok" : "down"}
                  tone={data.database.ok ? "text-keep" : "text-drop"}
                />
                {data.database.ok ? (
                  <>
                    <Row label="migrations" value={String(data.database.migrations)} />
                    <Row label="slips" value={String(data.database.slips)} />
                    <Row label="reads" value={String(data.database.reads)} />
                    <Row
                      label="last read"
                      value={
                        data.database.latestReadAt
                          ? new Date(data.database.latestReadAt).toLocaleString("en-GB", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "Africa/Lagos",
                            })
                          : "—"
                      }
                    />
                  </>
                ) : (
                  <Empty>Everything else on this page lives in the database.</Empty>
                )}
              </div>
            </Panel>

            <Panel label="calibration" note={cal?.n ? `${cal.n} settled legs` : undefined} className="sm:col-span-2">
              {cal && cal.n ? (
                <div>
                  <div className="grid grid-cols-3 gap-2">
                    <Stat label="brier" value={cal.brier != null ? cal.brier.toFixed(3) : "—"} />
                    <Stat label="scale a" value={cal.platt.a.toFixed(2)} />
                    <Stat label="scale b" value={cal.platt.b.toFixed(2)} />
                  </div>
                  {bins.length ? (
                    <table className="mt-5 w-full text-sm">
                      <thead>
                        <tr className="panel-label">
                          <th className="pb-2 text-left font-normal">said</th>
                          <th className="pb-2 text-right font-normal">landed</th>
                          <th className="pb-2 text-right font-normal">legs</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bins.map((b) => (
                          <tr key={b.low} className="panel-row">
                            <td className="num py-2 text-left text-muted-foreground">
                              {Math.round(b.low * 100)}–{Math.round(b.high * 100)}%
                            </td>
                            <td className="num py-2 text-right">{pct(b.meanP)}</td>
                            <td className="num py-2 text-right">{pct(b.hitRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                  <p className="mt-4 text-sm text-muted-foreground">{cal.verdict}</p>
                </div>
              ) : (
                <Empty>{cal?.verdict ?? "Nothing settled yet."}</Empty>
              )}
            </Panel>

            <Panel label="book" note="newest first">
              {data.book.rows.length ? (
                <ol>
                  {data.book.rows.map((row) => {
                    const status = STATUS[row.status];
                    return (
                      <li
                        key={row.code}
                        className="panel-row flex items-baseline justify-between gap-4 py-2.5"
                      >
                        <span className="num text-sm">{row.code}</span>
                        <span className="flex items-baseline gap-3">
                          {row.won != null && row.lost != null ? (
                            <span className="num text-xs text-muted-foreground">
                              {row.won}–{row.lost}
                            </span>
                          ) : null}
                          <span className={cn("num text-xs", status.className)}>{status.label}</span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <Empty>No slips yet. Cook one on Telegram.</Empty>
              )}
            </Panel>
          </div>
        )}

        <footer className="mt-10 text-xs text-muted-foreground">
          Analysis, cutting and booking run on Telegram. This page only reads.
        </footer>
      </div>
    </main>
  );
}
