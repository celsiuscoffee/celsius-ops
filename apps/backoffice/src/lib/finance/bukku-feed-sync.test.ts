import { describe, it, expect } from "vitest";
import { feedProblems, type FeedSyncAccountResult } from "./bukku-feed-sync";

const acct = (over: Partial<FeedSyncAccountResult>): FeedSyncAccountResult => ({
  subdomain: "celsiusconezion", accountTail: "2644",
  accountName: "CELSIUS COFFEE CONEZION SDN. BHD. (2644)",
  anchorDate: "2026-05-31", anchorBalance: 0, newLines: 0, latestDate: null,
  endingBalance: null, statements: 0, committed: false,
  ...over,
});

describe("feedProblems — bank feed escalation", () => {
  it("flags an account whose ledger stopped weeks ago even when nothing threw", () => {
    // The 2026-10 incident: Conezion silently 'already current' at Sep 9.
    const p = feedProblems([acct({ latestDate: "2026-09-09", skipped: "already current" })], "2026-10-30");
    expect(p).toEqual([{ account: "CELSIUS COFFEE CONEZION SDN. BHD. (2644)", problem: "stale: latest line 2026-09-09" }]);
  });

  it("flags per-account sync errors and company-level feed errors", () => {
    const p = feedProblems([
      acct({ accountName: null, skipped: "sync error: Bukku /bank_feeds/1 → HTTP 429" }),
      acct({ accountName: null, subdomain: "celsius", accountTail: "", skipped: "feed error: HTTP 401" }),
    ], "2026-10-30");
    expect(p.map((x) => x.problem)).toEqual([
      "sync error: Bukku /bank_feeds/1 → HTTP 429",
      "feed error: HTTP 401",
    ]);
    expect(p[0].account).toBe("celsiusconezion …2644");
  });

  it("stays quiet for a feed that is current or only a weekend behind", () => {
    expect(feedProblems([
      acct({ latestDate: "2026-10-29", newLines: 40 }),
      acct({ latestDate: "2026-10-27", skipped: "already current" }),
    ], "2026-10-30")).toEqual([]);
  });
});
