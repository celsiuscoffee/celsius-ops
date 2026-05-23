import { Stack } from "expo-router";

export default function AuditLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#FFFFFF" },
        headerTintColor: "#1A0200",
        headerTitleStyle: { fontFamily: "Peachi-Bold" },
        headerShadowVisible: false,
        headerBackTitle: "Back",
      }}
    >
      <Stack.Screen name="index" options={{ title: "Audits" }} />
      <Stack.Screen name="new" options={{ title: "New audit" }} />
      <Stack.Screen name="[id]" options={{ title: "Audit" }} />
    </Stack>
  );
}
