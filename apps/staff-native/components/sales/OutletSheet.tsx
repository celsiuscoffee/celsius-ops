import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Check, Store } from "lucide-react-native";
import { useCelsius } from "@/lib/celsius-ui";

type Props = {
  visible: boolean;
  outlets: { id: string; name: string }[];
  selected: string;
  onSelect: (id: string) => void;
  onClose: () => void;
};

export function OutletSheet({ visible, outlets, selected, onSelect, onClose }: Props) {
  const C = useCelsius().color;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} className="flex-1 bg-scrim" />
      <View className="absolute bottom-0 left-0 right-0 rounded-t-[28px] border-t border-line bg-raised px-5 pb-9 pt-2">
        <View className="mx-auto mb-4 mt-1.5 h-1 w-10 rounded-full bg-line-2" />
        <Text className="mb-2 font-display text-base text-text">Choose an outlet</Text>
        <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
          {outlets.map((o) => {
            const on = selected === o.id;
            return (
              <Pressable
                key={o.id}
                onPress={() => onSelect(o.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                className="min-h-14 flex-row items-center gap-3 border-b border-line py-3 active:bg-sunken"
              >
                <View className={`h-10 w-10 items-center justify-center rounded-xl ${on ? "bg-ink" : "bg-sunken"}`}>
                  <Store color={on ? C["on-ink"] : C["text-2"]} size={18} />
                </View>
                <Text className={`flex-1 text-base ${on ? "font-body-bold text-text" : "font-body-semi text-text"}`}>{o.name}</Text>
                {on ? <Check color={C.text} size={20} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}
