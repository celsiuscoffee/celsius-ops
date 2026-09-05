import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { ChevronDown, ChevronUp, Download } from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { fetchPayslips, fetchPayslipDownloadUrl, type Payslip } from "../../../lib/hr/api";

export default function PayslipsScreen() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["hr-payslips"],
    queryFn: fetchPayslips,
  });
  const payslips = data?.payslips ?? [];

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader title="Payslips" back />
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-sm text-danger text-center">
            {(error as Error).message}
          </Text>
        </View>
      ) : (
        <FlatList
          className="flex-1"
          contentContainerClassName="pt-2 pb-6"
          data={payslips}
          keyExtractor={(p) => p.id}
          ItemSeparatorComponent={() => <View className="h-3" />}
          renderItem={({ item }) => <PayslipCard payslip={item} />}
          ListEmptyComponent={
            <Text className="mt-12 text-center text-sm text-muted-fg">
              No confirmed payslips yet.
            </Text>
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </Screen>
  );
}

// The earnings lines exactly as the backoffice run page and the PDF label
// them (packages/shared/src/hr/pay-lines.ts): OT by rate with the hours, and
// the day-type pay — the 2× line carries the public-holiday second-day wage
// and the 1× line the rest-day day-pay, which are not overtime and were shown
// here as "Overtime".
function earningLinesFor(p: Payslip): Array<{ label: string; value: number }> {
  const n = (v: unknown) => Number(v ?? 0) || 0;
  const d = p.computation_details ?? {};
  const phPay = n(d.ph_premium_amount);
  const restPay = n(d.rest_day_pay_amount);
  const hrs = (h: number | undefined) => (h && h > 0 ? ` · ${h}h` : "");
  const lines: Array<{ label: string; value: number }> = [];
  const ot1 = n(p.ot_1x_amount) - restPay;
  const ot15 = n(p.ot_1_5x_amount);
  const ot2 = n(p.ot_2x_amount) - phPay;
  const ot3 = n(p.ot_3x_amount);
  if (ot1 > 0.004) lines.push({ label: `OT 1.0× (Plain Rate)${hrs(d.ot_hours_1x)}`, value: ot1 });
  if (ot15 > 0.004) lines.push({ label: `OT 1.5× (Weekday)${hrs(d.ot_hours_1_5x)}`, value: ot15 });
  if (ot2 > 0.004) lines.push({ label: `OT 2.0× (Rest Day)${hrs(d.ot_hours_2x)}`, value: ot2 });
  if (ot3 > 0.004) lines.push({ label: `OT 3.0× (Public Holiday)${hrs(d.ot_hours_3x)}`, value: ot3 });
  if (phPay > 0.004) {
    const days = n(d.ph_days_worked);
    lines.push({ label: `Public Holiday Pay (${days || 1} day${days === 1 || !days ? "" : "s"} × 2)`, value: phPay });
  }
  if (restPay > 0.004) {
    const days = n(d.rest_day_days_worked);
    lines.push({ label: `Rest Day Pay (${days || 1} day${days === 1 || !days ? "" : "s"})`, value: restPay });
  }
  // Older items have no detail block: fall back to one overtime line so the
  // gross still ties out.
  if (lines.length === 0 && n(p.overtime_pay) > 0.004) lines.push({ label: "Overtime", value: n(p.overtime_pay) });
  return lines;
}

// "18,040.67" with thousands separators. Hermes Intl is unreliable for grouping,
// so format the integer part by hand.
function amount(n: number): string {
  const [int, dec] = Math.abs(Number(n ?? 0)).toFixed(2).split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${dec}`;
}

function fmtDay(d: string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString([], { day: "numeric", month: "short" });
}

// A payslip is a collapsed summary row (period + net + status) that expands to
// the full breakdown on tap. With several months on file this keeps the list
// scannable, so a specific month is one glance away instead of a long scroll.
function PayslipCard({ payslip }: { payslip: Payslip }) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const run = payslip.hr_payroll_runs;

  // Fetch a short-lived signed URL over the authenticated API, then open it in
  // the system browser (which can't carry our Bearer token) to download the
  // official PDF — the same document HR issues, valid for loan applications.
  async function downloadPdf() {
    if (downloading) return;
    setDownloading(true);
    try {
      const { url } = await fetchPayslipDownloadUrl(payslip.id);
      await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      Alert.alert(
        "Couldn't open payslip",
        e instanceof Error ? e.message : "Please try again in a moment.",
      );
    } finally {
      setDownloading(false);
    }
  }

  // hr_payroll_runs is a joined relation; a filtered/absent run leaves it null,
  // and dereferencing period_year/status below would crash the whole list.
  if (!run) return null;

  // Weekly part-timer runs have null period_year/month, so label them by their
  // date range instead of month/year.
  const isWeekly = run.cycle_type === "weekly" || run.period_year == null;
  let periodLabel: string;
  if (isWeekly) {
    periodLabel = run.period_start
      ? `${fmtDay(run.period_start)} to ${fmtDay(run.period_end)}`
      : "Weekly pay";
  } else {
    periodLabel = new Date(run.period_year ?? 1970, (run.period_month ?? 1) - 1, 1)
      .toLocaleDateString([], { month: "long", year: "numeric" });
  }

  const base = Number(payslip.base_salary ?? 0);
  const allow = Number(payslip.allowances ?? 0);
  const gross = Number(payslip.total_gross ?? 0);
  const earningLines = earningLinesFor(payslip);

  const epf = Number(payslip.epf_employee ?? 0);
  const socso = Number(payslip.socso_employee ?? 0);
  const eis = Number(payslip.eis_employee ?? 0);
  const pcb = Number(payslip.pcb ?? 0);
  const totalDeductions = Number(payslip.total_deductions ?? 0);
  // Anything in total_deductions beyond the four statutory lines (advances,
  // manual deductions) shows as one honest "Other" row so the math ties out.
  const other = Math.max(0, totalDeductions - (epf + socso + eis + pcb));

  const net = Number(payslip.net_pay ?? 0);

  const epfEmployer = Number(payslip.epf_employer ?? 0);
  const socsoEmployer = Number(payslip.socso_employer ?? 0);
  const eisEmployer = Number(payslip.eis_employer ?? 0);
  const hasEmployer = epfEmployer + socsoEmployer + eisEmployer > 0;

  const paid = run.status === "paid";

  return (
    <View className="overflow-hidden rounded-3xl border border-border bg-surface">
      {/* Collapsed summary row: period + net + status, always visible */}
      <Pressable
        onPress={() => setOpen((o) => !o)}
        className="flex-row items-center gap-3 p-5 active:bg-primary-50"
      >
        <View className="flex-1">
          <Text className="text-base font-body-semi text-espresso">
            {periodLabel}
          </Text>
          <Text
            className={`mt-0.5 text-xs font-body-medium uppercase tracking-wide ${
              paid ? "text-success" : "text-primary"
            }`}
          >
            {run.status}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-[10px] font-body uppercase tracking-wide text-muted-fg">
            Net pay
          </Text>
          <Text className="text-lg font-display text-espresso">
            RM {amount(net)}
          </Text>
        </View>
        {open ? (
          <ChevronUp color="#9CA3AF" size={18} />
        ) : (
          <ChevronDown color="#9CA3AF" size={18} />
        )}
      </Pressable>

      {/* Full breakdown, revealed on tap */}
      {open ? (
        <View className="border-t border-border px-5 pb-5">
          {/* Earnings */}
          <SectionLabel>Earnings</SectionLabel>
          <View className="gap-1">
            <PayRow label={isWeekly ? "Hourly wages" : "Basic salary"} value={base} />
            {earningLines.map((l) => (
              <PayRow key={l.label} label={l.label} value={l.value} />
            ))}
            {allow > 0 ? <PayRow label="Performance Allowance" value={allow} /> : null}
          </View>
          <Subtotal label="Gross pay" value={gross} />

          {/* Deductions: always show the statutory four, even at zero, so it
              reads like a real payslip and a missing PCB is visible. */}
          <SectionLabel>Deductions</SectionLabel>
          <View className="gap-1">
            <PayRow label="EPF" value={-epf} />
            <PayRow label="SOCSO" value={-socso} />
            <PayRow label="EIS" value={-eis} />
            <PayRow label="PCB (tax)" value={-pcb} />
            {other > 0 ? <PayRow label="Other" value={-other} /> : null}
          </View>
          <Subtotal label="Total deductions" value={-totalDeductions} />

          {/* Net (restated as the closing line) */}
          <View className="mt-3 flex-row items-center justify-between border-t border-border pt-3">
            <Text className="text-sm font-body-bold text-espresso">Net pay</Text>
            <Text className="text-base font-display text-espresso">
              RM {amount(net)}
            </Text>
          </View>

          {/* Employer contributions: paid on top of salary, not deducted */}
          {hasEmployer ? (
            <View className="mt-4 rounded-2xl bg-primary-50 p-3">
              <Text className="text-xs font-body-semi text-muted uppercase tracking-wide">
                Employer contributions
              </Text>
              <Text className="mb-2 text-xs font-body text-muted-fg">
                Paid by Celsius on top of your salary. Not deducted from your pay.
              </Text>
              <View className="gap-1">
                <PayRow label="EPF" value={epfEmployer} muted />
                <PayRow label="SOCSO" value={socsoEmployer} muted />
                <PayRow label="EIS" value={eisEmployer} muted />
              </View>
            </View>
          ) : null}

          {/* Official PDF — full company details, statutory numbers and YTD,
              suitable for loan / financing applications. */}
          <Pressable
            onPress={downloadPdf}
            disabled={downloading}
            className="mt-4 flex-row items-center justify-center gap-2 rounded-2xl bg-primary py-3 active:opacity-80"
          >
            {downloading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Download color="#FFFFFF" size={18} />
            )}
            <Text className="text-sm font-body-semi text-white">
              {downloading ? "Preparing…" : "Download PDF"}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="mt-4 mb-2 text-xs font-body-semi text-muted uppercase tracking-wide">
      {children}
    </Text>
  );
}

function Subtotal({ label, value }: { label: string; value: number }) {
  const isNeg = value < 0;
  return (
    <View className="mt-2 flex-row justify-between border-t border-border pt-2">
      <Text className="text-sm font-body-semi text-espresso">{label}</Text>
      <Text className="text-sm font-body-bold text-espresso">
        {isNeg ? "-" : ""}RM {amount(value)}
      </Text>
    </View>
  );
}

function PayRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  const isNeg = value < 0;
  return (
    <View className="flex-row justify-between">
      <Text className="text-sm font-body text-muted-fg">{label}</Text>
      <Text
        className={`text-sm font-body-medium ${
          muted ? "text-muted-fg" : isNeg ? "text-danger" : "text-espresso"
        }`}
      >
        {isNeg ? "-" : ""}RM {amount(value)}
      </Text>
    </View>
  );
}

// Route-level boundary: a throw in this screen degrades to an inline retry
// card instead of unmounting the whole HR stack (see the Who's Working
// incident, docs in components/RouteErrorBoundary.tsx).
export { RouteErrorFallback as ErrorBoundary } from "../../../components/RouteErrorBoundary";
