import { Text, View } from "react-native";
import { Screen } from "../../components/Screen";
import { useStaff } from "../../lib/store";

export default function Home() {
  const session = useStaff((s) => s.session);
  return (
    <Screen>
      <View className="pt-8">
        <Text className="text-sm font-body-semi text-muted uppercase tracking-wide">
          {greeting()}
        </Text>
        <Text className="mt-1 text-3xl font-display text-espresso">
          {session?.name ?? ""}
        </Text>
        {session?.outletName ? (
          <Text className="mt-1 text-base font-body text-muted-fg">
            @ {session.outletName}
          </Text>
        ) : null}
      </View>

      <View className="mt-8 rounded-3xl border border-border bg-surface p-5">
        <Text className="text-xs font-body-semi text-muted uppercase tracking-wide">
          Today
        </Text>
        <Text className="mt-2 text-base font-body text-espresso">
          Dashboard widgets land in Phase 5.
        </Text>
      </View>
    </Screen>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
