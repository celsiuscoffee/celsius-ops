import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Check, ChevronDown } from "lucide-react-native";
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
    if (pin.length < 6) {
      setError("PIN must be 6 digits");
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
    setPin((p) => (p.length >= 6 ? p : p + d));
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
            {Array.from({ length: 6 }).map((_, i) => (
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
          disabled={busy || pin.length < 6}
          className={`mt-6 h-14 items-center justify-center rounded-2xl ${
            busy || pin.length < 6 ? "bg-primary/40" : "bg-primary"
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
  const [open, setOpen] = useState(false);

  if (error) {
    return <Text className="text-center text-sm text-danger">{error}</Text>;
  }
  if (!outlets) {
    return <ActivityIndicator />;
  }

  const selected = outlets.find((o) => o.id === selectedId) ?? null;

  return (
    <View>
      <Pressable
        onPress={() => setOpen(true)}
        className="h-14 flex-row items-center justify-between rounded-2xl border border-border bg-surface px-4 active:bg-primary-50"
      >
        <Text
          className={`flex-1 text-base font-body-semi ${
            selected ? "text-espresso" : "text-muted"
          }`}
          numberOfLines={1}
        >
          {selected ? selected.name : "Select outlet"}
        </Text>
        <ChevronDown color="#6B6B6B" size={20} />
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <View className="flex-1 bg-background">
          <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
            <Text className="text-xl font-display text-espresso">Outlet</Text>
            <Pressable onPress={() => setOpen(false)} className="px-2 py-1">
              <Text className="text-sm font-body-bold text-primary">Close</Text>
            </Pressable>
          </View>
          <ScrollView className="flex-1" contentContainerClassName="px-5 py-4">
            {outlets.map((o) => {
              const active = o.id === selectedId;
              return (
                <Pressable
                  key={o.id}
                  onPress={() => {
                    onSelect(o.id);
                    setOpen(false);
                  }}
                  className={`mb-2 h-14 flex-row items-center justify-between rounded-2xl border px-4 active:bg-primary-50 ${
                    active
                      ? "border-primary bg-primary-50"
                      : "border-border bg-surface"
                  }`}
                >
                  <Text
                    className="flex-1 text-base font-body-semi text-espresso"
                    numberOfLines={1}
                  >
                    {o.name}
                  </Text>
                  {active ? <Check color="#A2492C" size={20} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
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
