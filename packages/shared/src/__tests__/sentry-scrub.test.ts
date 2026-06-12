import { describe, it, expect } from "vitest";
import { scrubSecrets, scrubSentryEvent } from "../sentry-scrub";

// Shape-realistic fakes — same three-segment base64url structure as
// real Supabase/Stripe credentials, but throwaway values.
const FAKE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const FAKE_SK = "sk_live_AbCdEfGh0123456789";

describe("scrubSecrets", () => {
  it("redacts JWTs (Supabase keys + session tokens)", () => {
    const out = scrubSecrets(`auth failed for Bearer ${FAKE_JWT} at /api/orders`);
    expect(out).not.toContain(FAKE_JWT);
    expect(out).toContain("[REDACTED_JWT]");
    expect(out).toContain("at /api/orders"); // surrounding context survives
  });

  it("redacts Stripe secret/restricted keys", () => {
    expect(scrubSecrets(`key=${FAKE_SK}`)).toBe("key=[REDACTED_STRIPE_KEY]");
    expect(scrubSecrets("rk_test_AbCdEfGh0123456789")).toBe("[REDACTED_STRIPE_KEY]");
  });

  it("leaves ordinary text alone, including pk_ publishable keys", () => {
    const s = "Order CC-CON-0042 failed: pk_live_AbCdEfGh0123456789 timeout";
    expect(scrubSecrets(s)).toBe(s);
  });
});

describe("scrubSentryEvent", () => {
  it("scrubs nested event fields — headers, breadcrumbs, messages", () => {
    const event = {
      message: `boom ${FAKE_JWT}`,
      request: { headers: { authorization: `Bearer ${FAKE_JWT}`, "x-service-key": FAKE_JWT } },
      breadcrumbs: [{ message: `fetch with ${FAKE_SK}` }],
      extra: { harmless: "keep me" },
    };
    const out = scrubSentryEvent(event);
    expect(JSON.stringify(out)).not.toContain(FAKE_JWT);
    expect(JSON.stringify(out)).not.toContain(FAKE_SK);
    expect(out.extra.harmless).toBe("keep me");
    expect(out.request.headers.authorization).toBe("Bearer [REDACTED_JWT]");
  });

  it("returns the event unchanged when not serializable", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(scrubSentryEvent(cyclic)).toBe(cyclic);
  });
});
