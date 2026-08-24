import { createFileRoute } from "@tanstack/react-router";
import { Mark } from "@/components/mark";

export const Route = createFileRoute("/")({ component: Closed });

function Closed() {
  return (
    <main className="desk-grid flex min-h-dvh items-center justify-center px-6">
      <div className="paper max-w-md rounded-xl px-8 py-10 text-center">
        <Mark className="mx-auto size-12" />
        <h1 className="mt-5 font-serif text-3xl italic tracking-tight text-ink">SlipCut</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink/65">
          The desk is closed. Analysis runs on Telegram only.
        </p>
        <a
          href="https://t.me/Slipcut_bot"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-ink px-5 text-sm font-medium text-paper"
        >
          Open Slipcut bot
        </a>
      </div>
    </main>
  );
}
