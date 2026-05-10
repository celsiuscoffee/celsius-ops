// lib/analytics.ts
// Amplitude wrapper. No-op when EXPO_PUBLIC_AMPLITUDE_API_KEY is unset
// so dev / preview builds without the env var don't crash and don't
// pollute prod data.
//
// Setting up: in EAS dashboard or eas.json, set
//   EXPO_PUBLIC_AMPLITUDE_API_KEY=<your-amplitude-key>
// Then run an OTA — events start flowing on next cold launch.
//
// Event naming follows the "object_action" convention:
//   menu_viewed, product_viewed, cart_add, checkout_started, order_placed
// User id is the loyalty member id; identify() runs once we know it.

import { init, track, identify, Identify, setUserId, reset, flush } from "@amplitude/analytics-react-native";

const API_KEY = (process.env.EXPO_PUBLIC_AMPLITUDE_API_KEY ?? "").trim();
const ENABLED = API_KEY.length > 0;

let initialized = false;

export async function initAnalytics(): Promise<void> {
  if (!ENABLED || initialized) return;
  try {
    await init(API_KEY, undefined, {
      // Conservative flush — small events, infrequent flushes.
      flushIntervalMillis: 30_000,
      flushQueueSize: 30,
      // The RN SDK auto-handles session events; no defaultTracking knob.
    }).promise;
    initialized = true;
  } catch (err) {
    // Amplitude failures must never block app boot.
    console.warn("[analytics] init failed", err);
  }
}

export function trackEvent(
  name: string,
  props?: Record<string, unknown>,
): void {
  if (!ENABLED) return;
  try {
    track(name, props as Record<string, string | number | boolean>);
  } catch {
    // Swallow — analytics is fire-and-forget.
  }
}

export function identifyMember(
  memberId: string,
  traits: { name?: string | null; phone?: string | null; tier?: string | null } = {},
): void {
  if (!ENABLED) return;
  try {
    setUserId(memberId);
    const id = new Identify();
    if (traits.name)  id.set("name",  traits.name);
    if (traits.phone) id.set("phone", traits.phone);
    if (traits.tier)  id.set("tier",  traits.tier);
    identify(id);
  } catch {
    /* noop */
  }
}

export function clearMember(): void {
  if (!ENABLED) return;
  try {
    reset();
  } catch {
    /* noop */
  }
}

export async function flushAnalytics(): Promise<void> {
  if (!ENABLED) return;
  try {
    await flush().promise;
  } catch {
    /* noop */
  }
}

export const analyticsEnabled = ENABLED;
