import { Pressable, View } from "react-native";
import type { PropsWithChildren } from "react";

type Props = PropsWithChildren<{
  onPress?: () => void;
  /** default: a surface card · muted: a sunken well · accent: one highlight per screen */
  variant?: "default" | "muted" | "accent";
  pad?: "sm" | "md" | "lg";
  /** Kept for callers; Celsius UI cards are flat (a hairline, no shadow). */
  elevated?: boolean;
  /** A card that needs attention gets a full border in its colour. */
  tone?: "danger" | "warn" | "ok";
}>;

const TONE = { danger: "border-danger", warn: "border-warn", ok: "border-ok" } as const;

// Celsius UI card: surface on paper, a hairline border, radius 16.
export function Card({ children, onPress, variant = "default", pad = "md", tone }: Props) {
  const padCls = pad === "sm" ? "p-3.5" : pad === "lg" ? "p-6" : "p-4";
  const fill =
    variant === "accent" ? "bg-raised border-line-2" : variant === "muted" ? "bg-sunken border-line" : "bg-surface border-line";
  const base = `rounded-2xl border ${fill} ${tone ? TONE[tone] : ""} ${padCls}`;

  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" className={`${base} active:bg-sunken`}>
        {children}
      </Pressable>
    );
  }
  return <View className={base}>{children}</View>;
}
