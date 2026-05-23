import { Text, View } from "react-native";

export function Logo({ size = "lg" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: { circle: "h-8 w-8", text: "text-base", caption: "text-[10px]" },
    md: { circle: "h-12 w-12", text: "text-xl", caption: "text-xs" },
    lg: { circle: "h-16 w-16", text: "text-2xl", caption: "text-sm" },
  };
  const s = sizes[size];
  return (
    <View className="items-center">
      <View
        className={`${s.circle} items-center justify-center rounded-full bg-espresso`}
      >
        <Text className={`${s.text} font-display text-white`}>°c</Text>
      </View>
      <Text className={`${s.caption} mt-2 font-body-semi text-espresso`}>
        CELSIUS STAFF
      </Text>
    </View>
  );
}
