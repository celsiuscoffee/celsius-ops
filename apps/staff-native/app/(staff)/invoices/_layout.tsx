import { Stack } from "expo-router";
import { stackScreenOptions } from "../../../lib/screen-options";

export default function InvoicesLayout() {
  return (
    <Stack screenOptions={{ ...stackScreenOptions, headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
