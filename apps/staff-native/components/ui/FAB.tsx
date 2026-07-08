import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import type { ComponentType } from "react";

type Props = {
  icon: ComponentType<{ color: string; size: number }>;
  label?: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

// Floating Action Button. Sits in the bottom-right corner above the
// tab bar, terracotta primary with white icon. Soft shadow gives it
// elevation against the scroll content. Optional `label` turns it
// into an extended FAB (pill-shaped with icon + text), otherwise it's
// a 56×56 circle.
//
// Tab bar height + iOS home-indicator safe area = ~84-100px from the
// bottom; the FAB's `bottom-24` (96px) lifts it above both.
const SHADOW = Platform.select({
  ios: {
    shadowColor: "#4E1F12",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
  },
  android: { elevation: 6 },
  default: {},
});

export function FAB({ icon: Icon, label, onPress, loading, disabled }: Props) {
  const off = disabled || loading;
  const extended = !!label;
  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-x-0 bottom-24 items-end px-5"
    >
      <Pressable
        onPress={onPress}
        disabled={off}
        accessibilityLabel={label ?? "Action"}
        style={SHADOW}
        className={`flex-row items-center justify-center gap-2 rounded-full ${
          off ? "bg-primary/50" : "bg-primary active:opacity-90"
        } ${extended ? "h-14 px-5" : "h-14 w-14"}`}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <Icon color="#FFFFFF" size={22} />
            {extended ? (
              <Text className="text-base font-body-bold text-white">
                {label}
              </Text>
            ) : null}
          </>
        )}
      </Pressable>
    </View>
  );
}
