import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Check, ChevronDown, Delete } from "lucide-react-native";
import { fetchOutlets, type Outlet } from "../../lib/outlets";
import { loginWithPin } from "../../lib/auth";
import { ApiError } from "../../lib/api";

const LAST_OUTLET_KEY = "celsius_staff_last_outlet_v1";

// Dark-themed login screen — matches the POS dark aesthetic so cashiers
// on both apps see the same lock-screen vibe. Always dark regardless of
// system/user color-scheme preference, since the brand mark reads
// better on espresso.
// Tuned contrast: previous surface (#2A1411) was only ~5 lumin steps
// above the espresso bg, so the keypad buttons rendered invisibly on
// device — only the digits appeared, "all over the place". Bumped
// surface ≈ 3× brighter so buttons read as distinct rounded cards on
// the dark background.
const COLORS = {
  bg: "#1A0200", // espresso
  surface: "#6E4434", // keypad button + outlet picker bg (visible on espresso)
  surfaceHi: "#8A5544", // pressed/hover
  keyBorder: "rgba(245,243,240,0.20)", // outline so keys read as distinct cards
  text: "#FAFAFA",
  textMuted: "#C8B8B3",
  brand: "#C2452D", // primary
  brandSoft: "#F6E8E2", // primary-50, used as accent
  danger: "#EF4444",
  dotEmpty: "#5C3A30",
};

export default function Login() {
  const router = useRouter();
  const [outlets, setOutlets] = useState<Outlet[] | null>(null);
  const [outletsError, setOutletsError] = useState<string | null>(null);
  const [outletId, setOutletId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await fetchOutlets();
        setOutlets(list);
        const last = await AsyncStorage.getItem(LAST_OUTLET_KEY);
        if (last && list.some((o) => o.id === last)) setOutletId(last);
        else if (list.length === 1) setOutletId(list[0].id);
      } catch (e) {
        setOutletsError(
          e instanceof ApiError ? e.message : "Couldn't load outlets",
        );
      }
    })();
  }, []);

  // Auto-submit when the user hits 6 digits — same as POS. The Sign in
  // button is gone; entering the 6th digit IS the submit.
  async function submit(code: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await loginWithPin(code, outletId);
      if (outletId) await AsyncStorage.setItem(LAST_OUTLET_KEY, outletId);
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      router.replace("/(staff)/home");
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
        () => {},
      );
      setError(e instanceof ApiError ? e.message : "Wrong PIN");
      // Clear after a brief flash so the user can retype.
      setTimeout(() => {
        setPin("");
        setError(null);
      }, 900);
    } finally {
      setBusy(false);
    }
  }

  function press(d: string) {
    Haptics.selectionAsync().catch(() => {});
    if (error) setError(null);
    if (d === "del") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (d === "clear") {
      setPin("");
      return;
    }
    setPin((p) => {
      if (p.length >= 6) return p;
      const next = p + d;
      if (next.length === 6) {
        // Defer submit so the 6th dot paints before the round-trip.
        setTimeout(() => submit(next), 60);
      }
      return next;
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      <SafeAreaView style={{ flex: 1 }}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 24,
            justifyContent: "center",
            gap: 24,
          }}
        >
          {/* Brand mark — icon + role tag. The wordmark.png is black and
              renders invisibly on the dark login bg; until a white
              variant is provided, just show the icon + subtitle. */}
          <View style={{ alignItems: "center", gap: 14 }}>
            <Image
              source={require("../../assets/icon.png")}
              style={{ width: 88, height: 88, borderRadius: 20 }}
              resizeMode="cover"
            />
            <Text
              style={{
                color: COLORS.textMuted,
                fontSize: 14,
                letterSpacing: 0.5,
              }}
            >
              Staff Login
            </Text>
          </View>

          <OutletPicker
            outlets={outlets}
            selectedId={outletId}
            onSelect={setOutletId}
            error={outletsError}
          />

          {/* PIN dots — grow + colour-shift when filled, flash danger
              on error, brand colour otherwise. */}
          <View style={{ alignItems: "center", gap: 12 }}>
            <View style={{ flexDirection: "row", gap: 16 }}>
              {Array.from({ length: 6 }).map((_, i) => {
                const filled = i < pin.length;
                const bg = error
                  ? COLORS.danger
                  : filled
                    ? COLORS.brand
                    : COLORS.dotEmpty;
                return (
                  <View
                    key={i}
                    style={{
                      width: filled ? 18 : 14,
                      height: filled ? 18 : 14,
                      borderRadius: 12,
                      backgroundColor: bg,
                    }}
                  />
                );
              })}
            </View>
            <Text
              style={{
                color: error ? COLORS.danger : COLORS.textMuted,
                fontSize: 14,
                minHeight: 18,
              }}
            >
              {error
                ? error
                : busy
                  ? "Verifying…"
                  : "Enter your PIN"}
            </Text>
          </View>

          <NumPad onPress={press} disabled={busy} />
        </View>
      </SafeAreaView>
    </View>
  );
}

function OutletPicker({
  outlets,
  selectedId,
  onSelect,
  error,
}: {
  outlets: Outlet[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);

  if (error) {
    return (
      <Text style={{ textAlign: "center", color: COLORS.danger, fontSize: 14 }}>
        {error}
      </Text>
    );
  }
  if (!outlets) {
    return <ActivityIndicator color={COLORS.brandSoft} />;
  }

  const selected = outlets.find((o) => o.id === selectedId) ?? null;

  return (
    <View>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          height: 56,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 18,
          borderRadius: 16,
          backgroundColor: pressed ? COLORS.surfaceHi : COLORS.surface,
        })}
      >
        <Text
          style={{
            flex: 1,
            color: selected ? COLORS.text : COLORS.textMuted,
            fontSize: 16,
          }}
          numberOfLines={1}
        >
          {selected ? selected.name : "Select outlet"}
        </Text>
        <ChevronDown color={COLORS.textMuted} size={20} />
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 20,
              paddingVertical: 16,
              borderBottomWidth: 1,
              borderBottomColor: COLORS.surface,
            }}
          >
            <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "600" }}>
              Outlet
            </Text>
            <Pressable
              onPress={() => setOpen(false)}
              style={{ paddingHorizontal: 8, paddingVertical: 4 }}
            >
              <Text style={{ color: COLORS.brandSoft, fontSize: 14, fontWeight: "700" }}>
                Close
              </Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 8 }}
      showsVerticalScrollIndicator={false}
    >
            {outlets.map((o) => {
              const active = o.id === selectedId;
              return (
                <Pressable
                  key={o.id}
                  onPress={() => {
                    onSelect(o.id);
                    setOpen(false);
                  }}
                  style={({ pressed }) => ({
                    height: 56,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingHorizontal: 18,
                    borderRadius: 16,
                    backgroundColor: pressed
                      ? COLORS.surfaceHi
                      : active
                        ? COLORS.brand + "22"
                        : COLORS.surface,
                    borderWidth: active ? 1 : 0,
                    borderColor: COLORS.brand,
                  })}
                >
                  <Text
                    style={{ flex: 1, color: COLORS.text, fontSize: 16 }}
                    numberOfLines={1}
                  >
                    {o.name}
                  </Text>
                  {active ? <Check color={COLORS.brand} size={20} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// 4x3 keypad — mirrors the POS lock-screen keypad (apps/pos-native):
// fixed rounded-square keys on a raised surface, centered grid, with
// Clear (red tint) · 0 · Delete (backspace icon) on the bottom row.
// Clear wipes all 6 digits in one tap; Delete pops the last digit.
// Auto-submit on 6 digits means no Sign in button. All styling is
// inline (not className) so the keys always render regardless of the
// NativeWind config — the bug this replaces was buttons rendering
// invisibly, leaving bare digits scattered down the screen.
function NumPad({
  onPress,
  disabled,
}: {
  onPress: (d: string) => void;
  disabled: boolean;
}) {
  const rows: Array<Array<{ key: string; label: string; tone?: "digit" | "danger" | "icon" }>> = [
    [
      { key: "1", label: "1" },
      { key: "2", label: "2" },
      { key: "3", label: "3" },
    ],
    [
      { key: "4", label: "4" },
      { key: "5", label: "5" },
      { key: "6", label: "6" },
    ],
    [
      { key: "7", label: "7" },
      { key: "8", label: "8" },
      { key: "9", label: "9" },
    ],
    [
      { key: "clear", label: "Clear", tone: "danger" },
      { key: "0", label: "0" },
      { key: "del", label: "del", tone: "icon" },
    ],
  ];
  return (
    <View style={{ gap: 14, alignSelf: "center", width: "100%", maxWidth: 320 }}>
      {rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: "row", gap: 14 }}>
          {row.map((k) => {
            const isDanger = k.tone === "danger";
            const isIcon = k.tone === "icon";
            return (
              <Pressable
                key={k.key}
                onPress={() => onPress(k.key)}
                disabled={disabled}
                android_ripple={{ color: COLORS.surfaceHi, borderless: false }}
                style={({ pressed }) => ({
                  flex: 1,
                  height: 72,
                  borderRadius: 20,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: isDanger ? COLORS.danger + "55" : COLORS.keyBorder,
                  backgroundColor: pressed
                    ? isDanger
                      ? COLORS.danger + "33"
                      : COLORS.surfaceHi
                    : isDanger
                      ? COLORS.danger + "22"
                      : COLORS.surface,
                  opacity: disabled ? 0.5 : 1,
                })}
              >
                {isIcon ? (
                  <Delete color={COLORS.text} size={28} />
                ) : (
                  <Text
                    style={{
                      color: isDanger ? COLORS.danger : COLORS.text,
                      fontSize: isDanger ? 16 : 30,
                      fontWeight: isDanger ? "700" : "500",
                    }}
                  >
                    {k.label}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
