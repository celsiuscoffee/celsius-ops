import { Text, View } from "react-native";
import type { PropsWithChildren, ReactNode } from "react";

type Props = PropsWithChildren<{
  title?: string;
  action?: ReactNode;
  spacing?: "tight" | "default" | "loose";
}>;

// A labelled group on a screen: the label in sentence case, quiet text-2.
export function Section({ title, action, children, spacing = "default" }: Props) {
  const top = spacing === "tight" ? "mt-4" : spacing === "loose" ? "mt-8" : "mt-6";
  return (
    <View className={top}>
      {title || action ? (
        <View className="mb-2 min-h-6 flex-row items-center justify-between">
          {title ? (
            <Text accessibilityRole="header" className="text-sm font-body-semi text-text-2">
              {title}
            </Text>
          ) : (
            <View />
          )}
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}
