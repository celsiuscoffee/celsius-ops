import { Stack } from "expo-router";
import { useStackScreenOptions } from "../../../lib/screen-options";

export default function ClaimsLayout() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen
        name="index"
        options={{ title: "Claims" }}
      />
      <Stack.Screen name="new" options={{ title: "New claim" }} />
    </Stack>
  );
}
