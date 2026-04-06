import { describe, it, expect } from "vitest";
import { hashPin, verifyPin } from "../pin";

describe("PIN hashing", () => {
  it("hashes and verifies a PIN", async () => {
    const hash = await hashPin("1234");
    expect(hash.startsWith("$2")).toBe(true);
    const result = await verifyPin("1234", hash);
    expect(result.match).toBe(true);
    expect(result.needsRehash).toBe(false);
  });

  it("rejects wrong PIN", async () => {
    const hash = await hashPin("1234");
    const result = await verifyPin("5678", hash);
    expect(result.match).toBe(false);
  });

  it("handles plaintext legacy PIN with rehash flag", async () => {
    const result = await verifyPin("1234", "1234");
    expect(result.match).toBe(true);
    expect(result.needsRehash).toBe(true);
  });

  it("handles null/empty stored PIN", async () => {
    expect((await verifyPin("1234", null)).match).toBe(false);
    expect((await verifyPin("1234", "")).match).toBe(false);
  });

  it("trims whitespace from PIN", async () => {
    const hash = await hashPin("1234");
    const result = await verifyPin(" 1234 ", hash);
    expect(result.match).toBe(true);
  });
});
