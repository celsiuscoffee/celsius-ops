import { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable, ActivityIndicator, Modal, ScrollView } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { Delete, ChevronDown, Check } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { apiPost } from "@/lib/api";
import { usePos } from "@/lib/store";

type Outlet = { id: string; name: string };

// Short label (drop the "Celsius Coffee " brand prefix). Mirrors the
// shared outlet registry used on web.
const SHORT: Record<string, string> = {
  "outlet-sa": "Shah Alam",
  "outlet-con": "Putrajaya",
  "outlet-tam": "Tamarind",
  "outlet-nilai": "Nilai",
};
const label = (o: Outlet) => SHORT[o.id] ?? o.name.replace(/^Celsius Coffee\s*/i, "");

// Brand tokens — mirror the web POS login (apps/pos/src/app/login).
const SURFACE_RAISED = "rgba(245,243,240,0.06)";
const BRAND = "#A2492C";
const DANGER = "#E5484D";

export default function Login() {
  const { outletId, setOutlet, setStaff, staff } = usePos();
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (staff && outletId) router.replace("/register");
  }, [staff, outletId]);

  useEffect(() => {
    supabase.from("outlets").select("id, name").order("id").then(({ data }) => {
      const list = (data ?? []) as Outlet[];
      setOutlets(list);
      if (!outletId && list.length) setOutlet(list[0].id);
    });
  }, []);

  const submit = useCallback(
    async (fullPin: string) => {
      if (!outletId) { setError("Select outlet first"); return; }
      setBusy(true);
      setError(null);
      try {
        const u = await apiPost<{ id: string; name: string; role: string }>("/api/auth/pin", {
          pin: fullPin, outletId,
        });
        setStaff({ staffId: u.id, staffName: u.name, role: u.role });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace("/register");
      } catch (e: any) {
        const msg = String(e?.message ?? "");
        setError(
          msg.includes("401") ? "Invalid PIN" :
          msg.includes("409") ? "Duplicate PIN — see manager" :
          "Login error",
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setTimeout(() => { setPin(""); setError(null); }, 1000);
      } finally {
        setBusy(false);
      }
    },
    [outletId],
  );

  function digit(d: string) {
    if (busy || pin.length >= 6) return;
    Haptics.selectionAsync();
    const next = pin + d;
    setPin(next);
    setError(null);
    if (next.length === 6) submit(next);
  }
  const del = () => { if (!busy) { Haptics.selectionAsync(); setPin((p) => p.slice(0, -1)); setError(null); } };
  const clear = () => { if (!busy) { Haptics.selectionAsync(); setPin(""); setError(null); } };

  const selected = outlets.find((o) => o.id === outletId);

  return (
    <View className="flex-1 bg-espresso items-center justify-center">
      <View className="items-center" style={{ gap: 32 }}>
        {/* Brand */}
        <View className="items-center" style={{ gap: 12 }}>
          <View className="h-24 w-24 rounded-3xl bg-cream items-center justify-center">
            <Text className="text-espresso text-5xl" style={{ fontFamily: "Peachi-Bold" }}>°C</Text>
          </View>
          <Text className="text-cream text-4xl" style={{ fontFamily: "Peachi-Bold" }}>Celsius Coffee</Text>
          <Text className="text-cream/55 text-lg" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>Staff Login</Text>
        </View>

        {/* Outlet dropdown */}
        <Pressable
          onPress={() => { Haptics.selectionAsync(); setPickerOpen(true); }}
          className="w-72 flex-row items-center justify-between rounded-xl px-4 py-3.5 border"
          style={{ backgroundColor: SURFACE_RAISED, borderColor: "rgba(245,243,240,0.14)" }}
        >
          <Text className={selected ? "text-cream" : "text-cream/40"} style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 16 }}>
            {selected ? label(selected) : "Select Outlet"}
          </Text>
          <ChevronDown size={20} color="rgba(245,243,240,0.5)" />
        </Pressable>

        {/* PIN dots */}
        <View className="flex-row" style={{ gap: 16 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const filled = i < pin.length;
            return (
              <View
                key={i}
                className="h-5 w-5 rounded-full"
                style={{
                  backgroundColor: filled ? (error ? DANGER : BRAND) : "#444",
                  transform: [{ scale: filled ? 1.25 : 1 }],
                }}
              />
            );
          })}
        </View>

        {/* Status line */}
        <View className="h-6 justify-center">
          {busy ? (
            <Text className="text-cream/55 text-lg" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>Verifying…</Text>
          ) : error ? (
            <Text className="text-lg" style={{ fontFamily: "SpaceGrotesk_600SemiBold", color: DANGER }}>{error}</Text>
          ) : null}
        </View>

        {/* Keypad — 3-col grid: 1-9, Clear · 0 · ⌫ */}
        <View style={{ gap: 16 }}>
          {[["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]].map((row, ri) => (
            <View key={ri} className="flex-row" style={{ gap: 16 }}>
              {row.map((d) => <DigitKey key={d} label={d} onPress={() => digit(d)} disabled={busy} />)}
            </View>
          ))}
          <View className="flex-row" style={{ gap: 16 }}>
            <Pressable onPress={clear} className="h-20 w-20 rounded-2xl items-center justify-center active:opacity-60"
              style={{ backgroundColor: "rgba(229,72,77,0.18)" }}>
              <Text className="text-base" style={{ fontFamily: "SpaceGrotesk_600SemiBold", color: DANGER }}>Clear</Text>
            </Pressable>
            <DigitKey label="0" onPress={() => digit("0")} disabled={busy} />
            <Pressable onPress={del} className="h-20 w-20 rounded-2xl items-center justify-center active:opacity-60"
              style={{ backgroundColor: SURFACE_RAISED }}>
              <Delete size={28} color="#F5F3F0" />
            </Pressable>
          </View>
        </View>
      </View>

      {/* Outlet picker modal */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable className="flex-1 bg-black/70 items-center justify-center" onPress={() => setPickerOpen(false)}>
          <View className="w-80 rounded-3xl bg-surface border border-border p-3" style={{ backgroundColor: "#1A0A02" }}>
            <Text className="text-cream/50 text-xs tracking-[2px] px-3 py-2" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>SELECT OUTLET</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {outlets.map((o) => {
                const sel = o.id === outletId;
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => { Haptics.selectionAsync(); setOutlet(o.id); setPickerOpen(false); }}
                    className="flex-row items-center justify-between px-3 py-4 rounded-2xl active:opacity-70"
                    style={sel ? { backgroundColor: "rgba(245,243,240,0.06)" } : undefined}
                  >
                    <Text className={sel ? "text-cream" : "text-cream/75"} style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 17 }}>
                      {label(o)}
                    </Text>
                    {sel && <Check size={20} color={BRAND} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function DigitKey({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="h-20 w-20 rounded-2xl items-center justify-center active:opacity-60"
      style={{ backgroundColor: SURFACE_RAISED, opacity: disabled ? 0.5 : 1 }}
    >
      <Text className="text-cream" style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 30 }}>{label}</Text>
    </Pressable>
  );
}
