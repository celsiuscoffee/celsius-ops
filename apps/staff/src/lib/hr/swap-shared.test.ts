import { describe, expect, it } from "vitest";
import { flattenSwappable, isRestRow } from "./swap-shared";

describe("isRestRow", () => {
  it("treats a 00:00–00:00 placeholder as a rest row", () => {
    expect(isRestRow({ start_time: "00:00:00", end_time: "00:00:00", role_type: null })).toBe(true);
  });
  it("treats a labelled rest day as a rest row whatever the times", () => {
    expect(isRestRow({ start_time: "09:00:00", end_time: "17:00:00", role_type: "Rest Day" })).toBe(true);
  });
  it("keeps a working shift", () => {
    expect(isRestRow({ start_time: "09:00:00", end_time: "17:00:00", role_type: "Barista" })).toBe(false);
    expect(isRestRow({ start_time: "00:00:00", end_time: "08:00:00", role_type: null })).toBe(false);
  });
});

describe("flattenSwappable", () => {
  const base = {
    id: "s1", user_id: "u1", shift_date: "2026-09-12", start_time: "09:00:00", end_time: "17:00:00",
    role_type: "Barista", notes: null,
  };
  it("lifts outlet_id and status from the joined schedule (object form)", () => {
    const flat = flattenSwappable({ ...base, hr_schedules: { outlet_id: "o1", status: "published" } });
    expect(flat.outlet_id).toBe("o1");
    expect(flat.status).toBe("published");
  });
  it("handles the array form PostgREST sometimes returns", () => {
    const flat = flattenSwappable({ ...base, hr_schedules: [{ outlet_id: "o2", status: "draft" }] });
    expect(flat.outlet_id).toBe("o2");
    expect(flat.status).toBe("draft");
  });
  it("is null-safe when the join is missing", () => {
    const flat = flattenSwappable({ ...base, hr_schedules: null });
    expect(flat.outlet_id).toBeNull();
    expect(flat.status).toBeNull();
  });
});
