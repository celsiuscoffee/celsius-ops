import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";

// Standard Stack screenOptions for every inner-page layout. Peachi Bold
// (the brand display face) carries the title text both here and in
// `components/PageHeader.tsx`, so the small nav-bar title and the big
// hero PageHeader read as the same voice.
export const stackScreenOptions = {
  headerStyle: { backgroundColor: "#FFFFFF" },
  headerTintColor: "#1A0200",
  // Peachi Bold per CC Brand System v2026 — display face also used
  // in PageHeader so the title voice is consistent at every scale.
  headerTitleStyle: { fontFamily: "Peachi-Bold", fontSize: 18 },
  headerShadowVisible: false,
  // Chevron-only back button. `headerBackTitle: ""` was ignored on newer
  // @react-navigation/native-stack (v7+) and the previous screen's title
  // kept rendering in the pill. `minimal` is the correct API and matches
  // the brand's restrained chrome.
  headerBackButtonDisplayMode: "minimal",
} satisfies NativeStackNavigationOptions;
