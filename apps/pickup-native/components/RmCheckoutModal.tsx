import { useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Linking,
  StatusBar,
} from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview";
import { X } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";

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
  onSuccess:   () => void;
  onCancel:    () => void;
  onError:     (msg: string) => void;
}

const RETURN_SCHEME = "celsiuscoffee://rm-return";

export function RmCheckoutModal({ visible, url, methodLabel, onSuccess, onCancel, onError }: Props) {
  const [loading, setLoading] = useState(true);

  const handleShouldStart = (req: WebViewNavigation): boolean => {
    const target = req.url;
    if (target.startsWith(RETURN_SCHEME)) {
      onSuccess();
      return false;
    }
    if (!target.startsWith("http://") && !target.startsWith("https://")) {
      Linking.openURL(target).catch(() => {
        // Wallet/bank app not installed; surface a soft error but keep
        // the modal open so the customer can retry via the in-page
        // fallback (e.g. TNG's "Sign in and continue via browser").
        onError(`Couldn't open ${methodLabel} app. Tap the in-page web option instead.`);
      });
      return false;
    }
    return true;
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onCancel}
    >
      <StatusBar barStyle="light-content" />
      <SafeAreaView edges={["top"]} className="bg-espresso">
        <View className="flex-row items-center justify-between px-4 py-3">
          <Pressable
            onPress={onCancel}
            hitSlop={12}
            className="w-9 h-9 rounded-full bg-white/10 items-center justify-center active:opacity-70"
          >
            <X size={18} color="#FFFFFF" />
          </Pressable>
          <Text
            className="text-white text-base flex-1 text-center"
            style={{ fontFamily: "Peachi-Bold" }}
            numberOfLines={1}
          >
            Pay with {methodLabel}
          </Text>
          <View className="w-9 h-9" />
        </View>
      </SafeAreaView>

      <View className="flex-1 bg-white">
        {url && (
          <WebView
            source={{ uri: url }}
            onShouldStartLoadWithRequest={handleShouldStart}
            onLoadEnd={() => setLoading(false)}
            onError={({ nativeEvent }) =>
              onError(nativeEvent.description || "Couldn't load payment page")
            }
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState={false}
            sharedCookiesEnabled
            originWhitelist={["*"]}
          />
        )}
        {loading && (
          <View className="absolute inset-0 items-center justify-center bg-white/90">
            <ActivityIndicator size="large" color="#C05040" />
            <Text className="text-muted-fg text-sm mt-3">
              Loading {methodLabel}…
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}
