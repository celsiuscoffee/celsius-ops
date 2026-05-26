import { useEffect, useState } from "react";
import { Platform, View, Text, Pressable } from "react-native";
import { X, Plus, Share } from "lucide-react-native";
import * as Haptics from "@/lib/haptics";

/**
 * One-shot "Add Celsius to Home Screen" nudge for iOS Safari.
 *
 * iOS Safari shows its URL bar permanently when the PWA is opened from
 * a browser — eats ~120px of viewport. There's no JS hook to collapse
 * it; the only fix is for the customer to launch the app from the home
 * screen (standalone mode → no URL bar at all). This banner explains
 * how, once, then quietly retires.
 *
 * Renders only when ALL of these are true:
 *   - Platform.OS === "web"          (no-op in the native iOS app)
 *   - device is iOS (Safari)         (Android uses its own install banner)
 *   - not already in standalone mode (already installed = no nudge needed)
 *   - the customer hasn't dismissed it before (localStorage flag)
 *
 * Designed to be embedded near the top of the home ScrollView so it
 * scrolls with the page — never a fixed/sticky overlay. Dismissal is
 * permanent: once X'd, never shows again for that browser profile.
 */
const DISMISS_KEY = "celsius:add-to-home:dismissed";

function isIosSafariBrowser(): boolean {
  if (Platform.OS !== "web") return false;
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIos = /iPhone|iPad|iPod/.test(ua);
  if (!isIos) return false;
  // navigator.standalone is iOS-Safari-only; true ⇒ already installed.
  // matchMedia covers other browsers' standalone signal.
  const standaloneNav = (navigator as unknown as { standalone?: boolean }).standalone === true;
  const standaloneMql = typeof window.matchMedia === "function"
    && window.matchMedia("(display-mode: standalone)").matches;
  return !standaloneNav && !standaloneMql;
}

export function AddToHomeHint() {
  // Start hidden; flip on after mount so SSR/native bundle render nothing.
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isIosSafariBrowser()) return;
    try {
      if (window.localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      // Safari can throw on localStorage access in private mode — in that
      // case fall back to showing the hint; the customer can dismiss
      // again next session if needed.
    }
    setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    Haptics.selectionAsync();
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore — best effort
    }
    setShow(false);
  };

  return (
    <View
      style={{
        marginHorizontal: 16,
        marginTop: 12,
        backgroundColor: "#160800",
        borderRadius: 16,
        paddingVertical: 12,
        paddingLeft: 14,
        paddingRight: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      }}
      accessibilityRole="alert"
      accessibilityLabel="Tip: Add Celsius to your home screen for the full app experience"
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          backgroundColor: "#A2492C",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Plus size={18} color="#FFFFFF" strokeWidth={2.5} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: "#FFFFFF",
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 13,
            lineHeight: 16,
          }}
        >
          Add to Home Screen
        </Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            flexWrap: "wrap",
            marginTop: 1,
          }}
        >
          <Text
            style={{
              color: "rgba(255,255,255,0.7)",
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 11,
              lineHeight: 14,
            }}
          >
            Tap{" "}
          </Text>
          <Share size={11} color="rgba(255,255,255,0.7)" />
          <Text
            style={{
              color: "rgba(255,255,255,0.7)",
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 11,
              lineHeight: 14,
            }}
          >
            {' then "Add to Home Screen" for the full experience.'}
          </Text>
        </View>
      </View>
      <Pressable
        onPress={dismiss}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={{
          width: 32,
          height: 32,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <X size={16} color="rgba(255,255,255,0.6)" />
      </Pressable>
    </View>
  );
}
