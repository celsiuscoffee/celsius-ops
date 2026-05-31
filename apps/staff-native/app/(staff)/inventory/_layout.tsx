import { Stack } from "expo-router";
import { stackScreenOptions } from "../../../lib/screen-options";

export default function InventoryLayout() {
  return (
    <Stack screenOptions={{ ...stackScreenOptions, headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="levels" />
    </Stack>
  );
}
