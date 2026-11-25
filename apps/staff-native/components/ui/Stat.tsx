import { Text, View } from "react-native";

type Tone = "default" | "brand" | "success" | "danger" | "warn";

const COLOR: Record<Tone, string> = {
  default: "text-text",
  brand: "text-brand-text",
  success: "text-ok-text",
  danger: "text-danger-text",
  warn: "text-warn-text",
};

type Props = {
  value: string | number;
  label: string;
  /** A reference that gives the number meaning ("of RM 300", "vs 12 last week"). */
  hint?: string;
  tone?: Tone;
};

/**
 * Key number: the label, the figure (Peachi, tabular), and a reference line.
 * A number on its own means nothing; give it a hint whenever there is one.
 */
export function KeyNumber({ value, label, hint, tone = "default" }: Props) {
  return (
    <View className="flex-1 items-start">
      <Text className="text-xs font-body-semi text-text-2" numberOfLines={1}>
        {label}
      </Text>
      <Text className={`mt-1 text-2xl font-display ${COLOR[tone]}`} style={{ fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
      {hint ? (
        <Text className="mt-0.5 text-xs font-body text-text-3" numberOfLines={2}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Older name for KeyNumber; kept so callers keep working. */
export function Stat(props: Props) {
  return <KeyNumber {...props} />;
}
