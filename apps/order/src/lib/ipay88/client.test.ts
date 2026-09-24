import { createHmac } from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPaymentRequest,
  classifyRequery,
  formatAmount,
  merchantByCode,
  merchantForStore,
  parseAmountSen,
  parseResponse,
  paymentIdFor,
  renderAutoSubmitPage,
  requestSignature,
  responseSignature,
  verifyResponse,
} from "./client";

const M = { code: "M00001", key: "secretKey" };
const ENV_KEYS = ["IPAY88_MERCHANT_CODE", "IPAY88_MERCHANT_KEY", "IPAY88_MERCHANTS", "IPAY88_PAYMENT_IDS"];

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("amounts", () => {
  it("formats sen with two decimals and thousands separators", () => {
    expect(formatAmount(0)).toBe("0.00");
    expect(formatAmount(445)).toBe("4.45");
    expect(formatAmount(1000)).toBe("10.00");
    expect(formatAmount(127899)).toBe("1,278.99");
    expect(formatAmount(123456789)).toBe("1,234,567.89");
  });

  it("rejects non-integer and negative sen", () => {
    expect(() => formatAmount(4.5)).toThrow();
    expect(() => formatAmount(-1)).toThrow();
  });

  it("parses amounts back to sen, with or without separators", () => {
    expect(parseAmountSen("4.45")).toBe(445);
    expect(parseAmountSen("1,278.99")).toBe(127899);
    expect(parseAmountSen("1278.99")).toBe(127899);
    expect(parseAmountSen("4.5")).toBeNull();
    expect(parseAmountSen("abc")).toBeNull();
  });
});

describe("signatures", () => {
  it("signs the request as HMAC-SHA512(key, key+code+refNo+amountDigits+currency)", () => {
    const expected = createHmac("sha512", "secretKey")
      .update("secretKeyM00001C-AB12CD127899MYR")
      .digest("hex");
    expect(requestSignature(M, "C-AB12CD", "1,278.99")).toBe(expected);
  });

  it("signs the response over paymentId, refNo, amount, currency and status", () => {
    const expected = createHmac("sha512", "secretKey")
      .update("secretKeyM000012C-AB12CD445MYR1")
      .digest("hex");
    expect(
      responseSignature(M, { paymentId: "2", refNo: "C-AB12CD", amount: "4.45", currency: "MYR", status: "1" }),
    ).toBe(expected);
  });

  it("verifies a genuine response and rejects tampering", () => {
    process.env.IPAY88_MERCHANT_CODE = M.code;
    process.env.IPAY88_MERCHANT_KEY = M.key;
    const fields = { paymentId: "2", refNo: "C-AB12CD", amount: "4.45", currency: "MYR", status: "1" };
    const form = new URLSearchParams({
      MerchantCode: M.code,
      PaymentId: "2",
      RefNo: "C-AB12CD",
      Amount: "4.45",
      Currency: "MYR",
      Status: "1",
      TransId: "T123",
      Signature: responseSignature(M, fields).toUpperCase(),
    });
    expect(verifyResponse(parseResponse(form))).toBe(true);

    form.set("Amount", "0.01");
    expect(verifyResponse(parseResponse(form))).toBe(false);
    form.set("Amount", "4.45");
    form.set("Status", "0");
    expect(verifyResponse(parseResponse(form))).toBe(false);
    form.set("Status", "1");
    form.set("MerchantCode", "OTHER");
    expect(verifyResponse(parseResponse(form))).toBe(false);
  });

  it("rejects a response when iPay88 is not configured", () => {
    const form = new URLSearchParams({ MerchantCode: M.code, Signature: "abc" });
    expect(verifyResponse(parseResponse(form))).toBe(false);
  });
});

describe("merchants", () => {
  it("prefers the per-outlet account and falls back to the default", () => {
    process.env.IPAY88_MERCHANT_CODE = "DEFAULT";
    process.env.IPAY88_MERCHANT_KEY = "k0";
    process.env.IPAY88_MERCHANTS = JSON.stringify({ conezion: { code: "CNZ", key: "k1" } });
    expect(merchantForStore("conezion")).toEqual({ code: "CNZ", key: "k1" });
    expect(merchantForStore("shah-alam")).toEqual({ code: "DEFAULT", key: "k0" });
    expect(merchantByCode("CNZ")).toEqual({ code: "CNZ", key: "k1" });
    expect(merchantByCode("DEFAULT")).toEqual({ code: "DEFAULT", key: "k0" });
    expect(merchantByCode("NOPE")).toBeNull();
  });

  it("returns null when nothing is configured", () => {
    expect(merchantForStore("shah-alam")).toBeNull();
  });
});

describe("payment request", () => {
  it("maps methods to PaymentIds, with env overrides and a blank for unknown methods", () => {
    expect(paymentIdFor("card")).toBe("2");
    expect(paymentIdFor("apple_pay")).toBe("");
    process.env.IPAY88_PAYMENT_IDS = JSON.stringify({ apple_pay: 999, card: "55" });
    expect(paymentIdFor("apple_pay")).toBe("999");
    expect(paymentIdFor("card")).toBe("55");
  });

  it("builds a signed request", () => {
    const req = buildPaymentRequest({
      merchant: M,
      refNo: "C-AB12CD",
      amountSen: 445,
      methodId: "card",
      prodDesc: "Celsius Coffee order C-AB12CD",
      userName: "Aisyah",
      userEmail: "a@example.com",
      userContact: "0123456789",
      remark: "order-uuid",
      responseUrl: "https://order.celsiuscoffee.com/api/payments/ipay88/callback/web",
      backendUrl: "https://order.celsiuscoffee.com/api/payments/ipay88/webhook",
    });
    expect(req.Amount).toBe("4.45");
    expect(req.PaymentId).toBe("2");
    expect(req.SignatureType).toBe("HMACSHA512");
    expect(req.Signature).toBe(requestSignature(M, "C-AB12CD", "4.45"));
  });

  it("escapes field values in the auto-submit page", () => {
    const html = renderAutoSubmitPage("https://pay.example/entry.asp", { UserName: `"><script>x</script>` });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
});

describe("requery classification", () => {
  it("only treats 00 as paid", () => {
    expect(classifyRequery("00")).toBe("SUCCESS");
    expect(classifyRequery(" 00\r\n")).toBe("SUCCESS");
    expect(classifyRequery("Payment fail")).toBe("FAILED");
    expect(classifyRequery("Record not found")).toBe("UNPAID");
    expect(classifyRequery("Haven't paid (0)")).toBe("UNPAID");
    expect(classifyRequery("Payment Pending")).toBe("PENDING");
    expect(classifyRequery("Incorrect amount")).toBe("UNKNOWN");
    expect(classifyRequery("Invalid parameters")).toBe("UNKNOWN");
    expect(classifyRequery("<html>error</html>")).toBe("UNKNOWN");
  });
});
