import { Pressable, Text, View } from "react-native";

type Option<K extends string> = { key: K; label: string; count?: number };

/**
 * Segmented control (Celsius UI tabs inside a screen): a sunken track, the
 * chosen segment raised on surface. 44 high, so every segment is a full target.
 */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<Option<K>>;
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <View accessibilityRole="tablist" className="flex-row gap-1 rounded-xl bg-sunken p-1">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            className={`h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg ${
              on ? "border border-line bg-surface" : "active:opacity-70"
            }`}
          >
            <Text className={`text-sm ${on ? "font-body-semi text-text" : "font-body-medium text-text-2"}`} numberOfLines={1}>
              {o.label}
            </Text>
            {o.count != null && o.count > 0 ? (
              <Text className="text-xs font-body-semi text-text-3">{o.count}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
