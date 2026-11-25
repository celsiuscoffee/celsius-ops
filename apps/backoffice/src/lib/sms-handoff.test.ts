import { describe, it, expect } from "vitest";
import { clearPickedPhones, readPickedPhones, savePickedPhones } from "./sms-handoff";

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe("Members → Messages SMS hand-off", () => {
  it("passes the picked phones once, without duplicates or blanks", () => {
    const s = mem();
    expect(savePickedPhones(["60123", " 60123 ", "", "60199"], s, 1000)).toBe(2);
    expect(readPickedPhones(s, 2000)).toEqual(["60123", "60199"]);
    clearPickedPhones(s);
    expect(readPickedPhones(s, 2000)).toEqual([]);
  });
  it("expires after 30 minutes", () => {
    const s = mem();
    savePickedPhones(["60123"], s, 0);
    expect(readPickedPhones(s, 31 * 60_000)).toEqual([]);
  });
  it("survives missing or corrupt storage", () => {
    expect(readPickedPhones(null)).toEqual([]);
    const s = mem(); s.setItem("celsius:sms-picked", "{oops");
    expect(readPickedPhones(s)).toEqual([]);
  });
});
