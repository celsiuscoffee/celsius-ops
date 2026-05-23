import { ScrollView, Text, View } from "react-native";
import { Link } from "expo-router";
import { Calendar, Clock, FileText, ListChecks, Plane } from "lucide-react-native";
import { Screen } from "../../../components/Screen";

const items = [
  { href: "/(staff)/hr/shifts", title: "My Shifts", subtitle: "Today and upcoming", icon: Calendar },
  { href: "/(staff)/hr/attendance", title: "Attendance", subtitle: "Clock-in history + overtime", icon: Clock },
  { href: "/(staff)/hr/leave", title: "Leave", subtitle: "Balances and requests", icon: Plane },
  { href: "/(staff)/hr/payslips", title: "Payslips", subtitle: "Monthly pay history", icon: FileText },
  { href: "/(staff)/hr/memos", title: "Memos", subtitle: "Notices from HR", icon: ListChecks },
] as const;

export default function HrIndex() {
  return (
    <Screen>
      <ScrollView contentContainerClassName="pt-8 pb-12">
        <Text className="text-3xl font-display text-espresso">HR</Text>
        <View className="mt-6 gap-3">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <Link key={it.href} href={it.href} asChild>
                <View className="flex-row items-center rounded-3xl border border-border bg-surface p-4 active:bg-primary-50">
                  <View className="h-12 w-12 items-center justify-center rounded-2xl bg-primary-50">
                    <Icon color="#A2492C" size={22} />
                  </View>
                  <View className="ml-4 flex-1">
                    <Text className="text-base font-display-medium text-espresso">
                      {it.title}
                    </Text>
                    <Text className="text-sm font-body text-muted-fg">
                      {it.subtitle}
                    </Text>
                  </View>
                </View>
              </Link>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}
