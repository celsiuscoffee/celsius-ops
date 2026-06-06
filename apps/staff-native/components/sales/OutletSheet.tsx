import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Check, Store } from "lucide-react-native";

type Props = {
  visible: boolean;
  outlets: { id: string; name: string }[];
  selected: string;
  onSelect: (id: string) => void;
  onClose: () => void;
};

export function OutletSheet({ visible, outlets, selected, onSelect, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} className="flex-1 bg-black/55" />
      <View className="absolute bottom-0 left-0 right-0 rounded-t-[26px] border-t border-[#F5F3F01a] bg-[#1c0d04] px-5 pb-9 pt-2">
        <View className="mx-auto mb-4 mt-1.5 h-1 w-10 rounded-full bg-[#F5F3F03a]" />
        <Text className="mb-2 font-display text-base text-[#F5F3F0]">Select outlet</Text>
        <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
          {outlets.map((o) => {
            const on = selected === o.id;
            return (
              <Pressable
                key={o.id}
                onPress={() => onSelect(o.id)}
                className="flex-row items-center gap-3 border-b border-[#F5F3F00f] py-3.5"
              >
                <View className={`h-9 w-9 items-center justify-center rounded-xl ${on ? "bg-[#A2492C]" : "bg-[#F5F3F00f]"}`}>
                  <Store color={on ? "#F5F3F0" : "#F5F3F08a"} size={17} />
                </View>
                <Text className={`flex-1 text-[14px] ${on ? "font-body-bold text-[#F5F3F0]" : "font-body-semi text-[#F5F3F0]"}`}>{o.name}</Text>
                {on ? <Check color="#FBBF24" size={18} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}
