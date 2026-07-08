import { Text, View } from "react-native";

type Props = {
  value: string | number;
  label: string;
  tone?: "default" | "brand" | "success" | "danger";
};

const COLOR: Record<NonNullable<Props["tone"]>, string> = {
  default: "text-espresso",
  brand: "text-primary",
  success: "text-success",
  danger: "text-danger",
};

// Big-number display for dashboards / cards. Renders in Peachi Bold per
// the brand spec: Peachi is the display face that carries the Celsius
// typographic voice. Labels stay in Space Grotesk for quiet legibility.
export function Stat({ value, label, tone = "default" }: Props) {
  return (
    <View className="items-start">
      <Text className={`text-2xl font-display tabular-nums ${COLOR[tone]}`}>
        {value}
      </Text>
      <Text className="mt-1 text-xs font-body-semi uppercase tracking-wide text-muted">
        {label}
      </Text>
    </View>
  );
}
