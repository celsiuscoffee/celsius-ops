import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useColorScheme } from "nativewind";

type Props = {
  title: string;
  subtitle?: string | null;
  /** Right-aligned slot for actions (icon button or pill). */
  right?: ReactNode;
  /** Set to true on inner pages to show a chevron-back. Tab roots omit
   *  this prop entirely — back button is not appropriate on a tab root. */
  back?: boolean;
};

// Page-level header — single source of truth for every "this is the
// screen title" line across the staff app. Standardised here so screens
// can't drift on size or font:
//
//   title    = text-2xl font-display text-espresso  (24px Peachi-Bold)
//   subtitle = text-sm  font-body    text-muted     (14px Space Grotesk)
//
// Peachi is reserved for THIS title. Subtitle, body, buttons, and
// labels stay on Space Grotesk so the brand voice stays distinctive
// without getting tired.
//
// `right` slot is for inline action buttons (e.g. "+ New audit") —
// matches the web pattern of putting the primary action next to the
// title rather than as a floating chrome strip.
//
// Earlier the title used `text-xl font-peachi` — but `font-peachi`
// was never registered in tailwind.config.js, so every page title
// silently fell back to the system font. Fixed by renaming to
// `font-display` (Peachi-Bold) globally; size bumped to 24px so the
// brand mark is finally legible at glance distance.
export function PageHeader({ title, subtitle, right, back }: Props) {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const iconColor = colorScheme === "dark" ? "#FAFAFA" : "#160800";

  return (
    // Top padding lives HERE so screens don't have to wrap PageHeader
    // in `<View className="pt-3">` (some forgot to, some used pt-8,
    // some omitted entirely). One canonical position for every page
    // header across the app — title always lands at the same Y.
    <View className="pt-3 pb-3">
      {back ? (
        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Back"
          hitSlop={12}
          className="mb-2 -ml-2 h-9 w-9 items-center justify-center rounded-full active:bg-gray-100"
        >
          <ChevronLeft color={iconColor} size={24} />
        </Pressable>
      ) : null}
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-2xl font-display text-espresso">{title}</Text>
          {subtitle ? (
            <Text className="mt-1 text-sm font-body text-muted">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ? <View>{right}</View> : null}
      </View>
    </View>
  );
}
