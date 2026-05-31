import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { fetchPayslips, type Payslip } from "../../../lib/hr/api";

export default function PayslipsScreen() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["hr-payslips"],
    queryFn: fetchPayslips,
  });
  const payslips = data?.payslips ?? [];

  return (
    <Screen>
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
          contentContainerClassName="pt-2 pb-8"
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

function PayslipCard({ payslip }: { payslip: Payslip }) {
  const run = payslip.hr_payroll_runs;
  const periodLabel = new Date(run.period_year, run.period_month - 1, 1)
    .toLocaleDateString([], { month: "long", year: "numeric" });
  return (
    <View className="rounded-3xl border border-border bg-surface p-5">
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="text-xs font-body-semi text-muted uppercase tracking-wide">
            {periodLabel}
          </Text>
          <Text className="mt-1 text-2xl font-display text-espresso">
            RM {Number(payslip.net_pay).toFixed(2)}
          </Text>
        </View>
        <View
          className={`rounded-full px-3 py-1 ${
            run.status === "paid" ? "bg-success/10" : "bg-primary-50"
          }`}
        >
          <Text
            className={`text-xs font-body-bold uppercase ${
              run.status === "paid" ? "text-success" : "text-primary"
            }`}
          >
            {run.status}
          </Text>
        </View>
      </View>
      <View className="mt-3 border-t border-border pt-3 gap-1">
        <PayRow label="Base" value={Number(payslip.base_salary)} />
        {Number(payslip.overtime_pay) > 0 ? (
          <PayRow label="Overtime" value={Number(payslip.overtime_pay)} />
        ) : null}
        {Number(payslip.allowances) > 0 ? (
          <PayRow label="Allowances" value={Number(payslip.allowances)} />
        ) : null}
        <PayRow label="EPF" value={-Number(payslip.epf_employee)} />
        <PayRow label="SOCSO" value={-Number(payslip.socso_employee)} />
        {Number(payslip.eis_employee) > 0 ? (
          <PayRow label="EIS" value={-Number(payslip.eis_employee)} />
        ) : null}
        {Number(payslip.pcb) > 0 ? (
          <PayRow label="PCB" value={-Number(payslip.pcb)} />
        ) : null}
      </View>
    </View>
  );
}

function PayRow({ label, value }: { label: string; value: number }) {
  const isNeg = value < 0;
  return (
    <View className="flex-row justify-between">
      <Text className="text-sm font-body text-muted-fg">{label}</Text>
      <Text
        className={`text-sm font-body-medium ${
          isNeg ? "text-danger" : "text-espresso"
        }`}
      >
        {isNeg ? "−" : ""}RM {Math.abs(value).toFixed(2)}
      </Text>
    </View>
  );
}
