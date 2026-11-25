import { Stack } from "expo-router";
import { useStackScreenOptions } from "../../../lib/screen-options";

export default function InventoryLayout() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="levels" />
    </Stack>
  );
}
