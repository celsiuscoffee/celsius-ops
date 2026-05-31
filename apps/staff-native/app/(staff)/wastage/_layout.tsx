import { Stack } from "expo-router";

export default function WastageLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="index" options={{ title: "Wastage" }} />
    </Stack>
  );
}
