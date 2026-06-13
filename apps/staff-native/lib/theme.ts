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
// Values MUST stay in sync with the token names in tailwind.config.js.
// Light = the original hardcoded palette. Dark = brand espresso tones so
// the whole app matches the login/sales aesthetic in dark mode.
export const themes = {
  light: vars({
    "--color-background": "#FFFFFF",
    "--color-surface": "#FFFFFF",
    "--color-espresso": "#1A0200",
    "--color-border": "rgba(26, 2, 0, 0.10)",
    "--color-muted": "#6B6B6B",
    "--color-muted-fg": "#4A4A4A",
    "--color-primary-50": "#F6E8E2",
    "--color-primary-100": "#EBD0C2",
  }),
  dark: vars({
    "--color-background": "#1A0200",
    "--color-surface": "#2A1508",
    "--color-espresso": "#FAFAFA",
    "--color-border": "rgba(245, 243, 240, 0.12)",
    "--color-muted": "#9A8A85",
    "--color-muted-fg": "#C8B8B3",
    "--color-primary-50": "#3D211A",
    "--color-primary-100": "#4E2A1E",
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
