import { describe, it, expect, vi } from "vitest";

// The sources only need their clients at call time; the access rule is pure.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/hr/supabase", () => ({ hrSupabaseAdmin: {} }));
vi.mock("@/lib/finance/supabase", () => ({ getFinanceClient: () => ({}) }));

import { INBOX_SOURCES, sourcesFor } from "./sources";
import type { UserProfile } from "@/lib/nav";

const keys = (u: UserProfile) => sourcesFor(u).map((s) => s.key);

describe("inbox sources follow the user's grants", () => {
  it("owners see every queue", () => {
    const owner: UserProfile = { id: "o", name: "O", role: "OWNER", outletId: null, moduleAccess: [] };
    expect(keys(owner)).toEqual(INBOX_SOURCES.map((s) => s.key));
  });

  it("a manager sees only the queues of pages they can open", () => {
    const mgr: UserProfile = { id: "m", name: "M", role: "MANAGER", outletId: "x", moduleAccess: ["inventory:invoices", "hr:leave"] };
    expect(keys(mgr).sort()).toEqual(["invoice-problems", "leave", "not-invoiced"]);
  });

  it("finance never shows to a manager, even with a finance grant set", () => {
    const mgr: UserProfile = { id: "m", name: "M", role: "MANAGER", outletId: "x", moduleAccess: ["finance:transactions"] };
    expect(keys(mgr)).not.toContain("finance-exceptions");
  });

  it("every source links to a page in the app and has a readable name", () => {
    for (const s of INBOX_SOURCES) {
      expect(s.moduleKey).toMatch(/^[a-z-]+:[a-z-]+$/);
      expect(s.label.length).toBeGreaterThan(3);
    }
  });
});
