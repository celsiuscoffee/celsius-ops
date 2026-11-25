import { Stack } from "expo-router";
import { useStackScreenOptions } from "../../../lib/screen-options";

export default function WastageLayout() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: "Wastage" }} />
    </Stack>
  );
}
