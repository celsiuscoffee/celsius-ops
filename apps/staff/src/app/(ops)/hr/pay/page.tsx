"use client";

// Pay (owner, 20 Nov 2026): pay for the month so far, payday, overtime still
// waiting, the allowance and the latest payslip, so staff stop asking "is my
// pay ready?". Modelled on Gosamē's Staff app Pay tab. Every number comes
// from /api/hr/pay (payroll's own data); this page only shows it. Not a
// payslip: no deductions here, and the payslip is final.
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { CalendarDays, CheckCircle2, ChevronRight, Clock, FileText, Hourglass, Moon, Receipt, Wallet } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import { HRPageHeader } from "@/components/hr-page-header";
import { KeyNumber } from "@/components/key-number";
import { FetchError } from "@/components/fetch-error";
import { dayLabel, dayMonth, hoursWords, monthName, rm, type PayResponse, type RunStatus, type WeekSummary } from "@/lib/hr/pay-summary";

type Tone = "ok" | "warn" | "info" | undefined;

function Row({ icon: Icon, title, meta, trailing, href, tone }: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  meta?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  tone?: Tone;
}) {
  const tile = tone === "ok" ? "bg-ok-soft text-ok-text" : tone === "warn" ? "bg-warn-soft text-warn-text" : tone === "info" ? "bg-info-soft text-info-text" : "bg-sunken text-text-2";
  const body = (
    <>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tile}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-text">{title}</span>
        {meta && <span className="block text-[13px] text-text-3">{meta}</span>}
      </span>
      {trailing}
      {href && <ChevronRight className="h-5 w-5 shrink-0 text-text-3" />}
    </>
  );
  const cls = "flex min-h-[60px] items-center gap-3 px-4 py-2.5";
  return href ? <Link href={href} className={`${cls} active:bg-sunken`}>{body}</Link> : <div className={cls}>{body}</div>;
}

function Group({ title, meta, children }: { title?: string; meta?: string; children: ReactNode }) {
  return (
    <section>
      {title && (
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold text-text-2">{title}</h2>
          {meta && <span className="text-[13px] text-text-3">{meta}</span>}
        </div>
      )}
      <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">{children}</div>
    </section>
  );
}

const Amount = ({ n }: { n: number }) => <span className="shrink-0 font-semibold tabular-nums text-text">{rm(n)}</span>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Is my pay ready?" in one line per state. */
function statusWords(status: RunStatus | "not_started"): { title: string; tone: Tone } {
  if (status === "paid") return { title: "Paid", tone: "ok" };
  if (status === "confirmed") return { title: "Ready, confirmed by HR", tone: "ok" };
  if (status === "preparing") return { title: "Being prepared by HR", tone: "info" };
  return { title: "Not started yet", tone: undefined };
}

function Hero({ eyebrow, value, children }: { eyebrow: string; value: string; children?: ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <p className="text-[13px] font-medium text-text-2">{eyebrow}</p>
      <p className="mt-1 text-[32px] font-semibold leading-10 tabular-nums text-text">{value}</p>
      {children}
    </div>
  );
}

function MonthlyView({ pay }: { pay: PayResponse }) {
  const m = pay.monthly!;
  const last = pay.lastMonth;
  const month = monthName(m.month);
  const a = m.allowance;
  const lastStatus = last ? statusWords(last.status) : null;
  return (
    <>
      <Hero eyebrow={`${month} pay so far`} value={m.soFar == null ? "Not set up" : rm(m.soFar)}>
        <p className="mt-1 text-[13px] text-text-3">
          {m.soFar == null
            ? "Your salary is not on file yet. Ask your manager."
            : "Estimate before deductions: basic salary, allowance so far and fixed additions. Approved overtime is added by payroll at month end."}
        </p>
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-[15px] text-text">
          <CalendarDays className="h-5 w-5 shrink-0 text-text-3" />
          {m.payday ? <span>Payday <b className="font-semibold">{dayLabel(m.payday)}</b></span> : <span>Paid by the 7th of next month</span>}
        </div>
      </Hero>

      {last && lastStatus && (
        <Group title={`${monthName(last.month)} pay`}>
          <Row
            icon={lastStatus.tone === "ok" ? CheckCircle2 : Hourglass}
            tone={lastStatus.tone}
            title={lastStatus.title}
            meta={
              last.opensOn
                ? `Your payslip opens on ${dayLabel(last.opensOn)}`
                : last.payday
                  ? `Payday ${dayLabel(last.payday)}`
                  : last.status === "paid" || last.status === "confirmed"
                    ? "Your payslip is below"
                    : "Paid by the 7th"
            }
          />
        </Group>
      )}

      <div className="grid grid-cols-2 gap-3">
        <KeyNumber label="Overtime approved" value={hoursWords(m.overtime.approvedHours)} note={`In ${month}`} tone={m.overtime.approvedHours > 0 ? "ok" : undefined} />
        <KeyNumber
          label="With your manager"
          value={hoursWords(m.overtime.waitingHours)}
          note={m.overtime.waitingHours > 0 ? "Overtime not yet approved" : "Nothing waiting"}
          tone={m.overtime.waitingHours > 0 ? "warn" : undefined}
          href={m.overtime.waitingHours > 0 ? "/hr/attendance" : undefined}
        />
      </div>

      {m.overtime.waiting.length > 0 && (
        <Group title="Overtime waiting" meta={hoursWords(m.overtime.waitingHours)}>
          {m.overtime.waiting.map((w) => (
            <Row key={w.date} icon={Moon} tone="info" title={`${dayLabel(w.date)} · ${hoursWords(w.hours)}`} meta="With your manager" href="/hr/attendance" />
          ))}
        </Group>
      )}

      <Group title="What makes up the estimate">
        <Row icon={Wallet} title="Basic salary" meta="Every month, as your letter says" trailing={m.basicSalary == null ? undefined : <Amount n={m.basicSalary} />} />
        {a.state === "counted" && (
          <Row icon={Receipt} title="Allowance so far" meta={`Of ${rm(a.max)} · ${plural(a.daysRemaining, "day")} left · final at month end`} trailing={<Amount n={a.earned} />} href="/hr" />
        )}
        {a.state === "probation" && (
          <Row icon={Receipt} tone="info" title="Allowance" meta={`Scored ${rm(a.earned)} of ${rm(a.max)}. Paid once you are confirmed`} trailing={<Amount n={0} />} href="/hr" />
        )}
        {a.state === "unavailable" && <Row icon={Receipt} tone="warn" title="Allowance did not load" meta="The rest is right. Try again in a minute" />}
        {m.additions.map((x) => (
          <Row key={x.label} icon={Receipt} title={x.label} meta="Fixed, every month" trailing={<Amount n={x.amount} />} />
        ))}
      </Group>
    </>
  );
}

function weekMeta(w: WeekSummary) {
  return `${dayMonth(w.start)} – ${dayMonth(w.end)}`;
}

function WeeklyView({ pay }: { pay: PayResponse }) {
  const { thisWeek: t, lastWeek: l } = pay.weekly!;
  const waitingSignOff = l.shifts - l.signedOff;
  const lastStatus = l.run ? statusWords(l.run.status) : null;
  return (
    <>
      <Hero eyebrow="This week so far" value={plural(t.shifts, "shift")}>
        <p className="mt-1 text-[13px] text-text-3">
          {hoursWords(t.clockedHours)} clocked · {t.signedOff} of {t.shifts} signed off by your manager{t.onShift ? " · on shift now" : ""}
        </p>
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-[15px] text-text">
          <CalendarDays className="h-5 w-5 shrink-0 text-text-3" />
          <span>Paid weekly, once your manager signs off your shifts</span>
        </div>
      </Hero>

      <div className="grid grid-cols-2 gap-3">
        <KeyNumber label="Signed off" value={`${t.signedOff} of ${t.shifts}`} note={weekMeta(t)} tone={t.shifts > 0 && t.signedOff === t.shifts ? "ok" : undefined} />
        <KeyNumber
          label="Overtime"
          value={hoursWords(t.otApprovedHours)}
          note={t.otWaitingHours > 0 ? `${hoursWords(t.otWaitingHours)} with your manager` : "Approved this week"}
          tone={t.otWaitingHours > 0 ? "warn" : undefined}
        />
      </div>

      <Group title="Last week" meta={weekMeta(l)}>
        {l.run && lastStatus ? (
          <Row icon={lastStatus.tone === "ok" ? CheckCircle2 : Hourglass} tone={lastStatus.tone} title={lastStatus.title}
            meta={l.run.payday ? `Payday ${dayLabel(l.run.payday)}` : `${plural(l.shifts, "shift")} · ${hoursWords(l.clockedHours)} clocked`} />
        ) : l.shifts === 0 ? (
          <Row icon={Clock} title="No shifts last week" />
        ) : waitingSignOff > 0 ? (
          <Row icon={Hourglass} tone="warn" title={`${plural(waitingSignOff, "shift")} waiting for your manager`}
            meta={`${l.signedOff} of ${l.shifts} signed off. Pay is worked out after all are signed off`} />
        ) : (
          <Row icon={CheckCircle2} tone="ok" title="All shifts signed off" meta="Being prepared by HR" />
        )}
        {l.otWaitingHours > 0 && <Row icon={Moon} tone="info" title={`Overtime · ${hoursWords(l.otWaitingHours)}`} meta="With your manager" />}
      </Group>
    </>
  );
}

function LatestPayslip({ slip }: { slip: PayResponse["latestPayslip"] }) {
  return (
    <Group title="Latest payslip">
      {slip ? (
        <Row icon={FileText} title={slip.label} meta="Net pay · tap for all payslips" trailing={<Amount n={slip.netPay} />} href="/hr/payslips" />
      ) : (
        <Row icon={FileText} title="No payslip yet" meta="All payslips" href="/hr/payslips" />
      )}
    </Group>
  );
}

export default function PayPage() {
  const { data: pay, error, mutate } = useFetch<PayResponse>("/api/hr/pay");
  const noProfile = !!error && String(error.message).includes("404");

  return (
    <div className="px-4 pb-6">
      <HRPageHeader title="Pay" subtitle={pay ? dayLabel(pay.today) : "Your pay as it stands"} />

      {!pay && !error && (
        <div aria-busy aria-label="Loading" className="space-y-3">
          <div className="h-40 animate-pulse rounded-card bg-sunken" />
          <div className="h-24 animate-pulse rounded-card bg-sunken" />
          <div className="h-32 animate-pulse rounded-card bg-sunken" />
        </div>
      )}

      {noProfile && (
        <div className="rounded-card border border-line bg-surface p-5 text-center">
          <Wallet className="mx-auto mb-2 h-6 w-6 text-text-3" />
          <p className="font-semibold text-text">Your pay details are not set up yet</p>
          <p className="mt-0.5 text-[13px] text-text-3">Ask your manager to add them.</p>
        </div>
      )}
      {error && !noProfile && <FetchError error={error} onRetry={() => mutate()} what="your pay" />}

      {pay && (
        <div className="space-y-5">
          {pay.cycle === "monthly" && pay.monthly ? <MonthlyView pay={pay} /> : pay.weekly ? <WeeklyView pay={pay} /> : null}
          <LatestPayslip slip={pay.latestPayslip} />
          <p className="flex items-start gap-2 px-1 text-[12px] text-text-3">
            <FileText className="mt-px h-4 w-4 shrink-0" />
            Before EPF, SOCSO, EIS and tax. Your payslip is final.
          </p>
        </div>
      )}
    </div>
  );
}
