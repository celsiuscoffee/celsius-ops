-- Applied 2026-07-20 via Supabase MCP (apply_migration: agent_two_way), human in
-- session. Audit trail per docs/database-migrations.md - do not re-run.
--
-- Two-way agent comms: let the owner talk back to the agents over Telegram.
-- Two directions:
--   1. Agent -> owner question: an agent that needs a decision or more info
--      calls askOwner(), which posts a message with inline buttons (or an open
--      question) to the pulse bot. The owner's tap/reply lands here.
--   2. Owner -> agent: the owner replies to a feed message (to add context /
--      close a gap) or sends a free note; the webhook records it and, when it's
--      a reply, links it back to the exact agent_message it answers.
--
-- agent_prompts holds the open questions + their answers. agent_messages gains
-- notified_message_id (the Telegram message id we posted) so an owner reply can
-- be matched to the message it answers, and a 'note' kind for owner-authored
-- entries so they appear on the Conversations feed.

create table if not exists agent_prompts (
  id uuid primary key default gen_random_uuid(),
  agent_key text not null,
  kind text not null default 'confirm' check (kind in ('confirm', 'question')),
  prompt text not null,                       -- what the agent is asking, in plain English
  options jsonb not null default '[]'::jsonb, -- [{label, value}] for buttons; empty = free-text answer
  ref_table text,
  ref_id text,
  outlet_id text,
  telegram_message_id bigint,                 -- the pulse message carrying the buttons
  status text not null default 'pending' check (status in ('pending', 'answered', 'expired')),
  answer text,                                -- the chosen value or the owner's text
  answered_by text,                           -- telegram user id / name
  answered_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
alter table agent_prompts enable row level security;
create index if not exists agent_prompts_status_idx on agent_prompts (status, created_at desc);
create index if not exists agent_prompts_agent_idx on agent_prompts (agent_key, created_at desc);
create index if not exists agent_prompts_msg_idx on agent_prompts (telegram_message_id);

-- Link a posted pulse message back to its row, so an owner reply can be matched.
alter table agent_messages add column if not exists notified_message_id bigint;
create index if not exists agent_messages_notified_msg_idx on agent_messages (notified_message_id);

-- Owner-authored entries show on the feed as their own kind.
alter table agent_messages drop constraint if exists agent_messages_kind_check;
alter table agent_messages add constraint agent_messages_kind_check
  check (kind in ('handoff', 'learning', 'logic_change', 'report', 'correction', 'note'));
