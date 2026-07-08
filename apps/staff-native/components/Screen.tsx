import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { View } from "react-native";
import type { PropsWithChildren } from "react";

type Props = PropsWithChildren<{
  // Which safe-area edges to inset against. Defaults to all sides.
  // Screens with a pinned bottom action bar pass ["top","left","right"]
  // so the bar sits flush against the device tab bar instead of leaving
  // a 34px home-indicator gap. Previously this prop was silently
  // dropped at runtime, the type didn't declare it and the component
  // ignored it, so every "fix" that passed edges had no effect.
  edges?: ReadonlyArray<Edge>;
}>;

export function Screen({ children, edges }: Props) {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={edges}>
      <View className="flex-1 px-5">{children}</View>
    </SafeAreaView>
  );
}
