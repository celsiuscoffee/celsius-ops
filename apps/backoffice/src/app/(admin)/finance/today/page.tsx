"use client";

// Money › Today (owner, 20 Nov 2026): one list of money decisions, each with
// its own button, modelled on Gosamē Office's Money › Today. Key numbers on
// top, then payroll to approve, bills to pay this week, payment requests, and
// bank lines the matcher was not sure of. Empty sections are hidden.
//
// Reads only existing data:
//   GET /api/finance/today    bills, payment requests, payroll (read only)
//   GET /api/finance/ap-match the Bank inbox's own read (same request, so SWR
//                             shares it with /finance/recon)
//   GET /api/finance/home     cash in bank, as Overview already shows it
//
// Hard rule 6: nothing here pays or approves. Payroll and bills open their
// own pages, where the existing checks run. The one action on this page is
// the Bank inbox's own Match (POST /api/finance/bank-lines/match), behind a
// confirmation: it links a bank line that has already left the bank to its
// invoice, with that endpoint's own double-payment checks.

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { toast, useConfirm } from "@celsius/ui";
import { useFetch } from "@/lib/use-fetch";
import { KeyNumber } from "@/components/ui/key-number";
import { formatInboxTime } from "@/lib/inbox/format";
import {
  bankRowsToCheck,
  billHref,
  cashNote,
  dayWords,
  dueWords,
  moneyTodayCounts,
  payrollHref,
  payrollTitle,
  plural,
  rm,
  timeWords,
  type BankInboxRead,
  type BankMatch,
  type MoneyToday,
} from "@/lib/finance/money-today";

type HomeCash = { cashPosition: { code: string; name: string; balance: number }[] };

const SHOW = 8;
const BTN = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-ctl px-3 text-[13px] font-medium transition-colors disabled:opacity-50 max-md:h-10";
const PRIMARY = `${BTN} bg-ink text-on-ink hover:bg-ink-hover`;
const SECONDARY = `${BTN} border border-line-2 text-text hover:bg-sunken`;

export default function MoneyTodayPage() {
  const { data, error, isLoading, mutate } = useFetch<MoneyToday>("/api/finance/today");
  const bank = useFetch<BankInboxRead>("/api/finance/ap-match?sinceDays=90");
  const home = useFetch<HomeCash>("/api/finance/home");
  const [loadedAt] = useState(() => new Date());

  const c = moneyTodayCounts(data, bank.data);
  const loading = isLoading || bank.isLoading;
  const cash = home.data?.cashPosition?.[0];
  const unavailable = [...(data?.unavailable ?? []), ...(bank.error ? ["bank lines"] : [])];
  const refresh = () => { void mutate(); void bank.mutate(); void home.mutate(); };

  return (
    <div className="mx-auto max-w-[1240px] space-y-5 overflow-x-hidden px-4 pt-6 pb-10 md:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">
            {data ? `${dayWords(data.today)} · updated ${timeWords(loadedAt)}` : "Loading…"}
          </p>
          <h1 className="mt-1 text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Today</h1>
          <p className="mt-1 text-sm text-text-2">Money decisions waiting on you: payroll to approve, bills to pay, bank lines to check.</p>
        </div>
        <button type="button" onClick={refresh} className={SECONDARY}>
          <RefreshCw className="size-3.5" aria-hidden /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyNumber
          label="Cash in bank"
          value={home.data ? (cash ? rm(cash.balance) : "–") : home.error ? "–" : null}
          note={cashNote(cash?.name)}
          href="/finance/bank-statements"
        />
        <KeyNumber
          label="Bills due this week"
          value={data ? rm(c.billsTotal) : null}
          tone={c.billsLate > 0 ? "warn" : undefined}
          note={data ? `${plural(c.billsCount, "bill")}${c.billsLate ? ` · ${c.billsLate} late` : ""}` : ""}
        />
        <KeyNumber
          label="Bank lines to check"
          value={bank.data ? String(c.bankToCheck + c.doublePayments) : bank.error ? "–" : null}
          tone={c.doublePayments > 0 ? "warn" : undefined}
          note={c.doublePayments ? plural(c.doublePayments, "possible double payment") : "the matcher wasn't sure"}
          href="/finance/recon"
        />
        <KeyNumber
          label="Payroll waiting"
          value={data ? String(c.payrollWaiting) : null}
          note={c.payrollWaiting ? `${rm(c.payrollNet)} net pay` : "nothing to approve"}
        />
      </div>

      {unavailable.length > 0 && (
        <p className="flex items-center gap-2 rounded-card bg-warn-soft px-4 py-2.5 text-[13px] text-warn-text">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          Couldn&apos;t check {unavailable.join(", ")} just now, so the list may be short. Refresh to try again.
        </p>
      )}
      {error && !data && (
        <p className="rounded-card bg-danger-soft px-4 py-2.5 text-[13px] text-danger-text">
          Couldn&apos;t load today&apos;s money decisions. Refresh to try again.
        </p>
      )}

      {data && <PayrollSection data={data} />}
      {data && <BillsSection data={data} />}
      {data && <ClaimsSection data={data} />}
      {bank.data && <BankSection read={bank.data} onDone={() => void bank.mutate()} />}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-card border border-line bg-surface py-10 text-sm text-text-2">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Checking bills, bank lines and payroll…
        </div>
      ) : data && c.waiting === 0 && unavailable.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-card border border-line bg-surface px-4 py-14 text-center">
          <CheckCircle2 className="size-8 text-ok-text" aria-hidden />
          <p className="text-[15px] font-semibold text-text">Nothing waits on you.</p>
          <p className="text-[13px] text-text-2">No bills due this week, no bank lines to check and no payroll to approve.</p>
        </div>
      ) : null}
    </div>
  );
}

// ─── Building blocks ─────────────────────────────────────────────────────

function Section({ title, sub, href, linkLabel, children }: {
  title: string; sub?: string; href: string; linkLabel: string; children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-4 pb-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-text-3">{sub}</p>}
        </div>
        <Link href={href} className="inline-flex min-h-8 items-center gap-1 text-[13px] font-medium text-text hover:underline">
          {linkLabel} <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      <ul>{children}</ul>
    </section>
  );
}

function Row({ title, meta, amount, action, late }: {
  title: React.ReactNode; meta: React.ReactNode; amount?: number; action: React.ReactNode; late?: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-[13px] font-medium leading-[18px] text-text [overflow-wrap:anywhere]">{title}</p>
        <p className={"mt-0.5 text-xs [overflow-wrap:anywhere] " + (late ? "text-danger-text" : "text-text-3")}>{meta}</p>
      </div>
      <div className="ml-auto flex items-center gap-3">
        {amount != null && <span className="font-mono text-[13px] font-medium tabular-nums text-text">{rm(amount)}</span>}
        {action}
      </div>
    </li>
  );
}

function More({ shown, total, href, label }: { shown: number; total: number; href: string; label: string }) {
  if (total <= shown) return null;
  return (
    <li className="border-t border-line">
      <Link href={href} className="flex min-h-11 items-center gap-1 px-4 text-[13px] font-medium text-text hover:bg-sunken/60">
        {total - shown} more {label} <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </li>
  );
}

// ─── Sections ────────────────────────────────────────────────────────────

function PayrollSection({ data }: { data: MoneyToday }) {
  if (!data.payroll.length) return null;
  return (
    <Section title="Payroll to approve" sub="Worked out and waiting for you. Approve on the payroll page, after its checks." href="/hr/payroll" linkLabel="Open payroll">
      {data.payroll.map((r) => (
        <Row
          key={r.id}
          title={payrollTitle(r)}
          meta={<>Gross {rm(r.gross)}{r.computedAt ? ` · worked out ${formatInboxTime(r.computedAt)}` : ""}</>}
          amount={r.net}
          action={<Link href={payrollHref(r)} className={PRIMARY}>Review</Link>}
        />
      ))}
    </Section>
  );
}

function BillsSection({ data }: { data: MoneyToday }) {
  if (!data.bills.length) return null;
  const shown = data.bills.slice(0, SHOW);
  const total = data.bills.reduce((s, b) => s + b.amountDue, 0);
  return (
    <Section
      title="Bills to pay this week"
      sub={`${plural(data.bills.length, "bill")}, ${rm(Math.round(total * 100) / 100)} due by ${dayWords(data.weekEnd)}`}
      href="/inventory/invoices?cardFilter=payable"
      linkLabel="Open invoices"
    >
      {shown.map((b) => (
        <Row
          key={b.id}
          title={<>{b.supplier} <span className="font-normal text-text-3">· {b.invoiceNumber}</span></>}
          meta={<>{dueWords(b.dueDate, data.today)} · {b.outlet}{b.status === "DEPOSIT_PAID" || b.status === "PARTIALLY_PAID" ? " · balance left" : ""}</>}
          late={b.dueDate < data.today}
          amount={b.amountDue}
          action={<Link href={billHref(b)} className={PRIMARY}>Open</Link>}
        />
      ))}
      <More shown={shown.length} total={data.bills.length} href="/inventory/invoices?cardFilter=payable" label="bills in Invoices" />
    </Section>
  );
}

function ClaimsSection({ data }: { data: MoneyToday }) {
  if (!data.claims.length) return null;
  const shown = data.claims.slice(0, SHOW);
  return (
    <Section title="Payment requests" sub="Staff claims and payment requests waiting for approval" href="/inventory/pay-and-claim" linkLabel="Open bills">
      {shown.map((i) => (
        <Row
          key={i.id}
          title={i.title}
          meta={<>{i.from}{i.at ? ` · ${formatInboxTime(i.at)}` : ""}</>}
          amount={i.amountRM}
          action={<Link href={i.href} className={PRIMARY}>Review</Link>}
        />
      ))}
      <More shown={shown.length} total={data.claims.length} href="/inventory/pay-and-claim" label="requests" />
    </Section>
  );
}

function BankSection({ read, onDone }: { read: BankInboxRead; onDone: () => void }) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const rows = bankRowsToCheck(read);
  const doubles = read.doublePayments;
  if (!rows.length && !doubles.length) return null;
  const shown = rows.slice(0, SHOW);

  // The Bank inbox's own Confirm (POST /api/finance/bank-lines/match), with
  // that route's checks (owner/admin, line not already matched, invoice not
  // already settled by another line).
  const match = async (m: BankMatch) => {
    const ok = await confirm({
      title: `Match this bank line to ${m.invoiceNumber ?? "the invoice"}?`,
      description: `${m.bankDesc} (${dayWords(m.bankDate)}) is linked to ${m.payee}${m.invoiceNumber ? ` ${m.invoiceNumber}` : ""}, ${rm(m.amount)}, and the invoice is marked paid in the books unless it was already paid another way. Nothing is paid from here: the money has already left the bank.`,
      confirmLabel: "Match",
    });
    if (!ok) return;
    const key = m.bankLineId + m.invoiceId;
    setBusy(key);
    try {
      const res = await fetch("/api/finance/bank-lines/match", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankLineId: m.bankLineId, invoiceId: m.invoiceId }),
      });
      if (res.ok) toast.success(`Matched to ${m.payee}.`);
      else {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? "Couldn't match it. Try again, or match it in the Bank inbox.");
      }
      onDone();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Bank lines to check"
      sub="Likely matches the matcher wasn't sure of. Match links the line to its invoice; anything else, decide in the Bank inbox."
      href="/finance/recon"
      linkLabel="Open bank inbox"
    >
      <ConfirmDialog />
      {doubles.map((m) => (
        <Row
          key={`d-${m.bankLineId}-${m.invoiceId}`}
          title={<>Possible double payment: {m.payee} <span className="font-normal text-text-3">· {m.invoiceNumber ?? "no invoice number"}</span></>}
          meta={<>The invoice was already paid once · {m.bankDesc} · {dayWords(m.bankDate)}</>}
          late
          amount={m.amount}
          action={<Link href="/finance/recon" className={PRIMARY}>Review</Link>}
        />
      ))}
      {shown.map((m) => {
        const key = m.bankLineId + m.invoiceId;
        return (
          <Row
            key={key}
            title={<>{m.payee} <span className="font-normal text-text-3">· {m.invoiceNumber ?? "no invoice number"}</span></>}
            meta={<>{m.bankDesc} · {dayWords(m.bankDate)}{m.reasons.length ? ` · ${m.reasons.slice(0, 2).join(", ")}` : ""}</>}
            amount={m.amount}
            action={
              <button type="button" className={PRIMARY} disabled={!!busy} onClick={() => match(m)}>
                {busy === key && <Loader2 className="size-3.5 animate-spin" aria-hidden />}Match
              </button>
            }
          />
        );
      })}
      <More shown={shown.length} total={rows.length} href="/finance/recon" label="in the Bank inbox" />
    </Section>
  );
}
