import * as LocalAuthentication from "expo-local-authentication";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BIOMETRIC_PREF_KEY = "celsius_staff_biometric_clock_v1";

export async function isBiometricAvailable(): Promise<boolean> {
  const hardware = await LocalAuthentication.hasHardwareAsync();
  if (!hardware) return false;
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return enrolled;
}

export async function getBiometricRequired(): Promise<boolean> {
  const v = await AsyncStorage.getItem(BIOMETRIC_PREF_KEY).catch(() => null);
  return v === "1";
}

export async function setBiometricRequired(required: boolean): Promise<void> {
  await AsyncStorage.setItem(BIOMETRIC_PREF_KEY, required ? "1" : "0");
}

export async function authenticate(reason: string): Promise<boolean> {
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: "Cancel",
    fallbackLabel: "Use PIN",
    disableDeviceFallback: false,
  });
  return res.success;
}
