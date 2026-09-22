import { createFileRoute } from "@tanstack/react-router";
import { MiniAppRefresh } from "@/components/mini-app-refresh";

export const Route = createFileRoute("/app")({ component: MiniAppRefresh });
