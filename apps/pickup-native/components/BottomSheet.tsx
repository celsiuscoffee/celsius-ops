import { ReactNode } from "react";
import { View, Text, Pressable, Modal, ScrollView } from "react-native";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  visible: boolean;
  onClose: () => void;
  title:   string;
  children: ReactNode;
};

// Minimal slide-up sheet that backs the wallet / bank pickers. Native
// Modal handles the dim backdrop + dismiss-on-back-button; we just style
// the inner panel. Tapping the backdrop closes — the inner Pressable
// stops propagation so taps inside the panel don't dismiss it.
export function BottomSheet({ visible, onClose, title, children }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: "#FFFFFF",
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingTop: 12,
            paddingBottom: insets.bottom + 16,
            maxHeight: "85%",
          }}
        >
          {/* Drag handle */}
          <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#E0D6CC", marginBottom: 12 }} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 8 }}>
            <Text
              style={{ color: "#1A0200", fontFamily: "Peachi-Bold", fontSize: 17 }}
            >
              {title}
            </Text>
            <Pressable onPress={onClose} hitSlop={12} className="active:opacity-60">
              <X size={20} color="#8E8E93" />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={{ paddingHorizontal: 4, paddingTop: 8 }}>{children}</View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
