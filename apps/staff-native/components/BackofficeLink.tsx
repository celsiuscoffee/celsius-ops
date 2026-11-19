import { Pressable, Text, View } from "react-native";
import { ExternalLink } from "lucide-react-native";
import * as WebBrowser from "expo-web-browser";
import { useCelsius } from "../lib/celsius-ui";

const BACKOFFICE_BASE = "https://backoffice.celsiuscoffee.com";

export function BackofficeLink({
  path,
  label,
  className,
}: {
  path: string;
  label: string;
  className?: string;
}) {
  const C = useCelsius().color;
  return (
    <Pressable
      onPress={() => {
        const url = path.startsWith("http") ? path : `${BACKOFFICE_BASE}${path}`;
        void WebBrowser.openBrowserAsync(url);
      }}
      className={`flex-row items-center justify-center rounded-2xl border border-line bg-surface px-4 py-3 active:bg-sunken ${
        className ?? ""
      }`}
    >
      <Text className="text-sm font-body-semi text-text">{label}</Text>
      <View className="ml-2">
        <ExternalLink color={C["text-2"]} size={14} />
      </View>
    </Pressable>
  );
}
