import { describe, it, expect, beforeAll } from "vitest";
import { createToken, verifyToken } from "../jwt";
import type { SessionUser } from "../types";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-for-vitest-minimum-length-32chars";
});

const mockUser: SessionUser = {
  id: "user-123",
  name: "Test User",
  role: "ADMIN",
  outletId: "outlet-456",
  outletName: "Test Outlet",
};

describe("JWT tokens", () => {
  it("creates and verifies a token", async () => {
    const token = await createToken(mockUser);
    expect(typeof token).toBe("string");

    const user = await verifyToken(token);
    expect(user).not.toBeNull();
    expect(user!.id).toBe("user-123");
    expect(user!.name).toBe("Test User");
    expect(user!.role).toBe("ADMIN");
    expect(user!.outletId).toBe("outlet-456");
  });

  it("returns null for invalid token", async () => {
    const user = await verifyToken("invalid.token.here");
    expect(user).toBeNull();
  });

  it("returns null for empty token", async () => {
    const user = await verifyToken("");
    expect(user).toBeNull();
  });
});
