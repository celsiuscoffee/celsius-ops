import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import * as Updates from "expo-updates";

/**
 * Self-applying OTA updates for the staff app.
 *
 * The problem this solves: `eas update` publishes JS/asset fixes to the
 * `production` channel, but expo-updates only CHECKS for a new bundle on a cold
 * app start by default. Staff phones/tablets stay logged in (and the app stays
 * resident) for days, so a published fix never actually loads, the device keeps
 * running the bundle it booted with. That's exactly the "the dashboard is
 * showing an old number" / "you fixed it but it still happens" symptom: the
 * screen re-fetches data fine, but it's an OLD screen bundle.
 *
 * Here we check on every foreground (the screen waking is the natural moment to
 * swap the bundle) and, when a newer update has been fetched, reload into it.
 * After this ships once, every future fix lands within seconds of a screen-wake
 * with zero staff action. Mirrors the pos-native till hook (PR #340).
 *
 * Fully crash-safe + gated: a no-op in dev / Expo Go / when updates are disabled
 * (`Updates.isEnabled` false). Throttled so a flurry of foreground events can't
 * hammer the update server.
 */

// Don't re-check more than this often, foreground events can fire in bursts
// (system dialogs, lock/unlock). A fix is never so urgent that 60s matters, and
// a cold start always checks immediately anyway.
const MIN_CHECK_INTERVAL_MS = 60 * 1000;

export function useOtaAutoUpdate(): void {
  const lastCheckAt = useRef(0);
  const checking = useRef(false);

  useEffect(() => {
    // Dev client / Expo Go / updates disabled → nothing to do.
    if (!Updates.isEnabled || __DEV__) return;

    const checkAndApply = async () => {
      const now = Date.now();
      if (checking.current || now - lastCheckAt.current < MIN_CHECK_INTERVAL_MS) return;
      checking.current = true;
      lastCheckAt.current = now;
      try {
        const res = await Updates.checkForUpdateAsync();
        if (!res.isAvailable) return;
        const fetched = await Updates.fetchUpdateAsync();
        // Only reload if a genuinely new bundle landed, reloadAsync restarts the
        // JS app, so we never do it speculatively.
        if (!fetched.isNew) return;
        // Forward-only guard: never reload the device into an OLDER bundle. If an
        // OTA is ever published to this channel from a branch behind main (an
        // out-of-order publish), it becomes the channel's "latest" and we would
        // otherwise reload backwards mid-session, the "it reverted to the old
        // build" symptom. Compare the fetched bundle's createdAt to the running
        // one; if we can't read it, fall through and reload (normal behaviour).
        const runningAt = Updates.createdAt?.getTime() ?? 0;
        const manifest = fetched.manifest as unknown as
          | { createdAt?: string }
          | undefined;
        const fetchedAt = manifest?.createdAt
          ? new Date(manifest.createdAt).getTime()
          : Number.POSITIVE_INFINITY;
        if (fetchedAt < runningAt) return;
        await Updates.reloadAsync();
      } catch {
        // Network blip / mid-publish race / anything else, swallow. The next
        // foreground (or the next cold start) retries; a failed update check must
        // never surface to the user.
      } finally {
        checking.current = false;
      }
    };

    // Check once on mount (covers a long-running session that was already
    // foregrounded when this code first ships), then on every return to active.
    void checkAndApply();
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") void checkAndApply();
    });
    return () => sub.remove();
  }, []);
}
