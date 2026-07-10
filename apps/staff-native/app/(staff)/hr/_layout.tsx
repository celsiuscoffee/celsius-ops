import { Stack } from "expo-router";

export default function HrLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="index" options={{ title: "HR", headerShown: false }} />
      <Stack.Screen name="scoreboard" options={{ title: "My Scoreboard" }} />
      <Stack.Screen name="shifts" options={{ title: "My Shifts" }} />
      <Stack.Screen name="whos-working" options={{ title: "Who's Working" }} />
      <Stack.Screen name="attendance" options={{ title: "Attendance" }} />
      <Stack.Screen name="leave" options={{ title: "Leave" }} />
      <Stack.Screen name="payslips" options={{ title: "Payslips" }} />
      <Stack.Screen name="memos" options={{ title: "Memos" }} />
      <Stack.Screen name="reviews" options={{ title: "Feedback" }} />
      <Stack.Screen name="my-skills" options={{ title: "My Skills" }} />
    </Stack>
  );
}
