-- 096: protect posted journals — period locks and balance hold AFTER posting.
--
-- The 002/004 triggers only fire on the transition INTO status='posted'
-- (fin_check_balanced, fin_check_period_open) and there are no triggers on
-- fin_journal_lines at all. Two live code paths exploit that hole today:
--   - the bank GL poster's fold-in updates line amounts on already-posted
--     journals (gl-posting.ts), with nothing re-checking balance or period;
--   - its GC pass deletes posted journals outright, period-unchecked.
-- A closed month's numbers could therefore drift after close with no error.
--
-- This migration adds:
--   1. fin_fold_bank_journal(): the fold-in as ONE atomic, period-checked,
--      balance-preserving SQL function (the app previously updated the two
--      lines in two separate HTTP requests — momentarily unbalanced and
--      impossible to guard).
--   2. fin_gc_bank_journals(): atomic GC that re-verifies orphan-ness and
--      refuses closed periods; relies on the fin_journal_lines FK cascade.
--   3. Row triggers on fin_journal_lines: closed-period guard (immediate)
--      and a DEFERRED balance re-check for any posted parent.
--   4. A posted-transaction guard on fin_transactions: no delete, and no
--      amount/date/company/outlet change, once its period is closed.
--      (Status transitions — e.g. posted→reversed — stay allowed: the
--      reversal flow marks old originals reversed while posting the offset
--      into the current period. Whether reports should keep counting
--      'reversed' originals in closed periods is a separate question.)

-- ── 1. Atomic fold-in ─────────────────────────────────────────────────────
create or replace function fin_fold_bank_journal(p_txn_id text, p_new_total numeric)
returns void language plpgsql security definer as $$
declare
  v_txn record;
  v_period_status text;
  v_lines int;
begin
  if p_new_total is null or p_new_total <= 0 then
    raise exception 'fin_fold_bank_journal: total must be > 0 (got %)', p_new_total;
  end if;
  select id, company_id, period, status, posted_by_agent into v_txn
    from fin_transactions where id = p_txn_id for update;
  if not found then
    raise exception 'fin_fold_bank_journal: transaction % not found', p_txn_id;
  end if;
  if v_txn.status <> 'posted' or v_txn.posted_by_agent <> 'bank' then
    raise exception 'fin_fold_bank_journal: % is not a posted bank journal', p_txn_id;
  end if;
  select status into v_period_status from fin_periods
    where company_id = v_txn.company_id and period = v_txn.period;
  if v_period_status = 'closed' then
    raise exception 'fin_fold_bank_journal: period % is closed for %', v_txn.period, v_txn.company_id;
  end if;
  select count(*) into v_lines from fin_journal_lines where transaction_id = p_txn_id;
  if v_lines <> 2 then
    raise exception 'fin_fold_bank_journal: journal % has % lines; expected 2', p_txn_id, v_lines;
  end if;
  update fin_journal_lines set debit  = p_new_total where transaction_id = p_txn_id and debit  > 0;
  update fin_journal_lines set credit = p_new_total where transaction_id = p_txn_id and credit > 0;
  update fin_transactions set amount = p_new_total where id = p_txn_id;
end $$;

-- ── 2. Atomic, period-checked GC ──────────────────────────────────────────
-- Deletes only ids that are (still) posted bank journals with zero bank-line
-- references and an OPEN period; the FK cascade removes their lines in the
-- same transaction. Returns how many were actually deleted, so the caller's
-- count reflects skips.
create or replace function fin_gc_bank_journals(p_ids text[])
returns integer language plpgsql security definer as $$
declare
  v_deleted integer;
begin
  delete from fin_transactions t
  where t.id = any(p_ids)
    and t.posted_by_agent = 'bank'
    and t.status = 'posted'
    and not exists (select 1 from "BankStatementLine" b where b."glTransactionId" = t.id)
    and coalesce((select p.status from fin_periods p
                   where p.company_id = t.company_id and p.period = t.period), 'open') <> 'closed';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

-- ── 3. Journal-line guards ────────────────────────────────────────────────
-- Immediate: lines of a posted/reversed transaction are frozen once the
-- period closes. Parent-missing is allowed — that is the FK cascade midway
-- through a transaction delete, which the transaction-level guard has
-- already vetted.
create or replace function fin_journal_line_guard() returns trigger
language plpgsql security definer as $$
declare
  v_txn record;
  v_period_status text;
begin
  select company_id, period, status into v_txn
    from fin_transactions where id = coalesce(new.transaction_id, old.transaction_id);
  if not found then
    return coalesce(new, old);
  end if;
  if v_txn.status in ('posted', 'reversed') then
    select status into v_period_status from fin_periods
      where company_id = v_txn.company_id and period = v_txn.period;
    if v_period_status = 'closed' then
      raise exception 'Journal lines of % transaction in closed period % (%) cannot be modified',
        v_txn.status, v_txn.period, v_txn.company_id;
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_fin_journal_lines_guard on fin_journal_lines;
create trigger trg_fin_journal_lines_guard
  before insert or update or delete on fin_journal_lines
  for each row execute function fin_journal_line_guard();

-- Deferred: whatever a transaction did to the lines of a POSTED journal, at
-- commit the journal must still balance and still have lines. Fires per
-- affected row (volumes are small); parent-missing means the whole journal
-- was deleted — nothing left to balance.
create or replace function fin_journal_lines_balance_check() returns trigger
language plpgsql security definer as $$
declare
  v_txn_id text := coalesce(new.transaction_id, old.transaction_id);
  v_status text;
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_count int;
begin
  select status into v_status from fin_transactions where id = v_txn_id;
  if not found or v_status <> 'posted' then
    return null;
  end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0), count(*)
    into v_debit, v_credit, v_count
    from fin_journal_lines where transaction_id = v_txn_id;
  if v_count = 0 then
    raise exception 'Posted transaction % would be left with no journal lines', v_txn_id;
  end if;
  if v_debit <> v_credit then
    raise exception 'Posted transaction % would be unbalanced: debit=% credit=%', v_txn_id, v_debit, v_credit;
  end if;
  return null;
end $$;

drop trigger if exists trg_fin_journal_lines_balance on fin_journal_lines;
create constraint trigger trg_fin_journal_lines_balance
  after insert or update or delete on fin_journal_lines
  deferrable initially deferred
  for each row execute function fin_journal_lines_balance_check();

-- ── 4. Posted-transaction guard ───────────────────────────────────────────
create or replace function fin_txn_guard() returns trigger
language plpgsql security definer as $$
declare
  v_period_status text;
begin
  if old.status <> 'posted' then
    return coalesce(new, old);
  end if;
  select status into v_period_status from fin_periods
    where company_id = old.company_id and period = old.period;
  if v_period_status <> 'closed' or v_period_status is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Posted transaction % in closed period % (%) cannot be deleted',
      old.id, old.period, old.company_id;
  end if;
  if new.amount is distinct from old.amount
     or new.txn_date is distinct from old.txn_date
     or new.company_id is distinct from old.company_id
     or new.outlet_id is distinct from old.outlet_id then
    raise exception 'Posted transaction % in closed period % (%) cannot change amount/date/company/outlet',
      old.id, old.period, old.company_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_fin_transactions_guard on fin_transactions;
create trigger trg_fin_transactions_guard
  before update or delete on fin_transactions
  for each row execute function fin_txn_guard();
