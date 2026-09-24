export type BookSport = "football" | "basketball" | "tennis" | "handball";
export type SportKind = BookSport | "other";

export type BookmakerId = "sportybet" | "bet9ja" | "1xbet";

export type NormalizedPeriod =
  | "match"
  | "first_half"
  | "second_half"
  | "first_set"
  | "second_set"
  | "q1"
  | "q2"
  | "q3"
  | "q4"
  | "other";

export type NormalizedMarketFamily =
  | "winner"
  | "double_chance"
  | "draw_no_bet"
  | "total"
  | "team_total"
  | "handicap"
  | "btts"
  | "odd_even"
  | "corners"
  | "other";

export type NormalizedMarket = {
  family: NormalizedMarketFamily;
  period: NormalizedPeriod;
  line?: number;
  scope?: "match" | "home" | "away";
  outcome: string;
};

export type BookmakerSelectionRef = {
  bookmaker: BookmakerId;
  eventId?: string;
  marketId?: string;
  outcomeId?: string;
  specifier?: string;
  native?: Record<string, string | number | boolean | null>;
};

export type SportySelection = {
  eventId: string;
  marketId: string;
  outcomeId: string;
  specifier?: string;
};

export type TicketPick = {
  id: string;
  sport: SportKind;
  league: string;
  country?: string;
  home: string;
  away: string;
  market: string;
  selection: string;
  odds?: number;
  kickoff?: number;

  // Neutral identity used when matching the same real-world selection
  // across bookmakers. These are additive so persisted legacy picks remain valid.
  normalizedHome?: string;
  normalizedAway?: string;
  normalizedLeague?: string;
  normalizedMarket?: NormalizedMarket;
  bookmakerRefs?: Partial<Record<BookmakerId, BookmakerSelectionRef>>;

  // Backwards-compatible SportyBet reference. New code also mirrors this into
  // bookmakerRefs.sportybet so existing callers can migrate incrementally.
  sporty?: SportySelection;

  probability?: number;
  confidence?: "high" | "medium" | "low";
  summary?: string;
  verdict?: "keep" | "drop" | "ignore";
};

export type Ticket = {
  sourceBookmaker?: BookmakerId;
  sourceCode?: string;
  picks: TicketPick[];
  createdAt?: number;
  country?: string;
  currency?: string;
  warnings?: string[];
};

export type AnalyzedPick = TicketPick & {
  probability: number;
  confidence: "high" | "medium" | "low";
  summary: string;
  reasons: string[];
  risks: string[];
  verdict: "keep" | "drop" | "ignore";
};

export type CutResult = {
  ok: true;
  shareCode?: string;
  desk: string;
  picks: AnalyzedPick[];
  threshold: number;
  kept: AnalyzedPick[];
  dropped: AnalyzedPick[];
  ignored: AnalyzedPick[];
  combinedKeepChance: number | null;
};

export type CutFailure = {
  ok: false;
  error: string;
};

export type CutResponse = CutResult | CutFailure;

export type InputMode = "code" | "text" | "image";

export const COUNTRIES = [
  { id: "ng", label: "Nigeria" },
  { id: "gh", label: "Ghana" },
  { id: "ke", label: "Kenya" },
  { id: "za", label: "South Africa" },
  { id: "tz", label: "Tanzania" },
  { id: "ug", label: "Uganda" },
  { id: "zm", label: "Zambia" },
  { id: "cm", label: "Cameroon" },
] as const;

export const DEFAULT_THRESHOLD = 45;
export const MIN_THRESHOLD = 40;
export const MAX_THRESHOLD = 80;
