import { useEffect, useState } from "react";
import { View, Text, AppState } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlertCircle } from "lucide-react-native";
import { getSetting } from "../lib/settings";

// Top banner shown app-wide when admin has flipped maintenance mode on
// from backoffice. Pickup orders keep working but customers see the
// message — useful for "Back at 11am after a brief outage" style notices.
//
// The banner re-reads the setting on a 60s poll AND on every
// foreground transition. Without this it stayed at whatever state the
// app booted into, so admins flipping the toggle mid-session never
// reached the customer until they killed + relaunched the app.
export function MaintenanceBanner() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      getSetting("maintenance").then((m) => {
        if (cancelled) return;
        setVisible(Boolean(m.enabled && m.message));
        setMessage(m.message ?? "");
      }).catch(() => { /* defaults already shown */ });
    };

    sync();
    const interval = setInterval(sync, 60_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  if (!visible) return null;

  return (
    <View
      style={{
        position: "absolute",
        top: insets.top,
        left: 0,
        right: 0,
        zIndex: 10000,
        paddingVertical: 8,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: "#A2492C",
      }}
    >
      <AlertCircle size={14} color="#FFFFFF" strokeWidth={2.5} />
      <Text
        style={{
          color: "#FFFFFF",
          fontFamily: "SpaceGrotesk_600SemiBold",
          fontSize: 12,
          flex: 1,
        }}
        numberOfLines={2}
      >
        {message}
      </Text>
    </View>
  );
}
