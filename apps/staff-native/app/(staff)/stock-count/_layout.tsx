import { Stack } from "expo-router";

export default function StockCountLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#FFFFFF" },
        headerTintColor: "#1A0200",
        headerTitleStyle: { fontFamily: "Peachi-Bold" },
        headerShadowVisible: false,
        headerBackTitle: "Back",
      }}
    >
      <Stack.Screen name="index" options={{ title: "Stock Count" }} />
    </Stack>
  );
}
