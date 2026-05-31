import { Platform, Pressable, View } from "react-native";
import type { PropsWithChildren } from "react";

type Props = PropsWithChildren<{
  onPress?: () => void;
  variant?: "default" | "muted" | "accent";
  pad?: "sm" | "md" | "lg";
  /** Default true — soft terracotta-tinted shadow gives every card
   *  depth against the page surface. Opt out with `elevated={false}`
   *  on tightly-packed list rows where the shadow would crowd. */
  elevated?: boolean;
}>;

const SHADOW = Platform.select({
  ios: {
    shadowColor: "#4E1F12",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
  },
  android: { elevation: 1 },
  default: {},
});

export function Card({
  children,
  onPress,
  variant = "default",
  pad = "md",
  elevated = true,
}: Props) {
  const padCls = pad === "sm" ? "p-3.5" : pad === "lg" ? "p-6" : "p-5";
  const base =
    variant === "accent"
      ? "rounded-3xl border border-primary/30 bg-primary-50/50"
      : variant === "muted"
        ? "rounded-3xl border border-border bg-primary-50/30"
        : "rounded-3xl border border-border bg-surface";
  const shadow = elevated ? SHADOW : undefined;

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={shadow}
        className={`${base} ${padCls} active:opacity-90`}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View style={shadow} className={`${base} ${padCls}`}>
      {children}
    </View>
  );
}
