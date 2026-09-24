import type { BookmakerId, Ticket, TicketPick } from "../types";
import { getBookmakerAdapter } from "./adapters";
import { matchTicket } from "./match";
import { normalizeTicket } from "./normalize";

export type ConversionFallback = "strict" | "drop-unavailable";

export type ConversionResult =
  | {
      ok: true;
      bookmaker: BookmakerId;
      code: string;
      url?: string;
      ticket: Ticket;
      warnings: string[];
      dropped: TicketPick[];
    }
  | {
      ok: false;
      code:
        | "invalid_code"
        | "provider_unavailable"
        | "provider_timeout"
        | "provider_rejected"
        | "selection_unavailable"
        | "encoding_unsupported";
      error: string;
    };

export function matchTicketToCatalog(
  ticket: Ticket,
  catalog: TicketPick[],
  fallback: ConversionFallback = "drop-unavailable",
): { ok: true; ticket: Ticket; dropped: TicketPick[]; warnings: string[] } | { ok: false; error: string } {
  const normalized = normalizeTicket(ticket);
  const result = matchTicket(normalized.picks, catalog);
  if (result.unmatched.length && fallback === "strict") {
    return {
      ok: false,
      error: `${result.unmatched.length} selection(s) could not be matched unambiguously.`,
    };
  }
  const matched = result.matched.map((row) => row.target);
  if (!matched.length) return { ok: false, error: "No selections could be matched." };
  if (
    fallback === "drop-unavailable" &&
    normalized.picks.length > 1 &&
    (matched.length < 2 || matched.length / normalized.picks.length < 0.75)
  ) {
    return { ok: false, error: "Too many selections would be lost during conversion." };
  }
  const dropped = result.unmatched.map((row) => row.source);
  return {
    ok: true,
    ticket: normalizeTicket({ ...normalized, picks: matched }),
    dropped,
    warnings: dropped.length
      ? [`${dropped.length} selection(s) were unavailable or ambiguous and were dropped.`]
      : [],
  };
}

export async function convertTicket(
  ticket: Ticket,
  target: BookmakerId,
  options: { country?: string; fallback?: ConversionFallback } = {},
): Promise<ConversionResult> {
  const normalized = normalizeTicket(ticket);
  const adapter = getBookmakerAdapter(target);
  const encoded = await adapter.encode(normalized, {
    country: options.country,
    fallback: options.fallback ?? "drop-unavailable",
  });
  if (!encoded.ok) return encoded;
  const bookedIds = new Set(encoded.ticket.picks.map((pick) => pick.id));
  const dropped = normalized.picks.filter((pick) => !bookedIds.has(pick.id));
  return {
    ok: true,
    bookmaker: target,
    code: encoded.code,
    url: encoded.url,
    ticket: encoded.ticket,
    warnings: encoded.warnings,
    dropped,
  };
}

export async function convertBookingCode(input: {
  code: string;
  from: BookmakerId;
  to: BookmakerId;
  country?: string;
  fallback?: ConversionFallback;
}): Promise<ConversionResult> {
  const source = getBookmakerAdapter(input.from);
  const decoded = await source.decode(input.code, input.country);
  if (!decoded.ok) return decoded;
  if (input.from === input.to) {
    return {
      ok: true,
      bookmaker: input.to,
      code: input.code,
      ticket: decoded.ticket,
      warnings: decoded.ticket.warnings ?? [],
      dropped: [],
    };
  }
  return convertTicket(decoded.ticket, input.to, {
    country: input.country,
    fallback: input.fallback,
  });
}
