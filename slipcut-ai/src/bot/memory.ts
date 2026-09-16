import type { BuiltSlip, Intent } from "../types/index.js";

export type UserSession = {
  telegramId: string;
  currentSlip?: BuiltSlip;
  lastIntent?: Intent;
  lastSport?: "football" | "basketball";
  lastFixtureQuery?: string;
  updatedAt: number;
};

const sessions = new Map<string, UserSession>();

export function getSession(telegramId: string): UserSession {
  let s = sessions.get(telegramId);
  if (!s) {
    s = { telegramId, updatedAt: Date.now() };
    sessions.set(telegramId, s);
  }
  return s;
}

export function saveSlip(telegramId: string, slip: BuiltSlip) {
  const s = getSession(telegramId);
  s.currentSlip = slip;
  s.updatedAt = Date.now();
}

export function clearSession(telegramId: string) {
  sessions.delete(telegramId);
}
