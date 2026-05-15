/**
 * ClaimableSection — one-tap-claim row group for the Rewards screen.
 *
 * Surfaces vouchers the customer can grab with a single tap (welcome
 * offers, admin promos, pending mystery reveals).
 *
 * Visual treatment is distinct from the main wallet:
 *   - Terracotta side-stripe + NEW badge → "this is fresh"
 *   - Inline "Claim" pill button → no need to drill in to use
 *   - Animates out of the section on successful claim and into the wallet
 */

import { useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Croissant, Plus, Sparkles, Percent, Ticket, Coffee, Gift, Check,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import {
  claimVoucher, voucherUrgencyLabel,
  type ClaimableVoucher,
} from "../lib/rewards-v2";

const CATEGORY_ICON: Record<ClaimableVoucher["category"], React.ComponentType<{ size: number; color: string; strokeWidth?: number }>> = {
  free_item:  Croissant,
  upgrade:    Plus,  // Celsius offers add-ons (extra shot, oat milk) — not size upgrades
  discount:   Percent,
  multiplier: Sparkles,
  special:    Ticket,
};

const SOURCE_ICON: Partial<Record<ClaimableVoucher["source_type"], React.ComponentType<{ size: number; color: string; strokeWidth?: number }>>> = {
  welcome:           Coffee,
  promo:             Gift,
  mystery_pending:   Sparkles,
};

type Props = {
  claimables: ClaimableVoucher[];
};

export function ClaimableSection({ claimables }: Props) {
  if (claimables.length === 0) return null;

  return (
    <View className="mt-6">
      <View className="flex-row items-center justify-between mb-2.5 px-1">
        <Text
          className="text-[12px] uppercase"
          style={{
            fontFamily: "SpaceGrotesk_700Bold",
            letterSpacing: 1.8,
            color: "#C05040",
          }}
        >
          Claim now · {claimables.length}
        </Text>
      </View>

      <View style={{ gap: 8 }}>
        {claimables.map((c) => (
          <ClaimableRow key={c.id} claimable={c} />
        ))}
      </View>
    </View>
  );
}

function ClaimableRow({ claimable }: { claimable: ClaimableVoucher }) {
  const qc = useQueryClient();
  const [claimed, setClaimed] = useState(false);

  const Icon =
    SOURCE_ICON[claimable.source_type] ?? CATEGORY_ICON[claimable.category] ?? Ticket;

  // For mystery-pending we know the expiry is roughly "until next order";
  // for everything else show standard urgency.
  const urgency = claimable.expires_at
    ? voucherUrgencyLabel({
        id: claimable.id, title: "", description: "", icon: "", category: claimable.category,
        status: "active", source_type: null, issued_at: "", expires_at: claimable.expires_at,
        redeemed_at: null, stacks_with_beans: true, template_id: null,
      })
    : { label: "Limited offer", warning: false };

  const claimMutation = useMutation({
    mutationFn: () => claimVoucher(claimable.id),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setClaimed(true);
      // Refresh wallet + claimable lists
      qc.invalidateQueries({ queryKey: ["my-vouchers"] });
      qc.invalidateQueries({ queryKey: ["claimable-vouchers"] });
    },
  });

  return (
    <View
      className="bg-surface rounded-2xl p-3 flex-row items-center"
      style={{
        gap: 12,
        borderWidth: 1,
        borderColor: "rgba(192,80,64,0.25)",
        position: "relative",
        shadowColor: "#000",
        shadowOpacity: 0.04,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 1,
      }}
    >
      {/* Left stripe — terracotta "fresh" indicator */}
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 14,
          bottom: 14,
          width: 3,
          backgroundColor: "#C05040",
          borderTopRightRadius: 2,
          borderBottomRightRadius: 2,
        }}
      />

      {/* NEW badge */}
      <View
        style={{
          position: "absolute",
          top: -7,
          left: 14,
          backgroundColor: "#C05040",
          paddingHorizontal: 8,
          paddingVertical: 2,
          borderRadius: 6,
        }}
      >
        <Text
          style={{
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 8.5,
            color: "#FFFFFF",
            letterSpacing: 1.2,
            textTransform: "uppercase",
            fontWeight: "800",
          }}
        >
          New
        </Text>
      </View>

      <View
        className="rounded-xl items-center justify-center"
        style={{ width: 44, height: 44, backgroundColor: "#FBEBE8" }}
      >
        <Icon size={22} color="#C05040" strokeWidth={1.8} />
      </View>

      <View className="flex-1 min-w-0">
        <Text
          className="text-espresso text-[15px]"
          style={{ fontFamily: "Peachi-Bold" }}
          numberOfLines={1}
        >
          {claimable.title}
        </Text>
        <Text
          className="text-[11px] mt-0.5"
          style={{
            fontFamily: "SpaceGrotesk_500Medium",
            color: urgency.warning ? "#C05040" : "#6B6B6B",
            letterSpacing: 0.2,
          }}
          numberOfLines={1}
        >
          {urgency.label}
        </Text>
      </View>

      {/* Inline claim CTA */}
      <Pressable
        onPress={() => {
          if (claimed || claimMutation.isPending) return;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          claimMutation.mutate();
        }}
        disabled={claimed || claimMutation.isPending}
        className="rounded-full flex-row items-center active:opacity-80"
        style={{
          backgroundColor: claimed ? "#6ab04c" : "#C05040",
          paddingHorizontal: 14,
          paddingVertical: 7,
          gap: 4,
          flexShrink: 0,
        }}
      >
        {claimMutation.isPending ? (
          <>
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text
              className="text-white text-[12px]"
              style={{ fontFamily: "Peachi-Bold" }}
            >
              Claiming…
            </Text>
          </>
        ) : (
          <>
            <Text
              className="text-white text-[12px]"
              style={{ fontFamily: "Peachi-Bold" }}
            >
              {claimed ? "Claimed" : claimable.cta_label ?? "Claim"}
            </Text>
            <Check size={10} color="#FFFFFF" strokeWidth={2.8} />
          </>
        )}
      </Pressable>
    </View>
  );
}
