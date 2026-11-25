import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Updates from "expo-updates";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Fingerprint,
  Key,
  LogOut,
  RefreshCw,
  Shield,
  UserCircle2,
} from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { Screen } from "../../components/Screen";
import { PageHeader } from "../../components/PageHeader";
import { Button, List, ListRow, Section, Segmented } from "../../components/ui";
import { useStaff } from "../../lib/store";
import { logout } from "../../lib/auth";
import { api } from "../../lib/api";
import { API_BASE_URL } from "../../lib/env";
import { loadSession } from "../../lib/session";
import {
  getBiometricRequired,
  isBiometricAvailable,
  setBiometricRequired,
} from "../../lib/biometric";
import {
  loadColorSchemePref,
  saveColorSchemePref,
  type ColorSchemePref,
} from "../../lib/theme";
import { useCelsius } from "../../lib/celsius-ui";

type ProfileResp = {
  completeness?: { percent: number; complete: boolean };
};

export default function Profile() {
  const C = useCelsius().color;
  const router = useRouter();
  const session = useStaff((s) => s.session);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricOn, setBiometricOn] = useState(false);
  const [completeness, setCompleteness] = useState<{
    percent: number;
    complete: boolean;
  } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const { setColorScheme } = useColorScheme();
  const [appearancePref, setAppearancePref] =
    useState<ColorSchemePref>("system");

  useEffect(() => {
    (async () => {
      setBiometricSupported(await isBiometricAvailable());
      setBiometricOn(await getBiometricRequired());
      setAppearancePref(await loadColorSchemePref());
    })();
  }, []);

  async function pickAppearance(pref: ColorSchemePref) {
    setAppearancePref(pref);
    setColorScheme(pref);
    await saveColorSchemePref(pref);
  }

  const loadCompleteness = useCallback(async () => {
    try {
      const data = await api<ProfileResp>("/api/hr/profile");
      if (data.completeness) setCompleteness(data.completeness);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadCompleteness();
  }, [loadCompleteness]);

  async function toggleBiometric(v: boolean) {
    setBiometricOn(v);
    await setBiometricRequired(v);
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await logout();
      router.replace("/(auth)/login");
    } finally {
      setSigningOut(false);
    }
  }

  // Manual OTA pull, the default expo-updates flow downloads in the
  // background and only applies on the NEXT cold launch, which is
  // confusing for testers who expect "tap refresh, see new UI". This
  // forces the fetch + reload synchronously.
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  async function handleCheckForUpdates() {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    try {
      // Skip in dev, Updates APIs no-op (or throw) in Expo Go / dev
      // client, and there's nothing to fetch anyway.
      if (__DEV__ || !Updates.isEnabled) {
        Alert.alert(
          "Not available",
          "Update check only works in production builds.",
        );
        return;
      }
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) {
        Alert.alert(
          "You're up to date",
          `Running the latest build${
            Updates.updateId ? ` (${Updates.updateId.slice(0, 8)})` : ""
          }.`,
        );
        return;
      }
      await Updates.fetchUpdateAsync();
      Alert.alert(
        "Update ready",
        "The app will now reload to apply the new version.",
        [{ text: "Reload now", onPress: () => Updates.reloadAsync() }],
      );
    } catch (err) {
      Alert.alert(
        "Couldn't check for updates",
        err instanceof Error ? err.message : "Try again on Wi-Fi.",
      );
    } finally {
      setCheckingUpdate(false);
    }
  }

  const initial = session?.name?.charAt(0)?.toUpperCase() ?? "?";
  const role = session?.role
    ? session.role[0] + session.role.slice(1).toLowerCase()
    : "";
  const isManager =
    session?.role === "OWNER" ||
    session?.role === "ADMIN" ||
    session?.role === "MANAGER";

  const openPersonal = () => {
    router.push("/(staff)/personal");
  };

  const incomplete = completeness && !completeness.complete;

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader title="Profile" back />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="pb-8">
        {/* Who you are */}
        <View className="flex-row items-center gap-4 rounded-2xl border border-line bg-surface p-4">
          <View className="h-14 w-14 items-center justify-center rounded-full bg-sunken">
            <Text className="text-2xl font-display text-text">{initial}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-xl font-display text-text" numberOfLines={1}>
              {session?.name ?? "-"}
            </Text>
            <Text className="mt-0.5 text-sm font-body text-text-2" numberOfLines={1}>
              {[role, session?.outletName].filter(Boolean).join(" · ")}
            </Text>
          </View>
        </View>

        <Section title="Account">
          <List>
            <Pressable
              onPress={openPersonal}
              accessibilityRole="button"
              accessibilityLabel="Personal info"
              className={`min-h-[60px] flex-row items-center gap-3 px-4 py-3 active:bg-sunken ${
                incomplete ? "bg-warn-soft" : ""
              }`}
            >
              <View
                className={`h-10 w-10 items-center justify-center rounded-xl ${
                  incomplete ? "bg-surface" : "bg-sunken"
                }`}
              >
                {incomplete ? (
                  <AlertCircle color={C["warn-text"]} size={20} />
                ) : (
                  <UserCircle2 color={C["text-2"]} size={20} />
                )}
              </View>
              <View className="flex-1">
                <Text className="text-base font-body-semi text-text">
                  {incomplete ? "Finish your personal info" : "Personal info"}
                </Text>
                <Text className="mt-0.5 text-sm font-body text-text-2">
                  Address, IC and emergency contact, needed for payslips and tax.
                </Text>
                {incomplete ? (
                  <View className="mt-2 flex-row items-center gap-2">
                    <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
                      <View className="h-full bg-warn" style={{ width: `${completeness?.percent ?? 0}%` }} />
                    </View>
                    <Text className="text-xs font-body-semi text-warn-text" style={{ fontVariant: ["tabular-nums"] }}>
                      {completeness?.percent ?? 0}%
                    </Text>
                  </View>
                ) : null}
              </View>
              <ChevronRight color={C["text-3"]} size={18} />
            </Pressable>
            <ListRow
              icon={Key}
              title="Change PIN"
              meta="Your 6-digit sign-in PIN"
              onPress={() => setPinOpen(true)}
            />
            {biometricSupported ? (
              <ListRow
                icon={Fingerprint}
                title="Face ID for clock-in"
                meta="Confirm every clock-in and clock-out"
                trailing={
                  <Switch
                    value={biometricOn}
                    onValueChange={toggleBiometric}
                    accessibilityLabel="Face ID for clock-in"
                    trackColor={{ true: C.ink, false: C["line-2"] }}
                    thumbColor={C.raised}
                    ios_backgroundColor={C["line-2"]}
                  />
                }
              />
            ) : null}
          </List>
        </Section>

        <Section title="Appearance">
          <Segmented
            options={[
              { key: "system", label: "System" },
              { key: "light", label: "Light" },
              { key: "dark", label: "Dark" },
            ]}
            value={appearancePref}
            onChange={(k) => pickAppearance(k)}
          />
        </Section>

        <Section title="App">
          <List>
            {isManager ? (
              <ListRow
                icon={Shield}
                title="Back office"
                meta="Open the web back office in your browser"
                onPress={() => WebBrowser.openBrowserAsync("https://backoffice.celsiuscoffee.com")}
              />
            ) : null}
            <ListRow
              icon={RefreshCw}
              title={checkingUpdate ? "Checking…" : "Check for updates"}
              meta="Get the latest version now, no need to close the app"
              onPress={handleCheckForUpdates}
            />
          </List>
        </Section>

        <View className="mt-8">
          <Button
            label={signingOut ? "Signing out…" : "Sign out"}
            onPress={handleSignOut}
            variant="danger"
            icon={LogOut}
            loading={signingOut}
          />
        </View>

        <Text className="mt-6 text-center text-xs font-body text-text-3">Celsius Coffee · Manager</Text>
      </ScrollView>

      <ChangePinSheet open={pinOpen} onClose={() => setPinOpen(false)} />
    </Screen>
  );
}

function ChangePinSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const C = useCelsius().color;
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!open) {
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setError(null);
      setSuccess(false);
    }
  }, [open]);

  async function submit() {
    setError(null);
    if (!/^\d{6}$/.test(newPin)) {
      setError("New PIN must be exactly 6 digits.");
      return;
    }
    if (newPin !== confirmPin) {
      setError("New PIN and confirmation don't match.");
      return;
    }
    setSaving(true);
    try {
      const session = await loadSession();
      const res = await fetch(`${API_BASE_URL}/api/auth/change-pin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify({ current_pin: currentPin, new_pin: newPin }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Failed to change PIN");
        return;
      }
      setSuccess(true);
      setTimeout(() => onClose(), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to change PIN");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-1 bg-bg">
          <View className="flex-row items-center justify-between border-b border-line px-5 py-4">
            <Text className="text-xl font-display text-text">
              Change PIN
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              className="h-11 justify-center px-3 active:opacity-70"
            >
              <Text className="text-base font-body-semi text-text-2">Close</Text>
            </Pressable>
          </View>

          {success ? (
            <View className="flex-1 items-center justify-center px-6">
              <CheckCircle2 color={C["ok-text"]} size={56} />
              <Text className="mt-3 text-xl font-display text-text">
                PIN updated
              </Text>
              <Text className="mt-1 text-sm font-body text-text-2">
                Next sign-in will use the new PIN.
              </Text>
            </View>
          ) : (
            <>
              <ScrollView
                className="flex-1"
                contentContainerClassName="px-5 pt-4"
                keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
                <PinField
                  label="Current PIN"
                  value={currentPin}
                  onChange={setCurrentPin}
                />
                <PinField
                  label="New PIN (6 digits)"
                  value={newPin}
                  onChange={setNewPin}
                />
                <PinField
                  label="Confirm new PIN"
                  value={confirmPin}
                  onChange={setConfirmPin}
                />
                {error ? (
                  <View className="mt-3 flex-row items-center gap-2 rounded-2xl border border-danger bg-danger-soft px-3 py-2.5">
                    <AlertCircle color={C.danger} size={16} />
                    <Text className="flex-1 text-sm font-body text-danger-text">
                      {error}
                    </Text>
                  </View>
                ) : null}
              </ScrollView>
              <View className="border-t border-line p-5">
                <Pressable
                  onPress={submit}
                  disabled={saving || !currentPin || !newPin || !confirmPin}
                  className={`h-14 items-center justify-center rounded-2xl ${
                    saving || !currentPin || !newPin || !confirmPin
                      ? "bg-ink opacity-40"
                      : "bg-ink active:opacity-90"
                  }`}
                >
                  {saving ? (
                    <ActivityIndicator color={C["on-ink"]} />
                  ) : (
                    <Text className="text-base font-body-bold text-on-ink">
                      Update PIN
                    </Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PinField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <View className="mt-3">
      <Text className="mb-1.5 text-sm font-body-semi text-text-2">{label}</Text>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        accessibilityLabel={label}
        className="h-14 rounded-xl border border-line-2 bg-surface px-4 text-2xl font-body-bold text-text tracking-widest"
      />
    </View>
  );
}
