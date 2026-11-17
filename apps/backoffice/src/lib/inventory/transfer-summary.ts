// Stock › Transfers key numbers (restructure step 6, 17 Nov 2026), worked out
// from the transfer list the page already loads. Pure, so it is tested
// without the page. A transfer is stock that has left one shelf and not yet
// reached another, so the questions are: what is stuck, and for how long.

export type TransferRow = {
  status: string;
  createdAt: string;
  approvedAt?: string | null;
  receivedAt?: string | null;
  completedAt?: string | null;
  items: unknown[];
};

const DAY = 86_400_000;
const DONE = new Set(["RECEIVED", "COMPLETED"]);

export type TransferSummary = {
  /** waiting for a manager: submitted but not approved */
  approval: { count: number; oldestDays: number | null };
  /** left the source outlet, not yet received */
  transit: { count: number; oldestDays: number | null; late: number };
  /** received or completed in the last 30 days */
  moved: { count: number; lines: number };
  /** cancelled or rejected in the last 30 days, of all created then */
  cancelled: { count: number; of: number };
};

/** In transit longer than this is late: outlets are a short drive apart. */
export const LATE_DAYS = 2;

export function summariseTransfers(rows: TransferRow[], now: number): TransferSummary {
  const age = (iso: string | null | undefined) => (iso ? (now - Date.parse(iso)) / DAY : 0);
  const oldest = (xs: number[]) => (xs.length ? Math.floor(Math.max(...xs)) : null);

  const waiting = rows.filter((r) => r.status === "PENDING_APPROVAL");
  // In transit counts from approval (when stock left), falling back to creation.
  const transit = rows.filter((r) => r.status === "IN_TRANSIT" || r.status === "APPROVED");
  const transitAges = transit.map((r) => age(r.approvedAt ?? r.createdAt));

  const recent = rows.filter((r) => age(r.createdAt) < 30);
  const moved = rows.filter((r) => DONE.has(r.status) && age(r.receivedAt ?? r.completedAt ?? r.createdAt) < 30);

  return {
    approval: { count: waiting.length, oldestDays: oldest(waiting.map((r) => age(r.createdAt))) },
    transit: { count: transit.length, oldestDays: oldest(transitAges), late: transitAges.filter((a) => a > LATE_DAYS).length },
    moved: { count: moved.length, lines: moved.reduce((a, r) => a + r.items.length, 0) },
    cancelled: { count: recent.filter((r) => r.status === "CANCELLED").length, of: recent.length },
  };
}
