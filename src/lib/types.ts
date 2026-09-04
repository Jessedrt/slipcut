export type BookSport = "football" | "basketball" | "tennis";
export type SportKind = BookSport | "other";

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
  sporty?: SportySelection;
};

export type AnalyzedPick = TicketPick & {
  probability: number;
  confidence: "high" | "medium" | "low";
  summary: string;
  reasons: string[];
  risks: string[];
  verdict: "keep" | "drop" | "ignore";
  /**
   * Reasoning trail. `marketProb` is the book's price with the margin removed,
   * `modelProb` is what research alone said, and `probability` is the blend.
   * `edge` is probability − marketProb in percentage points; `ev` is the
   * expected return per 1 unit staked at the quoted price.
   */
  marketProb?: number | null;
  modelProb?: number | null;
  fairOdds?: number | null;
  edge?: number | null;
  ev?: number | null;
  engine?: string | null;
  agreement?: number | null;
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
