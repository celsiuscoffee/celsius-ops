-- QR (DuitNow) tender reconciliation from source, exact to the cent.
-- QR-code tender sales (StoreHub archive + POS-native) vs bank QR-category
-- settlements, per month. Powers the DuitNow QR panel on /finance/reports
-- (Reconciliation tab). The commingled 1000-02 Cash & QR ledger account cannot
-- be split to the cent (daily EOD journals bucket cash/QR/e-wallet together), so
-- QR is reconciled straight off the tender source instead.
create or replace function fin_qr_tender_recon(p_start date, p_end date, p_company text default null)
returns table(month text, sales numeric, settled numeric)
language sql stable
set search_path = public, pg_temp
as $$
  with oc(outlet_id, company) as (values
    ('b3b6299e-09dc-4f4a-80ef-bbc04316d324','celsius'),
    ('89b19c9f-b1e0-42fe-a404-6d1a472e34c5','celsiusconezion'),
    ('5d1f2731-1985-4e54-a6df-3990e7d5c159','celsiustamarind'),
    ('outlet-sa','celsius'),('outlet-con','celsiusconezion'),('outlet-tam','celsiustamarind')),
  sales_rows as (
    select to_char(s.transaction_time,'YYYY-MM') m, (pmt->>'amount')::numeric amt
    from storehub_sales s join oc on oc.outlet_id=s.outlet_id,
         lateral jsonb_array_elements(s.raw->'payments') pmt
    where s.is_cancelled is not true and lower(pmt->>'paymentMethod')='qr code'
      and s.transaction_time>=p_start and s.transaction_time < (p_end + 1)
      and (p_company is null or oc.company=p_company)
    union all
    select to_char(o.created_at,'YYYY-MM'), p.amount/100.0
    from pos_order_payments p
      join pos_orders o on o.id=p.order_id and o.status='completed'
      join oc on oc.outlet_id=o.outlet_id
    where lower(p.payment_method)='qr'
      and o.created_at>=p_start and o.created_at < (p_end + 1)
      and (p_company is null or oc.company=p_company)),
  sales_m as (select m, round(sum(amt)::numeric,2) s from sales_rows group by 1),
  settle_m as (
    select to_char(bsl."txnDate",'YYYY-MM') m, round(sum(bsl.amount)::numeric,2) s
    from "BankStatementLine" bsl
      left join fin_transactions t on t.id=bsl."glTransactionId"
    where bsl.category='QR' and bsl.direction='CR'
      and bsl."txnDate">=p_start and bsl."txnDate" < (p_end + 1)
      and (p_company is null or t.company_id=p_company)
    group by 1)
  select coalesce(sa.m,se.m) as month, coalesce(sa.s,0) as sales, coalesce(se.s,0) as settled
  from sales_m sa full join settle_m se on se.m=sa.m
  order by 1;
$$;
