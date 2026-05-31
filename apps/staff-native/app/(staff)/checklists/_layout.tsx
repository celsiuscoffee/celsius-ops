import { Stack } from "expo-router";

export default function ChecklistsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="index" options={{ title: "Checklists" }} />
      <Stack.Screen name="[id]" options={{ title: "Checklist" }} />
    </Stack>
  );
}
