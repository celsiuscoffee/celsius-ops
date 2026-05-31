import { Text, View } from "react-native";

type Tone = "success" | "warning" | "danger" | "info" | "muted" | "brand";

const TONES: Record<Tone, { bg: string; text: string }> = {
  success: { bg: "bg-success/10", text: "text-success" },
  warning: { bg: "bg-amber-400/10", text: "text-amber-500" },
  danger: { bg: "bg-danger/10", text: "text-danger" },
  info: { bg: "bg-primary-50", text: "text-primary" },
  brand: { bg: "bg-primary-50", text: "text-primary" },
  muted: { bg: "bg-muted/10", text: "text-muted-fg" },
};

export function Pill({ label, tone = "muted" }: { label: string; tone?: Tone }) {
  const t = TONES[tone];
  return (
    <View className={`rounded-full px-2.5 py-1 ${t.bg}`}>
      <Text className={`text-[11px] font-body-bold uppercase tracking-wide ${t.text}`}>
        {label}
      </Text>
    </View>
  );
}
