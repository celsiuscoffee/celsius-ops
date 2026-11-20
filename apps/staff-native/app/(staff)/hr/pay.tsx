import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { CalendarDays, CheckCircle2, Clock, FileText, Hourglass, Moon, Receipt, Wallet } from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { Card, EmptyState, KeyNumber, List, ListRow, Section, SkeletonList } from "../../../components/ui";
import { fetchPay, type PayRunStatus, type PaySummary, type PayWeek } from "../../../lib/hr/api";
import { useCelsius } from "../../../lib/celsius-ui";

// Pay (owner 20 Nov 2026): the same summary as the staff web Pay page, from
// /api/hr/pay. Every number is payroll's own; this screen only shows it.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const rm = (n: unknown) => `RM ${(Number(n ?? 0) || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs = (h: unknown) => {
  const v = Math.round((Number(h ?? 0) || 0) * 100) / 100;
  return `${v} ${v === 1 ? "hr" : "hrs"}`;
};
const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
const dayMonth = (d: string) => {
  const [, m, day] = d.slice(0, 10).split("-").map(Number);
  return `${day} ${(MONTHS[m - 1] ?? "").slice(0, 3)}`;
};
const dayLabel = (d: string) => `${DOW[new Date(`${d.slice(0, 10)}T00:00:00Z`).getUTCDay()]} ${dayMonth(d)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Tone = "neutral" | "ok" | "warn" | "info";
function statusWords(s: PayRunStatus | "not_started"): { title: string; tone: Tone } {
  if (s === "paid") return { title: "Paid", tone: "ok" };
  if (s === "confirmed") return { title: "Ready, confirmed by HR", tone: "ok" };
  if (s === "preparing") return { title: "Being prepared by HR", tone: "info" };
  return { title: "Not started yet", tone: "neutral" };
}

const Amount = ({ n }: { n: number }) => (
  <Text className="text-base font-body-semi text-text" style={{ fontVariant: ["tabular-nums"] }}>
    {rm(n)}
  </Text>
);

function Hero({ eyebrow, value, note, footer }: { eyebrow: string; value: string; note: string; footer: string }) {
  const C = useCelsius().color;
  return (
    <Card>
      <Text className="text-sm font-body-semi text-text-2">{eyebrow}</Text>
      <Text className="mt-1 text-3xl font-display text-text" style={{ fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
      <Text className="mt-1 text-sm font-body text-text-3">{note}</Text>
      <View className="mt-3 flex-row items-center gap-2 border-t border-line pt-3">
        <CalendarDays color={C["text-3"]} size={18} />
        <Text className="flex-1 text-base font-body text-text">{footer}</Text>
      </View>
    </Card>
  );
}

function Monthly({ pay }: { pay: PaySummary }) {
  const router = useRouter();
  const m = pay.monthly!;
  const last = pay.lastMonth;
  const a = m.allowance;
  const month = monthName(m.month);
  const ls = last ? statusWords(last.status) : null;
  return (
    <>
      <Hero
        eyebrow={`${month} pay so far`}
        value={m.soFar == null ? "Not set up" : rm(m.soFar)}
        note={
          m.soFar == null
            ? "Your salary is not on file yet. Ask your manager."
            : "Estimate before deductions: basic salary, allowance so far and fixed additions. Approved overtime is added by payroll at month end."
        }
        footer={m.payday ? `Payday ${dayLabel(m.payday)}` : "Paid by the 7th of next month"}
      />

      {last && ls ? (
        <Section title={`${monthName(last.month)} pay`}>
          <List>
            <ListRow
              icon={ls.tone === "ok" ? CheckCircle2 : Hourglass}
              tone={ls.tone}
              title={ls.title}
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
          </List>
        </Section>
      ) : null}

      <Section title="Overtime">
        <Card>
          <View className="flex-row gap-4">
            <KeyNumber label="Approved" value={hrs(m.overtime.approvedHours)} hint={`In ${month}`} tone={m.overtime.approvedHours > 0 ? "success" : "default"} />
            <KeyNumber
              label="With your manager"
              value={hrs(m.overtime.waitingHours)}
              hint={m.overtime.waitingHours > 0 ? "Not yet approved" : "Nothing waiting"}
              tone={m.overtime.waitingHours > 0 ? "warn" : "default"}
            />
          </View>
        </Card>
        {m.overtime.waiting.length > 0 ? (
          <View className="mt-3">
            <List>
              {m.overtime.waiting.map((w) => (
                <ListRow key={w.date} icon={Moon} tone="info" title={`${dayLabel(w.date)} · ${hrs(w.hours)}`} meta="With your manager" onPress={() => router.push("/(staff)/hr/attendance")} />
              ))}
            </List>
          </View>
        ) : null}
      </Section>

      <Section title="What makes up the estimate">
        <List>
          <ListRow icon={Wallet} title="Basic salary" meta="Every month, as your letter says" trailing={m.basicSalary == null ? undefined : <Amount n={m.basicSalary} />} />
          {a.state === "counted" ? (
            <ListRow
              icon={Receipt}
              title="Allowance so far"
              meta={`Of ${rm(a.max)} · ${plural(a.daysRemaining, "day")} left · final at month end`}
              trailing={<Amount n={a.earned} />}
              onPress={() => router.push("/(staff)/hr/scoreboard")}
            />
          ) : null}
          {a.state === "probation" ? (
            <ListRow
              icon={Receipt}
              tone="info"
              title="Allowance"
              meta={`Scored ${rm(a.earned)} of ${rm(a.max)}. Paid once you are confirmed`}
              trailing={<Amount n={0} />}
              onPress={() => router.push("/(staff)/hr/scoreboard")}
            />
          ) : null}
          {a.state === "unavailable" ? <ListRow icon={Receipt} tone="warn" title="Allowance did not load" meta="The rest is right. Try again in a minute" /> : null}
          {m.additions.map((x) => (
            <ListRow key={x.label} icon={Receipt} title={x.label} meta="Fixed, every month" trailing={<Amount n={x.amount} />} />
          ))}
        </List>
      </Section>
    </>
  );
}

const weekMeta = (w: PayWeek) => `${dayMonth(w.start)} – ${dayMonth(w.end)}`;

function Weekly({ pay }: { pay: PaySummary }) {
  const { thisWeek: t, lastWeek: l } = pay.weekly!;
  const waiting = l.shifts - l.signedOff;
  const ls = l.run ? statusWords(l.run.status) : null;
  return (
    <>
      <Hero
        eyebrow="This week so far"
        value={plural(t.shifts, "shift")}
        note={`${hrs(t.clockedHours)} clocked · ${t.signedOff} of ${t.shifts} signed off by your manager${t.onShift ? " · on shift now" : ""}`}
        footer="Paid weekly, once your manager signs off your shifts"
      />

      <Section title={`This week · ${weekMeta(t)}`}>
        <Card>
          <View className="flex-row gap-4">
            <KeyNumber label="Signed off" value={`${t.signedOff} of ${t.shifts}`} hint="By your manager" tone={t.shifts > 0 && t.signedOff === t.shifts ? "success" : "default"} />
            <KeyNumber
              label="Overtime"
              value={hrs(t.otApprovedHours)}
              hint={t.otWaitingHours > 0 ? `${hrs(t.otWaitingHours)} with your manager` : "Approved this week"}
              tone={t.otWaitingHours > 0 ? "warn" : "default"}
            />
          </View>
        </Card>
      </Section>

      <Section title={`Last week · ${weekMeta(l)}`}>
        <List>
          {l.run && ls ? (
            <ListRow
              icon={ls.tone === "ok" ? CheckCircle2 : Hourglass}
              tone={ls.tone}
              title={ls.title}
              meta={l.run.payday ? `Payday ${dayLabel(l.run.payday)}` : `${plural(l.shifts, "shift")} · ${hrs(l.clockedHours)} clocked`}
            />
          ) : l.shifts === 0 ? (
            <ListRow icon={Clock} title="No shifts last week" />
          ) : waiting > 0 ? (
            <ListRow
              icon={Hourglass}
              tone="warn"
              title={`${plural(waiting, "shift")} waiting for your manager`}
              meta={`${l.signedOff} of ${l.shifts} signed off. Pay is worked out after all are signed off`}
            />
          ) : (
            <ListRow icon={CheckCircle2} tone="ok" title="All shifts signed off" meta="Being prepared by HR" />
          )}
          {l.otWaitingHours > 0 ? <ListRow icon={Moon} tone="info" title={`Overtime · ${hrs(l.otWaitingHours)}`} meta="With your manager" /> : null}
        </List>
      </Section>
    </>
  );
}

export default function PayScreen() {
  const router = useRouter();
  const C = useCelsius().color;
  const [refreshing, setRefreshing] = useState(false);
  const { data: pay, isLoading, error, refetch } = useQuery({ queryKey: ["hr-pay"], queryFn: fetchPay });
  const status = (error as { status?: number } | null)?.status;

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader title="Pay" subtitle={pay ? dayLabel(pay.today) : "Your pay as it stands"} back />
      <ScrollView
        contentContainerClassName="pb-8"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await refetch().finally(() => setRefreshing(false));
            }}
            tintColor={C["text-3"]}
            colors={[C["text-2"]]}
          />
        }
      >
        {isLoading ? <SkeletonList /> : null}
        {error && status === 404 ? <EmptyState icon={Wallet} title="Your pay details are not set up yet" subtitle="Ask your manager to add them." /> : null}
        {error && status !== 404 ? (
          <EmptyState icon={Wallet} title="Pay did not load" subtitle="Check your connection and pull down to try again." />
        ) : null}

        {pay ? (
          <>
            {pay.cycle === "monthly" && pay.monthly ? <Monthly pay={pay} /> : pay.weekly ? <Weekly pay={pay} /> : null}
            <Section title="Latest payslip">
              <List>
                <ListRow
                  icon={FileText}
                  title={pay.latestPayslip ? pay.latestPayslip.label : "No payslip yet"}
                  meta={pay.latestPayslip ? "Net pay · tap for all payslips" : "All payslips"}
                  trailing={pay.latestPayslip ? <Amount n={pay.latestPayslip.netPay} /> : undefined}
                  onPress={() => router.push("/(staff)/hr/payslips")}
                />
              </List>
            </Section>
            <Text className="mt-4 px-1 text-xs font-body text-text-3">Before EPF, SOCSO, EIS and tax. Your payslip is final.</Text>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export { RouteErrorFallback as ErrorBoundary } from "../../../components/RouteErrorBoundary";
