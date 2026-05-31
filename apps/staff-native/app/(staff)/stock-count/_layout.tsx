import { Stack } from "expo-router";

export default function StockCountLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="index" options={{ title: "Stock Count" }} />
    </Stack>
  );
}
