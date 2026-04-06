import { describe, it, expect, beforeEach } from "vitest";
import { getJwtSecret, SESSION_MAX_AGE } from "../constants";

describe("constants", () => {
  beforeEach(() => {
    delete process.env.JWT_SECRET;
  });

  it("throws if JWT_SECRET is not set", () => {
    expect(() => getJwtSecret()).toThrow("JWT_SECRET environment variable is not set");
  });

  it("returns secret when JWT_SECRET is set", () => {
    process.env.JWT_SECRET = "my-test-secret";
    const secret = getJwtSecret();
    expect(secret).toBeInstanceOf(Uint8Array);
    expect(secret.length).toBeGreaterThan(0);
  });

  it("session max age is 12 hours", () => {
    expect(SESSION_MAX_AGE).toBe(60 * 60 * 12);
  });
});
