-- Deterministic posting identity for DERIVED journals (bank day-aggregates).
-- The idempotent poster (#694) stored its md5 aggregation key in
-- source_doc_id, which is an FK to fin_documents — every bank post failed the
-- constraint. Dedicated column instead, unique so a group can never post twice.
-- (Already applied to production 2026-07-02; file recorded for reproducibility.)
alter table fin_transactions add column if not exists posting_key uuid;
create unique index if not exists uq_fin_transactions_posting_key
  on fin_transactions(posting_key) where posting_key is not null;
