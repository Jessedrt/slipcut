import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearTelegramDraft,
  loadTelegramDraft,
  saveTelegramDraft,
  type TelegramDraftDependencies,
} from "./telegram-draft-store.ts";

function localDependencies(now: () => number): TelegramDraftDependencies {
  return {
    persistentAvailable: () => false,
    sql: async () => {
      throw new Error("database should not be used");
    },
    now,
  };
}

describe("Telegram draft storage", () => {
  it("keeps an unfinished draft and expires it", async () => {
    let clock = 1_000;
    const dependencies = localDependencies(() => clock);
    const chatId = "draft-expiry-test";
    await saveTelegramDraft(chatId, { sport: "football", mode: "odds" }, 500, dependencies);
    assert.deepEqual(await loadTelegramDraft(chatId, dependencies), {
      sport: "football",
      mode: "odds",
    });
    clock = 1_501;
    assert.deepEqual(await loadTelegramDraft(chatId, dependencies), {});
  });

  it("clears a completed conversation so it cannot repeat", async () => {
    const dependencies = localDependencies(() => 5_000);
    const chatId = "draft-clear-test";
    await saveTelegramDraft(
      chatId,
      { sport: "basketball", mode: "games", games: 5 },
      5_000,
      dependencies,
    );
    await clearTelegramDraft(chatId, dependencies);
    assert.deepEqual(await loadTelegramDraft(chatId, dependencies), {});
  });

  it("continues with memory fallback when persistent storage fails", async () => {
    const dependencies: TelegramDraftDependencies = {
      persistentAvailable: () => true,
      sql: async () => {
        throw new Error("offline");
      },
      now: () => 10_000,
    };
    const chatId = "draft-db-failure-test";
    await saveTelegramDraft(
      chatId,
      { sport: "football", mode: "games", games: 3 },
      5_000,
      dependencies,
    );
    assert.equal((await loadTelegramDraft(chatId, dependencies)).games, 3);
  });
});
