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
  Moon,
  RefreshCw,
  Shield,
  Smartphone,
  Sun,
  UserCircle2,
} from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { Screen } from "../../components/Screen";
import { PageHeader } from "../../components/PageHeader";
import { Card, Section } from "../../components/ui";
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

type ProfileResp = {
  completeness?: { percent: number; complete: boolean };
};

export default function Profile() {
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

  // Manual OTA pull — the default expo-updates flow downloads in the
  // background and only applies on the NEXT cold launch, which is
  // confusing for testers who expect "tap refresh, see new UI". This
  // forces the fetch + reload synchronously.
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  async function handleCheckForUpdates() {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    try {
      // Skip in dev — Updates APIs no-op (or throw) in Expo Go / dev
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
    <Screen>
      {/* Sticky header */}
      <PageHeader title="Profile" subtitle="Personal info, PIN, biometric" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-24"
      >

        {/* Hero user card */}
        <View className="mt-2">
          <Card variant="accent" pad="lg">
            <View className="flex-row items-center gap-4">
              <View className="h-16 w-16 items-center justify-center rounded-full bg-primary">
                <Text className="text-2xl font-display text-white">
                  {initial}
                </Text>
              </View>
              <View className="flex-1">
                <Text
                  className="text-xl font-display text-espresso"
                  numberOfLines={1}
                >
                  {session?.name ?? "—"}
                </Text>
                <Text className="mt-0.5 text-sm font-body-semi text-primary">
                  {role}
                </Text>
                {session?.outletName ? (
                  <Text
                    className="mt-0.5 text-xs font-body text-muted-fg"
                    numberOfLines={1}
                  >
                    {session.outletName}
                  </Text>
                ) : null}
              </View>
            </View>
          </Card>
        </View>

        {/* Account */}
        <Section title="Account">
          <Pressable
            onPress={openPersonal}
            accessibilityLabel="Personal info"
            className={`flex-row items-center gap-3 rounded-3xl border p-4 active:opacity-90 ${
              incomplete
                ? "border-amber-500/40 bg-amber-50/60"
                : "border-border bg-surface"
            }`}
          >
            <View
              className={`h-11 w-11 items-center justify-center rounded-2xl ${
                incomplete ? "bg-amber-500/15" : "bg-primary-50"
              }`}
            >
              {incomplete ? (
                <AlertCircle color="#D97706" size={20} />
              ) : (
                <UserCircle2 color="#C2452D" size={20} />
              )}
            </View>
            <View className="flex-1">
              <Text className="text-base font-display text-espresso">
                {incomplete ? "Complete your personal info" : "Personal info"}
              </Text>
              <Text className="mt-0.5 text-xs font-body text-muted-fg">
                Address, IC, emergency contact — needed for payslips and tax.
              </Text>
              {incomplete ? (
                <View className="mt-3 flex-row items-center gap-2">
                  <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-amber-100">
                    <View
                      className="h-full bg-amber-500"
                      style={{ width: `${completeness?.percent ?? 0}%` }}
                    />
                  </View>
                  <Text className="text-[10px] font-body-bold text-amber-700 tabular-nums">
                    {completeness?.percent ?? 0}%
                  </Text>
                </View>
              ) : null}
            </View>
            <ChevronRight color="#9CA3AF" size={18} />
          </Pressable>
        </Section>

        {/* Security */}
        <Section title="Security">
          <View className="gap-2.5">
            {biometricSupported ? (
              <View className="flex-row items-center gap-3 rounded-3xl border border-border bg-surface p-4">
                <View className="h-11 w-11 items-center justify-center rounded-2xl bg-primary-50">
                  <Fingerprint color="#C2452D" size={20} />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-display text-espresso">
                    Face ID for clock-in
                  </Text>
                  <Text className="mt-0.5 text-xs font-body text-muted-fg">
                    Require biometric to confirm every clock action.
                  </Text>
                </View>
                <Switch
                  value={biometricOn}
                  onValueChange={toggleBiometric}
                  trackColor={{ true: "#C2452D", false: "#D1D5DB" }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor="#D1D5DB"
                />
              </View>
            ) : null}

            <Pressable
              onPress={() => setPinOpen(true)}
              accessibilityLabel="Change PIN"
              className="flex-row items-center gap-3 rounded-3xl border border-border bg-surface p-4 active:bg-primary-50"
            >
              <View className="h-11 w-11 items-center justify-center rounded-2xl bg-primary-50">
                <Key color="#C2452D" size={20} />
              </View>
              <View className="flex-1">
                <Text className="text-base font-display text-espresso">
                  Change PIN
                </Text>
                <Text className="mt-0.5 text-xs font-body text-muted-fg">
                  Update your 4–6 digit login PIN.
                </Text>
              </View>
              <ChevronRight color="#9CA3AF" size={18} />
            </Pressable>
          </View>
        </Section>

        {/* Appearance — Light / Dark / System tri-toggle */}
        <Section title="Appearance">
          <View className="flex-row items-center gap-2 rounded-3xl border border-border bg-surface p-2">
            <AppearanceChip
              label="Light"
              Icon={Sun}
              active={appearancePref === "light"}
              onPress={() => pickAppearance("light")}
            />
            <AppearanceChip
              label="Dark"
              Icon={Moon}
              active={appearancePref === "dark"}
              onPress={() => pickAppearance("dark")}
            />
            <AppearanceChip
              label="System"
              Icon={Smartphone}
              active={appearancePref === "system"}
              onPress={() => pickAppearance("system")}
            />
          </View>
        </Section>

        {/* Manager-only */}
        {isManager ? (
          <Section title="Manager">
            <Pressable
              onPress={() =>
                WebBrowser.openBrowserAsync(
                  "https://backoffice.celsiuscoffee.com",
                )
              }
              accessibilityLabel="Open backoffice"
              className="flex-row items-center gap-3 rounded-3xl border border-border bg-surface p-4 active:bg-primary-50"
            >
              <View className="h-11 w-11 items-center justify-center rounded-2xl bg-primary-50">
                <Shield color="#C2452D" size={20} />
              </View>
              <View className="flex-1">
                <Text className="text-base font-display text-espresso">
                  Backoffice
                </Text>
                <Text className="mt-0.5 text-xs font-body text-muted-fg">
                  Open the web dashboard in your browser.
                </Text>
              </View>
              <ChevronRight color="#9CA3AF" size={18} />
            </Pressable>
          </Section>
        ) : null}

        {/* App — manual OTA pull. Default expo-updates behavior is
            background-download + apply-on-next-launch, which trips up
            testers expecting a refresh button. This forces fetch +
            reload synchronously. */}
        <Section title="App">
          <Pressable
            onPress={handleCheckForUpdates}
            disabled={checkingUpdate}
            accessibilityLabel="Check for updates"
            className="flex-row items-center gap-3 rounded-3xl border border-border bg-surface p-4 active:bg-primary-50"
          >
            <View className="h-11 w-11 items-center justify-center rounded-2xl bg-primary-50">
              {checkingUpdate ? (
                <ActivityIndicator color="#C2452D" size="small" />
              ) : (
                <RefreshCw color="#C2452D" size={20} />
              )}
            </View>
            <View className="flex-1">
              <Text className="text-base font-display text-espresso">
                Check for updates
              </Text>
              <Text className="mt-0.5 text-xs font-body text-muted-fg">
                Pull the latest build now — no need to force-quit.
              </Text>
            </View>
            <ChevronRight color="#9CA3AF" size={18} />
          </Pressable>
        </Section>

        {/* Sign out */}
        <Pressable
          onPress={handleSignOut}
          disabled={signingOut}
          accessibilityLabel="Sign out"
          className="mt-8 h-14 flex-row items-center justify-center gap-2 rounded-2xl border border-danger/30 active:bg-danger/5"
        >
          {signingOut ? (
            <ActivityIndicator color="#B91C1C" size="small" />
          ) : (
            <LogOut color="#B91C1C" size={18} />
          )}
          <Text className="text-base font-body-bold text-danger">
            {signingOut ? "Signing out…" : "Sign out"}
          </Text>
        </Pressable>

        {/* Version footer */}
        <Text className="mt-6 text-center text-[10px] font-body text-muted">
          Celsius Coffee · Staff
        </Text>
      </ScrollView>

      <ChangePinSheet open={pinOpen} onClose={() => setPinOpen(false)} />
    </Screen>
  );
}

function AppearanceChip({
  label,
  Icon,
  active,
  onPress,
}: {
  label: string;
  Icon: React.ComponentType<{ color: string; size: number }>;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-2xl py-3 active:opacity-80 ${
        active ? "bg-primary" : ""
      }`}
    >
      <Icon color={active ? "#FFFFFF" : "#737373"} size={16} />
      <Text
        className={`text-sm font-body-bold ${
          active ? "text-white" : "text-muted-fg"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ChangePinSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
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
    if (!/^\d{4,6}$/.test(newPin)) {
      setError("New PIN must be 4-6 digits.");
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
        <View className="flex-1 bg-background">
          <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
            <Text className="text-xl font-display text-espresso">
              Change PIN
            </Text>
            <Pressable onPress={onClose} className="px-2 py-1">
              <Text className="text-sm font-body-bold text-muted">Close</Text>
            </Pressable>
          </View>

          {success ? (
            <View className="flex-1 items-center justify-center px-6">
              <CheckCircle2 color="#15803D" size={56} />
              <Text className="mt-3 text-xl font-display text-espresso">
                PIN updated
              </Text>
              <Text className="mt-1 text-sm font-body text-muted-fg">
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
                  label="New PIN (4-6 digits)"
                  value={newPin}
                  onChange={setNewPin}
                />
                <PinField
                  label="Confirm new PIN"
                  value={confirmPin}
                  onChange={setConfirmPin}
                />
                {error ? (
                  <View className="mt-3 flex-row items-center gap-2 rounded-2xl border border-danger/30 bg-danger/5 px-3 py-2.5">
                    <AlertCircle color="#B91C1C" size={16} />
                    <Text className="flex-1 text-sm font-body text-danger">
                      {error}
                    </Text>
                  </View>
                ) : null}
              </ScrollView>
              <View className="border-t border-border p-5">
                <Pressable
                  onPress={submit}
                  disabled={saving || !currentPin || !newPin || !confirmPin}
                  className={`h-14 items-center justify-center rounded-2xl ${
                    saving || !currentPin || !newPin || !confirmPin
                      ? "bg-primary/40"
                      : "bg-primary active:opacity-90"
                  }`}
                >
                  {saving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text className="text-base font-body-bold text-white">
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
      <Text className="mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        className="h-14 rounded-2xl border border-border bg-surface px-4 text-2xl font-body-bold text-espresso tracking-widest"
      />
    </View>
  );
}
