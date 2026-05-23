import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Screen } from "../../components/Screen";
import { Logo } from "../../components/Logo";
import { fetchOutlets, type Outlet } from "../../lib/outlets";
import { loginWithPin } from "../../lib/auth";
import { ApiError } from "../../lib/api";

const LAST_OUTLET_KEY = "celsius_staff_last_outlet_v1";

export default function Login() {
  const router = useRouter();
  const [outlets, setOutlets] = useState<Outlet[] | null>(null);
  const [outletsError, setOutletsError] = useState<string | null>(null);
  const [outletId, setOutletId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await fetchOutlets();
        setOutlets(list);
        const last = await AsyncStorage.getItem(LAST_OUTLET_KEY);
        if (last && list.some((o) => o.id === last)) setOutletId(last);
        else if (list.length === 1) setOutletId(list[0].id);
      } catch (e) {
        setOutletsError(
          e instanceof ApiError ? e.message : "Couldn't load outlets",
        );
      }
    })();
  }, []);

  async function handleSubmit() {
    if (busy) return;
    if (pin.length < 4) {
      setError("PIN must be at least 4 digits");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await loginWithPin(pin, outletId);
      if (outletId) await AsyncStorage.setItem(LAST_OUTLET_KEY, outletId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
      router.replace("/(staff)/home");
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
        () => {},
      );
      setError(e instanceof ApiError ? e.message : "Login failed");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  function press(d: string) {
    Haptics.selectionAsync().catch(() => {});
    setError(null);
    if (d === "del") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    setPin((p) => (p.length >= 8 ? p : p + d));
  }

  return (
    <Screen>
      <View className="flex-1 justify-center">
        <View className="items-center mb-8">
          <Logo size="lg" />
        </View>

        <OutletPicker
          outlets={outlets}
          selectedId={outletId}
          onSelect={setOutletId}
          error={outletsError}
        />

        <View className="mt-8 mb-3 items-center">
          <View className="flex-row gap-3">
            {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
              <View
                key={i}
                className={`h-4 w-4 rounded-full border-2 border-espresso ${
                  i < pin.length ? "bg-espresso" : "bg-transparent"
                }`}
              />
            ))}
          </View>
          {error ? (
            <Text className="mt-3 text-sm text-danger">{error}</Text>
          ) : (
            <Text className="mt-3 text-sm text-muted">
              Enter your PIN
            </Text>
          )}
        </View>

        <NumPad onPress={press} disabled={busy} />

        <Pressable
          onPress={handleSubmit}
          disabled={busy || pin.length < 4}
          className={`mt-6 h-14 items-center justify-center rounded-2xl ${
            busy || pin.length < 4 ? "bg-primary/40" : "bg-primary"
          }`}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className="text-base font-body-bold text-white">Sign in</Text>
          )}
        </Pressable>
      </View>
    </Screen>
  );
}

function OutletPicker({
  outlets,
  selectedId,
  onSelect,
  error,
}: {
  outlets: Outlet[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  error: string | null;
}) {
  if (error) {
    return (
      <Text className="text-center text-sm text-danger">{error}</Text>
    );
  }
  if (!outlets) {
    return <ActivityIndicator />;
  }
  return (
    <View className="flex-row flex-wrap justify-center gap-2">
      {outlets.map((o) => {
        const active = o.id === selectedId;
        return (
          <Pressable
            key={o.id}
            onPress={() => onSelect(o.id)}
            className={`rounded-full border px-4 py-2 ${
              active
                ? "border-espresso bg-espresso"
                : "border-border bg-surface"
            }`}
          >
            <Text
              className={`text-sm font-body-semi ${
                active ? "text-white" : "text-espresso"
              }`}
            >
              {o.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function NumPad({
  onPress,
  disabled,
}: {
  onPress: (d: string) => void;
  disabled: boolean;
}) {
  const keys: (string | null)[] = [
    "1", "2", "3",
    "4", "5", "6",
    "7", "8", "9",
    null, "0", "del",
  ];
  return (
    <View className="flex-row flex-wrap justify-center">
      {keys.map((k, i) => {
        if (k === null) {
          return <View key={i} className="basis-1/3 p-1" />;
        }
        return (
          <View key={i} className="basis-1/3 p-1">
            <Pressable
              onPress={() => onPress(k)}
              disabled={disabled}
              className="h-16 items-center justify-center rounded-2xl bg-primary-50 active:bg-primary-100"
            >
              <Text className="text-2xl font-display-medium text-espresso">
                {k === "del" ? "⌫" : k}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
