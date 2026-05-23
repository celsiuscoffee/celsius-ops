import { Redirect } from "expo-router";
import { useStaff } from "../lib/store";

export default function Index() {
  const session = useStaff((s) => s.session);
  return <Redirect href={session ? "/(staff)/home" : "/(auth)/login"} />;
}
