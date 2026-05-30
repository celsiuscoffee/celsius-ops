import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import Constants from "expo-constants";
import {
  ChevronLeft, Printer, LayoutGrid, Receipt, FileText, Store, RefreshCw, CheckCircle2, AlertCircle, ExternalLink,
} from "lucide-react-native";
import { usePos } from "@/lib/store";
import { useSettings } from "@/lib/settings";
import { outletShort, outletFull } from "@/lib/outlets";
import { getPrinterStatus, reconnectPrinter, testPrint, printerAvailable } from "@/lib/printer";

const BRAND = "#A2492C";
const OK = "#86efac";
const WARN = "#FBBF24";

export default function SettingsScreen() {
  const { outletId, staff } = usePos();
  const settings = useSettings((s) => s.settings);
  const loading = useSettings((s) => s.loading);
  const error = useSettings((s) => s.error);
  const loadSettings = useSettings((s) => s.load);

  const [printer, setPrinter] = useState<{ connected: boolean; status?: string; name?: string; paper?: string } | null>(null);
  const [printerBusy, setPrinterBusy] = useState(false);

  useEffect(() => {
    if (outletId) loadSettings(outletId);
    refreshPrinter();
  }, [outletId]);

  async function refreshPrinter() {
    setPrinter(await getPrinterStatus());
  }

  async function onReconnect() {
    setPrinterBusy(true);
    Haptics.selectionAsync();
    await reconnectPrinter();
    await refreshPrinter();
    setPrinterBusy(false);
  }

  async function onTestPrint() {
    setPrinterBusy(true);
    Haptics.selectionAsync();
    const ok = await testPrint();
    setPrinterBusy(false);
    Haptics.notificationAsync(
      ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
    );
    if (!ok) {
      Alert.alert("Test print failed", printerAvailable()
        ? "Printer not reachable. Check paper + that this is a SUNMI device, then Reconnect."
        : "Printer module not available in this build.");
    }
  }

  const moduleMissing = !printerAvailable();
  const connected = printer?.connected === true;

  return (
    <View className="flex-1 bg-espresso">
      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 pt-4 pb-3 border-b border-border">
        <Pressable
          onPress={() => { Haptics.selectionAsync(); router.back(); }}
          className="h-10 w-10 items-center justify-center rounded-xl border border-cream/15 active:opacity-60"
        >
          <ChevronLeft size={20} color="rgba(245,243,240,0.8)" />
        </Pressable>
        <Text className="text-cream text-xl" style={{ fontFamily: "Peachi-Bold" }}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60, alignItems: "center" }}>
        <View style={{ width: "100%", maxWidth: 760, gap: 16 }}>

          {/* ── Printer ── */}
          <Card title="Receipt Printer" Icon={Printer}>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                {connected ? <CheckCircle2 size={18} color={OK} /> : <AlertCircle size={18} color={WARN} />}
                <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>
                  {moduleMissing ? "Module unavailable" : connected ? "Connected" : "Not connected"}
                </Text>
              </View>
              {printerBusy && <ActivityIndicator color={WARN} />}
            </View>
            {!!printer?.name && <Row label="Printer" value={String(printer.name)} />}
            {!!printer?.paper && <Row label="Paper" value={String(printer.paper)} />}
            {!!printer?.status && <Row label="Status" value={String(printer.status)} />}
            <View className="flex-row gap-3 mt-2">
              <Btn label="Reconnect" Icon={RefreshCw} onPress={onReconnect} disabled={printerBusy || moduleMissing} />
              <Btn label="Test Print" Icon={Receipt} onPress={onTestPrint} disabled={printerBusy || moduleMissing} primary />
            </View>
            <Text className="text-cream/35 text-[11px] mt-1" style={{ fontFamily: "SpaceGrotesk_400Regular" }}>
              SUNMI D3 built-in 80mm thermal head. Receipts + kitchen dockets print here automatically on checkout.
            </Text>
          </Card>

          {/* ── Backoffice-managed outlet settings (read-only mirror) ── */}
          <Card title="Outlet Settings" Icon={LayoutGrid}>
            <View className="flex-row items-center gap-1.5 mb-1">
              <ExternalLink size={13} color="rgba(245,243,240,0.45)" />
              <Text className="text-cream/45 text-[11px]" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                Managed in Backoffice → POS Settings. This terminal reads it live.
              </Text>
            </View>
            {loading ? (
              <ActivityIndicator color={WARN} style={{ marginVertical: 12 }} />
            ) : error ? (
              <Text className="text-[#E5484D] text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                Couldn't load settings: {error}
              </Text>
            ) : !settings ? (
              <Text className="text-cream/45 text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                No settings row for this outlet yet.
              </Text>
            ) : (
              <>
                <Row label="Service Charge" value={`${settings.service_charge_rate ?? 0}%`} />
                <Row label="Default Order Type" value={settings.default_order_type === "dine_in" ? "Dine-in" : "Takeaway"} />
                <Row label="Product Grid" value={`${settings.grid_columns ?? 4} columns`} />
                <Row label="Checkout Option" value={settings.checkout_option ?? "—"} />
              </>
            )}
          </Card>

          {/* ── Receipt config (read-only mirror) ── */}
          {settings && (
            <Card title="Receipt" Icon={Receipt}>
              <Row label="Header" value={settings.receipt_header || outletFull(outletId)} />
              <Row label="Footer" value={settings.receipt_footer || "Thank you for visiting!"} />
              <Row label="Logo" value={settings.receipt_show_logo !== false ? "Shown" : "Hidden"} />
              <Row label="QR on receipt" value={settings.receipt_qr_url ? "On" : "Off"} />
              <Row label="Promo on receipt" value={settings.receipt_promo_enabled ? "On" : "Off"} />
            </Card>
          )}

          {/* ── Tax + e-Invoice (read-only mirror) ── */}
          {settings && (
            <Card title="Tax & e-Invoice" Icon={FileText}>
              <Row label="Default Tax Rate" value={`${settings.default_tax_rate ?? 0}%`} />
              <Row label="Tax Inclusive" value={settings.default_tax_inclusive !== false ? "Yes" : "No"} />
              <Row label="TIN" value={settings.einvoice_tin || "—"} />
              <Row label="BRN" value={settings.einvoice_brn || "—"} />
              <Row label="SST No." value={settings.einvoice_sst_no || "—"} />
            </Card>
          )}

          {/* ── Terminal ── */}
          <Card title="Terminal" Icon={Store}>
            <Row label="Outlet" value={`${outletShort(outletId)} (${outletId ?? "—"})`} />
            <Row label="Signed in" value={staff?.staffName ?? "—"} />
            <Row label="Role" value={staff?.role ?? "—"} />
            <Row label="App version" value={String(Constants.expoConfig?.version ?? "1.0.0")} />
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

function Card({ title, Icon, children }: { title: string; Icon: any; children: React.ReactNode }) {
  return (
    <View className="rounded-3xl border border-border p-5" style={{ backgroundColor: "#1A0A02", gap: 8 }}>
      <View className="flex-row items-center gap-2 pb-2 mb-1 border-b border-border">
        <Icon size={16} color={BRAND} />
        <Text className="text-cream text-base" style={{ fontFamily: "Peachi-Bold" }}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <Text className="text-cream/55 text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>{label}</Text>
      <Text className="text-cream text-sm text-right flex-1 ml-4" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Btn({
  label, Icon, onPress, disabled, primary,
}: { label: string; Icon: any; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-1 h-12 flex-row items-center justify-center gap-2 rounded-2xl active:opacity-70 ${primary ? "bg-primary" : "border border-cream/15"}`}
      style={{ opacity: disabled ? 0.45 : 1, backgroundColor: primary ? BRAND : "rgba(245,243,240,0.05)" }}
    >
      <Icon size={16} color="#F5F3F0" />
      <Text className="text-cream text-sm" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>{label}</Text>
    </Pressable>
  );
}
