import { Stack } from "expo-router";
import { useStackScreenOptions } from "../../../lib/screen-options";

export default function ChecklistsLayout() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: "Checklists" }} />
      <Stack.Screen name="[id]" options={{ title: "Checklist" }} />
    </Stack>
  );
}
