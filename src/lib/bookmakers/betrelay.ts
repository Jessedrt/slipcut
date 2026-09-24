import type { BookmakerId } from "../types";
import type { RelayBookPick } from "./normalize";

const DEFAULT_BASE = "https://betrelay.com.ng/api/v1";

export class BookmakerProviderError extends Error {
  readonly code:
    | "provider_unavailable"
    | "provider_timeout"
    | "provider_rejected"
    | "invalid_code"
    | "selection_unavailable"
    | "encoding_unsupported";
  readonly retryable: boolean;

  constructor(
    code: BookmakerProviderError["code"],
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "BookmakerProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

function apiKey() {
  return process.env.BETRELAY_API_KEY?.trim() ?? "";
}

function baseUrl() {
  return (process.env.BETRELAY_API_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, "");
}

export function betRelayReady() {
  return Boolean(apiKey());
}

async function relayRequest<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T> {
  const key = apiKey();
  if (!key) {
    throw new BookmakerProviderError(
      "provider_unavailable",
      "Multi-bookmaker provider is not configured.",
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-API-Key": key,
        ...(init.headers ?? {}),
      },
    });
    const raw = await response.text();
    let payload: unknown = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = raw;
    }
    if (!response.ok) {
      const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      const message =
        String(rec.message ?? rec.error ?? "").trim() ||
        `Multi-bookmaker provider rejected the request (HTTP ${response.status}).`;
      if (response.status === 404 || /invalid|not found|expired|booking code/i.test(message)) {
        throw new BookmakerProviderError("invalid_code", message);
      }
      throw new BookmakerProviderError(
        "provider_rejected",
        message,
        response.status === 429 || response.status >= 500,
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof BookmakerProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new BookmakerProviderError(
        "provider_timeout",
        "Multi-bookmaker provider timed out.",
        true,
      );
    }
    throw new BookmakerProviderError(
      "provider_unavailable",
      "Multi-bookmaker provider could not be reached.",
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

type RelayCode = {
  code?: string;
  share_url?: string;
  shareURL?: string;
  url?: string;
};

function unwrapRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  const root = payload as Record<string, unknown>;
  const data = root.data;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : root;
}

function firstCode(payload: unknown, target?: BookmakerId): RelayCode | null {
  const data = unwrapRecord(payload);
  const direct =
    typeof data.code === "string"
      ? {
          code: data.code,
          share_url:
            typeof data.share_url === "string"
              ? data.share_url
              : typeof data.shareURL === "string"
                ? data.shareURL
                : undefined,
        }
      : null;
  if (direct) return direct;

  const codes = data.codes;
  if (!codes || typeof codes !== "object") return null;
  const record = codes as Record<string, unknown>;
  const keys = target
    ? [
        target,
        `${target}_ng`,
        target === "1xbet" ? "1xbet_ng" : "",
        target === "sportybet" ? "sportybet_ng" : "",
        target === "bet9ja" ? "bet9ja_ng" : "",
      ].filter(Boolean)
    : Object.keys(record);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return { code: value };
    if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      if (typeof row.code === "string") {
        return {
          code: row.code,
          share_url:
            typeof row.share_url === "string"
              ? row.share_url
              : typeof row.shareURL === "string"
                ? row.shareURL
                : typeof row.url === "string"
                  ? row.url
                  : undefined,
        };
      }
    }
  }
  return null;
}

export type RelayConversion = {
  code: string;
  url?: string;
  warnings: string[];
  raw: unknown;
};

export async function convertRelayCode(input: {
  code: string;
  from: BookmakerId;
  to: BookmakerId;
  country?: string;
}): Promise<RelayConversion> {
  const raw = await relayRequest<unknown>("/convert", {
    method: "POST",
    body: JSON.stringify({
      code: input.code,
      from: input.from,
      to: input.to,
      country: input.country ?? "ng",
    }),
  });
  const hit = firstCode(raw, input.to);
  if (!hit?.code) {
    throw new BookmakerProviderError(
      "provider_rejected",
      "Multi-bookmaker conversion returned no booking code.",
    );
  }
  const data = unwrapRecord(raw);
  const warnings = [
    ...(Array.isArray(data.warnings)
      ? data.warnings.filter((v): v is string => typeof v === "string")
      : []),
    ...(typeof data.note === "string" ? [data.note] : []),
  ];
  return {
    code: hit.code,
    url: hit.share_url ?? hit.shareURL ?? hit.url,
    warnings,
    raw,
  };
}

const RELAY_BOOKMAKER: Record<BookmakerId, string> = {
  sportybet: "sportybet_ng",
  bet9ja: "bet9ja_ng",
  "1xbet": "1xbet_ng",
};

export async function bookRelayPicks(input: {
  picks: RelayBookPick[];
  bookmakers: BookmakerId[];
}): Promise<{
  codes: Partial<Record<BookmakerId, RelayCode>>;
  warnings: string[];
  raw: unknown;
}> {
  if (!input.picks.length) {
    throw new BookmakerProviderError("encoding_unsupported", "No supported selections to book.");
  }
  const raw = await relayRequest<unknown>("/book", {
    method: "POST",
    body: JSON.stringify({
      picks: input.picks,
      bookmakers: input.bookmakers.map((bookmaker) => RELAY_BOOKMAKER[bookmaker]),
    }),
  }, 20_000);

  const codes: Partial<Record<BookmakerId, RelayCode>> = {};
  for (const bookmaker of input.bookmakers) {
    const hit = firstCode(raw, bookmaker);
    if (hit?.code) codes[bookmaker] = hit;
  }
  const data = unwrapRecord(raw);
  const warnings = [
    ...(Array.isArray(data.warnings)
      ? data.warnings.filter((v): v is string => typeof v === "string")
      : []),
    ...(typeof data.note === "string" ? [data.note] : []),
  ];
  return { codes, warnings, raw };
}

export type RelayEvent = {
  eventId?: string;
  home: string;
  away: string;
  kickoff?: number;
  competition?: string;
  raw: unknown;
};

function parseKickoff(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 20_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 20_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export async function searchRelayEvents(query: string): Promise<RelayEvent[]> {
  const raw = await relayRequest<unknown>(
    `/odds/search?q=${encodeURIComponent(query)}`,
    { method: "GET", headers: { "Content-Type": "application/json" } },
  );
  const data = unwrapRecord(raw);
  const rows = Array.isArray(data.events)
    ? data.events
    : Array.isArray(data.results)
      ? data.results
      : Array.isArray(data.data)
        ? data.data
        : Array.isArray(raw)
          ? raw
          : [];
  return rows.flatMap((value): RelayEvent[] => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const home = String(row.home ?? row.home_team ?? row.homeTeam ?? "").trim();
    const away = String(row.away ?? row.away_team ?? row.awayTeam ?? "").trim();
    if (!home || !away) return [];
    return [{
      eventId: String(row.event_id ?? row.eventId ?? row.id ?? "").trim() || undefined,
      home,
      away,
      kickoff: parseKickoff(row.kickoff ?? row.start_time ?? row.startTime),
      competition: String(row.competition ?? row.league ?? "").trim() || undefined,
      raw: value,
    }];
  });
}

export async function relayOdds(input: {
  home: string;
  away: string;
  competition?: string;
}): Promise<unknown> {
  const params = new URLSearchParams({ home: input.home, away: input.away });
  if (input.competition) params.set("competition", input.competition);
  return relayRequest<unknown>(`/odds?${params.toString()}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
}
