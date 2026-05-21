import { View, Text, Pressable, Platform } from "react-native";
import { Check } from "lucide-react-native";
import * as Haptics from "@/lib/haptics";
import { FPX_BANKS } from "../lib/fpx-banks";

type Props = {
  selectedCode: string | null;
  onSelect: (code: string) => void;
};

// Inline list (no scroll wrapper — parent ScrollView handles overflow).
// Used in both the checkout review step and the order detail retry sheet,
// so anything visual stays here and the bank-code → RM Direct-mode
// plumbing stays in the screens that call this.
export function FpxBankPicker({ selectedCode, onSelect }: Props) {
  return (
    <View>
      <Text className="text-muted-fg text-[11px] font-bold uppercase tracking-wider px-1 mb-2">
        Pick your bank
      </Text>
      <View className="bg-surface rounded-2xl border border-border overflow-hidden">
        {FPX_BANKS.map((bank, idx) => {
          const isSelected = selectedCode === bank.code;
          return (
            <Pressable
              key={bank.code}
              onPress={() => {
                Haptics.selectionAsync();
                onSelect(bank.code);
              }}
              className={`flex-row items-center gap-3 px-4 py-3 ${
                idx > 0 ? "border-t border-border" : ""
              } active:bg-background`}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  backgroundColor: bank.bg,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    color: bank.fg,
                    fontFamily: "Peachi-Bold",
                    fontSize: bank.short.length > 2 ? 11 : 14,
                    letterSpacing: -0.3,
                    lineHeight: Platform.OS === "ios" ? 14 : undefined,
                  }}
                >
                  {bank.short}
                </Text>
              </View>
              <Text className="flex-1 text-espresso text-[14px]" numberOfLines={1}>
                {bank.name}
              </Text>
              {isSelected && <Check size={18} color="#C05040" />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
