import { describe, it, expect } from "vitest";
import {
  buildVerifierPrompt,
  parseVerdict,
  type VerifierInput,
  type VerifierDecision,
} from "./verifier";

const input: VerifierInput = {
  supplierName: "Test Supplier",
  paymentModel: "Net 30",
  orderNumber: "CC-KL-0001",
  orderStatus: "SENT",
  items: [
    { name: "Caramel Syrup", qty: 5, unit: "btl", unitPrice: 18 },
    { name: "Oat Milk", qty: 10, unit: "ctn", unitPrice: 42 },
  ],
  thread: [
    { who: "Us", text: "Hi bos, PO CC-KL-0001 attached 🙏" },
    { who: "Supplier", text: "ok noted" },
  ],
  inboundText: "caramel syrup takde bos",
  hadDoc: false,
  today: "2026-06-26",
};

const decision: VerifierDecision = {
  intent: "out_of_stock",
  language: "ms",
  actionType: "remove_item",
  actionItemName: "Caramel Syrup",
  newQuantity: null,
  deliveryDate: null,
  captureInvoice: false,
  replyText: "Noted bos 🙏 kita remove caramel dulu",
  confidence: 0.92,
  escalated: false,
  escalationReason: null,
  appliedAction: "remove_item",
  reSourced: true,
};

describe("buildVerifierPrompt", () => {
  it("includes the PO, line items, the inbound message and what the agent did", () => {
    const p = buildVerifierPrompt(input, decision);
    expect(p).toContain("CC-KL-0001");
    expect(p).toContain("Caramel Syrup");
    expect(p).toContain("caramel syrup takde bos");
    expect(p).toContain("PO action(s): remove_item");
    expect(p).toContain("re-sourced to alt supplier (DRAFT): true");
    expect(p).toContain("2026-06-26");
  });

  it("renders empty items/thread without crashing", () => {
    const p = buildVerifierPrompt({ ...input, items: [], thread: [] }, decision);
    expect(p).toContain("(no line items)");
    expect(p).toContain("(no earlier messages)");
  });
});

describe("parseVerdict", () => {
  it("parses a clean pass verdict", () => {
    const v = parseVerdict(
      '{"rating":"pass","confidence":0.9,"issues":[],"summary":"correct OOS removal","recommendedAction":null}',
    );
    expect(v).not.toBeNull();
    expect(v!.rating).toBe("pass");
    expect(v!.issues).toEqual([]);
    expect(v!.recommendedAction).toBeNull();
  });

  it("extracts JSON from surrounding prose", () => {
    const v = parseVerdict('Here is my verdict:\n{"rating":"fail","confidence":0.8,"issues":["accepted a substitution"],"summary":"bad"}\nThanks');
    expect(v!.rating).toBe("fail");
    expect(v!.issues).toEqual(["accepted a substitution"]);
  });

  it("clamps confidence to 0..1 and drops empty issues", () => {
    const v = parseVerdict('{"rating":"concern","confidence":5,"issues":["real issue",""," "],"summary":"x"}');
    expect(v!.confidence).toBe(1);
    expect(v!.issues).toEqual(["real issue"]);
  });

  it("rejects an invalid rating", () => {
    expect(parseVerdict('{"rating":"great","confidence":0.5}')).toBeNull();
  });

  it("returns null when there is no JSON object", () => {
    expect(parseVerdict("no json here")).toBeNull();
    expect(parseVerdict('{ not valid json')).toBeNull();
  });

  it("treats a blank recommendedAction as null", () => {
    const v = parseVerdict('{"rating":"pass","confidence":0.7,"issues":[],"summary":"ok","recommendedAction":"  "}');
    expect(v!.recommendedAction).toBeNull();
  });
});
