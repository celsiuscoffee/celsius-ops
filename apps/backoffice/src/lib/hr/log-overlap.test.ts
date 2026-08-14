import { describe, it, expect } from "vitest";
import { clipOverlappingLogs } from "./log-overlap";

const span = (clockIn: string, clockOut: string, final_status: string | null = null) => ({
  clock_in: clockIn,
  clock_out: clockOut,
  final_status,
});

describe("clipOverlappingLogs", () => {
  it("leaves a single log untouched", () => {
    const [a] = clipOverlappingLogs([span("2026-08-04T07:30:00Z", "2026-08-04T15:30:00Z")]);
    expect(a.clockIn.toISOString()).toBe("2026-08-04T07:30:00.000Z");
    expect(a.clockOut.toISOString()).toBe("2026-08-04T15:30:00.000Z");
    expect(a.trimmedMinutes).toBe(0);
  });

  it("leaves genuine split shifts untouched", () => {
    const out = clipOverlappingLogs([
      span("2026-08-04T07:30:00Z", "2026-08-04T11:30:00Z"),
      span("2026-08-04T17:00:00Z", "2026-08-04T21:00:00Z"),
    ]);
    expect(out.every((l) => l.trimmedMinutes === 0)).toBe(true);
  });

  // Iffa 2026-07-02: tap log 07:26–15:39, manual round-time log 07:39–15:39
  // added beside it — 480 min of overlap that would have paid twice.
  it("zeroes a full duplicate: the later claim clips to nothing", () => {
    const out = clipOverlappingLogs([
      span("2026-07-01T23:26:19Z", "2026-07-02T07:39:32Z"),
      span("2026-07-01T23:39:00Z", "2026-07-02T07:39:00Z"),
    ]);
    const dup = out[1];
    expect(out[0].trimmedMinutes).toBe(0);
    expect(dup.clockOut.getTime()).toBe(dup.clockIn.getTime()); // zero-length → pays 0, needs sign-off
    expect(dup.trimmedMinutes).toBe(480);
  });

  // Aina 2026-07-02: tap log 09:56–18:03 (approved) + manual log 10:03–18:03
  // (adjusted). The manager's version claims first; the tap log keeps only the
  // 7 minutes before it — which brackets to zero pay instead of doubling.
  it("a manager-adjusted log claims first even when it starts later", () => {
    const out = clipOverlappingLogs([
      span("2026-07-02T01:56:19Z", "2026-07-02T10:03:40Z", "approved"),
      span("2026-07-02T02:03:00Z", "2026-07-02T10:03:00Z", "adjusted"),
    ]);
    const adjusted = out.find((l) => l.log.final_status === "adjusted")!;
    const tap = out.find((l) => l.log.final_status === "approved")!;
    expect(adjusted.trimmedMinutes).toBe(0);
    expect(tap.clockIn.toISOString()).toBe("2026-07-02T01:56:19.000Z");
    expect(tap.clockOut.toISOString()).toBe("2026-07-02T02:03:00.000Z"); // capped at the claim's start
    expect(tap.trimmedMinutes).toBeGreaterThan(470);
  });

  // Adjusted-first must NOT break chronology for non-overlapping shifts: an
  // adjusted evening shift claiming first must not clip the morning tap log.
  it("an adjusted evening shift does not clip a non-overlapping morning shift", () => {
    const out = clipOverlappingLogs([
      span("2026-08-04T07:30:00Z", "2026-08-04T15:30:00Z"),
      span("2026-08-04T15:30:00Z", "2026-08-04T23:30:00Z", "adjusted"),
    ]);
    expect(out[0].clockIn.toISOString()).toBe("2026-08-04T07:30:00.000Z");
    expect(out.every((l) => l.trimmedMinutes === 0)).toBe(true);
  });

  it("device-retry identical duplicates: second pays nothing", () => {
    const out = clipOverlappingLogs([
      span("2026-08-04T07:30:00Z", "2026-08-04T15:30:00Z"),
      span("2026-08-04T07:30:00Z", "2026-08-04T15:30:00Z"),
    ]);
    expect(out[0].trimmedMinutes).toBe(0);
    expect(out[1].clockOut.getTime()).toBe(out[1].clockIn.getTime());
    expect(out[1].trimmedMinutes).toBe(480);
  });

  it("partial overlap trims only the overlapped minutes", () => {
    // 07:30–15:30 then 15:00–19:00 — the second log keeps 15:30–19:00.
    const out = clipOverlappingLogs([
      span("2026-08-04T07:30:00Z", "2026-08-04T15:30:00Z"),
      span("2026-08-04T15:00:00Z", "2026-08-04T19:00:00Z"),
    ]);
    expect(out[1].clockIn.toISOString()).toBe("2026-08-04T15:30:00.000Z");
    expect(out[1].trimmedMinutes).toBe(30);
  });

  it("returns effective spans in chronological order for deterministic OT budgeting", () => {
    const out = clipOverlappingLogs([
      span("2026-08-04T15:30:00Z", "2026-08-04T23:30:00Z", "adjusted"),
      span("2026-08-04T07:30:00Z", "2026-08-04T11:30:00Z"),
    ]);
    expect(out[0].clockIn.getTime()).toBeLessThan(out[1].clockIn.getTime());
  });
});
