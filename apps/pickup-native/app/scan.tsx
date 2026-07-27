import { useCallback, useRef, useState } from "react";
import { View, Text, Pressable, Linking, StyleSheet } from "react-native";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
import { router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, QrCode, Camera as CameraIcon } from "lucide-react-native";
import * as Haptics from "@/lib/haptics";
import { useApp } from "@/lib/store";
import { supabase } from "@/lib/supabase";

/**
 * In-app table-QR scanner — the dine-in entry that does NOT depend on the
 * OS deep-link.
 *
 * The table QR encodes https://order.celsiuscoffee.com/table/{outletId}/{tableId}.
 * iOS Universal Links are currently blocked by an Apple account-side
 * provisioning bug (associated-domains never lands in the profile), and
 * Android App Links need the Play signing SHA wired — so a customer can't
 * always rely on the OS to route the QR into the app. Opening the app and
 * scanning here sidesteps all of that: it parses the same URL and runs the
 * exact dine-in handoff as app/table/[outletId]/[tableId].tsx.
 *
 * Scanning the physical table QR is the ONLY way in. The old manual
 * "enter table number" fallback was removed: it paired a hand-typed table with
 * a hand-picked outlet (routing through the /store outlet picker), which is the
 * exact wrong-table / pickup-flavoured path the QR-only dine-in flow exists to
 * prevent.
 */

/**
 * Pull {outletId, tableId} out of a scanned Celsius table QR. We only trust
 * our own domain — a stray QR code in the wild must not be able to drop a
 * customer into a dine-in session for some arbitrary store/table.
 */
function parseTableQr(raw: string): { outletId: string; tableId: string } | null {
  if (!raw) return null;
  if (!raw.includes("celsiuscoffee.com")) return null;
  const m = raw.match(/\/table\/([^/?#]+)\/([^/?#]+)/);
  if (!m) return null;
  const outletId = decodeURIComponent(m[1]).trim();
  const tableId = decodeURIComponent(m[2]).trim();
  if (!outletId || !tableId) return null;
  return { outletId, tableId };
}

const WRONG_QR_HINT =
  "That isn't a Celsius table code. Point the camera at the QR on your table.";

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const setDineIn = useApp((s) => s.setDineIn);
  const setOutletName = useApp((s) => s.setOutletName);
  // CameraView fires onBarcodeScanned many times a second; this ref makes the
  // dine-in handoff fire exactly once (we navigate away immediately after).
  const handled = useRef(false);
  const [hint, setHint] = useState<string | null>(null);

  // Pin dine-in context + head to the menu — the handoff the scan path runs.
  // Mirrors app/table/[outletId]/[tableId].tsx.
  const enterDineIn = useCallback(
    (oId: string, oName: string, table: string) => {
      handled.current = true;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setDineIn(oId, oName, table);
      router.replace("/menu");
    },
    [setDineIn],
  );

  const onScan = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (handled.current) return;
      const parsed = parseTableQr(data);
      if (!parsed) {
        // React bails on an identical string, so re-setting every frame is a
        // single render — keep scanning, just nudge the customer.
        setHint(WRONG_QR_HINT);
        return;
      }
      // Empty name now; backfill it in the background (the menu/checkout
      // resolve the outlet from the id regardless).
      enterDineIn(parsed.outletId, "", parsed.tableId);
      (async () => {
        try {
          const { data: row } = await supabase
            .from("outlet_settings")
            .select("name")
            .eq("store_id", parsed.outletId)
            .maybeSingle();
          const name = (row as { name?: string } | null)?.name;
          // Name-only: don't hijack the customer's persisted pickup outlet.
          if (name) setOutletName(name);
        } catch {
          // Name is cosmetic — the menu works with the id alone.
        }
      })();
    },
    [enterDineIn, setOutletName],
  );

  // Initial status still resolving.
  if (!permission) {
    return <View style={{ flex: 1, backgroundColor: "#000" }} />;
  }

  // Camera not granted — explain why we need it, offer the right next step,
  // and still allow manual entry so a denied camera doesn't block dine-in.
  if (!permission.granted) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#160800",
          paddingHorizontal: 28,
          justifyContent: "center",
        }}
      >
        <Stack.Screen options={{ headerShown: false }} />
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{
            position: "absolute",
            top: insets.top + 8,
            left: 16,
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: "rgba(255,255,255,0.12)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <X size={22} color="#FFFFFF" />
        </Pressable>
        <View style={{ alignItems: "center" }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: "rgba(255,255,255,0.1)",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 20,
            }}
          >
            <CameraIcon size={30} color="#FFFFFF" strokeWidth={1.8} />
          </View>
          <Text
            style={{
              fontFamily: "Peachi-Bold",
              fontSize: 21,
              color: "#FFFFFF",
              textAlign: "center",
            }}
          >
            Scan your table QR
          </Text>
          <Text
            style={{
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 14,
              color: "rgba(255,255,255,0.7)",
              textAlign: "center",
              marginTop: 8,
              lineHeight: 20,
            }}
          >
            Celsius needs camera access to read the QR code on your table so you
            can order from your seat.
          </Text>
          <Pressable
            onPress={() => {
              if (permission.canAskAgain) requestPermission();
              else Linking.openSettings();
            }}
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: 999,
              paddingHorizontal: 28,
              paddingVertical: 14,
              marginTop: 24,
            }}
          >
            <Text style={{ fontFamily: "Peachi-Bold", fontSize: 15, color: "#160800" }}>
              {permission.canAskAgain ? "Allow camera" : "Open Settings"}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Live scanner.
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={onScan}
      />
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{
            position: "absolute",
            top: insets.top + 8,
            left: 16,
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: "rgba(0,0,0,0.5)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <X size={22} color="#FFFFFF" />
        </Pressable>

        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <View
            style={{
              width: 240,
              height: 240,
              borderRadius: 28,
              borderWidth: 3,
              borderColor: "rgba(255,255,255,0.92)",
              backgroundColor: "rgba(255,255,255,0.04)",
            }}
          />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              marginTop: 28,
            }}
          >
            <QrCode size={18} color="#FFFFFF" />
            <Text style={{ fontFamily: "Peachi-Bold", fontSize: 16, color: "#FFFFFF" }}>
              Point at your table QR
            </Text>
          </View>
          <Text
            style={{
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 13,
              color: hint ? "#FBBF24" : "rgba(255,255,255,0.7)",
              marginTop: 6,
              textAlign: "center",
              paddingHorizontal: 44,
              lineHeight: 18,
            }}
          >
            {hint ?? "Order from your phone — we'll bring it to your table."}
          </Text>
        </View>
      </View>
    </View>
  );
}
