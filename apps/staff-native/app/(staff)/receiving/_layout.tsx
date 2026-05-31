import { Stack } from "expo-router";

export default function ReceivingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="index" options={{ title: "Receive" }} />
    </Stack>
  );
}
