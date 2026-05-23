import { api } from "../api";

export type Shift = {
  id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  position: string | null;
  notes: string | null;
  hr_schedules: { outlet_id: string; week_start: string };
};

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
  gross_pay: number;
  net_pay: number;
  base_salary: number;
  overtime_pay: number;
  allowances: number;
  deductions: number;
  epf_employee: number;
  socso_employee: number;
  eis_employee: number;
  pcb: number;
  hr_payroll_runs: {
    status: string;
    period_month: number;
    period_year: number;
    confirmed_at: string | null;
  };
};

export type Memo = {
  id: string;
  title: string;
  body: string;
  issued_at: string;
  issued_by: string;
  requires_acknowledgement: boolean;
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
  attendance: AttendanceItem[];
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

export function submitLeave(req: {
  leave_type: string;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string;
}) {
  return api<{ success: boolean }>("/api/hr/leave", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export function fetchPayslips() {
  return api<{ payslips: Payslip[] }>("/api/hr/payslips");
}

export function fetchMemos() {
  return api<{ memos: Memo[] }>("/api/hr/memos");
}

export function acknowledgeMemo(memoId: string, notes?: string) {
  return api<{ success: boolean }>(`/api/hr/memos/${memoId}/acknowledge`, {
    method: "POST",
    body: JSON.stringify({ notes }),
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

// ── Allowances breakdown ───
export type AllowanceBreakdown = {
  isFullTime: boolean;
  period: {
    year: number;
    month: number;
    daysElapsed: number;
    daysRemaining: number;
  };
  attendance: {
    base: number;
    earned: number;
    tip: string;
    metrics: { lateCount: number; absentCount: number };
  };
  performance: {
    base: number;
    earned: number;
    score: number;
    mode: string;
    eligible: boolean;
    breakdown: { checklists: number; reviews: number; audit: number };
    tip: string;
  };
  reviewPenalty: {
    total: number;
    entries: { id: string; reviewDate: string; rating: number; amount: number }[];
  };
  totalEarned: number;
  totalMax: number;
};

export function fetchAllowances() {
  return api<{ breakdown: AllowanceBreakdown }>("/api/hr/allowances");
}
