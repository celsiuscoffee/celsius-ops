import { ActivityIndicator, Text, View } from "react-native";
import type { ComponentType } from "react";
import { useCelsius } from "../lib/celsius-ui";

export function LoadingState() {
  const C = useCelsius().color;
  return (
    <View className="flex-1 items-center justify-center bg-bg">
      <ActivityIndicator color={C["text-3"]} />
    </View>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <View className="flex-1 items-center justify-center bg-bg px-6">
      <Text className="text-sm text-danger-text text-center">{message}</Text>
    </View>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  subtitle,
}: {
  icon?: ComponentType<{ color?: string; size?: number }>;
  title: string;
  subtitle?: string;
}) {
  const C = useCelsius().color;
  return (
    <View className="flex-1 items-center justify-center bg-bg px-6 py-12">
      {Icon ? (
        <View className="h-20 w-20 items-center justify-center rounded-2xl bg-sunken mb-4">
          <Icon color={C["text-2"]} size={32} />
        </View>
      ) : null}
      <Text className="text-xl font-display text-text text-center">
        {title}
      </Text>
      {subtitle ? (
        <Text className="mt-2 text-sm font-body text-text-2 text-center">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
