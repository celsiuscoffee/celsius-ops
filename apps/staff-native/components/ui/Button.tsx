import { ActivityIndicator, Pressable, Text } from "react-native";
import type { ComponentType, ReactNode } from "react";
import { useCelsius, type ColorName } from "../../lib/celsius-ui";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

type Props = {
  label: string;
  onPress: () => void;
  /** primary: the one main action on the screen (espresso ink, cream text) */
  variant?: Variant;
  size?: Size;
  icon?: ComponentType<{ color: string; size: number }>;
  iconRight?: ComponentType<{ color: string; size: number }>;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
};

// Celsius UI button. One main action per screen, in ink (espresso in light,
// cream in dark), never a solid signal colour: white on a solid colour is
// unreadable in dark mode. Danger is an outline in the danger colour.
// Heights: sm 44 (the phone minimum), md 52, lg 56.
const LOOK: Record<Variant, { cls: string; text: ColorName }> = {
  primary: { cls: "bg-ink", text: "on-ink" },
  secondary: { cls: "border border-line-2 bg-surface active:bg-sunken", text: "text" },
  danger: { cls: "border border-danger bg-surface active:bg-danger-soft", text: "danger-text" },
  ghost: { cls: "active:bg-sunken", text: "text-2" },
};

const SIZE: Record<Size, { h: string; px: string; text: string; icon: number }> = {
  sm: { h: "h-11", px: "px-4", text: "text-sm", icon: 16 },
  md: { h: "h-[52px]", px: "px-5", text: "text-base", icon: 18 },
  lg: { h: "h-14", px: "px-6", text: "text-base", icon: 20 },
};

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
  const C = useCelsius().color;
  const off = disabled || loading;
  const look = LOOK[variant];
  const dims = SIZE[size];
  const fg = C[look.text];

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy: loading }}
      className={`${dims.h} ${dims.px} flex-row items-center justify-center gap-2 rounded-xl ${look.cls} ${
        off ? "opacity-40" : variant === "primary" ? "active:opacity-80" : ""
      } ${fullWidth ? "self-stretch" : "self-start"}`}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {Icon ? <Icon color={fg} size={dims.icon} /> : null}
          <Text className={`${dims.text} font-body-semi`} style={{ color: fg }}>
            {label}
          </Text>
          {IconRight ? <IconRight color={fg} size={dims.icon} /> : null}
        </>
      )}
    </Pressable>
  );
}
