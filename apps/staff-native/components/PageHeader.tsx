import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCelsius } from "../lib/celsius-ui";

type Props = {
  title: string;
  subtitle?: string | null;
  /** Right-aligned slot for one action (an icon button or a small button). */
  right?: ReactNode;
  /** Inner pages show a back chevron; tab roots never do. */
  back?: boolean;
};

// The page title, the same on every screen: 24 px Peachi in text, one quiet
// line under it in text-2, the back chevron a full 44 pt target. Top padding
// lives here so every title lands at the same height.
export function PageHeader({ title, subtitle, right, back }: Props) {
  const router = useRouter();
  const C = useCelsius().color;

  return (
    <View className="pt-2 pb-3">
      {back ? (
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="-ml-2.5 mb-1 h-11 w-11 items-center justify-center rounded-full active:bg-sunken"
        >
          <ChevronLeft color={C.text} size={24} />
        </Pressable>
      ) : null}
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text accessibilityRole="header" className="text-2xl font-display text-text">
            {title}
          </Text>
          {subtitle ? <Text className="mt-1 text-sm font-body text-text-2">{subtitle}</Text> : null}
        </View>
        {right ? <View>{right}</View> : null}
      </View>
    </View>
  );
}
