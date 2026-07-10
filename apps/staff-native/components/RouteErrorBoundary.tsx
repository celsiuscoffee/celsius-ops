import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import type { ErrorBoundaryProps } from "expo-router";
import { AlertTriangle } from "lucide-react-native";
import { Sentry } from "../lib/sentry";

/**
 * Per-route error boundary, re-exported as `ErrorBoundary` from route files:
 *
 *   export { RouteErrorFallback as ErrorBoundary } from "../../../components/RouteErrorBoundary";
 *
 * Why this exists: expo-router loads route modules synchronously at push time,
 * and without a route-level boundary a single throwing screen unmounts the
 * WHOLE surrounding stack, with the crashed route stuck in nav state so the
 * tab re-crashes on every focus (the Who's Working incident). With this
 * export, expo-router wraps just that route in its Try boundary: the rest of
 * the tab keeps working and the user gets an inline retry instead.
 */
export function RouteErrorFallback({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    try {
      Sentry.captureException(error, { tags: { boundary: "route" } });
      void Sentry.flush().catch(() => {});
    } catch {
      // reporting must never crash the fallback
    }
  }, [error]);

  return (
    <View className="flex-1 items-center justify-center bg-background px-8">
      <View className="mb-3 h-12 w-12 items-center justify-center rounded-2xl bg-danger/10">
        <AlertTriangle color="#B91C1C" size={22} />
      </View>
      <Text className="text-base font-display-medium text-espresso text-center">
        This screen hit a problem
      </Text>
      <Text className="mt-1 text-sm font-body text-muted-fg text-center">
        The rest of the app still works. Tap to try this screen again.
      </Text>
      <Pressable
        onPress={() => {
          retry().catch(() => {});
        }}
        accessibilityRole="button"
        className="mt-5 rounded-2xl bg-primary px-8 py-3 active:opacity-80"
      >
        <Text className="text-sm font-body-semi text-white">Try again</Text>
      </Pressable>
    </View>
  );
}
