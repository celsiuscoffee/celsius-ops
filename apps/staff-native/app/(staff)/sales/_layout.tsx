import { Stack } from "expo-router";
import { useStackScreenOptions } from "../../../lib/screen-options";

export default function SalesLayout() {
  const screenOptions = useStackScreenOptions();
  return <Stack screenOptions={screenOptions} />;
}
