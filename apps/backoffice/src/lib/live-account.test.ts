import { describe, expect, it } from "vitest";
import { applyLiveAccountState } from "./live-account";

const s = { id: "u1", name: "Aina", role: "MANAGER", outletId: "o1" };

describe("applyLiveAccountState", () => {
  it("keeps an active account as it is", () => {
    expect(applyLiveAccountState(s, { role: "MANAGER", active: true })).toEqual(s);
  });
  it("drops a deleted or deactivated account", () => {
    expect(applyLiveAccountState(s, null)).toBeNull();
    expect(applyLiveAccountState(s, { role: "MANAGER", active: false })).toBeNull();
  });
  it("uses the role on the row now, so a demoted manager loses manager routes", () => {
    expect(applyLiveAccountState(s, { role: "STAFF", active: true })?.role).toBe("STAFF");
    expect(applyLiveAccountState(s, { role: "ADMIN", active: true })?.role).toBe("ADMIN");
  });
  it("keeps the token's role when the database could not be read (empty role)", () => {
    expect(applyLiveAccountState(s, { role: "", active: true })?.role).toBe("MANAGER");
  });
});
