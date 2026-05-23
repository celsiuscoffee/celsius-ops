import { Stack } from "expo-router";

export default function ChecklistsLayout() {
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
      <Stack.Screen name="index" options={{ title: "Checklists" }} />
      <Stack.Screen name="[id]" options={{ title: "Checklist" }} />
    </Stack>
  );
}
