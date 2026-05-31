import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { ComponentType, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  icon?: ComponentType<{ color: string; size: number }>;
  iconRight?: ComponentType<{ color: string; size: number }>;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
};

// Single source of truth for button styling. Every CTA in the app should
// route through this so brand colour, radius, and tap targets stay
// uniform. h-14/16 honour the "never-rushed" / big-press-target rules.
export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  disabled = false,
  fullWidth = true,
}: Props) {
  const off = disabled || loading;
  const c = colors(variant, off);
  const dims = sizes(size);

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      className={`${dims.h} ${dims.px} flex-row items-center justify-center gap-2 rounded-2xl ${c.bg} ${c.border} ${c.active} ${fullWidth ? "self-stretch" : "self-start"}`}
    >
      {loading ? (
        <ActivityIndicator color={c.spinnerColor} />
      ) : (
        <>
          {Icon ? <Icon color={c.text} size={dims.icon} /> : null}
          <Text className={`${dims.text} font-body-bold`} style={{ color: c.text }}>
            {label}
          </Text>
          {IconRight ? <IconRight color={c.text} size={dims.icon} /> : null}
        </>
      )}
    </Pressable>
  );
}

function colors(variant: Variant, off: boolean) {
  if (variant === "primary") {
    return {
      bg: off ? "bg-primary/40" : "bg-primary",
      border: "",
      active: "active:opacity-80",
      text: "#FFFFFF",
      spinnerColor: "#FFFFFF",
    };
  }
  if (variant === "secondary") {
    return {
      bg: off ? "bg-surface" : "bg-surface",
      border: "border border-border",
      active: "active:bg-primary-50",
      text: "#1A0200",
      spinnerColor: "#1A0200",
    };
  }
  if (variant === "danger") {
    return {
      bg: off ? "bg-danger/40" : "bg-danger",
      border: "",
      active: "active:opacity-80",
      text: "#FFFFFF",
      spinnerColor: "#FFFFFF",
    };
  }
  // ghost
  return {
    bg: "",
    border: "",
    active: "active:opacity-60",
    text: off ? "#9B9B9B" : "#C2452D",
    spinnerColor: "#C2452D",
  };
}

function sizes(size: Size) {
  if (size === "sm") return { h: "h-10", px: "px-3", text: "text-sm", icon: 16 };
  if (size === "lg") return { h: "h-16", px: "px-6", text: "text-base", icon: 22 };
  return { h: "h-14", px: "px-4", text: "text-base", icon: 20 };
}
