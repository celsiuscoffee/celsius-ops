import { Stack } from "expo-router";
import { useStackScreenOptions } from "../../../lib/screen-options";

export default function HrLayout() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: "Me" }} />
      <Stack.Screen name="scoreboard" options={{ title: "My scoreboard" }} />
      <Stack.Screen name="shifts" options={{ title: "My shifts" }} />
      <Stack.Screen name="availability" options={{ title: "My availability" }} />
      <Stack.Screen name="whos-working" options={{ title: "Who's working" }} />
      <Stack.Screen name="attendance" options={{ title: "Attendance" }} />
      <Stack.Screen name="leave" options={{ title: "Leave" }} />
      <Stack.Screen name="pay" options={{ title: "Pay" }} />
      <Stack.Screen name="payslips" options={{ title: "Payslips" }} />
      <Stack.Screen name="memos" options={{ title: "Memos" }} />
      <Stack.Screen name="reviews" options={{ title: "Feedback" }} />
      <Stack.Screen name="my-skills" options={{ title: "My skills" }} />
    </Stack>
  );
}
