-- Scheduling "assist" decision log — the training set for auto-scheduling.
-- One row every time a manager assigns a staffer to a shift via the assist
-- panel. `was_override` + `candidate_snapshot` capture WHEN a manager disagreed
-- with the model's ranking and the full ranked context at that moment, so the
-- fit-score weights can later be learned from revealed preference rather than
-- hand-tuned. Read/written only by service-role routes (RLS deny-all).
create table if not exists hr_schedule_assist_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  manager_user_id text,
  outlet_id text not null,
  shift_date date not null,
  slot_start time not null,
  slot_end time not null,
  role_type text,
  assigned_user_id text not null,
  assigned_fit_rank integer,          -- 1 = top-ranked; higher = manager reached past the model
  assigned_fit_score numeric,
  top_candidate_user_id text,
  top_candidate_fit_score numeric,
  was_override boolean not null default false,   -- assigned != top-ranked candidate
  override_reason text,
  candidate_snapshot jsonb            -- ranked candidates + signals + weights at decision time
);

create index if not exists idx_assist_log_outlet_date on hr_schedule_assist_log (outlet_id, shift_date);

alter table hr_schedule_assist_log enable row level security;
