import { Stack } from "expo-router";

export default function TransfersLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="index" options={{ title: "Transfers" }} />
    </Stack>
  );
}
