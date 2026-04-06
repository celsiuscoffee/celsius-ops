import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../password";

describe("password hashing", () => {
  it("hashes and verifies a password", async () => {
    const hash = hashPassword("mypassword123");
    expect(hash).toContain(":");
    expect(await verifyPassword("mypassword123", hash)).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = hashPassword("correct");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("produces unique hashes for same password", () => {
    const h1 = hashPassword("same");
    const h2 = hashPassword("same");
    expect(h1).not.toBe(h2);
  });

  it("rejects malformed hash", async () => {
    expect(await verifyPassword("test", "nocolon")).toBe(false);
  });
});
