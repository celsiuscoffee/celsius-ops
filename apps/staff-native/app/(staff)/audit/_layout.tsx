import { Stack } from "expo-router";
import { useStackScreenOptions } from "../../../lib/screen-options";

export default function AuditLayout() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: "Audits" }} />
      <Stack.Screen name="new" options={{ title: "New audit" }} />
      <Stack.Screen name="[id]" options={{ title: "Audit" }} />
    </Stack>
  );
}
