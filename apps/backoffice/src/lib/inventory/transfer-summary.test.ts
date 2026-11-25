import { describe, it, expect } from "vitest";
import { summariseTransfers, type TransferRow } from "./transfer-summary";

const NOW = Date.parse("2026-11-17T04:00:00Z");
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const row = (status: string, created: number, extra: Partial<TransferRow> = {}, lines = 1): TransferRow =>
  ({ status, createdAt: ago(created), items: Array(lines).fill(0), ...extra });

describe("summariseTransfers", () => {
  it("counts what is waiting for approval and how old the oldest is", () => {
    const s = summariseTransfers([row("PENDING_APPROVAL", 1), row("PENDING_APPROVAL", 4.5), row("DRAFT", 9)], NOW);
    expect(s.approval).toEqual({ count: 2, oldestDays: 4 });
  });

  it("ages in-transit stock from approval and flags it late after two days", () => {
    const s = summariseTransfers([
      row("IN_TRANSIT", 10, { approvedAt: ago(1) }),
      row("IN_TRANSIT", 5, { approvedAt: ago(3) }),
      row("APPROVED", 2.5),
    ], NOW);
    expect(s.transit).toEqual({ count: 3, oldestDays: 3, late: 2 });
  });

  it("counts transfers received in the last 30 days and cancellations among recent ones", () => {
    const s = summariseTransfers([
      row("RECEIVED", 5, { receivedAt: ago(4) }, 3),
      row("COMPLETED", 40, { completedAt: ago(10) }, 2),
      row("RECEIVED", 50, { receivedAt: ago(45) }),
      row("CANCELLED", 3),
      row("CANCELLED", 60),
    ], NOW);
    expect(s.moved).toEqual({ count: 2, lines: 5 });
    expect(s.cancelled).toEqual({ count: 1, of: 2 });
  });

  it("is empty-safe", () => {
    const s = summariseTransfers([], NOW);
    expect(s.approval.oldestDays).toBeNull();
    expect(s.transit.oldestDays).toBeNull();
  });
});
