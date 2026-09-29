import { riskOddsAllowed, type SelectionRisk } from "./selection-policy";
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
  const identity = (p: TicketPick) =>
    `${p.sport}:${p.sporty?.eventId}:${p.sporty?.marketId}:${p.sporty?.outcomeId}:${p.sporty?.specifier ?? ""}`;
  const expected = new Set(unique.picks.map(identity));
  if (
    refreshed.available.length !== unique.picks.length ||
    new Set(refreshed.available.map(identity)).size !== expected.size ||
    refreshed.available.some((p) => !expected.has(identity(p)))
  ) {
    return {
      ok: false,
      code: "selection_unavailable",
      error:
        "Refreshed selections do not match the analysed fixture, market, outcome and line. No replacement or partial code was created.",
    };
  }
  const originals = new Map(
    unique.picks.map((pick) => [
      `${pick.sporty?.eventId ?? pick.id}:${pick.sporty?.marketId ?? pick.market}:${pick.sporty?.outcomeId ?? pick.selection}:${pick.sporty?.specifier ?? ""}`,
      pick,
    ]),
  );
  const changes = refreshed.available.flatMap((pick): OddsChange[] => {
    const key = `${pick.sporty?.eventId ?? pick.id}:${pick.sporty?.marketId ?? pick.market}:${pick.sporty?.outcomeId ?? pick.selection}:${pick.sporty?.specifier ?? ""}`;
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
  for (const pick of refreshed.available) {
    const risk = (picks.find((p) => p.id === pick.id) as TicketPick & { riskMode?: SelectionRisk })
      ?.riskMode;
    if (
      risk &&
      (!["conservative", "balanced", "aggressive"].includes(risk) ||
        !riskOddsAllowed(pick.odds, risk))
    ) {
      return {
        ok: false,
        code: "selection_unavailable",
        error: `${pick.home} vs ${pick.away}: refreshed price ${pick.odds} is outside the ${risk} range. No replacement was made.`,
        unavailable: [{ pick, reason: "Risk-mode odds range failed after refresh." }],
      };
    }
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
      error: `SportyBet booking failed: ${minted.error}. Submitted selections: ${refreshed.available.map((p) => `${p.home} vs ${p.away}: ${p.market} / ${p.selection}`).join("; ")}.`,
    };
  }
  if (minted.unavailable > 0) {
    const affected = refreshed.available.filter((p) =>
      minted.unavailableOutcomes?.some((raw) => {
        if (!raw || typeof raw !== "object") return false;
        const row = raw as Record<string, unknown>;
        return (
          String(row.eventId) === p.sporty?.eventId &&
          String(row.marketId) === p.sporty?.marketId &&
          String(row.outcomeId) === p.sporty?.outcomeId
        );
      }),
    );
    const detail = affected.length
      ? affected.map((p) => `${p.home} vs ${p.away}: ${p.market} / ${p.selection}`).join("; ")
      : "SportyBet did not identify the failed outcome in its response.";
    return {
      ok: false,
      code: "selection_unavailable",
      error: `SportyBet rejected unavailable outcomes: ${detail}. No code was accepted; review and retry.`,
      ...(affected.length
        ? {
            unavailable: affected.map((pick) => ({
              pick,
              reason: "SportyBet rejected this outcome during booking.",
            })),
          }
        : {}),
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
