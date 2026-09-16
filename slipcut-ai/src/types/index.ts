import { z } from "zod";

export type Sport = "football" | "basketball";
export type RiskMode = "conservative" | "balanced" | "aggressive";
export type RiskLevel = "lower" | "medium" | "higher";

export const IntentSchema = z.object({
  action: z
    .enum([
      "cook",
      "analyze_code",
      "analyze_screenshot",
      "explore_markets",
      "edit_slip",
      "split_slip",
      "book",
      "help",
      "today",
      "unknown",
    ])
    .default("unknown"),
  sport: z.enum(["football", "basketball"]).optional(),
  gameCount: z.number().int().positive().optional(),
  gameCountMin: z.number().int().positive().optional(),
  gameCountMax: z.number().int().positive().optional(),
  targetOdds: z.number().positive().optional(),
  minOdds: z.number().positive().optional(),
  maxOdds: z.number().positive().optional(),
  minimumConfidence: z.number().min(0).max(100).optional(),
  league: z.string().optional(),
  dateHint: z.enum(["today", "soon", "weekend", "any"]).optional(),
  marketPreference: z.string().optional(),
  riskMode: z.enum(["conservative", "balanced", "aggressive"]).optional(),
  bookingCode: z.string().optional(),
  fixtureQuery: z.string().optional(),
  editOp: z
    .enum([
      "remove_weakest",
      "remove_below_confidence",
      "replace_weakest",
      "change_to_goals",
      "keep_sport",
      "trim_to_odds",
      "none",
    ])
    .optional(),
  splitParts: z.number().int().min(2).max(6).optional(),
  removeCount: z.number().int().positive().optional(),
  raw: z.string().optional(),
});

export type Intent = z.infer<typeof IntentSchema>;

export type NormalizedMarket = {
  providerMarketId: string;
  providerSelectionId: string;
  eventId: string;
  sport: Sport;
  category: string;
  marketName: string;
  selectionName: string;
  odds: number;
  line?: string;
  specifier?: string;
  status: "open" | "suspended" | "unknown";
  home: string;
  away: string;
  league?: string;
  kickoff?: number;
};

export type AnalyzedSelection = NormalizedMarket & {
  modelProbability: number;
  confidenceScore: number;
  dataQuality: "high" | "medium" | "low";
  riskLevel: RiskLevel;
  reasoning: string;
  impliedProbability: number;
};

export type SlipLeg = AnalyzedSelection;

export type BuiltSlip = {
  legs: SlipLeg[];
  combinedOdds: number;
  averageConfidence: number;
  sport?: Sport;
  targetOdds?: number;
  riskMode: RiskMode;
};
