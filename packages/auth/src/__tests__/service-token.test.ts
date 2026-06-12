import { describe, it, expect, beforeAll } from "vitest";
import { createServiceToken, verifyServiceToken } from "../service-token";
import { createToken } from "../jwt";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-for-vitest-minimum-length-32chars";
});

describe("service tokens", () => {
  it("signs and verifies for the matching scope", async () => {
    const token = await createServiceToken("order.confirm-maybank-qr");
    expect(await verifyServiceToken(token, "order.confirm-maybank-qr")).toBe(true);
  });

  it("rejects a different scope", async () => {
    const token = await createServiceToken("order.confirm-maybank-qr");
    expect(await verifyServiceToken(token, "order.refund")).toBe(false);
  });

  it("rejects an expired token", async () => {
    const token = await createServiceToken("order.confirm-maybank-qr", -1);
    expect(await verifyServiceToken(token, "order.confirm-maybank-qr")).toBe(false);
  });

  it("rejects garbage and empty strings", async () => {
    expect(await verifyServiceToken("not-a-jwt", "order.confirm-maybank-qr")).toBe(false);
    expect(await verifyServiceToken("", "order.confirm-maybank-qr")).toBe(false);
  });

  it("rejects a user session token (different audience)", async () => {
    const sessionToken = await createToken({
      id: "user-1",
      name: "Staff",
      role: "ADMIN",
      outletId: null,
      outletName: null,
    });
    expect(await verifyServiceToken(sessionToken, "order.confirm-maybank-qr")).toBe(false);
  });
});
