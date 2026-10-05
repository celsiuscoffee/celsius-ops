import { afterEach, describe, expect, it } from "vitest";
import { assertAllowedFetchUrl, isAllowedFetchUrl } from "./safe-fetch-url";

const ENV = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_LOYALTY_SUPABASE_URL", "LEGACY_INVENTORY_SUPABASE_URL"];
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

describe("assertAllowedFetchUrl", () => {
  it("allows our storage hosts", () => {
    expect(isAllowedFetchUrl("https://kqdcdhpnyuwrxqhbuyfl.supabase.co/storage/v1/object/public/invoices/a.pdf")).toBe(true);
    expect(isAllowedFetchUrl("https://res.cloudinary.com/celsius/image/upload/x.jpg")).toBe(true);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://custom.example.org";
    expect(isAllowedFetchUrl("https://custom.example.org/storage/v1/x")).toBe(true);
  });

  it("refuses everything that is not https on an allow-listed host", () => {
    expect(isAllowedFetchUrl("http://kqdcdhpnyuwrxqhbuyfl.supabase.co/x.pdf")).toBe(false);
    expect(isAllowedFetchUrl("https://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isAllowedFetchUrl("https://localhost:3003/api/finance/home")).toBe(false);
    expect(isAllowedFetchUrl("https://evil.com/supabase.co/x.pdf")).toBe(false);
    expect(isAllowedFetchUrl("https://supabase.co.evil.com/x.pdf")).toBe(false);
    expect(isAllowedFetchUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedFetchUrl("not a url")).toBe(false);
    expect(() => assertAllowedFetchUrl("https://evil.com/x")).toThrow(/Refusing to fetch from evil.com/);
  });
});
