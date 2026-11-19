// Celsius UI for the manager app: the theme. The root layout applies the CSS
// variables (`themeVars[scheme]`), so NativeWind classes such as bg-surface,
// text-text-2 and border-line switch with light and dark. Code that needs a
// colour as a value (an icon, a chart, a RefreshControl, a nav header) reads
// the same token from useCelsius().color, never a hex.
//
// The components that use these tokens live in components/ui (Button, Card,
// ListRow, KeyNumber, Segmented, Pill, Section, Field, EmptyState, Skeleton).
import { useColorScheme, vars } from "nativewind";
import { colorNames, palette, type Palette, type Scheme } from "./tokens";

export * from "./tokens";

const cssVars = (s: Scheme) =>
  vars(Object.fromEntries(colorNames.map((n) => [`--${n}`, palette[s][n]])));

/** The CSS variable sets the root view applies for each scheme. */
export const themeVars = { light: cssVars("light"), dark: cssVars("dark") } as const;

/** The person's chosen scheme (System, Light or Dark) and its colours. */
export function useCelsius(): { scheme: Scheme; color: Palette } {
  const { colorScheme } = useColorScheme();
  const scheme: Scheme = colorScheme === "dark" ? "dark" : "light";
  return { scheme, color: palette[scheme] };
}
export * from "./format";
