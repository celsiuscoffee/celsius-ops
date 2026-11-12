// One decision waiting on a person. The Inbox (/inbox), the "Needs you" panel on
// Today and the rail count all read this shape from GET /api/inbox.
//
// v1 is read-only: each card says what is waiting and why, and "Open" goes to the
// page where it is decided today, so no approval logic is copied and payroll /
// payment approvals keep their own checks (CLAUDE.md hard rule 6).

export type InboxArea = "Procurement" | "HR" | "Finance" | "Customers" | "Stock" | "Agents" | "Ops";

// When the decision is needed (Gosamē UI Inbox grouping).
export type InboxWhen = "now" | "today" | "week" | "later";

export type InboxItem = {
  id: string;            // stable: `${source}:${recordId}`
  source: string;        // e.g. "leave", "pay-claim"
  area: InboxArea;
  when: InboxWhen;
  title: string;         // what is waiting, one line ("Leave request: Mira, 2 days")
  from: string;          // who or what it comes from ("HR · Shah Alam", "Procurement agent")
  why?: string[];        // evidence lines for the open card
  amountRM?: number;
  at?: string;           // ISO time it arrived or is due
  href: string;          // page where it is decided today
  hrefLabel: string;     // "Open leave requests"
};

export type InboxResponse = {
  items: InboxItem[];
  counts: { total: number; now: number };
  // Sources that failed to load, so the page can say the list may be short
  // instead of silently showing fewer items.
  unavailable: string[];
};

export const WHEN_ORDER: InboxWhen[] = ["now", "today", "week", "later"];
export const WHEN_LABEL: Record<InboxWhen, string> = {
  now: "Act now",
  today: "Today",
  week: "This week",
  later: "Later",
};

// Sort: by when (Act now first), then by ringgit at stake, then oldest first.
export function sortInbox(items: InboxItem[]): InboxItem[] {
  const w = (i: InboxItem) => WHEN_ORDER.indexOf(i.when);
  return [...items].sort(
    (a, b) =>
      w(a) - w(b) ||
      (b.amountRM ?? 0) - (a.amountRM ?? 0) ||
      (a.at ?? "").localeCompare(b.at ?? ""),
  );
}
