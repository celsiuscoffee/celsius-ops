import { Text, View } from "react-native";
import type { ComponentType, ReactNode } from "react";

type Props = {
  icon?: ComponentType<{ color: string; size: number }>;
  title: string;
  subtitle?: string;
  action?: ReactNode;
};

// Warm-copy empty state. Brand voice is "never-rushed" — leave room
// around the message; don't crowd it with a wall of help text.
export function EmptyState({ icon: Icon, title, subtitle, action }: Props) {
  return (
    <View className="items-center justify-center px-8 py-12">
      {Icon ? (
        <View className="h-20 w-20 items-center justify-center rounded-3xl bg-primary-50 mb-5">
          <Icon color="#C2452D" size={32} />
        </View>
      ) : null}
      <Text className="text-center text-base font-body-bold text-espresso">
        {title}
      </Text>
      {subtitle ? (
        <Text className="mt-2 text-center text-sm font-body text-muted-fg">
          {subtitle}
        </Text>
      ) : null}
      {action ? <View className="mt-6 self-stretch">{action}</View> : null}
    </View>
  );
}
