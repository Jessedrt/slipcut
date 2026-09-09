import { randomUUID } from "node:crypto";
import { getSql } from "./db";
import { eventScore, getEventDetail, marketFamily } from "./sportybet";
import type { TicketPick } from "./types";

export type LegResult = "won" | "lost" | "void" | "pending";

export type StudiedLeg = {
  home: string;
  away: string;
  market: string;
  selection: string;
  league: string;
  sport: string;
  family: string;
  result: LegResult;
  note: string;
};

export type StudyReport = {
  code: string;
  cut: boolean;
  hit: boolean;
  pending: number;
  won: number;
  lost: number;
  voided: number;
  legs: StudiedLeg[];
  lesson: string;
};

export type PendingReview = {
  token: string;
  chatId: string;
  title: string;
  picks: TicketPick[];
};

/** Save a proposed slip until the user explicitly chooses to book it. */
export async function savePendingReview(
  chatId: number,
  picks: TicketPick[],
  title: string,
): Promise<PendingReview | null> {
  const review: PendingReview = {
    token: randomUUID().replace(/-/g, "").slice(0, 12),
    chatId: String(chatId),
    title,
    picks,
  };
  try {
    const sql = await getSql();
    await sql`
      insert into pending_reviews (token, chat_id, title, picks_json)
      values (${review.token}, ${review.chatId}, ${review.title}, ${JSON.stringify(review.picks)})
    `;
    return review;
  } catch {
    return null;
  }
}

export async function loadPendingReview(
  token: string,
  chatId: number,
): Promise<PendingReview | null> {
  try {
    const sql = await getSql();
    const rows = await sql<{ token: string; chat_id: string; title: string; picks_json: string }>`
      select token, chat_id, title, picks_json
      from pending_reviews
      where token = ${token} and chat_id = ${String(chatId)}
      limit 1
    `;
    const row = rows[0];
    if (!row?.picks_json) return null;
    return {
      token: row.token,
      chatId: row.chat_id,
      title: row.title,
      picks: JSON.parse(row.picks_json) as TicketPick[],
    };
  } catch {
    return null;
  }
}

export async function updatePendingReview(review: PendingReview): Promise<void> {
  try {
    const sql = await getSql();
    await sql`
      update pending_reviews
      set picks_json = ${JSON.stringify(review.picks)}
      where token = ${review.token} and chat_id = ${review.chatId}
    `;
  } catch {
    /* leave review intact */
  }
}

export async function deletePendingReview(token: string, chatId: number): Promise<void> {
  try {
    const sql = await getSql();
    await sql`delete from pending_reviews where token = ${token} and chat_id = ${String(chatId)}`;
  } catch {
    /* ok */
  }
}

// REST of file continues below — this is incomplete if we only push this
