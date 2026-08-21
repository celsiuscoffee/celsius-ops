import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_AFTER_LOGIN,
  isExpiredSessionResponse,
  loginRedirectUrl,
  requestPath,
  safeNextPath,
  __resetSessionExpiryForTests,
} from "./session-expiry";

const ORIGIN = "https://staff.celsiuscoffee.com";

beforeEach(() => __resetSessionExpiryForTests());

describe("requestPath", () => {
  it("resolves the shapes fetch() accepts", () => {
    expect(requestPath("/api/upload", ORIGIN)).toBe("/api/upload");
    expect(requestPath(`${ORIGIN}/api/upload?x=1`, ORIGIN)).toBe("/api/upload");
    expect(requestPath(new URL(`${ORIGIN}/api/auth/me`), ORIGIN)).toBe("/api/auth/me");
    expect(requestPath({ url: `${ORIGIN}/api/checklists` } as Request, ORIGIN)).toBe("/api/checklists");
  });

  it("ignores other origins — a 401 from Supabase or Sentry is not our session", () => {
    expect(requestPath("https://xyz.supabase.co/storage/v1/object", ORIGIN)).toBeNull();
    // Relative strings resolve against this origin, exactly as fetch() would —
    // they just never match /api/*.
    expect(requestPath("not a url at all", ORIGIN)).toBe("/not%20a%20url%20at%20all");
  });
});

describe("isExpiredSessionResponse", () => {
  it("fires on a 401 from any app API route", () => {
    expect(isExpiredSessionResponse("/api/upload", 401)).toBe(true);
    expect(isExpiredSessionResponse("/api/checklists/abc/items/def", 401)).toBe(true);
  });

  it("ignores non-401s and non-API paths", () => {
    expect(isExpiredSessionResponse("/api/upload", 200)).toBe(false);
    expect(isExpiredSessionResponse("/api/upload", 403)).toBe(false);
    expect(isExpiredSessionResponse("/api/upload", 413)).toBe(false);
    expect(isExpiredSessionResponse("/checklists", 401)).toBe(false);
    expect(isExpiredSessionResponse(null, 401)).toBe(false);
  });

  it("ignores the login endpoints — a wrong PIN is a 401 too, and bouncing there would loop", () => {
    expect(isExpiredSessionResponse("/api/auth/pin", 401)).toBe(false);
    expect(isExpiredSessionResponse("/api/auth/login", 401)).toBe(false);
    expect(isExpiredSessionResponse("/api/auth/pin-native", 401)).toBe(false);
    // Mistyping the current PIN on the profile page 401s too.
    expect(isExpiredSessionResponse("/api/auth/change-pin", 401)).toBe(false);
    // …but /api/auth/me IS a session check.
    expect(isExpiredSessionResponse("/api/auth/me", 401)).toBe(true);
  });
});

describe("safeNextPath", () => {
  it("keeps in-app paths, query included", () => {
    expect(safeNextPath("/checklists/abc123")).toBe("/checklists/abc123");
    expect(safeNextPath("/audit/xyz?tab=2")).toBe("/audit/xyz?tab=2");
  });

  it("refuses anything that could leave the app", () => {
    expect(safeNextPath("//evil.example.com")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath("https://evil.example.com")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath("checklists")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath(null)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath("")).toBe(DEFAULT_AFTER_LOGIN);
  });

  it("never sends the staffer back to /login", () => {
    expect(safeNextPath("/login")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath("/login?reason=expired")).toBe(DEFAULT_AFTER_LOGIN);
  });
});

describe("loginRedirectUrl", () => {
  it("carries the staffer back to the checklist they were working on", () => {
    const url = new URL(loginRedirectUrl("/checklists/abc123"), ORIGIN);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/checklists/abc123");
    expect(url.searchParams.get("reason")).toBe("expired");
  });

  it("omits a redundant next", () => {
    const url = new URL(loginRedirectUrl(DEFAULT_AFTER_LOGIN), ORIGIN);
    expect(url.searchParams.has("next")).toBe(false);
    expect(url.searchParams.get("reason")).toBe("expired");
  });
});
