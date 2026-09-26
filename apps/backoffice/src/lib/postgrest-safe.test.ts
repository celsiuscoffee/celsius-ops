import { describe, expect, it } from "vitest";
import { isSafeFilterIdent, sanitizeIlikeTerm } from "./postgrest-safe";

describe("postgrest-safe", () => {
  it("strips PostgREST grammar from ilike terms", () => {
    expect(sanitizeIlikeTerm("x,id.not.is.null")).toBe("xid.not.is.null");
    expect(sanitizeIlikeTerm("  ali (test) \"q\" ")).toBe("ali test q");
    expect(sanitizeIlikeTerm("a".repeat(100)).length).toBe(64);
    expect(sanitizeIlikeTerm(null)).toBe("");
  });
  it("accepts only id-shaped filter values", () => {
    expect(isSafeFilterIdent("clx8a1b2c3d4")).toBe(true);
    expect(isSafeFilterIdent("6f1e4c2a-0b3d-4e5f-8a9b-0c1d2e3f4a5b")).toBe(true);
    expect(isSafeFilterIdent("x,status.eq.ACTIVE")).toBe(false);
    expect(isSafeFilterIdent("")).toBe(false);
    expect(isSafeFilterIdent(undefined)).toBe(false);
  });
});
