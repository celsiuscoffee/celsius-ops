// HR System Types — matches Supabase hr_* tables

export type EmployeeProfile = {
  id: string;
  user_id: string;
  ic_number: string | null;
  date_of_birth: string | null;
  gender: string | null;
  nationality: string;
  join_date: string;
  probation_end_date: string | null;
  employment_type: "full_time" | "part_time" | "contract" | "intern";
  position: string | null;
  manager_user_id: string | null;
  basic_salary: number;
  hourly_rate: number | null;
  epf_number: string | null;
  socso_number: string | null;
  eis_number: string | null;
  tax_number: string | null;
  epf_employee_rate: number;
  epf_employer_rate: number;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
  schedule_required: boolean;
  created_at: string;
  updated_at: string;
};

export type LeavePolicy = {
  id: string;
  leave_type: string;
  display_name: string;
  entitlement_type: "fixed" | "on_request";
  entitlement_days: number | null;
  accrual_type: "yearly" | "monthly" | "daily" | "none";
  prorated: boolean;
  prorate_mode: "started_month" | "completed_month" | "partial_month";
  carry_forward: boolean;
  carry_forward_max_days: number | null;
  carry_forward_expiry_months: number | null;
  first_approver: "manager" | "position" | "person" | "role" | "none";
  second_approver: "manager" | "position" | "person" | "role" | "none";
  half_day_allowed: boolean;
  apply_in_past: boolean;
  min_advance_days: number | null;
  max_advance_days: number | null;
  min_consecutive_days: number | null;
  max_consecutive_days: number | null;
  mandatory_attachment: boolean;
  mandatory_justification: boolean;
  applies_to_employment_types: string[];
  is_active: boolean;
  notes: string | null;
};

export type PayrollItemCatalogEntry = {
  id: string;
  code: string;
  name: string;
  category: "Remuneration" | "Allowances" | "Deductions" | "Benefits in Kind" | "Other perquisites" | "Tax Relief";
  item_type: "fixed_remuneration" | "additional_remuneration" | "deduct_from_gross" | "deduct_after_net" | "not_a_remuneration";
  ea_form_field: string | null;
  pcb_taxable: boolean;
  epf_contributing: boolean;
  socso_contributing: boolean;
  eis_contributing: boolean;
  hrdf_contributing: boolean;
  is_bik: boolean;
  is_custom: boolean;
  sort_order: number;
  is_active: boolean;
};

export type ShiftTemplate = {
  id: string;
  outlet_id: string | null;
  label: string;
  start_time: string; // HH:MM:SS
  end_time: string;
  break_minutes: number;
  color: string | null;
  sort_order: number | null;
  is_active: boolean;
};

export type GeofenceZone = {
  id: string;
  outlet_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_active: boolean;
};

export type AttendanceLog = {
  id: string;
  user_id: string;
  outlet_id: string;
  clock_in: string;
  clock_out: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  clock_in_method: "app" | "manual" | "pos";
  clock_out_method: "app" | "manual" | "pos" | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  ai_status: "pending" | "approved" | "flagged" | "reviewed";
  ai_flags: string[];
  ai_processed_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  final_status: "approved" | "rejected" | "adjusted" | null;
  total_hours: number | null;
  regular_hours: number | null;
  overtime_hours: number | null;
  overtime_type: string | null;
  clock_in_photo_url: string | null;
  clock_out_photo_url: string | null;
  created_at: string;
};

export type Schedule = {
  id: string;
  outlet_id: string;
  week_start: string;
  week_end: string;
  status: "draft" | "ai_generated" | "published" | "archived";
  generated_by: string;
  ai_notes: string | null;
  total_labor_hours: number | null;
  estimated_labor_cost: number | null;
  published_by: string | null;
  published_at: string | null;
};

export type ScheduleShift = {
  id: string;
  schedule_id: string;
  user_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  role_type: string | null;
  break_minutes: number;
  notes: string | null;
  is_ai_assigned: boolean;
};

export type LeaveBalance = {
  id: string;
  user_id: string;
  year: number;
  leave_type: string;
  entitled_days: number;
  used_days: number;
  pending_days: number;
  carried_forward: number;
};

export type LeaveRequest = {
  id: string;
  user_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string | null;
  attachment_url: string | null;
  status: "pending" | "ai_approved" | "ai_escalated" | "approved" | "rejected" | "cancelled";
  ai_decision: string | null;
  ai_reason: string | null;
  ai_processed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type PayrollRun = {
  id: string;
  cycle_type: "monthly" | "weekly";
  period_month: number | null;
  period_year: number | null;
  period_start: string | null;
  period_end: string | null;
  status: "draft" | "ai_computed" | "confirmed";
  total_gross: number;
  total_deductions: number;
  total_net: number;
  total_employer_cost: number;
  ai_computed_at: string | null;
  ai_notes: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentRun = {
  id: string;
  agent_type: "scheduler" | "attendance_processor" | "leave_manager" | "payroll_calculator";
  triggered_by: "cron" | "manual" | "event";
  triggered_by_user_id: string | null;
  status: "running" | "completed" | "failed";
  input_summary: Record<string, unknown> | null;
  output_summary: Record<string, unknown> | null;
  items_processed: number;
  items_flagged: number;
  items_auto_approved: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
};
