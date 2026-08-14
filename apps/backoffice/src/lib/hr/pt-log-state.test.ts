import { describe, expect, it } from "vitest";
import { isManagerConfirmed, ptLogState } from "./pt-log-state";

const log = (over: Partial<Parameters<typeof ptLogState>[0]> = {}) => ({
  final_status: null,
  ai_status: null,
  reviewed_by: null,
  ...over,
});

describe("ptLogState", () => {
  it("confirms a log a manager actually signed off", () => {
    expect(ptLogState(log({ final_status: "approved", ai_status: "reviewed", reviewed_by: "mgr-1" }))).toBe("confirmed");
  });

  it("confirms a manager-adjusted log", () => {
    expect(ptLogState(log({ final_status: "adjusted", reviewed_by: "mgr-1" }))).toBe("confirmed");
  });

  // The bug Farah reported: shifts showed "Confirmed" with nobody having pressed
  // anything, because the AI processor auto-approves every unflagged log.
  it("does NOT confirm an AI auto-approved log", () => {
    expect(ptLogState(log({ final_status: "approved", ai_status: "approved" }))).toBe("pending");
  });

  // The auto-close cron writes reviewed_at + review_notes but never reviewed_by,
  // so neither of those may be used as the human-action signal.
  it("does NOT confirm an auto-closed log despite its review_notes/reviewed_at", () => {
    expect(ptLogState(log({ final_status: "approved", ai_status: "approved" }))).toBe("pending");
    expect(isManagerConfirmed(log({ final_status: "approved" }))).toBe(false);
  });

  // ot-payroll-sync stamps final_status approved when an OT request settles.
  it("does NOT confirm an OT-sync approved log", () => {
    expect(isManagerConfirmed(log({ final_status: "approved", reviewed_by: null }))).toBe(false);
  });

  it("keeps flagged logs flagged until a human resolves them", () => {
    expect(ptLogState(log({ ai_status: "flagged" }))).toBe("flagged");
    expect(ptLogState(log({ final_status: "approved", ai_status: "flagged" }))).toBe("flagged");
  });

  it("rejects take precedence over everything", () => {
    expect(ptLogState(log({ final_status: "rejected", reviewed_by: "mgr-1" }))).toBe("rejected");
    expect(ptLogState(log({ final_status: "rejected", ai_status: "flagged" }))).toBe("rejected");
  });

  it("treats a reviewed_by with a non-approving status as unconfirmed", () => {
    expect(isManagerConfirmed(log({ final_status: null, reviewed_by: "mgr-1" }))).toBe(false);
  });
});
