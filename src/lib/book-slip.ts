import { combinedOdds } from "./workbench";
import { mintShare, refreshSelections, sportyOf } from "./sportybet";
import { uniqueEvents } from "./workbench";
import type { TicketPick } from "./types";

export type OddsChange = {
  pick: TicketPick;
  beforeOdds: number;
  afterOdds: number;
};

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
      code:
        | "invalid_request"
        | "selection_unavailable"
        | "odds_changed"
        | "provider_unavailable"
        | "provider_timeout"
        | "provider_rejected"
        | "mint_failed";
      error: string;
      available?: TicketPick[];
      unavailable?: Array<{ pick: TicketPick; reason: string }>;
      changes?: OddsChange[];
    };

export type BookDependencies = {
  refresh: typeof refreshSelections;
  mint: typeof mintShare;
};

export const defaultBookDependencies: BookDependencies = {
  refresh: refreshSelections,
  mint: mintShare,
};

export async function mintReviewedSlip(
  picks: TicketPick[],
  country = "ng",
  dependencies: BookDependencies = defaultBookDependencies,
  options: { acceptOddsChanges?: boolean } = {},
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
      code:
        refreshed.error.code === "provider_timeout"
          ? "provider_timeout"
          : refreshed.error.code === "provider_rejected"
            ? "provider_rejected"
            : "provider_unavailable",
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
  const originals = new Map(
    unique.picks.map((pick) => [
      `${pick.sporty?.eventId ?? pick.id}:${pick.sporty?.marketId ?? pick.market}:${pick.sporty?.outcomeId ?? pick.selection}`,
      pick,
    ]),
  );
  const changes = refreshed.available.flatMap((pick): OddsChange[] => {
    const key = `${pick.sporty?.eventId ?? pick.id}:${pick.sporty?.marketId ?? pick.market}:${pick.sporty?.outcomeId ?? pick.selection}`;
    const before = originals.get(key)?.odds;
    const after = pick.odds;
    if (
      typeof before !== "number" ||
      typeof after !== "number" ||
      !Number.isFinite(before) ||
      !Number.isFinite(after) ||
      Math.abs(before - after) < 0.0001
    )
      return [];
    return [{ pick, beforeOdds: before, afterOdds: after }];
  });
  // Existing bot/server callers preserve their established behaviour. Review
  // clients such as the Mini App opt in to the confirmation gate with `false`.
  if (changes.length && options.acceptOddsChanges === false) {
    return {
      ok: false,
      code: "odds_changed",
      error:
        changes.length === 1
          ? "One selection's odds changed. Review the current price before creating a code."
          : `${changes.length} selections changed odds. Review the current prices before creating a code.`,
      available: refreshed.available,
      changes,
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
      error:
        "SportyBet reported that one or more outcomes became unavailable. No code was accepted; review and retry.",
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
