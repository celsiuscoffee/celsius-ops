import { Image, View } from "react-native";

const sizes = {
  sm: 40,
  md: 64,
  lg: 96,
} as const;

const radii = {
  sm: 12,
  md: 18,
  lg: 24,
} as const;

export function Logo({ size = "lg" }: { size?: keyof typeof sizes }) {
  const px = sizes[size];
  const r = radii[size];
  return (
    <View className="items-center">
      <Image
        source={require("../assets/icon.png")}
        style={{ width: px, height: px, borderRadius: r }}
        resizeMode="cover"
      />
    </View>
  );
}
