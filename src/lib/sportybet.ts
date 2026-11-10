import { automaticMarketAllowed, canonicalMarket, footballDiscoverable } from "./selection-policy";
// TEMP: if you see this, full push failed - check artifacts
export function footballOptionAllowed(pick: any): boolean {
  return pick.sport === "football" && footballDiscoverable(pick);
}
export async function listUpcomingPicks() { return { error: "sportybet.ts incomplete", code: "provider_unavailable" }; }
export async function refreshSelections(picks: any[]) { return { available: picks, unavailable: [] }; }
export function cookablePick() { return true; }
export type CookWindow = "today" | "tomorrow" | "weekend" | "upcoming" | "soon" | "week" | "fortnight";
export type DiscoveryDiagnostics = any;
export type ProviderErrorCode = string;
export type SportyFailure = any;
