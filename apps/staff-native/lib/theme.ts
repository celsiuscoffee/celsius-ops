import AsyncStorage from "@react-native-async-storage/async-storage";
import { themeVars } from "./celsius-ui";

// Light / dark CSS variable sets applied at the root via the
// `<View style={themes[scheme]} />` pattern. They are the Celsius UI tokens
// (lib/celsius-ui/tokens.ts, the same names and values as the back office),
// so every NativeWind colour class (bg-surface, text-text-2, border-line …)
// resolves against them and follows the person's Light / Dark / System choice.
export const themes = themeVars;

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
