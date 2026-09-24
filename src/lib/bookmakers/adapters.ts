import {
  loadBookingCode,
  mintShare,
  refreshSelections,
  sportyOf,
} from "../sportybet";
import type {
  BookmakerId,
  Ticket,
  TicketPick,
} from "../types";
import {
  BookmakerProviderError,
  bookRelayPicks,
  convertRelayCode,
} from "./betrelay";
import {
  normalizePick,
  normalizeTicket,
  toRelayBookPick,
} from "./normalize";

export type AdapterErrorCode =
  | "invalid_code"
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_rejected"
  | "selection_unavailable"
  | "encoding_unsupported";

export type DecodeResult =
  | { ok: true; ticket: Ticket }
  | { ok: false; code: AdapterErrorCode; error: string };

export type EncodeResult =
  | {
      ok: true;
      code: string;
      url?: string;
      ticket: Ticket;
      warnings: string[];
    }
  | { ok: false; code: AdapterErrorCode; error: string };

export type RefreshResult =
  | {
      ok: true;
      available: TicketPick[];
      unavailable: Array<{ pick: TicketPick; reason: string }>;
    }
  | { ok: false; code: AdapterErrorCode; error: string };

export type EncodeOptions = {
  country?: string;
  fallback?: "strict" | "drop-unavailable";
};

export interface BookmakerAdapter {
  readonly id: BookmakerId;
  readonly displayName: string;
  readonly capabilities: {
    decode: boolean;
    encode: boolean;
    refresh: boolean;
  };
  readonly integration: "native" | "betrelay";
  readonly termsRisk: "native-existing" | "restricted-direct-automation";
  decode(code: string, country?: string): Promise<DecodeResult>;
  encode(ticket: Ticket, options?: EncodeOptions): Promise<EncodeResult>;
  refresh?(ticket: Ticket): Promise<RefreshResult>;
}

function failure(error: unknown): { code: AdapterErrorCode; error: string } {
  if (error instanceof BookmakerProviderError) {
    return { code: error.code, error: error.message };
  }
  return {
    code: "provider_unavailable",
    error: error instanceof Error ? error.message : "Bookmaker provider failed.",
  };
}

export const sportyBetAdapter: BookmakerAdapter = {
  id: "sportybet",
  displayName: "SportyBet",
  capabilities: { decode: true, encode: true, refresh: true },
  integration: "native",
  termsRisk: "native-existing",

  async decode(code, country = "ng") {
    const loaded = await loadBookingCode(code, country);
    if ("error" in loaded) {
      return { ok: false, code: "invalid_code", error: loaded.error };
    }
    return {
      ok: true,
      ticket: normalizeTicket({
        sourceBookmaker: "sportybet",
        sourceCode: loaded.shareCode,
        picks: loaded.picks,
        createdAt: Date.now(),
        country,
        currency: country === "ng" ? "NGN" : undefined,
      }),
    };
  },

  async refresh(ticket) {
    const refreshed = await refreshSelections(ticket.picks);
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
    return {
      ok: true,
      available: refreshed.available.map(normalizePick),
      unavailable: refreshed.unavailable,
    };
  },

  async encode(ticket, options = {}) {
    const refreshed = await refreshSelections(ticket.picks);
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
        error: `${refreshed.unavailable.length} selection(s) are no longer available on SportyBet.`,
      };
    }
    const selections = sportyOf(refreshed.available);
    if (!selections.length || selections.length !== refreshed.available.length) {
      return {
        ok: false,
        code: "encoding_unsupported",
        error: "One or more selections do not have SportyBet booking identifiers.",
      };
    }
    const minted = await mintShare(selections, options.country ?? ticket.country ?? "ng");
    if ("error" in minted) {
      return { ok: false, code: "provider_rejected", error: minted.error };
    }
    return {
      ok: true,
      code: minted.shareCode,
      url: minted.shareURL,
      ticket: normalizeTicket({
        ...ticket,
        sourceBookmaker: "sportybet",
        sourceCode: minted.shareCode,
        picks: refreshed.available,
      }),
      warnings: [],
    };
  },
};

function relayAdapter(id: Exclude<BookmakerId, "sportybet">, displayName: string): BookmakerAdapter {
  return {
    id,
    displayName,
    capabilities: { decode: true, encode: true, refresh: false },
    integration: "betrelay",
    termsRisk: "restricted-direct-automation",

    async decode(code, country = "ng") {
      try {
        // Direct automated extraction against these bookmakers is intentionally
        // avoided. BetRelay performs the authorized cross-bookmaker conversion,
        // then SlipCut decodes the resulting SportyBet ticket with its existing path.
        const converted = await convertRelayCode({
          code,
          from: id,
          to: "sportybet",
          country,
        });
        const loaded = await loadBookingCode(converted.code, country);
        if ("error" in loaded) {
          return {
            ok: false,
            code: "provider_rejected",
            error: "The converted ticket could not be decoded.",
          };
        }
        return {
          ok: true,
          ticket: normalizeTicket({
            sourceBookmaker: id,
            sourceCode: code,
            picks: loaded.picks,
            createdAt: Date.now(),
            country,
            currency: country === "ng" ? "NGN" : undefined,
            warnings: converted.warnings,
          }),
        };
      } catch (error) {
        return { ok: false, ...failure(error) };
      }
    },

    async encode(ticket, options = {}) {
      const fallback = options.fallback ?? "drop-unavailable";
      const mapped: Array<{ source: TicketPick; relay: NonNullable<ReturnType<typeof toRelayBookPick>> }> = [];
      const unsupported: TicketPick[] = [];
      for (const source of ticket.picks) {
        const relay = toRelayBookPick(source);
        if (relay) mapped.push({ source, relay });
        else unsupported.push(source);
      }
      if (unsupported.length && fallback === "strict") {
        return {
          ok: false,
          code: "encoding_unsupported",
          error: `${unsupported.length} selection(s) use a market that cannot be converted safely.`,
        };
      }
      if (!mapped.length) {
        return {
          ok: false,
          code: "encoding_unsupported",
          error: "None of the selected markets can be converted safely.",
        };
      }
      if (
        fallback === "drop-unavailable" &&
        (mapped.length < 2 && ticket.picks.length > 1 || mapped.length / ticket.picks.length < 0.75)
      ) {
        return {
          ok: false,
          code: "encoding_unsupported",
          error: "Too many legs would be lost during conversion.",
        };
      }
      try {
        const booked = await bookRelayPicks({
          picks: mapped.map((row) => row.relay),
          bookmakers: [id],
        });
        const hit = booked.codes[id];
        if (!hit?.code) {
          return {
            ok: false,
            code: "provider_rejected",
            error: `${displayName} did not return a booking code.`,
          };
        }
        const warnings = [
          ...booked.warnings,
          ...(unsupported.length
            ? [`${unsupported.length} unsupported selection(s) were dropped before conversion.`]
            : []),
        ];
        return {
          ok: true,
          code: hit.code,
          url: hit.share_url ?? hit.shareURL ?? hit.url,
          ticket: normalizeTicket({
            ...ticket,
            sourceBookmaker: id,
            sourceCode: hit.code,
            picks: mapped.map((row) => row.source),
            warnings: [...(ticket.warnings ?? []), ...warnings],
          }),
          warnings,
        };
      } catch (error) {
        return { ok: false, ...failure(error) };
      }
    },
  };
}

export const bet9jaAdapter = relayAdapter("bet9ja", "Bet9ja");
export const oneXBetAdapter = relayAdapter("1xbet", "1XBet");

const REGISTRY: Record<BookmakerId, BookmakerAdapter> = {
  sportybet: sportyBetAdapter,
  bet9ja: bet9jaAdapter,
  "1xbet": oneXBetAdapter,
};

export function getBookmakerAdapter(id: BookmakerId): BookmakerAdapter {
  return REGISTRY[id];
}

export function isBookmakerId(value: unknown): value is BookmakerId {
  return value === "sportybet" || value === "bet9ja" || value === "1xbet";
}

export function bookmakerAdapters() {
  return Object.values(REGISTRY);
}
