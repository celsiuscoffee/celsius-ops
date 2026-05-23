import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Key,
  LogOut,
  Shield,
  UserCircle2,
} from "lucide-react-native";
import { Screen } from "../../components/Screen";
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

  useEffect(() => {
    (async () => {
      setBiometricSupported(await isBiometricAvailable());
      setBiometricOn(await getBiometricRequired());
    })();
  }, []);

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

  const initial = session?.name?.charAt(0)?.toUpperCase() ?? "?";
  const role = session?.role
    ? session.role[0] + session.role.slice(1).toLowerCase()
    : "";
  const isManager =
    session?.role === "OWNER" ||
    session?.role === "ADMIN" ||
    session?.role === "MANAGER";

  const openPersonal = () => {
    const url = `${API_BASE_URL}/profile/personal`;
    void WebBrowser.openBrowserAsync(url);
  };

  return (
    <Screen>
      <ScrollView contentContainerClassName="pt-8 pb-12">
        <Text className="text-3xl font-display text-espresso">Profile</Text>

        {/* User card */}
        <View className="mt-4 flex-row items-center gap-3 rounded-3xl border border-border bg-surface p-4">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-primary-50">
            <Text className="text-lg font-display text-primary">{initial}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-base font-body-semi text-espresso">
              {session?.name ?? "—"}
            </Text>
            <Text className="text-sm font-body text-muted-fg">{role}</Text>
            {session?.outletName ? (
              <Text className="text-xs font-body text-muted">
                {session.outletName}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Personal info — reminder when incomplete */}
        <Pressable
          onPress={openPersonal}
          className={`mt-3 flex-row items-center gap-3 rounded-3xl border p-4 active:opacity-90 ${
            completeness && !completeness.complete
              ? "border-amber-500/30 bg-amber-50/50"
              : "border-border bg-surface"
          }`}
        >
          {completeness && !completeness.complete ? (
            <AlertCircle color="#F59E0B" size={20} />
          ) : (
            <UserCircle2 color="#A2492C" size={20} />
          )}
          <View className="flex-1">
            <Text className="text-sm font-body-semi text-espresso">
              {completeness && !completeness.complete
                ? "Complete your personal info"
                : "Personal info"}
            </Text>
            <Text className="text-xs font-body text-muted">
              Address, IC, emergency contact — needed for payslips and tax.
            </Text>
            {completeness && !completeness.complete ? (
              <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-amber-100">
                <View
                  className="h-full bg-amber-500"
                  style={{ width: `${completeness.percent}%` }}
                />
              </View>
            ) : null}
          </View>
          <ChevronRight color="#D1D5DB" size={16} />
        </Pressable>

        {/* Biometric */}
        {biometricSupported ? (
          <View className="mt-3 flex-row items-center gap-3 rounded-3xl border border-border bg-surface p-4">
            <View className="flex-1">
              <Text className="text-sm font-body-semi text-espresso">
                Face ID for clock-in
              </Text>
              <Text className="text-xs font-body text-muted">
                Require biometric to confirm every clock action.
              </Text>
            </View>
            <Switch
              value={biometricOn}
              onValueChange={toggleBiometric}
              trackColor={{ true: "#A2492C", false: "#D1D5DB" }}
            />
          </View>
        ) : null}

        {/* Change PIN */}
        <Pressable
          onPress={() => setPinOpen(true)}
          className="mt-3 flex-row items-center gap-3 rounded-3xl border border-border bg-surface p-4 active:bg-primary-50"
        >
          <View className="h-10 w-10 items-center justify-center rounded-2xl bg-primary-50">
            <Key color="#A2492C" size={18} />
          </View>
          <Text className="flex-1 text-sm font-body-semi text-espresso">
            Change PIN
          </Text>
          <ChevronRight color="#D1D5DB" size={16} />
        </Pressable>

        {/* Backoffice (managers) */}
        {isManager ? (
          <Pressable
            onPress={() =>
              WebBrowser.openBrowserAsync(
                "https://backoffice.celsiuscoffee.com",
              )
            }
            className="mt-3 flex-row items-center gap-3 rounded-3xl border border-border bg-surface p-4 active:bg-primary-50"
          >
            <View className="h-10 w-10 items-center justify-center rounded-2xl bg-primary-50">
              <Shield color="#A2492C" size={18} />
            </View>
            <Text className="flex-1 text-sm font-body-semi text-espresso">
              Backoffice
            </Text>
            <ChevronRight color="#D1D5DB" size={16} />
          </Pressable>
        ) : null}

        {/* Sign out */}
        <Pressable
          onPress={handleSignOut}
          disabled={signingOut}
          className="mt-6 h-14 flex-row items-center justify-center gap-2 rounded-2xl border border-danger/30 active:bg-danger/5"
        >
          {signingOut ? (
            <ActivityIndicator color="#B91C1C" size="small" />
          ) : (
            <LogOut color="#B91C1C" size={18} />
          )}
          <Text className="text-base font-body-bold text-danger">Sign out</Text>
        </Pressable>
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
            <Text className="text-xl font-display text-espresso">Change PIN</Text>
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
            </View>
          ) : (
            <>
              <ScrollView
                className="flex-1"
                contentContainerClassName="px-5 pt-4"
                keyboardShouldPersistTaps="handled"
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
                  <Text className="mt-3 text-sm font-body text-danger">
                    {error}
                  </Text>
                ) : null}
              </ScrollView>
              <View className="border-t border-border p-5">
                <Pressable
                  onPress={submit}
                  disabled={saving || !currentPin || !newPin || !confirmPin}
                  className={`h-14 items-center justify-center rounded-2xl ${
                    saving || !currentPin || !newPin || !confirmPin
                      ? "bg-primary/40"
                      : "bg-primary"
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

