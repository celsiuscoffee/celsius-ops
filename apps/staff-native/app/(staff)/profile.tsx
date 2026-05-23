import { useEffect, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "../../components/Screen";
import { useStaff } from "../../lib/store";
import { logout } from "../../lib/auth";
import {
  getBiometricRequired,
  isBiometricAvailable,
  setBiometricRequired,
} from "../../lib/biometric";

export default function Profile() {
  const router = useRouter();
  const session = useStaff((s) => s.session);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricOn, setBiometricOn] = useState(false);

  useEffect(() => {
    (async () => {
      setBiometricSupported(await isBiometricAvailable());
      setBiometricOn(await getBiometricRequired());
    })();
  }, []);

  async function toggleBiometric(v: boolean) {
    setBiometricOn(v);
    await setBiometricRequired(v);
  }

  async function handleSignOut() {
    await logout();
    router.replace("/(auth)/login");
  }

  return (
    <Screen>
      <View className="pt-8">
        <Text className="text-3xl font-display text-espresso">Profile</Text>
      </View>

      <View className="mt-6 rounded-3xl border border-border bg-surface p-5">
        <Row label="Name" value={session?.name ?? "—"} />
        <Row label="Role" value={session?.role ?? "—"} />
        <Row label="Outlet" value={session?.outletName ?? "—"} />
      </View>

      {biometricSupported ? (
        <View className="mt-6 rounded-3xl border border-border bg-surface p-5">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-4">
              <Text className="text-base font-display-medium text-espresso">
                Face ID for clock-in
              </Text>
              <Text className="mt-1 text-sm font-body text-muted-fg">
                Require Face ID or Touch ID to confirm every clock action.
              </Text>
            </View>
            <Switch
              value={biometricOn}
              onValueChange={toggleBiometric}
              trackColor={{ true: "#A2492C", false: "#D1D5DB" }}
            />
          </View>
        </View>
      ) : null}

      <Pressable
        onPress={handleSignOut}
        className="mt-6 h-14 items-center justify-center rounded-2xl border border-border bg-surface active:bg-primary-50"
      >
        <Text className="text-base font-body-bold text-espresso">Sign out</Text>
      </Pressable>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-3 border-b border-border last:border-b-0">
      <Text className="text-sm font-body-semi text-muted uppercase tracking-wide">
        {label}
      </Text>
      <Text className="text-sm font-body-medium text-espresso">{value}</Text>
    </View>
  );
}
