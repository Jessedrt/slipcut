export type SportKind = "football" | "basketball" | "other";

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

export const DEFAULT_THRESHOLD = 58;
export const MIN_THRESHOLD = 40;
export const MAX_THRESHOLD = 80;
