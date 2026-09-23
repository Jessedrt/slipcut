import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { verifyTelegramInitData } from "./telegram-miniapp-auth.ts";

function signedData(token: string, now: number) {
  const params = new URLSearchParams({ auth_date: String(now), query_id: "query-1", user: JSON.stringify({ id: 123, first_name: "Jesse" }) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

describe("Telegram Mini App authentication", () => {
  it("verifies signed initData and takes identity from Telegram", () => {
    const now = 1_800_000_000;
    const result = verifyTelegramInitData(signedData("123:token", now), "123:token", { nowSeconds: now });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.auth.user.id, 123);
  });
  it("rejects tampering and expired sessions", () => {
    const now = 1_800_000_000;
    assert.equal(verifyTelegramInitData(signedData("123:token", now).replace("Jesse", "James"), "123:token", { nowSeconds: now }).ok, false);
    const expired = verifyTelegramInitData(signedData("123:token", now - 90_000), "123:token", { nowSeconds: now });
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.code, "auth_expired");
  });
});
