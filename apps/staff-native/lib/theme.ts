import { vars } from "nativewind";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Light / dark CSS variable sets applied at the root via the
// `<View style={themes[scheme]} />` pattern. Every Tailwind color
// token in `tailwind.config.js` that references `var(--color-*)`
// will resolve against these.
//
// Strategy: only theme the *neutral* and *terracotta-tint* surfaces
// here. Pure brand color (`primary` itself) and the success/danger/
// amber accents work in both modes (sufficient contrast either way).
export const themes = {
  light: vars({
    "--color-background": "#FFFFFF",
    "--color-surface": "#FFFFFF",
    "--color-espresso": "#160800",
    "--color-border": "#E5E2DE",
    "--color-muted": "#9CA3AF",
    "--color-muted-fg": "#737373",
    "--color-primary-50": "#FBE9E4",
    "--color-primary-100": "#F4CFC4",
    "--color-gray-50": "#F9FAFB",
    "--color-gray-100": "#F3F4F6",
    "--color-gray-200": "#E5E7EB",
  }),
  dark: vars({
    "--color-background": "#0A0A0A",
    "--color-surface": "#18181B",
    "--color-espresso": "#FAFAFA",
    "--color-border": "#27272A",
    "--color-muted": "#71717A",
    "--color-muted-fg": "#A1A1AA",
    "--color-primary-50": "#2A1612",
    "--color-primary-100": "#3D211A",
    "--color-gray-50": "#18181B",
    "--color-gray-100": "#27272A",
    "--color-gray-200": "#3F3F46",
  }),
} as const;

export type ColorSchemePref = "light" | "dark" | "system";

const STORAGE_KEY = "@celsius/color-scheme";

export async function loadColorSchemePref(): Promise<ColorSchemePref> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // ignore
  }
  return "system";
}

export async function saveColorSchemePref(pref: ColorSchemePref): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // ignore
  }
}
