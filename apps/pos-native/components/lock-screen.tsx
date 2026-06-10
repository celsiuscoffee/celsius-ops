import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, Image, useWindowDimensions } from "react-native";
import * as Haptics from "expo-haptics";
import { Delete } from "lucide-react-native";
import { apiPost } from "@/lib/api";
import { usePos } from "@/lib/store";

/**
 * Sleep/lock overlay for the register.
 *
 * The auto-logout timer flips usePos().locked instead of signing out and
 * leaving the register, so the register stays mounted and its online-order
 * auto-printers + chime (usePickupPrinter / useGrabPrinter / useOrderChime —
 * all keyed on outletId, not staff) keep firing while the till is idle. This
 * overlay sits on top, blocks all interaction, and requires a staff PIN to
 * resume — same auth as the login screen (incl. manager override), so sales
 * still can't happen without a PIN and attribution is preserved.
 *
 * On a successful PIN, setStaff() also clears `locked`, so this unmounts.
 * Deliberately self-contained (no outlet picker, no navigation) so it can be
 * dropped over the register without touching the login flow.
 */

const SURFACE_RAISED = "rgba(245,243,240,0.06)";
const BRAND = "#A2492C";
const DANGER = "#E5484D";

function clockLabel(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

export default function LockScreen() {
  const { outletId, setStaff } = usePos();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Manager-override mode: rostered staff signing in outside their shift get a
  // 403 NOT_SCHEDULED; the keypad then collects a MANAGER pin to authorise.
  const [override, setOverride] = useState<{ staffPin: string } | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Live clock for the "asleep" framing — cheap 30s tick.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const submit = useCallback(
    async (fullPin: string) => {
      if (!outletId) { setError("No outlet set"); return; }
      setBusy(true);
      setError(null);
      const isOverride = !!override;
      const payload = isOverride
        ? { pin: override!.staffPin, outletId, overridePin: fullPin }
        : { pin: fullPin, outletId };
      try {
        const u = await apiPost<{ id: string; name: string; role: string; shiftEnd?: string | null }>(
          "/api/pos/auth/pin", payload,
        );
        const shiftEndsAt = u.shiftEnd ? Date.parse(u.shiftEnd) : null;
        // setStaff stamps a fresh session AND clears `locked` → this unmounts.
        setStaff({ staffId: u.id, staffName: u.name, role: u.role }, shiftEndsAt);
        setOverride(null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (e: any) {
        const msg = String(e?.message ?? "");
        if (!isOverride && msg.includes("NOT_SCHEDULED")) {
          setOverride({ staffPin: fullPin });
          setPin("");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          setBusy(false);
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
    [outletId, override, setStaff],
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
  const clear = () => { if (!busy) { Haptics.selectionAsync(); setPin(""); setError(null); setOverride(null); } };

  const { width: winW, height: winH } = useWindowDimensions();
  const scale = Math.min(1, (winW - 56) / 644, (winH - 56) / 400);

  return (
    <View
      // Absolute full-screen cover — blocks every touch on the register beneath.
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#0B0402", alignItems: "center", justifyContent: "center" }}
    >
      <View className="flex-row items-center" style={{ gap: 72, transform: [{ scale }] }}>
        {/* Left: asleep identity + clock + PIN dots */}
        <View className="items-center" style={{ gap: 20, width: 300 }}>
          <Image source={require("@/assets/icon.png")} style={{ width: 96, height: 96, borderRadius: 24, opacity: 0.92 }} resizeMode="contain" />
          <Text style={{ fontFamily: "Peachi-Bold", fontSize: 46, color: "rgba(245,243,240,0.92)", lineHeight: 50 }}>{clockLabel(now)}</Text>
          <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 15, color: override ? "#FBBF24" : "rgba(245,243,240,0.55)" }}>
            {override ? "Manager PIN to authorise" : "POS asleep — enter PIN to resume"}
          </Text>

          {/* PIN dots */}
          <View className="flex-row" style={{ gap: 16, marginTop: 4 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const filled = i < pin.length;
              return (
                <View
                  key={i}
                  className="h-5 w-5 rounded-full"
                  style={{ backgroundColor: filled ? (error ? DANGER : BRAND) : "#3A2A22", transform: [{ scale: filled ? 1.25 : 1 }] }}
                />
              );
            })}
          </View>

          {/* Status line */}
          <View className="h-6 justify-center">
            {busy ? (
              <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 17, color: "rgba(245,243,240,0.55)" }}>Verifying…</Text>
            ) : error ? (
              <Text style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 17, color: DANGER }}>{error}</Text>
            ) : override ? (
              <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 13, color: "#FBBF24" }}>Not scheduled — manager PIN, or Clear to cancel</Text>
            ) : null}
          </View>
        </View>

        {/* Right: keypad — 1-9, Clear · 0 · ⌫ */}
        <View style={{ gap: 16 }}>
          {[["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]].map((row, ri) => (
            <View key={ri} className="flex-row" style={{ gap: 16 }}>
              {row.map((d) => <DigitKey key={d} label={d} onPress={() => digit(d)} disabled={busy} />)}
            </View>
          ))}
          <View className="flex-row" style={{ gap: 16 }}>
            <Pressable onPress={clear} className="h-20 w-20 rounded-2xl items-center justify-center active:opacity-60" style={{ backgroundColor: "rgba(229,72,77,0.18)" }}>
              <Text style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 16, color: DANGER }}>Clear</Text>
            </Pressable>
            <DigitKey label="0" onPress={() => digit("0")} disabled={busy} />
            <Pressable onPress={del} className="h-20 w-20 rounded-2xl items-center justify-center active:opacity-60" style={{ backgroundColor: SURFACE_RAISED }}>
              <Delete size={28} color="#F5F3F0" />
            </Pressable>
          </View>
        </View>
      </View>
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
      <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 30, color: "#F5F3F0" }}>{label}</Text>
    </Pressable>
  );
}
