import { Stack } from "expo-router";

export default function HrLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#FFFFFF" },
        headerTintColor: "#1A0200",
        headerTitleStyle: { fontFamily: "Peachi-Bold" },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: "HR", headerShown: false }} />
      <Stack.Screen name="shifts" options={{ title: "My Shifts" }} />
      <Stack.Screen name="attendance" options={{ title: "Attendance" }} />
      <Stack.Screen name="leave" options={{ title: "Leave" }} />
      <Stack.Screen name="payslips" options={{ title: "Payslips" }} />
      <Stack.Screen name="memos" options={{ title: "Memos" }} />
    </Stack>
  );
}
