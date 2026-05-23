import { Stack } from "expo-router";

export default function ClaimsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#FFFFFF" },
        headerTintColor: "#1A0200",
        headerTitleStyle: { fontFamily: "Peachi-Bold" },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: "Claims", headerShown: false }}
      />
      <Stack.Screen name="new" options={{ title: "New Claim" }} />
    </Stack>
  );
}
