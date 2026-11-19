import { Stack } from "expo-router";
import { useStackScreenOptions } from "../../../lib/screen-options";

export default function InvoicesLayout() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
