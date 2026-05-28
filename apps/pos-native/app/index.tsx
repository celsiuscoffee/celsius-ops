import { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { Delete } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { apiPost } from "@/lib/api";
import { usePos } from "@/lib/store";

type Outlet = { id: string; name: string };

// Short label (drop the "Celsius Coffee " brand prefix) so the picker
// reads cleanly. Mirrors the shared outlet registry used on web.
const SHORT: Record<string, string> = {
  "outlet-sa": "Shah Alam",
  "outlet-con": "Putrajaya",
  "outlet-tam": "Tamarind",
  "outlet-nilai": "Nilai",
};
const shortName = (o: Outlet) => SHORT[o.id] ?? o.name.replace(/^Celsius Coffee\s*/i, "");

export default function Login() {
  const { outletId, setOutlet, setStaff, staff } = usePos();
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already logged in this shift → straight to register.
  useEffect(() => {
    if (staff && outletId) router.replace("/register");
  }, [staff, outletId]);

  // Load the outlet list once.
  useEffect(() => {
    supabase
      .from("outlets")
      .select("id, name")
      .order("id")
      .then(({ data }) => {
        const list = (data ?? []) as Outlet[];
        setOutlets(list);
        if (!outletId && list.length) setOutlet(list[0].id);
      });
  }, []);

  const submit = useCallback(
    async (fullPin: string) => {
      if (!outletId) {
        setError("Select an outlet first");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const u = await apiPost<{ id: string; name: string; role: string }>("/api/auth/pin", {
          pin: fullPin,
          outletId,
        });
        setStaff({ staffId: u.id, staffName: u.name, role: u.role });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace("/register");
      } catch (e: any) {
        const msg = String(e?.message ?? "");
        setError(
          msg.includes("401") ? "Invalid PIN" :
          msg.includes("409") ? "Duplicate PIN — see manager" :
          "Login failed. Try again.",
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setPin("");
      } finally {
        setBusy(false);
      }
    },
    [outletId],
  );

  function press(d: string) {
    if (busy || pin.length >= 6) return;
    Haptics.selectionAsync();
    const next = pin + d;
    setPin(next);
    setError(null);
    if (next.length === 6) submit(next);
  }
  const back = () => { if (!busy) { Haptics.selectionAsync(); setPin((p) => p.slice(0, -1)); } };

  const keypad = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <View className="flex-1 bg-espresso items-center justify-center px-8">
      {/* Brand */}
      <View className="h-20 w-20 rounded-2xl bg-cream items-center justify-center mb-3">
        <Text className="text-espresso text-4xl" style={{ fontFamily: "Peachi-Bold" }}>°C</Text>
      </View>
      <Text className="text-cream text-3xl" style={{ fontFamily: "Peachi-Bold" }}>Celsius Coffee</Text>
      <Text className="text-cream/55 text-[11px] tracking-[3px] mt-1 mb-6" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
        STAFF LOGIN
      </Text>

      {/* Outlet pills */}
      <View className="flex-row flex-wrap justify-center gap-2 mb-6 max-w-[640px]">
        {outlets.map((o) => {
          const sel = o.id === outletId;
          return (
            <Pressable
              key={o.id}
              onPress={() => { Haptics.selectionAsync(); setOutlet(o.id); }}
              className={`px-5 py-2.5 rounded-2xl border ${sel ? "bg-cream border-cream" : "border-cream/15"}`}
            >
              <Text
                className={sel ? "text-espresso" : "text-cream/70"}
                style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}
              >
                {shortName(o)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* PIN dots */}
      <View className="flex-row gap-3 mb-2 h-5 items-center">
        {Array.from({ length: 6 }).map((_, i) => (
          <View
            key={i}
            className={`h-3.5 w-3.5 rounded-full ${i < pin.length ? "bg-amber-400" : "bg-cream/20"}`}
          />
        ))}
      </View>
      <View className="h-6 justify-center">
        {busy ? <ActivityIndicator color="#FBBF24" /> :
          error ? <Text className="text-red-300 text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>{error}</Text> : null}
      </View>

      {/* Keypad */}
      <View className="flex-row flex-wrap justify-center mt-4" style={{ width: 320 }}>
        {keypad.map((d) => (
          <Key key={d} label={d} onPress={() => press(d)} />
        ))}
        <View className="h-[72px] w-[100px]" />
        <Key label="0" onPress={() => press("0")} />
        <Key onPress={back} icon>
          <Delete size={26} color="#F5F3F0" />
        </Key>
      </View>
    </View>
  );
}

function Key({
  label, onPress, icon, children,
}: { label?: string; onPress: () => void; icon?: boolean; children?: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      className="h-[72px] w-[100px] m-1 rounded-2xl items-center justify-center active:opacity-60"
      style={{ backgroundColor: "rgba(245,243,240,0.05)", borderWidth: 1, borderColor: "rgba(245,243,240,0.10)" }}
    >
      {icon ? children : (
        <Text className="text-cream text-2xl" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{label}</Text>
      )}
    </Pressable>
  );
}
