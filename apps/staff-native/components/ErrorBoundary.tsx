import { Component, type ReactNode } from "react";
import { Appearance, Pressable, Text, View } from "react-native";
import * as Updates from "expo-updates";
import { Sentry } from "../lib/sentry";
import { palette } from "../lib/celsius-ui/tokens";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * App-wide error boundary. Without this, ANY uncaught render error in any
 * screen takes down the whole app (RN has no default boundary). Here we
 * contain it to a recoverable card, and report it to Sentry so the crash is
 * finally visible (captureException is a safe no-op when Sentry has no DSN).
 *
 * Uses only system fonts/colors so it renders even if a font/theme load was
 * the thing that failed.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    try {
      Sentry.captureException(error, {
        extra: { componentStack: info?.componentStack ?? null },
        tags: { boundary: "root" },
      });
      // Start draining the envelope immediately: if the user taps "Reload app"
      // (or the OTA hook reloads) before the upload finishes, the JS context is
      // torn down and the crash report is silently lost.
      void Sentry.flush().catch(() => {});
    } catch {
      // never let the reporter itself crash the fallback
    }
  }

  private reload = () => {
    // Flush before the reload tears down the JS context, so the crash the user
    // is recovering from actually reaches Sentry.
    Sentry.flush()
      .catch(() => {})
      .then(() => Updates.reloadAsync())
      .catch(() => this.setState({ error: null }));
  };

  render() {
    if (!this.state.error) return this.props.children;
    // The outermost boundary sits above the theme wrapper, so read the
    // Celsius UI palette for the device's scheme directly.
    const C = palette[Appearance.getColorScheme() === "dark" ? "dark" : "light"];
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C.bg,
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        }}
      >
        <Text
          style={{
            color: C.text,
            fontSize: 20,
            fontWeight: "700",
            marginBottom: 10,
            textAlign: "center",
          }}
        >
          Something went wrong
        </Text>
        <Text
          style={{
            color: C["text-2"],
            fontSize: 14,
            lineHeight: 20,
            textAlign: "center",
            marginBottom: 28,
          }}
        >
          This screen hit an unexpected error. Reload the app to continue. Your
          login is kept.
        </Text>
        <Pressable
          onPress={this.reload}
          style={{
            backgroundColor: C.ink,
            borderRadius: 12,
            minHeight: 52,
            justifyContent: "center",
            paddingHorizontal: 30,
          }}
        >
          <Text style={{ color: C["on-ink"], fontSize: 16, fontFamily: "SpaceGrotesk_600SemiBold" }}>
            Reload app
          </Text>
        </Pressable>
      </View>
    );
  }
}
