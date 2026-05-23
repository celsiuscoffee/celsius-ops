import { ActivityIndicator, Text, View } from "react-native";
import type { ComponentType } from "react";

export function LoadingState() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <ActivityIndicator color="#A2492C" />
    </View>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <Text className="text-sm text-danger text-center">{message}</Text>
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
  return (
    <View className="flex-1 items-center justify-center bg-background px-6 py-12">
      {Icon ? (
        <View className="h-20 w-20 items-center justify-center rounded-3xl bg-primary-50 mb-4">
          <Icon color="#A2492C" size={32} />
        </View>
      ) : null}
      <Text className="text-xl font-display text-espresso text-center">
        {title}
      </Text>
      {subtitle ? (
        <Text className="mt-2 text-sm font-body text-muted-fg text-center">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
