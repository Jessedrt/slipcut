import { combinedOdds } from "./workbench";
import { mintShare, refreshSelections, sportyOf } from "./sportybet";
import { uniqueEvents } from "./workbench";
import type { TicketPick } from "./types";

export type BookSlipResult =
  | {
      ok: true;
      shareCode: string;
      shareURL: string;
      unavailable: 0;
      picks: TicketPick[];
      combinedOdds: number | null;
    }
  | {
      ok: false;
      code: "invalid_request" | "selection_unavailable" | "provider_unavailable" | "provider_timeout" | "provider_rejected" | "mint_failed";
      error: string;
      available?: TicketPick[];
      unavailable?: Array<{ pick: TicketPick; reason: string }>;
    };

export type BookDependencies = {
  refresh: typeof refreshSelections;
  mint: typeof mintShare;
};

const defaultBookDependencies: BookDependencies = {
  refresh: refreshSelections,
  mint: mintShare,
};

export async function mintReviewedSlip(
  picks: TicketPick[],
  country = "ng",
  dependencies: BookDependencies = defaultBookDependencies,
): Promise<BookSlipResult> {
  if (!Array.isArray(picks) || picks.length < 1 || picks.length > 15) {
    return {
      ok: false,
      code: "invalid_request",
      error: "Choose between 1 and 15 selections before creating a code.",
    };
  }
  const unique = uniqueEvents(picks);
  if (unique.picks.length !== picks.length) {
    return {
      ok: false,
      code: "invalid_request",
      error: "Choose only one selection from each event before creating a code.",
    };
  }
  const refreshed = await dependencies.refresh(unique.picks);
  if (refreshed.error) {
    return {
      ok: false,
      code: refreshed.error.code === "provider_timeout" ? "provider_timeout" : refreshed.error.code === "provider_rejected" ? "provider_rejected" : "provider_unavailable",
      error: refreshed.error.error,
    };
  }
  if (refreshed.unavailable.length) {
    return {
      ok: false,
      code: "selection_unavailable",
      error:
        refreshed.unavailable.length === 1
          ? "One selected outcome is no longer available. Review the updated slip."
          : `${refreshed.unavailable.length} selected outcomes are no longer available. Review the updated slip.`,
      available: refreshed.available,
      unavailable: refreshed.unavailable,
    };
  }
  const selections = sportyOf(refreshed.available);
  if (selections.length !== refreshed.available.length) {
    return {
      ok: false,
      code: "invalid_request",
      error: "One or more selections are missing SportyBet booking identifiers.",
    };
  }
  const minted = await dependencies.mint(selections, country);
  if ("error" in minted) {
    return {
      ok: false,
      code: "mint_failed",
      error: "Booking code creation failed. No code was created.",
    };
  }
  if (minted.unavailable > 0) {
    return {
      ok: false,
      code: "selection_unavailable",
      error: "SportyBet reported that one or more outcomes became unavailable. No code was accepted; review and retry.",
      available: refreshed.available,
    };
  }
  return {
    ok: true,
    shareCode: minted.shareCode,
    shareURL: minted.shareURL,
    unavailable: 0,
    picks: refreshed.available,
    combinedOdds: combinedOdds(refreshed.available),
  };
}
