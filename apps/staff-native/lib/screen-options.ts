import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { useCelsius } from "./celsius-ui";

// Stack screenOptions for every inner layout. Screens draw their own title
// with components/PageHeader (one title style app-wide), so the native header
// stays hidden; when a screen does turn it on, it reads the Celsius UI tokens
// so it follows light and dark. contentStyle paints the page colour behind
// every push, so a transition never flashes white in dark mode.
export function useStackScreenOptions(): NativeStackNavigationOptions {
  const C = useCelsius().color;
  return {
    headerShown: false,
    headerStyle: { backgroundColor: C.bg },
    headerTintColor: C.text,
    headerTitleStyle: { fontFamily: "Peachi-Bold", fontSize: 18, color: C.text },
    headerShadowVisible: false,
    // Chevron-only back button (`headerBackTitle: ""` is ignored on v7+).
    headerBackButtonDisplayMode: "minimal",
    contentStyle: { backgroundColor: C.bg },
  };
}
