import { useEffect, useRef, useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Linking,
  Platform,
  StatusBar,
} from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview";
import { X, RefreshCw } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// In-app webview for Revenue Monster payment redirects. Replaces
// expo-web-browser's openAuthSessionAsync (which on iOS surfaces a
// system URL bar — see card.revenuemonster.my / tngdigital.com.my in the
// chrome). This component renders a full-screen modal with only an X +
// title — no URL bar — and intercepts navigation to recognise the
// celsiuscoffee:// return scheme + native deep links to wallet apps.
//
// Navigation interception rules:
//   - celsiuscoffee://rm-return  →  fire onSuccess and dismiss. RM
//     redirects here when the customer completes / cancels in their
//     wallet; the order page's poll backstop reconciles the status.
//   - any other non-http(s) scheme (tng://, mae://, maybank://, etc.) →
//     hand off to Linking.openURL so the wallet/bank app opens, and
//     return false so the WebView doesn't try to load that scheme
//     itself (which would error). The modal stays open behind so the
//     customer can come back via the OS app-switcher.
//   - http(s) URLs → let the WebView load normally.

interface Props {
  visible:     boolean;
  url:         string | null;
  methodLabel: string;
  amountLabel?: string;    // e.g. "RM 4.45" — shown under the title as a trust signal
  methodId?:   string;     // canonical method id ("card", "tng", …) — used to auto-tap the
                           // Cards tab on RM's hosted picker when this is "card".
  onSuccess:   () => void;
  onCancel:    () => void;
}

const RETURN_SCHEME = "celsiuscoffee://rm-return";

// Inject when the customer picks "Card" so RM's consolidated hosted
// picker (e-Wallets / Cards / Online Banking) doesn't force a second
// tap. We can't pass a card-only method code to /v3/payment/online (RM
// returns CARD_MALAYSIA_NOT_ACTIVE for `CARD_MY` and no other code is
// publicly documented), so this is the next-best workaround: poll for
// the "Cards" button text and click it on the customer's behalf. Safe
// to no-op — if RM renames or restructures, the customer just sees the
// picker as today.
const CARD_AUTOTAP_JS = `
(function () {
  if (window.__celsiusCardAutoTap) return true;
  window.__celsiusCardAutoTap = true;
  var tries = 0;
  var maxTries = 25;
  var interval = setInterval(function () {
    tries++;
    var nodes = document.querySelectorAll(
      'button, [role="button"], a, div, span, label, li'
    );
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var text = (n.textContent || '').trim().toLowerCase();
      if (text === 'cards' || text === 'card') {
        var clickable = n;
        if (n.tagName === 'SPAN' || n.tagName === 'DIV' || n.tagName === 'LABEL' || n.tagName === 'LI') {
          var anc = n.closest('button, [role="button"], a');
          if (anc) clickable = anc;
        }
        try { clickable.click(); } catch (e) {}
        clearInterval(interval);
        return;
      }
    }
    if (tries >= maxTries) clearInterval(interval);
  }, 250);
})();
true;
`;

export function RmCheckoutModal({ visible, url, methodLabel, amountLabel, methodId, onSuccess, onCancel }: Props) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const webViewRef = useRef<WebView | null>(null);
  // useSafeAreaInsets reads from a hook-level context that does propagate
  // into Modal portals — <SafeAreaView edges={["top"]}> often returns 0
  // here on iOS because the modal opens in a separate UIWindow without
  // the host SafeAreaProvider tree. Hook value is reliable.
  const insets = useSafeAreaInsets();

  // Reset state whenever the modal opens with a new URL — without this
  // the previous error state lingers across consecutive payment attempts.
  useEffect(() => {
    if (visible) {
      setLoading(true);
      setErrorMsg(null);
    }
  }, [visible, url]);

  const handleShouldStart = (req: WebViewNavigation): boolean => {
    const target = req.url;
    if (target.startsWith(RETURN_SCHEME)) {
      onSuccess();
      return false;
    }
    if (!target.startsWith("http://") && !target.startsWith("https://")) {
      Linking.openURL(target).catch(() => {
        // Wallet/bank app not installed. Surface in the in-modal error
        // strip so the customer can either tap Retry (re-fetch the RM
        // page) or use the in-page "Sign in and continue via browser"
        // fallback most RM intermediaries provide.
        setErrorMsg(
          `Couldn't open ${methodLabel} app. Use the in-page web option instead, or tap retry.`,
        );
      });
      return false;
    }
    return true;
  };

  const reload = () => {
    setErrorMsg(null);
    setLoading(true);
    webViewRef.current?.reload();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onCancel}
    >
      <StatusBar barStyle="light-content" />
      <View
        className="bg-espresso"
        // useSafeAreaInsets returns 0 inside iOS modal portals in some
        // RN versions. Floor at 50 on iOS so the Cancel pill always
        // clears the notch / dynamic island, and 24 on Android for the
        // status bar.
        style={{
          paddingTop: Math.max(insets.top, Platform.OS === "ios" ? 50 : 24),
          zIndex: 10,
          elevation: 10,
        }}
      >
        <View className="flex-row items-center justify-between px-3 py-2.5">
          {/* Cancel — bigger tap target + brighter chip + a "Cancel"
              text label, so it reads as actionable even when the
              WebView underneath is slow to paint and would otherwise
              steal focus. */}
          <Pressable
            onPress={onCancel}
            hitSlop={16}
            className="flex-row items-center gap-1.5 rounded-full bg-white/20 px-3 h-11 active:opacity-70"
          >
            <X size={18} color="#FFFFFF" />
            <Text className="text-white text-sm font-bold">Cancel</Text>
          </Pressable>
          <View className="flex-1 items-center">
            <Text
              className="text-white text-base"
              style={{ fontFamily: "Peachi-Bold" }}
              numberOfLines={1}
            >
              Pay with {methodLabel}
            </Text>
            {amountLabel && (
              <Text
                className="text-white/70 text-xs mt-0.5"
                numberOfLines={1}
              >
                {amountLabel}
              </Text>
            )}
          </View>
          <View className="w-20 h-11" />
        </View>
      </View>

      <View className="flex-1 bg-white">
        {url && (
          <WebView
            ref={webViewRef}
            source={{ uri: url }}
            onShouldStartLoadWithRequest={handleShouldStart}
            onLoadEnd={() => setLoading(false)}
            onError={({ nativeEvent }) =>
              setErrorMsg(nativeEvent.description || "Couldn't load payment page")
            }
            onHttpError={({ nativeEvent }) =>
              setErrorMsg(`Payment page returned HTTP ${nativeEvent.statusCode}`)
            }
            injectedJavaScript={methodId === "card" ? CARD_AUTOTAP_JS : undefined}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState={false}
            sharedCookiesEnabled
            originWhitelist={["*"]}
          />
        )}
        {loading && !errorMsg && (
          <View className="absolute inset-0 items-center justify-center bg-white/90">
            <ActivityIndicator size="large" color="#A2492C" />
            <Text className="text-muted-fg text-sm mt-3">
              Loading {methodLabel}…
            </Text>
          </View>
        )}
        {errorMsg && (
          <View className="absolute inset-x-4 bottom-6 bg-espresso rounded-2xl p-4 shadow-2xl">
            <Text className="text-white text-sm" numberOfLines={3}>
              {errorMsg}
            </Text>
            <Pressable
              onPress={reload}
              className="mt-3 flex-row items-center justify-center gap-2 bg-terracotta rounded-xl py-3 active:opacity-80"
            >
              <RefreshCw size={16} color="#FFFFFF" />
              <Text className="text-white text-sm font-bold">Retry</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}
