// lib/analytics.ts
// Amplitude wrapper — fully lazy + native-module-safe.
//
// IMPORTANT: @amplitude/analytics-react-native ships native iOS/Android
// modules. The current TestFlight / App Store binary does NOT have
// those compiled in, so importing the package at module-load time
// would crash on require(). To keep this OTA-shippable today, we:
//   1. Don't import Amplitude at the top level.
//   2. Only require() it (a) when EXPO_PUBLIC_AMPLITUDE_API_KEY is
//      set AND (b) inside try/catch so a missing native module just
//      no-ops the whole analytics layer.
//
// Going live needs both: the env var set in EAS AND a fresh native
// build (eas build) that bakes the Amplitude pods/Gradle deps in.
// Until then, this module is a complete no-op.

const API_KEY = (process.env.EXPO_PUBLIC_AMPLITUDE_API_KEY ?? "").trim();
const ENABLED = API_KEY.length > 0;

// Memoised module reference — null while we haven't loaded yet,
// `false` when the load failed (won't retry), object once loaded.
type AmplitudeModule = typeof import("@amplitude/analytics-react-native");
let amp: AmplitudeModule | null | false = null;

function loadAmplitude(): AmplitudeModule | null {
  if (!ENABLED) return null;
  if (amp === false) return null;
  if (amp) return amp;
  try {
    amp = require("@amplitude/analytics-react-native") as AmplitudeModule;
    return amp;
  } catch (err) {
    // Most likely the native module isn't compiled into this binary.
    // Latch the failure so subsequent calls are cheap no-ops.
    console.warn("[analytics] amplitude module load failed", err);
    amp = false;
    return null;
  }
}

let initialized = false;

export async function initAnalytics(): Promise<void> {
  if (!ENABLED || initialized) return;
  const m = loadAmplitude();
  if (!m) return;
  try {
    await m.init(API_KEY, undefined, {
      flushIntervalMillis: 30_000,
      flushQueueSize: 30,
    }).promise;
    initialized = true;
  } catch (err) {
    console.warn("[analytics] init failed", err);
  }
}

export function trackEvent(
  name: string,
  props?: Record<string, unknown>,
): void {
  if (!ENABLED) return;
  const m = loadAmplitude();
  if (!m) return;
  try {
    m.track(name, props as Record<string, string | number | boolean>);
  } catch {
    /* noop */
  }
}

export function identifyMember(
  memberId: string,
  traits: { name?: string | null; phone?: string | null; tier?: string | null } = {},
): void {
  // Sentry user context — separate try/catch so an Amplitude failure
  // doesn't break Sentry attribution and vice versa. Sentry is a no-op
  // when its DSN isn't set in _layout.tsx, so this is safe to always
  // call.
  try {
    // Lazy require so non-RN environments / tests that don't pull
    // Sentry stay clean. setUser is sync.
    const Sentry = require("@sentry/react-native") as typeof import("@sentry/react-native");
    Sentry.setUser({
      id:    memberId,
      ...(traits.phone ? { phone: traits.phone } : {}),
      ...(traits.name  ? { username: traits.name } : {}),
    });
  } catch {
    /* noop */
  }

  if (!ENABLED) return;
  const m = loadAmplitude();
  if (!m) return;
  try {
    m.setUserId(memberId);
    const id = new m.Identify();
    if (traits.name)  id.set("name",  traits.name);
    if (traits.phone) id.set("phone", traits.phone);
    if (traits.tier)  id.set("tier",  traits.tier);
    m.identify(id);
  } catch {
    /* noop */
  }
}

export function clearMember(): void {
  try {
    const Sentry = require("@sentry/react-native") as typeof import("@sentry/react-native");
    Sentry.setUser(null);
  } catch {
    /* noop */
  }

  if (!ENABLED) return;
  const m = loadAmplitude();
  if (!m) return;
  try {
    m.reset();
  } catch {
    /* noop */
  }
}

export async function flushAnalytics(): Promise<void> {
  if (!ENABLED) return;
  const m = loadAmplitude();
  if (!m) return;
  try {
    await m.flush().promise;
  } catch {
    /* noop */
  }
}

export const analyticsEnabled = ENABLED;
