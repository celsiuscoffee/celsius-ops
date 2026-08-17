-- 095: make the finance audit actor real.
--
-- fin_set_actor() sets a TRANSACTION-local GUC (set_config(..., true)), but
-- every app caller invokes it as its own PostgREST .rpc() request — a separate
-- transaction on a pooled connection. The setting is gone before the actual
-- write request runs, so fin_audit() has recorded actor='system' on 100% of
-- writes since launch (29,631 rows in the 30 days before this migration).
--
-- Fix: the finance client now sends the actor as an `x-fin-actor` request
-- header on every PostgREST call (see apps/backoffice/src/lib/finance/
-- supabase.ts). PostgREST exposes request headers to SQL as the
-- `request.headers` GUC (JSON, lower-cased keys) within the SAME transaction
-- as the write, so the audit trigger can finally see who is acting.
--
-- Resolution order (fin_actor):
--   1. x-fin-actor request header   — the new, reliable path
--   2. app.actor GUC               — legacy fin_set_actor path, kept for any
--                                     future single-transaction (RPC) writers
--   3. 'system'                    — fallback; should now mean "write came
--                                     from outside the finance client"
--
-- fin_set_actor() itself is kept: harmless, and correct when a caller really
-- does bundle it into the same transaction as its write.

create or replace function fin_actor() returns text
language plpgsql stable as $$
declare
  v_header text;
begin
  begin
    v_header := nullif(current_setting('request.headers', true), '')::json ->> 'x-fin-actor';
  exception when others then
    v_header := null; -- malformed/absent headers must never break a write
  end;
  return coalesce(v_header, nullif(current_setting('app.actor', true), ''), 'system');
end $$;

comment on function fin_actor() is
  'Audit actor for fin_* writes: x-fin-actor request header, then app.actor GUC, then system.';

-- Same body as 002, with the actor resolution swapped to fin_actor().
create or replace function fin_audit() returns trigger
language plpgsql security definer as $$
declare
  v_actor text := fin_actor();
  v_row_id text;
begin
  if (tg_op = 'DELETE') then
    v_row_id := coalesce(to_jsonb(old)->>'id', to_jsonb(old)->>'code', '');
    insert into fin_audit_log(table_name, row_id, action, before, after, actor)
    values (tg_table_name, v_row_id, 'delete', to_jsonb(old), null, v_actor);
    return old;
  elsif (tg_op = 'UPDATE') then
    v_row_id := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'code', '');
    insert into fin_audit_log(table_name, row_id, action, before, after, actor)
    values (tg_table_name, v_row_id, 'update', to_jsonb(old), to_jsonb(new), v_actor);
    return new;
  elsif (tg_op = 'INSERT') then
    v_row_id := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'code', '');
    insert into fin_audit_log(table_name, row_id, action, before, after, actor)
    values (tg_table_name, v_row_id, 'insert', null, to_jsonb(new), v_actor);
    return new;
  end if;
  return null;
end $$;
