import { Stack } from "expo-router";

export default function AuditLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="index" options={{ title: "Audits" }} />
      <Stack.Screen name="new" options={{ title: "New audit" }} />
      <Stack.Screen name="[id]" options={{ title: "Audit" }} />
    </Stack>
  );
}
