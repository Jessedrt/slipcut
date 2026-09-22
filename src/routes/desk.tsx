import { createFileRoute } from "@tanstack/react-router";
import { MiniAppRefresh } from "@/components/mini-app-refresh";

// Existing Telegram "Open desk" buttons may still point at /desk.
// Keep that URL working, but always serve the same current UI as /app.
export const Route = createFileRoute("/desk")({ component: MiniAppRefresh });
