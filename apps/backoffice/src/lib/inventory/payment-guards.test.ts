import { describe, expect, it } from "vitest";
import {
  amountMismatchesOrder,
  canReceiveOrder,
  canReceiveTransfer,
  isApprovableClaimStatus,
  isOverpayment,
  isPayerRole,
  moneyHasMoved,
  receiptRequirementMode,
} from "./payment-guards";

describe("receiptRequirementMode", () => {
  it("defaults to warn", () => {
    expect(receiptRequirementMode(undefined)).toBe("warn");
    expect(receiptRequirementMode("")).toBe("warn");
    expect(receiptRequirementMode("nonsense")).toBe("warn");
  });
  it("blocks only when asked explicitly", () => {
    expect(receiptRequirementMode("block")).toBe("block");
    expect(receiptRequirementMode(" BLOCK ")).toBe("block");
    expect(receiptRequirementMode("warn")).toBe("warn");
  });
});

describe("amountMismatchesOrder", () => {
  it("tolerates RM 5 on small orders", () => {
    expect(amountMismatchesOrder(104.99, 100)).toBe(false);
    expect(amountMismatchesOrder(105.01, 100)).toBe(true);
    expect(amountMismatchesOrder(95.5, 100)).toBe(false);
  });
  it("tolerates 2% on large orders", () => {
    expect(amountMismatchesOrder(1019, 1000)).toBe(false); // 1.9%
    expect(amountMismatchesOrder(1021, 1000)).toBe(true); // 2.1%
    expect(amountMismatchesOrder(980, 1000)).toBe(false);
  });
  it("is quiet on garbage input", () => {
    expect(amountMismatchesOrder(NaN, 100)).toBe(false);
    expect(amountMismatchesOrder(100, NaN)).toBe(false);
  });
});

describe("isOverpayment", () => {
  it("flags a payment that pushes amountPaid over the total", () => {
    expect(isOverpayment(50, 60, 100)).toBe(true);
    expect(isOverpayment(0, 100.5, 100)).toBe(true);
  });
  it("allows exact settlement and float noise", () => {
    expect(isOverpayment(50, 50, 100)).toBe(false);
    expect(isOverpayment(33.33, 66.67, 100)).toBe(false);
    expect(isOverpayment(0, 100.005, 100)).toBe(false);
  });
});

describe("role / status predicates", () => {
  it("payer roles", () => {
    expect(isPayerRole("OWNER")).toBe(true);
    expect(isPayerRole("MANAGER")).toBe(true);
    expect(isPayerRole("STAFF")).toBe(false);
    expect(isPayerRole(undefined)).toBe(false);
  });
  it("money-moved statuses lock number/amount", () => {
    expect(moneyHasMoved("PAID")).toBe(true);
    expect(moneyHasMoved("DEPOSIT_PAID")).toBe(true);
    expect(moneyHasMoved("PENDING")).toBe(false);
    expect(moneyHasMoved("DRAFT")).toBe(false);
  });
  it("claims approve only from DRAFT / PENDING_APPROVAL", () => {
    expect(isApprovableClaimStatus("DRAFT")).toBe(true);
    expect(isApprovableClaimStatus("PENDING_APPROVAL")).toBe(true);
    expect(isApprovableClaimStatus("COMPLETED")).toBe(false);
  });
  it("transfer receive transitions", () => {
    expect(canReceiveTransfer("IN_TRANSIT")).toBe(true);
    expect(canReceiveTransfer("APPROVED")).toBe(true);
    expect(canReceiveTransfer("PENDING")).toBe(true);
    expect(canReceiveTransfer("RECEIVED")).toBe(false);
    expect(canReceiveTransfer("COMPLETED")).toBe(false);
    expect(canReceiveTransfer("DRAFT")).toBe(false);
    expect(canReceiveTransfer("CANCELLED")).toBe(false);
  });
  it("PO receive transitions", () => {
    expect(canReceiveOrder("SENT")).toBe(true);
    expect(canReceiveOrder("PARTIALLY_RECEIVED")).toBe(true);
    expect(canReceiveOrder("COMPLETED")).toBe(false);
    expect(canReceiveOrder("DRAFT")).toBe(false);
  });
});
