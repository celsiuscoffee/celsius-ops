import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.celsiuscoffee.pickup",
  appName: "Celsius Coffee",
  webDir: "out",
  server: {
    // Load from the deployed URL — updates instantly without rebuilding
    url: "https://order.celsiuscoffee.com",
    cleartext: false,
  },
  ios: {
    scheme: "Celsius Coffee",
    contentInset: "automatic",
    preferredContentMode: "mobile",
    backgroundColor: "#160800",
  },
  android: {
    backgroundColor: "#160800",
    allowMixedContent: false,
    buildOptions: {
      signingType: "apksigner",
    },
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#160800",
      showSpinner: false,
      launchFadeOutDuration: 500,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#160800",
    },
  },
};

export default config;
