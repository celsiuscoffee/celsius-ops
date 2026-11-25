import { Pressable, Text, View } from "react-native";
import { Children, type ComponentType, type ReactNode } from "react";
import { ChevronRight } from "lucide-react-native";
import { useCelsius, type ColorName } from "../../lib/celsius-ui";

type Tone = "neutral" | "ok" | "warn" | "danger" | "info";

const TILE: Record<Tone, { bg: string; fg: ColorName }> = {
  neutral: { bg: "bg-sunken", fg: "text-2" },
  ok: { bg: "bg-ok-soft", fg: "ok-text" },
  warn: { bg: "bg-warn-soft", fg: "warn-text" },
  danger: { bg: "bg-danger-soft", fg: "danger-text" },
  info: { bg: "bg-info-soft", fg: "info-text" },
};

type Props = {
  title: string;
  meta?: string | null;
  icon?: ComponentType<{ color?: string; size?: number }>;
  /** Colour the icon tile only when the row carries a signal. */
  tone?: Tone;
  /** A value, a pill or a small button on the right. */
  trailing?: ReactNode;
  /** The whole row is the target and shows a chevron. */
  onPress?: () => void;
  /** Highlight a row that needs attention (amber well). */
  attention?: boolean;
};

/** One row: icon tile, title, one line of meta, trailing value, chevron. 60 high. */
export function ListRow({ title, meta, icon: Icon, tone = "neutral", trailing, onPress, attention }: Props) {
  const C = useCelsius().color;
  const tile = TILE[tone];
  const body = (
    <>
      {Icon ? (
        <View className={`h-10 w-10 items-center justify-center rounded-xl ${tile.bg}`}>
          <Icon color={C[tile.fg]} size={20} />
        </View>
      ) : null}
      <View className="flex-1">
        <Text className="text-base font-body-semi text-text" numberOfLines={1}>
          {title}
        </Text>
        {meta ? (
          <Text className="mt-0.5 text-sm font-body text-text-2" numberOfLines={2}>
            {meta}
          </Text>
        ) : null}
      </View>
      {trailing}
      {onPress ? <ChevronRight color={C["text-3"]} size={18} /> : null}
    </>
  );
  const cls = `min-h-[60px] flex-row items-center gap-3 px-4 py-3 ${attention ? "bg-warn-soft" : ""}`;
  if (!onPress) return <View className={cls}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={meta ? `${title}, ${meta}` : title}
      className={`${cls} active:bg-sunken`}
    >
      {body}
    </Pressable>
  );
}

/** Rows in one card, split by hairlines. */
export function List({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View className="overflow-hidden rounded-2xl border border-line bg-surface">
      {rows.map((r, i) => (
        <View key={i} className={i > 0 ? "border-t border-line" : undefined}>
          {r}
        </View>
      ))}
    </View>
  );
}
