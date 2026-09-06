import { ApiError, api, fetchWithTimeout } from "../api";
import { API_BASE_URL } from "../env";
import { loadSession } from "../session";

export type Shift = {
  id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  position: string | null;
  notes: string | null;
  // Where the shift is — rotating staff work several outlets in a week.
  outlet_name?: string | null;
  hr_schedules: { outlet_id: string; week_start: string };
};

// A teammate rostered at your outlet on a given day (from /api/hr/whos-working).
export type TeamMate = {
  user_id: string;
  name: string;
  position: string | null;
  start_time: string;
  end_time: string;
  is_me: boolean;
};

export function fetchWhosWorking(date?: string) {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  return api<{ date: string; team: TeamMate[] }>(`/api/hr/whos-working${qs}`);
}

export type LeaveBalance = {
  id: string;
  leave_type: string;
  entitled_days: number;
  used_days: number;
  remaining_days: number;
  year: number;
};

export type LeaveRequest = {
  id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string | null;
  status:
    | "pending"
    | "approved"
    | "rejected"
    | "cancelled"
    | "ai_approved"
    | "ai_escalated"
    | (string & {});
  rejection_reason: string | null;
  created_at: string;
};

export type Payslip = {
  id: string;
  net_pay: number;
  base_salary: number;
  overtime_pay: number;
  allowances: number;
  total_gross: number;
  total_deductions: number;
  epf_employee: number;
  socso_employee: number;
  eis_employee: number;
  pcb: number;
  epf_employer: number;
  socso_employer: number;
  eis_employer: number;
  // Raw per-rate OT lines and the calculator's detail block, so the app can
  // label the earnings the way the backoffice and the PDF do (OT by rate,
  // Public Holiday Pay, Rest Day Pay) instead of one "Overtime" line.
  ot_1x_amount?: number | null;
  ot_1_5x_amount?: number | null;
  ot_2x_amount?: number | null;
  ot_3x_amount?: number | null;
  other_deductions?: Record<string, number | string | null> | null;
  computation_details?: {
    ot_hours_1x?: number;
    ot_hours_1_5x?: number;
    ot_hours_2x?: number;
    ot_hours_3x?: number;
    ph_days_worked?: number;
    ph_premium_amount?: number;
    rest_day_days_worked?: number;
    rest_day_pay_amount?: number;
  } | null;
  hr_payroll_runs: {
    status: string;
    cycle_type: string | null;
    period_month: number | null;
    period_year: number | null;
    period_start: string | null;
    period_end: string | null;
    confirmed_at: string | null;
  } | null;
};

export type Memo = {
  id: string;
  title: string;
  body: string;
  issued_at: string;
  issued_by: string;
  issued_by_name?: string;
  // hr_memos has no requires_acknowledgement column; every active memo is
  // acknowledgeable, gated purely on whether THIS user has acked it yet.
  my_acknowledged_at: string | null;
};

export type AttendanceItem = {
  id: string;
  clock_in: string;
  clock_out: string | null;
  total_hours: number | null;
  regular_hours: number | null;
  overtime_hours: number | null;
  overtime_type: string | null;
  ai_status: string | null;
  final_status: string | null;
  outlet_id: string;
};

export type AttendanceResponse = {
  // The API returns `logs` (matches the web staff app). This was previously
  // typed/read as `attendance`, so the native list was always empty.
  logs: AttendanceItem[];
  stats?: {
    totalHours: number;
    totalOT: number;
    daysWorked: number;
  };
};

export function fetchShifts() {
  return api<{ shifts: Shift[] }>("/api/hr/shifts");
}

export function fetchLeave() {
  return api<{ balances: LeaveBalance[]; requests: LeaveRequest[] }>(
    "/api/hr/leave",
  );
}

export async function submitLeave(req: {
  leave_type: string;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string;
  /**
   * MC photo/PDF for sick leave. REQUIRED for sick leave — /api/hr/leave
   * rejects a sick request without one, and the AI approver refuses to
   * auto-approve it. Sent as a RAW multipart file, NOT base64-in-JSON: a
   * full-resolution phone photo base64'd into a JSON body blew past the
   * ~4.5MB platform body limit (base64 inflates ~33%, and the iOS capture-
   * size cap silently no-ops because getAvailablePictureSizesAsync returns
   * presets, not WxH). Multipart streams the file with no inflation, so the
   * server (apps/staff/src/app/api/hr/leave/route.ts) converts it on its side.
   */
  mc?: { uri: string; type?: string } | null;
}): Promise<{ success: boolean }> {
  // No MC (annual/emergency/unpaid): plain JSON, same as before.
  if (!req.mc) {
    return api<{ success: boolean }>("/api/hr/leave", {
      method: "POST",
      body: JSON.stringify({
        leave_type: req.leave_type,
        start_date: req.start_date,
        end_date: req.end_date,
        total_days: req.total_days,
        reason: req.reason,
      }),
    });
  }

  // MC present: multipart/form-data with the raw file.
  const session = await loadSession();
  const form = new FormData();
  form.append("leave_type", req.leave_type);
  form.append("start_date", req.start_date);
  form.append("end_date", req.end_date);
  form.append("total_days", String(req.total_days));
  form.append("reason", req.reason ?? "");
  const type = req.mc.type || "image/jpeg";
  const ext =
    type === "application/pdf" ? "pdf" : type === "image/png" ? "png" : "jpg";
  form.append("attachment", {
    uri: req.mc.uri,
    name: `mc-${Date.now()}.${ext}`,
    type,
  } as unknown as Blob);

  // Do NOT set Content-Type — React Native fills in the multipart boundary
  // itself. Uploads run longer than a JSON call, so give it a bigger timeout
  // than the 15s default.
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${API_BASE_URL}/api/hr/leave`,
      {
        method: "POST",
        body: form,
        headers: session?.token
          ? { Authorization: `Bearer ${session.token}` }
          : undefined,
      },
      30_000,
    );
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new ApiError(
      0,
      aborted
        ? "Upload timed out. Check your connection and try again."
        : "Network error. Check your internet and try again.",
      null,
    );
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed: ${res.status}`;
    throw new ApiError(res.status, msg, body);
  }
  return body as { success: boolean };
}

export function fetchPayslips() {
  return api<{ payslips: Payslip[] }>("/api/hr/payslips");
}

// Mint a short-lived, item-bound URL for the official payslip PDF. The native
// app can't carry its Bearer token into an external browser, so we fetch the
// link over the authenticated API and hand the returned (token-signed) URL to
// the system browser to download.
export function fetchPayslipDownloadUrl(itemId: string) {
  return api<{ url: string }>(`/api/hr/payslips/pdf?item_id=${encodeURIComponent(itemId)}&link=1`);
}

export function fetchMemos() {
  return api<{ memos: Memo[] }>("/api/hr/memos");
}

export function acknowledgeMemo(memoId: string, notes?: string) {
  // Acknowledge via PATCH /api/hr/memos with { id, notes }. There is no
  // /[id]/acknowledge subroute on the staff API (that path 404s).
  return api<{ success: boolean }>("/api/hr/memos", {
    method: "PATCH",
    body: JSON.stringify({ id: memoId, notes }),
  });
}

export function fetchAttendance(days = 30) {
  return api<AttendanceResponse>(`/api/hr/attendance?days=${days}`);
}

// ── My Skills (audit history for the logged-in staff) ───
export type SkillsAuditItem = {
  itemTitle: string;
  sectionName: string;
  ratingType: string;
  rating: number | null;
  ratingDelta: number | null;
  notes: string | null;
};

export type SkillsAuditEntry = {
  id: string;
  date: string;
  overallScore: number | null;
  scoreDelta: number | null;
  completedAt: string | null;
  auditor: { id: string; name: string };
  outlet: { id: string; name: string; code: string };
  items: SkillsAuditItem[];
};

export type SkillsResponse = {
  auditee: { id: string; name: string } | null;
  templates: {
    template: { id: string; name: string; jobRoleFilter: string[] };
    audits: SkillsAuditEntry[];
  }[];
};

export type SkillsCoachInsights = {
  summary: string;
  strengths: string[];
  focus_areas: string[];
  coaching_actions: string[];
  needs_more_data: boolean;
};

export type SkillsCoachResponse = {
  insights: SkillsCoachInsights | null;
  generated_at: string | null;
  model: string | null;
  cached: boolean;
  audit_count: number;
  reason?: "no_audits" | "insufficient_data";
};

export function fetchMySkills(userId: string) {
  return api<SkillsResponse>(`/api/audits/staff/${userId}`);
}

export function fetchMySkillsCoach(userId: string) {
  return api<SkillsCoachResponse>(`/api/audits/staff/${userId}/coach`);
}

// ── Reviews attributed during my shifts ───
export type MyReview = {
  id: string;
  rating: number;
  comment: string | null;
  review_date: string;
  reviewer_name: string | null;
  source: string | null;
};

export function fetchMyReviews() {
  return api<{ reviews: MyReview[]; count: number }>("/api/hr/my-reviews");
}

// ── Allowances breakdown (Performance Allowance v2) ───
// One RM pool split into 4 KPI levers (each scored on its own metric, paid in
// nothing / half / full steps), minus attendance + review deductions. Shape
// mirrors the server's AllowanceBreakdown in apps/staff/src/lib/hr/allowances.ts.
export type AllowanceLever = {
  key: "checklist" | "phone" | "serving" | "audit";
  label: string;
  applicable: boolean;
  score: number; // 0-100 display proxy (completion / achievement %)
  tier: "under" | "ok" | "perform";
  slice: number; // RM allocated to this lever
  earned: number; // RM earned
  detail: string;
};
export type AllowanceDeduction = {
  kind: "late" | "absent" | "review";
  label: string;
  amount: number;
  date?: string;
};
export type AllowanceBreakdown = {
  userId: string;
  employmentType: string | null;
  isFullTime: boolean;
  eligible: boolean;
  period: {
    year: number;
    month: number;
    daysElapsed: number;
    daysRemaining: number;
  };
  pool: number;
  levers: AllowanceLever[];
  performanceEarned: number;
  attendance: {
    deductions: AllowanceDeduction[];
    lateCount: number;
    absentCount: number;
    total: number; // RM deducted
  };
  reviewPenalty: {
    total: number;
    entries: {
      id: string;
      reviewDate: string;
      rating: number;
      amount: number;
      reviewText?: string | null;
    }[];
  };
  totalEarned: number;
  totalMax: number;
  tip: string;
};

export function fetchAllowances() {
  return api<{ breakdown: AllowanceBreakdown }>("/api/hr/allowances");
}

// ── Availability (weekly pattern + date blockouts) ───
export type WeeklyAvailabilityRow = {
  id: string;
  day_of_week: number; // 0=Sun … 6=Sat
  available_from: string | null; // "HH:MM(:SS)" | null = from open
  available_until: string | null;
  is_preferred: boolean;
  max_shifts_per_week: number | null;
};

export type DateAvailability = {
  id: string;
  date: string;
  availability: "unavailable" | "preferred" | "available";
  reason: string | null;
};

export function fetchWeeklyAvailability() {
  return api<{ weekly: WeeklyAvailabilityRow[] }>("/api/hr/availability/weekly");
}

// Replace the whole weekly pattern (empty days = back to flexible).
export function saveWeeklyAvailability(req: {
  days: { day_of_week: number; available_from: string | null; available_until: string | null }[];
  max_shifts_per_week?: number | null;
}) {
  return api<{ success: boolean }>("/api/hr/availability/weekly", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export function fetchDateAvailability() {
  return api<{ availability: DateAvailability[] }>("/api/hr/availability");
}

export function setDateUnavailable(date: string, reason?: string) {
  // The server ACCEPTS a block on an already-rostered date but returns a
  // rostered_conflict telling the staffer the shift still stands until a
  // manager changes it — the screen surfaces that message.
  return api<{
    availability: DateAvailability;
    rostered_conflict?: { message: string; shifts: Array<{ shift_date: string; start_time: string; end_time: string }> } | null;
  }>("/api/hr/availability", {
    method: "POST",
    body: JSON.stringify({ date, availability: "unavailable", reason: reason || null }),
  });
}

export function clearDateAvailability(date: string) {
  return api<{ success: boolean }>(`/api/hr/availability?date=${encodeURIComponent(date)}`, {
    method: "DELETE",
  });
}

// ── Open slots (unfilled shifts; PTs REQUEST, manager assigns) ───
export type OpenSlot = {
  id: string;
  outlet_id: string;
  outlet_name: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  hours: number;
  station: string; // 'barista' | 'kitchen'
  role_type: string | null;
  blocked: string | null; // reason this user can't request it, null = requestable
  my_request: "pending" | "assigned" | null;
  pending_requests: number;
};

export type OpenSlotsResponse = {
  shifts: OpenSlot[];
  is_pt: boolean;
  week_hours: number;
  week_days: number;
};

export function fetchOpenSlots() {
  return api<OpenSlotsResponse>("/api/hr/open-shifts");
}

// Raise a hand for a slot — the manager assigns one requester.
export function requestOpenSlot(id: string) {
  return api<{ success: boolean; status: string }>("/api/hr/open-shifts", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function withdrawOpenSlotRequest(id: string) {
  return api<{ success: boolean }>(`/api/hr/open-shifts?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
