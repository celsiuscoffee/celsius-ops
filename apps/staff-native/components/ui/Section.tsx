import { Text, View } from "react-native";
import type { PropsWithChildren, ReactNode } from "react";

type Props = PropsWithChildren<{
  title?: string;
  action?: ReactNode;
  spacing?: "tight" | "default" | "loose";
}>;

// Labeled section with a small terracotta dot before the label,
// the dot is the visual rhythm marker that quietly repeats across
// the app.
export function Section({ title, action, children, spacing = "default" }: Props) {
  const top = spacing === "tight" ? "mt-5" : spacing === "loose" ? "mt-10" : "mt-7";
  return (
    <View className={top}>
      {title || action ? (
        <View className="mb-3 flex-row items-center justify-between">
          {title ? (
            <View className="flex-row items-center gap-2">
              <View className="h-1.5 w-1.5 rounded-full bg-primary" />
              <Text className="text-xs font-body-bold uppercase tracking-wider text-muted">
                {title}
              </Text>
            </View>
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
