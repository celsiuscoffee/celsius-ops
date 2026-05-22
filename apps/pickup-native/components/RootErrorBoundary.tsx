import React from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";

// Lazy-import expo-updates so a missing native module never prevents
// this boundary from rendering. If Updates can't be loaded the
// boundary still works — the auto-recover step just becomes a no-op.
let Updates: typeof import("expo-updates") | null = null;
try {
  Updates = require("expo-updates");
} catch {
  Updates = null;
}

type Props = { children: React.ReactNode };
type State = { error: Error | null; recovering: boolean; tries: number };

/**
 * Last-ditch boundary at the very top of the app. If a bad OTA push
 * makes the app crash during render, this catches it, shows a calm
 * "Reconnecting…" screen, and auto-tries to fetch + apply a newer
 * bundle. If a newer bundle isn't available it just reloads to the
 * same one (often that's enough — transient errors recover on retry).
 *
 * Important: this file MUST stay dependency-light. It's the safety
 * net against bugs in everything else, so anything imported here
 * needs to itself be bulletproof. No nativewind classNames, no app
 * state, no fonts, no SVG — only RN core + expo-updates (lazy).
 */
export class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, recovering: false, tries: 0 };
  private autoRecoverTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Visible in EAS runtime logs
    console.warn(
      "[RootErrorBoundary] caught:",
      error?.message,
      info?.componentStack?.split("\n").slice(0, 4).join(" | ")
    );

    // Lazy-require so a missing/broken Sentry module can never prevent
    // the boundary itself from working (same pattern as expo-updates above).
    // Sentry.wrap() on _layout already captures most uncaught errors, but
    // boundary-caught render errors don't propagate to it — this hook
    // ensures those land in Sentry too.
    try {
      const Sentry = require("@sentry/react-native") as typeof import("@sentry/react-native");
      Sentry.captureException(error, {
        contexts: { react: { componentStack: info?.componentStack ?? null } },
      });
    } catch {
      // Sentry not available — fall back to the console.warn above.
    }

    // First crash → auto-recover after a brief beat. Subsequent crashes
    // (after auto-recover already fired) wait for the user to tap.
    if (this.state.tries === 0) {
      this.autoRecoverTimer = setTimeout(() => this.recover(), 1500);
    }
  }

  componentWillUnmount() {
    if (this.autoRecoverTimer) clearTimeout(this.autoRecoverTimer);
  }

  recover = async () => {
    if (this.state.recovering) return;
    this.setState({ recovering: true, tries: this.state.tries + 1 });

    try {
      if (Updates) {
        // Try to grab a newer bundle first. If a fix has been pushed,
        // this picks it up before we reload. Failure is fine — the
        // reload below will just rerun whatever's cached.
        try {
          const upd = await Updates.checkForUpdateAsync();
          if (upd?.isAvailable) {
            await Updates.fetchUpdateAsync();
          }
        } catch {
          /* network down / update API unavailable — proceed */
        }
        await Updates.reloadAsync();
      } else {
        // No expo-updates module — best we can do is force a re-render
        // by clearing the error and hoping it was transient.
        this.setState({ error: null, recovering: false });
      }
    } catch (e) {
      console.warn("[RootErrorBoundary] recover failed:", e);
      this.setState({ recovering: false });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#160800",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        }}
      >
        <Text style={{ fontSize: 36, marginBottom: 12 }}>☕</Text>
        <Text
          style={{
            color: "#FFFFFF",
            fontSize: 18,
            fontWeight: "700",
            marginBottom: 8,
            textAlign: "center",
          }}
        >
          Reconnecting…
        </Text>
        <Text
          style={{
            color: "rgba(255, 255, 255, 0.65)",
            fontSize: 13,
            textAlign: "center",
            marginBottom: 28,
            lineHeight: 18,
          }}
        >
          We're refreshing the app for you. This usually only takes a moment.
        </Text>

        {this.state.recovering ? (
          <ActivityIndicator color="#A2492C" />
        ) : (
          <Pressable
            onPress={this.recover}
            style={({ pressed }) => ({
              backgroundColor: "#A2492C",
              paddingHorizontal: 28,
              paddingVertical: 14,
              borderRadius: 999,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 14 }}>
              Try again
            </Text>
          </Pressable>
        )}

        {this.state.tries > 1 ? (
          <Text
            style={{
              color: "rgba(255, 255, 255, 0.45)",
              fontSize: 11,
              textAlign: "center",
              marginTop: 24,
              maxWidth: 260,
              lineHeight: 16,
            }}
          >
            Still stuck? Force-quit the app from the app switcher and reopen.
            If that doesn't work, reinstall from the App Store.
          </Text>
        ) : null}
      </View>
    );
  }
}
