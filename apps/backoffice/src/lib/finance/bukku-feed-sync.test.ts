import { describe, it, expect } from "vitest";
import { chooseFeedAnchor, feedProblems, type FeedSyncAccountResult } from "./bukku-feed-sync";

// Conezion (2644) feed months as stored in prod on 2026-10-30; PDF anchor 31 May.
const PDF = { periodEnd: "2026-05-31", closing: 20000 };
const CONEZION_FEED = [
  { periodStart: "2026-06-01", periodEnd: "2026-06-30", closing: 17816.94 },
  { periodStart: "2026-07-01", periodEnd: "2026-07-31", closing: 5328.7 },
  { periodStart: "2026-08-01", periodEnd: "2026-08-31", closing: 6971.1 },
  { periodStart: "2026-09-01", periodEnd: "2026-09-09", closing: 4597.61 },
];

describe("chooseFeedAnchor — resume instead of rebuilding since the PDF", () => {
  it("resumes from the last complete month before the overlap window", () => {
    // Every run rebuilt Jun→now in one transaction and blew its 120s limit.
    expect(chooseFeedAnchor(PDF, CONEZION_FEED)).toEqual({ anchorYmd: "2026-08-31", anchorBal: 6971.1, source: "feed" });
  });

  it("steps back a month when the latest line sits inside the overlap", () => {
    const feeds = [...CONEZION_FEED.slice(0, 3), { periodStart: "2026-09-01", periodEnd: "2026-09-04", closing: 1 }];
    expect(chooseFeedAnchor(PDF, feeds).anchorYmd).toBe("2026-07-31");
  });

  it("re-anchors on the PDF when there are no feed months or a newer PDF arrives", () => {
    expect(chooseFeedAnchor(PDF, [])).toEqual({ anchorYmd: "2026-05-31", anchorBal: 20000, source: "pdf" });
    expect(chooseFeedAnchor({ periodEnd: "2026-08-31", closing: 7000 }, CONEZION_FEED).source).toBe("pdf");
    // Only the PDF's own month has feed lines → nothing earlier to resume from.
    expect(chooseFeedAnchor(PDF, [CONEZION_FEED[0]]).source).toBe("pdf");
  });
});

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
      acct({ accountName: null, skipped: "time budget exhausted — retried next run" }),
    ], "2026-10-30");
    expect(p.map((x) => x.problem)).toEqual([
      "sync error: Bukku /bank_feeds/1 → HTTP 429",
      "feed error: HTTP 401",
      "time budget exhausted — retried next run",
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
