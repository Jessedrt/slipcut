import { getSql, persistentDatabaseAvailable, type Sql } from "./db";
import type { ChatBuildDraft } from "./intent";

export type TelegramDraftDependencies = {
  persistentAvailable: () => boolean;
  sql: () => Promise<Sql>;
  now: () => number;
};

const defaultDependencies: TelegramDraftDependencies = {
  persistentAvailable: persistentDatabaseAvailable,
  sql: getSql,
  now: Date.now,
};

const memory = new Map<string, { draft: ChatBuildDraft; expiresAt: number }>();

function safeDraft(value: unknown): ChatBuildDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const draft: ChatBuildDraft = {};
  if (input.sport === "football" || input.sport === "basketball") draft.sport = input.sport;
  if (input.mode === "games" || input.mode === "odds") draft.mode = input.mode;
  if (typeof input.games === "number" && Number.isFinite(input.games)) draft.games = input.games;
  if (typeof input.targetOdds === "number" && Number.isFinite(input.targetOdds))
    draft.targetOdds = input.targetOdds;
  if (input.risk === "conservative" || input.risk === "balanced" || input.risk === "aggressive")
    draft.risk = input.risk;
  if (
    input.window === "today" ||
    input.window === "tomorrow" ||
    input.window === "weekend" ||
    input.window === "upcoming"
  )
    draft.window = input.window;
  return draft;
}

export async function loadTelegramDraft(
  chatId: string,
  dependencies: TelegramDraftDependencies = defaultDependencies,
): Promise<ChatBuildDraft> {
  const fallback = memory.get(chatId);
  if (fallback && fallback.expiresAt > dependencies.now()) return fallback.draft;
  memory.delete(chatId);
  if (!dependencies.persistentAvailable()) return {};
  try {
    const sql = await dependencies.sql();
    const rows = await sql<{ draft_json: string }>`
      select draft_json
      from telegram_build_drafts
      where chat_id = ${chatId} and expires_at > now()
      limit 1
    `;
    if (!rows[0]) return {};
    const draft = safeDraft(JSON.parse(rows[0].draft_json));
    memory.set(chatId, { draft, expiresAt: dependencies.now() + 60_000 });
    return draft;
  } catch (error) {
    console.error(
      "[telegram.draft] read failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return {};
  }
}

export async function saveTelegramDraft(
  chatId: string,
  draft: ChatBuildDraft,
  ttlMs: number,
  dependencies: TelegramDraftDependencies = defaultDependencies,
): Promise<void> {
  const expiresAt = dependencies.now() + ttlMs;
  memory.set(chatId, { draft, expiresAt });
  if (!dependencies.persistentAvailable()) return;
  try {
    const sql = await dependencies.sql();
    await sql`
      insert into telegram_build_drafts (chat_id, draft_json, expires_at, updated_at)
      values (${chatId}, ${JSON.stringify(draft)}, ${new Date(expiresAt).toISOString()}, now())
      on conflict (chat_id) do update set
        draft_json = excluded.draft_json,
        expires_at = excluded.expires_at,
        updated_at = now()
    `;
  } catch (error) {
    console.error(
      "[telegram.draft] write failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

export async function clearTelegramDraft(
  chatId: string,
  dependencies: TelegramDraftDependencies = defaultDependencies,
): Promise<void> {
  memory.delete(chatId);
  if (!dependencies.persistentAvailable()) return;
  try {
    const sql = await dependencies.sql();
    await sql`delete from telegram_build_drafts where chat_id = ${chatId}`;
  } catch (error) {
    console.error(
      "[telegram.draft] clear failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}
