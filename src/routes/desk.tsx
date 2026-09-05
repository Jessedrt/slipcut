import { createFileRoute } from "@tanstack/react-router";
import { Desk } from "@/components/desk";

export const Route = createFileRoute("/desk")({ component: DeskPage });

function DeskPage() {
  return <Desk />;
}
