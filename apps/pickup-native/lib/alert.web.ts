// react-native-web's Alert is a no-op stub — `Alert.alert(title, msg,
// buttons)` returns silently, so confirmation flows like the Spend
// Points redeem prompt never invoke the "Apply" onPress. This shim
// matches the surface React Native exposes and routes through window's
// confirm/alert primitives so existing call-sites work unmodified.
//
// Native code paths keep using react-native's Alert via lib/alert.ts;
// Metro resolves this .web.ts variant on the web bundle automatically.

export type AlertButton = {
  text?: string;
  onPress?: (value?: string) => void;
  style?: "default" | "cancel" | "destructive";
  isPreferred?: boolean;
};

export type AlertOptions = {
  cancelable?: boolean;
  onDismiss?: () => void;
  userInterfaceStyle?: "unspecified" | "light" | "dark";
};

function joinTitleMessage(title?: string, message?: string): string {
  if (title && message) return `${title}\n\n${message}`;
  return title || message || "";
}

function alertImpl(
  title?: string,
  message?: string,
  buttons?: AlertButton[],
  _options?: AlertOptions,
): void {
  const body = joinTitleMessage(title, message);

  // No buttons or single OK-style button → simple alert.
  if (!buttons || buttons.length === 0) {
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(body);
    }
    return;
  }

  if (buttons.length === 1) {
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(body);
    }
    buttons[0].onPress?.();
    return;
  }

  // Two-or-more buttons → confirm prompt. Pick the non-cancel button
  // as the "confirm" action — this preserves the destructive vs default
  // distinction the call-sites rely on.
  const cancelButton =
    buttons.find((b) => b.style === "cancel") ?? buttons[0];
  const confirmButton =
    buttons.find((b) => b.style === "destructive") ??
    buttons.find((b) => b.style === "default") ??
    buttons.find((b) => b !== cancelButton) ??
    buttons[buttons.length - 1];

  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    cancelButton.onPress?.();
    return;
  }

  const ok = window.confirm(body);
  if (ok) confirmButton.onPress?.();
  else cancelButton.onPress?.();
}

function promptImpl(
  title: string,
  message?: string,
  callbackOrButtons?: ((value: string) => void) | AlertButton[],
  _type?: "default" | "plain-text" | "secure-text" | "login-password",
  defaultValue?: string,
): void {
  if (typeof window === "undefined" || typeof window.prompt !== "function") {
    return;
  }
  const value = window.prompt(joinTitleMessage(title, message), defaultValue ?? "");
  if (value === null) return;
  if (typeof callbackOrButtons === "function") {
    callbackOrButtons(value);
    return;
  }
  const button =
    callbackOrButtons?.find((b) => b.style !== "cancel") ?? callbackOrButtons?.[0];
  button?.onPress?.(value);
}

export const Alert = {
  alert: alertImpl,
  prompt: promptImpl,
};
