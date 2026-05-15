import { Pressable, Text, View, ActivityIndicator } from "react-native";
import * as Haptics from "expo-haptics";

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  /** Optional contextual copy shown next to the spinner while loading.
   *  e.g. "Sending to kitchen…" — tells the customer what's happening
   *  instead of just a bare spinner. */
  loadingLabel?: string;
  disabled?: boolean;
  variant?: "primary" | "espresso" | "ghost";
  className?: string;
};

export function PrimaryButton({
  label,
  onPress,
  loading,
  loadingLabel,
  disabled,
  variant = "primary",
  className = "",
}: Props) {
  const styles =
    variant === "espresso"
      ? "bg-espresso"
      : variant === "ghost"
      ? "bg-surface border border-border"
      : "bg-primary";
  const textColor =
    variant === "ghost" ? "text-espresso" : "text-white";
  const spinnerColor = variant === "ghost" ? "#160800" : "#FFFFFF";

  return (
    <Pressable
      disabled={disabled || loading}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      className={`${styles} rounded-full py-4 items-center justify-center active:opacity-80 ${
        disabled ? "opacity-40" : ""
      } ${className}`}
      accessibilityRole="button"
      accessibilityLabel={loading && loadingLabel ? loadingLabel : label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
    >
      {loading ? (
        <View className="flex-row items-center justify-center" style={{ gap: 10 }}>
          <ActivityIndicator color={spinnerColor} />
          {loadingLabel ? (
            <Text className={`${textColor} font-bold text-base`}>{loadingLabel}</Text>
          ) : null}
        </View>
      ) : (
        <Text className={`${textColor} font-bold text-base`}>{label}</Text>
      )}
    </Pressable>
  );
}
