import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { ComponentType } from "react";
import { useCelsius } from "../../lib/celsius-ui";

type Props = {
  icon: ComponentType<{ color: string; size: number }>;
  label?: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

// Floating action button: the screen's one main action, in ink. Sits above
// the tab bar (bottom-24). `label` makes it an extended pill.
export function FAB({ icon: Icon, label, onPress, loading, disabled }: Props) {
  const C = useCelsius().color;
  const off = disabled || loading;
  const extended = !!label;
  return (
    <View pointerEvents="box-none" className="absolute inset-x-0 bottom-24 items-end px-4">
      <Pressable
        onPress={onPress}
        disabled={off}
        accessibilityRole="button"
        accessibilityLabel={label ?? "Action"}
        style={{ boxShadow: "0 8px 24px rgba(22, 8, 0, 0.18)" }}
        className={`flex-row items-center justify-center gap-2 rounded-full bg-ink ${
          off ? "opacity-50" : "active:opacity-90"
        } ${extended ? "h-14 px-5" : "h-14 w-14"}`}
      >
        {loading ? (
          <ActivityIndicator color={C["on-ink"]} />
        ) : (
          <>
            <Icon color={C["on-ink"]} size={22} />
            {extended ? <Text className="text-base font-body-semi text-on-ink">{label}</Text> : null}
          </>
        )}
      </Pressable>
    </View>
  );
}
