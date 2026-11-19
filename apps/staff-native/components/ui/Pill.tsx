import { Text, View } from "react-native";

type Tone = "success" | "warning" | "danger" | "info" | "muted" | "brand";

// Soft fill + the signal's text colour: readable in light and dark.
const TONES: Record<Tone, { bg: string; text: string }> = {
  success: { bg: "bg-ok-soft", text: "text-ok-text" },
  warning: { bg: "bg-warn-soft", text: "text-warn-text" },
  danger: { bg: "bg-danger-soft", text: "text-danger-text" },
  info: { bg: "bg-info-soft", text: "text-info-text" },
  brand: { bg: "bg-info-soft", text: "text-info-text" }, // in progress (approved, sent)
  muted: { bg: "bg-sunken", text: "text-text-2" },
};

/** A short status in sentence case ("Paid", "With Aina"). */
export function Pill({ label, tone = "muted" }: { label: string; tone?: Tone }) {
  const t = TONES[tone];
  // Raw enum values ("PARTIALLY_PAID") read as sentence case; labels with
  // their own capitals ("POP sent") are left alone.
  const text =
    label && label === label.toUpperCase()
      ? label.charAt(0) + label.slice(1).toLowerCase().replace(/_/g, " ")
      : label;
  return (
    <View className={`self-start rounded-full px-2.5 py-1 ${t.bg}`}>
      <Text className={`text-xs font-body-semi ${t.text}`}>{text}</Text>
    </View>
  );
}
