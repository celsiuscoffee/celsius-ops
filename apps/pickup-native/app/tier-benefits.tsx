import { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { Stack, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Star, Gift, Calendar, Sparkles } from "lucide-react-native";
import { EspressoHeader } from "../components/EspressoHeader";
import { CelsiusLoader } from "../components/CelsiusLoader";
import { TierCardCarousel, type TierLite } from "../components/TierCardCarousel";
import { useApp } from "../lib/store";
import { fetchTier } from "../lib/rewards";
import { supabase } from "../lib/supabase";

type BenefitRule = {
  type: string;
  value?: number;
  label?: string;
  reward_id?: string;
};

type Tier = TierLite & { benefit_rules: BenefitRule[] | null };

async function fetchAllTiers(): Promise<Tier[]> {
  const { data, error } = await supabase
    .from("tiers")
    .select("id,slug,name,min_visits,min_spend,multiplier,color,icon,benefits,benefit_rules,qualification_metric,sort_order")
    .eq("brand_id", "brand-celsius")
    .eq("is_active", true)
    .order("sort_order", { ascending: true, nullsFirst: true })
    .order("min_visits", { ascending: true, nullsFirst: true });
  if (error) throw error;
  return (data ?? []) as Tier[];
}

export default function TierBenefits() {
  const loyaltyId = useApp((s) => s.loyaltyId);
  const tiersQ = useQuery({ queryKey: ["tiers"], queryFn: fetchAllTiers, staleTime: 5 * 60_000 });
  const memberTierQ = useQuery({
    queryKey: ["member-tier", loyaltyId],
    queryFn: () => (loyaltyId ? fetchTier(loyaltyId) : Promise.resolve(null)),
    enabled: !!loyaltyId,
    staleTime: 60_000,
  });

  const tiers = tiersQ.data ?? [];
  const currentSlug = memberTierQ.data?.tier_slug ?? null;
  const currentIdx = useMemo(
    () => Math.max(0, tiers.findIndex((t) => t.slug === currentSlug)),
    [tiers, currentSlug],
  );

  const [activeIdx, setActiveIdx] = useState(0);

  if (tiersQ.isLoading) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ headerShown: false }} />
        <EspressoHeader title="Membership" showBack showCart={false} />
        <View className="flex-1 items-center justify-center">
          <CelsiusLoader size="md" />
        </View>
      </View>
    );
  }

  const activeTier = tiers[activeIdx];

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader title="Membership" showBack showCart={false} />

      <ScrollView contentContainerClassName="pb-24">
        <View style={{ paddingTop: 16 }}>
          <TierCardCarousel
            tiers={tiers}
            currentSlug={currentSlug}
            memberVisits={memberTierQ.data?.visits_this_period ?? 0}
            memberSpend={memberTierQ.data?.spend_this_period ?? 0}
            // Tap a card → make it the "active" one for the benefits list below.
            onCardPress={(t) => {
              const idx = tiers.findIndex((x) => x.id === t.id);
              if (idx >= 0) setActiveIdx(idx);
            }}
          />
        </View>

        {activeTier ? (
          <BenefitsSection tier={activeTier} isLocked={activeIdx > currentIdx} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function BenefitsSection({ tier, isLocked }: { tier: Tier; isLocked: boolean }) {
  const rules = tier.benefit_rules ?? [];

  const points    = rules.filter((r) => r.type === "points_multiplier");
  const birthday  = rules.filter((r) => r.type === "birthday_reward");
  const perks     = rules.filter((r) => r.type === "early_access" || r.type === "monthly_perk");
  const exclusive = rules.filter((r) => r.type === "exclusive_event");

  return (
    <View className="px-4" style={{ paddingTop: 16 }}>
      {points.length > 0 && (
        <Section title="Member Rewards" muted={isLocked}>
          <BenefitCard
            icon={<Star size={20} color="#C05040" />}
            label={`${String(points[0].value).replace(/\.0$/, "")}× points on every purchase`}
            muted={isLocked}
          />
        </Section>
      )}

      {birthday.length > 0 && (
        <Section title="Birthday Gifts" muted={isLocked}>
          <BenefitCard icon={<Gift size={20} color="#C05040" />} label="Free birthday drink" muted={isLocked} />
        </Section>
      )}

      {perks.length > 0 && (
        <Section title="Member Perks" muted={isLocked}>
          {perks.map((p, i) => (
            <BenefitCard
              key={i}
              icon={<Calendar size={20} color="#C05040" />}
              label={p.label ?? p.type.replace(/_/g, " ")}
              muted={isLocked}
            />
          ))}
        </Section>
      )}

      {exclusive.length > 0 && (
        <Section title="VIP Special" muted={isLocked}>
          {exclusive.map((p, i) => (
            <BenefitCard
              key={i}
              icon={<Sparkles size={20} color="#C05040" />}
              label={p.label ?? "Exclusive event invites"}
              muted={isLocked}
            />
          ))}
        </Section>
      )}

      {rules.length === 0 && (tier.benefits?.length ?? 0) > 0 && (
        <Section title="What you get" muted={isLocked}>
          {tier.benefits!.map((b, i) => (
            <BenefitCard key={i} icon={<Star size={20} color="#C05040" />} label={b} muted={isLocked} />
          ))}
        </Section>
      )}

      <Pressable
        onPress={() => router.push("/rewards")}
        className="mt-4 rounded-xl border border-primary/40 bg-primary/5 p-4 active:opacity-70"
        accessibilityRole="button"
        accessibilityLabel="View rewards catalogue"
      >
        <Text style={{ color: "#C05040", fontFamily: "Peachi-Bold", fontSize: 15 }}>
          See rewards catalogue →
        </Text>
        <Text
          style={{
            color: "rgba(26,2,0,0.6)",
            fontFamily: "SpaceGrotesk_400Regular",
            fontSize: 12,
            marginTop: 4,
            lineHeight: 18,
          }}
        >
          Redeem points for free drinks, RM5 / RM10 vouchers, and birthday gifts
        </Text>
      </Pressable>
    </View>
  );
}

function Section({
  title,
  children,
  muted,
}: {
  title: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <View style={{ marginTop: 16 }}>
      <Text
        style={{
          fontFamily: "Peachi-Bold",
          fontSize: 16,
          color: muted ? "rgba(26,2,0,0.55)" : "#160800",
          marginBottom: 10,
        }}
      >
        {title}
      </Text>
      <View style={{ gap: 8 }}>{children}</View>
    </View>
  );
}

function BenefitCard({
  icon,
  label,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  muted?: boolean;
}) {
  return (
    <View
      className="flex-row items-center rounded-xl border border-border bg-surface p-3"
      style={{ gap: 12, opacity: muted ? 0.55 : 1 }}
    >
      <View
        className="rounded-lg items-center justify-center"
        style={{ width: 40, height: 40, backgroundColor: "rgba(192,80,64,0.08)" }}
      >
        {icon}
      </View>
      <Text
        className="flex-1"
        style={{
          fontFamily: "SpaceGrotesk_500Medium",
          fontSize: 14,
          color: "#160800",
          lineHeight: 20,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
