import { createFileRoute } from "@tanstack/react-router";
import { MiniApp } from "@/components/mini-app";

export const Route = createFileRoute("/app")({ component: MiniApp });
