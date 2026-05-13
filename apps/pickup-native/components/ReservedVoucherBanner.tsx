/**
 * ReservedVoucherBanner — sticky strip shown on the Menu screen when the
 * customer tapped "Use" on a voucher in their wallet.
 *
 * Uses the shared VOUCHER_THEME so the banner colour + brand icon match
 * the voucher card the customer just tapped on the Rewards tab. A free
 * drink locks in with espresso+gold + CelsiusCup; a discount locks in
 * with terracotta+white + CelsiusTag; etc.
 */

import { View, Text, Pressable } from "react-native";
import { X } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useApp } from "../lib/store";
import { VOUCHER_THEME } from "./VoucherWallet";

export function ReservedVoucherBanner() {
  const reserved = useApp((s) => s.reservedVoucher);
  const setReservedVoucher = useApp((s) => s.setReservedVoucher);
  const appliedReward = useApp((s) => s.appliedReward);
  const setAppliedReward = useApp((s) => s.setAppliedReward);

  if (!reserved) return null;

  const theme = VOUCHER_THEME[reserved.category] ?? VOUCHER_THEME.special;
  // Text contrast on the banner — same logic the wallet rows use to
  // decide whether to drop cream or espresso on top of the surface.
  const dim = theme.fgDim;

  function dismiss() {
    Haptics.selectionAsync();
    setReservedVoucher(null);
    // Also clear the applied reward if it's THIS voucher — preserve any
    // points-shop reward the customer applied separately (different id).
    if (appliedReward?.voucher_id && appliedReward.voucher_id === reserved?.id) {
      setAppliedReward(null);
    }
  }

  return (
    <View
      style={{
        backgroundColor: theme.bg,
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
      }}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          backgroundColor: theme.iconBg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {theme.iconKind === "brand" && theme.brandIcon
          ? <theme.brandIcon size={22} color={theme.iconColor} />
          : theme.glyphIcon
            ? <theme.glyphIcon size={20} color={theme.iconColor} strokeWidth={2} />
            : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontFamily: "Peachi-Bold",
            fontSize: 14,
            color: theme.fg,
          }}
          numberOfLines={1}
        >
          {reserved.title} locked in
        </Text>
        <Text
          style={{
            fontFamily: "SpaceGrotesk_500Medium",
            fontSize: 11,
            color: dim,
            marginTop: 1,
          }}
          numberOfLines={1}
        >
          Add items — applies at checkout
        </Text>
      </View>
      <Pressable
        onPress={dismiss}
        hitSlop={12}
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          backgroundColor: theme.iconBg,
          alignItems: "center",
          justifyContent: "center",
        }}
        accessibilityLabel="Remove reserved voucher"
      >
        <X size={14} color={theme.iconColor} strokeWidth={2.4} />
      </Pressable>
    </View>
  );
}
