import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import * as Updates from "expo-updates";
import { Sentry } from "./sentry";

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
 * Fetch/apply split (crash-review fix): we CHECK + FETCH on foreground, but we
 * only RELOAD when the app goes to the background. reloadAsync() restarts the
 * whole JS app, and doing that on the "active" event meant a staffer could lose
 * an in-progress PO cart, claim draft, or clock-in selfie the moment a merge
 * landed. Backgrounding is the natural safe point: nothing is mid-gesture, and
 * if the OS kills the app before the reload runs, expo-updates applies the
 * fetched bundle on the next cold start anyway. Net effect: fixes land within
 * one background/foreground cycle instead of interrupting live use.
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
  const pendingReload = useRef(false);

  useEffect(() => {
    // Dev client / Expo Go / updates disabled → nothing to do.
    if (!Updates.isEnabled || __DEV__) return;

    const checkAndFetch = async () => {
      const now = Date.now();
      if (
        checking.current ||
        pendingReload.current ||
        now - lastCheckAt.current < MIN_CHECK_INTERVAL_MS
      )
        return;
      checking.current = true;
      lastCheckAt.current = now;
      try {
        const res = await Updates.checkForUpdateAsync();
        if (!res.isAvailable) return;
        const fetched = await Updates.fetchUpdateAsync();
        // Only mark for reload if a genuinely new bundle landed.
        if (!fetched.isNew) return;
        // Forward-only guard: never reload the device into an OLDER bundle. If an
        // OTA is ever published to this channel from a branch behind main (an
        // out-of-order publish), it becomes the channel's "latest" and we would
        // otherwise reload backwards mid-session, the "it reverted to the old
        // build" symptom. Compare the fetched bundle's createdAt to the running
        // one; if we can't read it, fall through and mark (normal behaviour).
        const runningAt = Updates.createdAt?.getTime() ?? 0;
        const manifest = fetched.manifest as unknown as
          | { createdAt?: string }
          | undefined;
        const fetchedAt = manifest?.createdAt
          ? new Date(manifest.createdAt).getTime()
          : Number.POSITIVE_INFINITY;
        if (fetchedAt < runningAt) return;
        pendingReload.current = true;
      } catch {
        // Network blip / mid-publish race / anything else, swallow. The next
        // foreground (or the next cold start) retries; a failed update check must
        // never surface to the user.
      } finally {
        checking.current = false;
      }
    };

    const applyIfPending = async () => {
      if (!pendingReload.current) return;
      pendingReload.current = false;
      try {
        // Drain any queued crash/error events before the JS context is torn
        // down; a reload racing an unflushed envelope silently drops it.
        await Sentry.flush().catch(() => {});
        await Updates.reloadAsync();
      } catch {
        // If the reload fails (or the OS suspends us first), the fetched
        // update still applies on the next cold start.
      }
    };

    // Check once on mount (covers a long-running session that was already
    // foregrounded when this code first ships), then fetch on every return to
    // active and apply on every drop to background.
    void checkAndFetch();
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") void checkAndFetch();
      else if (state === "background") void applyIfPending();
    });
    return () => sub.remove();
  }, []);
}
