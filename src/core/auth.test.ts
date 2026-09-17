/* Unit tests for OAuth token handling and gws auth extraction. */

import { beforeEach, describe, expect, test } from "bun:test";
import { type GwsCredentials, refreshAccessToken, resetTokenCache } from "./auth.ts";

describe("OAuth token provider", () => {
  beforeEach(() => {
    resetTokenCache();
  });

  test("refreshAccessToken throws descriptive error on invalid credentials", async () => {
    const badCreds: GwsCredentials = {
      client_id: "invalid-client-id",
      client_secret: "invalid-secret",
      refresh_token: "invalid-token",
    };

    await expect(refreshAccessToken(badCreds)).rejects.toThrow(/Google OAuth token refresh failed/);
  });
});
