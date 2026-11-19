import { Text, View } from "react-native";
import type { ComponentType, ReactNode } from "react";
import { useCelsius } from "../../lib/celsius-ui";

type Props = {
  icon?: ComponentType<{ color: string; size: number }>;
  title: string;
  /** When it fills, or what to do first. Never "No data". */
  subtitle?: string;
  action?: ReactNode;
};

export function EmptyState({ icon: Icon, title, subtitle, action }: Props) {
  const C = useCelsius().color;
  return (
    <View className="items-center justify-center px-8 py-12">
      {Icon ? (
        <View className="mb-4 h-14 w-14 items-center justify-center rounded-2xl bg-sunken">
          <Icon color={C["text-3"]} size={26} />
        </View>
      ) : null}
      <Text className="text-center text-base font-body-semi text-text">{title}</Text>
      {subtitle ? (
        <Text className="mt-1.5 text-center text-sm font-body text-text-2">{subtitle}</Text>
      ) : null}
      {action ? <View className="mt-6 self-stretch">{action}</View> : null}
    </View>
  );
}
