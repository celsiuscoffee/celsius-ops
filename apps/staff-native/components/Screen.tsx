import { SafeAreaView } from "react-native-safe-area-context";
import { View } from "react-native";
import type { PropsWithChildren } from "react";

export function Screen({ children }: PropsWithChildren) {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 px-5">{children}</View>
    </SafeAreaView>
  );
}
