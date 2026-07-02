import { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable, ActivityIndicator, Modal, ScrollView, Image, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { Delete, ChevronDown, Check } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { apiPost } from "@/lib/api";
import { usePos, shiftSessionExpired } from "@/lib/store";

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
  const { outletId, setOutlet, setStaff, staff, loggedInAt, shiftEndsAt, signOut } = usePos();
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Manager-override mode: when rostered staff sign in outside their shift the
  // server returns 403 NOT_SCHEDULED; the keypad then collects a MANAGER pin to
  // authorise the captured staff login. `null` = normal staff PIN entry.
  const [override, setOverride] = useState<{ staffPin: string } | null>(null);

  useEffect(() => {
    // A persisted session older than 2h is expired — clear it so the till
    // re-prompts for a PIN on launch instead of waltzing back into the register.
    if (staff && shiftSessionExpired(loggedInAt, shiftEndsAt)) { signOut(); return; }
    if (staff && outletId) router.replace("/register");
  }, [staff, outletId, loggedInAt, shiftEndsAt]);

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
      // In override mode the keypad collects a MANAGER pin to authorise the
      // not-scheduled staff captured in `override.staffPin`.
      const isOverride = !!override;
      const payload = isOverride
        ? { pin: override!.staffPin, outletId, overridePin: fullPin }
        : { pin: fullPin, outletId };
      try {
        const u = await apiPost<{ id: string; name: string; role: string; shiftEnd?: string | null; token?: string }>(
          "/api/pos/auth/pin", payload,
        );
        // Rostered login → auto-logout at the scheduled shift end; otherwise null
        // (manager / override / no roster) falls back to the till's 2h TTL.
        const shiftEndsAt = u.shiftEnd ? Date.parse(u.shiftEnd) : null;
        // Keep the POS session JWT so apiPost/apiGet can replay it as a Bearer
        // (the httpOnly cookie the endpoint also sets is unreachable to native).
        setStaff({ staffId: u.id, staffName: u.name, role: u.role, token: u.token ?? null }, shiftEndsAt);
        setOverride(null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace("/register");
      } catch (e: any) {
        const msg = String(e?.message ?? "");
        // Not scheduled now → drop into manager-override mode (manager taps their
        // PIN to authorise). Only on the first (staff) pass, never while already
        // collecting an override PIN.
        if (!isOverride && msg.includes("NOT_SCHEDULED")) {
          setOverride({ staffPin: fullPin });
          setPin("");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          return;
        }
        setError(
          msg.includes("OVERRIDE_FAILED") ? "Manager PIN not recognised" :
          msg.includes("NOT_SCHEDULED") ? "Not scheduled — ask a manager" :
          msg.includes("401") ? "Invalid PIN" :
          msg.includes("409") ? "Duplicate PIN — see manager" :
          "Login error",
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setTimeout(() => { setPin(""); setError(null); }, 1100);
      } finally {
        setBusy(false);
      }
    },
    [outletId, override],
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
  // Clear also cancels manager-override mode (back to staff PIN entry).
  const clear = () => { if (!busy) { Haptics.selectionAsync(); setPin(""); setError(null); setOverride(null); } };

  const selected = outlets.find((o) => o.id === outletId);

  // The two-column login block is ~644×400 at full size. On smaller / narrower
  // SUNMI panels it overflowed and clipped the keypad, so scale the whole block
  // down to fit the actual screen. Capped at 1 — a full-size landscape till is
  // unchanged; only constrained screens shrink.
  const { width: winW, height: winH } = useWindowDimensions();
  const loginScale = Math.min(1, (winW - 56) / 644, (winH - 56) / 400);

  return (
    <View className="flex-1 bg-espresso items-center justify-center">
      {/* Landscape two-column: identity on the left, keypad on the right.
          The screen is only 720dp tall — stacking everything in one column
          overflowed, so the tall keypad sits beside the brand instead.
          loginScale shrinks the block to fit smaller panels (never upscales). */}
      <View className="flex-row items-center" style={{ gap: 72, transform: [{ scale: loginScale }] }}>
        {/* Left: identity + outlet + PIN dots */}
        <View className="items-center" style={{ gap: 22, width: 300 }}>
          <Image
            source={require("@/assets/icon.png")}
            style={{ width: 104, height: 104, borderRadius: 26 }}
            resizeMode="contain"
          />
          <View className="items-center" style={{ gap: 4 }}>
            <Text className="text-cream text-3xl" style={{ fontFamily: "Peachi-Bold" }}>Celsius Coffee</Text>
            <Text className="text-base" style={{ fontFamily: "SpaceGrotesk_500Medium", color: override ? "#FBBF24" : "rgba(245,243,240,0.55)" }}>
              {override ? "Manager PIN to authorise" : "Staff Login"}
            </Text>
          </View>

          {/* Outlet dropdown */}
          <Pressable
            onPress={() => { Haptics.selectionAsync(); setPickerOpen(true); }}
            className="w-full flex-row items-center justify-between rounded-xl px-4 py-3.5 border"
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
            ) : override ? (
              <Text className="text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium", color: "#FBBF24" }}>Not scheduled — manager PIN, or Clear to cancel</Text>
            ) : null}
          </View>
        </View>

        {/* Right: keypad — 3-col grid: 1-9, Clear · 0 · ⌫ */}
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
