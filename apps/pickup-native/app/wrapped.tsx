/**
 * Coffee Wrapped — annual recap, Spotify-style.
 *
 * Brand: CC v2026 §1.4 — espresso surfaces, amber accents for wins,
 * Peachi for big numbers, Space Grotesk for body. Hard celebration:
 * each section animates in.
 *
 * Year is read from ?year= query, defaults to current.
 */

import { View, Text, ScrollView, Pressable, Share, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Sparkles, Coffee, Clock, MapPin, Trophy, Share2, ChevronLeft } from "lucide-react-native";
import * as Haptics from "@/lib/haptics";
import { fetchCoffeeWrapped } from "../lib/rewards-v2";
import { useApp } from "../lib/store";

const MONTH = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatHour(h: number | null): string {
  if (h === null) return "—";
  const local = (h + 8) % 24; // UTC → MYT
  const ampm = local < 12 ? "AM" : "PM";
  const h12 = local % 12 === 0 ? 12 : local % 12;
  return `${h12}${ampm}`;
}

function formatRM(sen: number): string {
  return `RM${(sen / 100).toFixed(2).replace(/\.00$/, "")}`;
}

export default function CoffeeWrappedScreen() {
  const insets = useSafeAreaInsets();
  const { year: yearParam } = useLocalSearchParams<{ year?: string }>();
  const year = yearParam ? Number(yearParam) : new Date().getFullYear();
  const phone = useApp((s) => s.phone);

  const { data, isLoading } = useQuery({
    queryKey: ["coffee-wrapped", year, phone ?? "anon"],
    queryFn: () => fetchCoffeeWrapped(year),
    enabled: !!phone,
  });

  async function share() {
    if (!data) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const lines = [
      `My Celsius Coffee Wrapped ${data.year}`,
      `${data.summary.total_orders} cups · ${data.summary.distinct_outlets} outlets`,
    ];
    if (data.favorites.product_name) {
      lines.push(`Favourite: ${data.favorites.product_name}`);
    }
    if (data.summary.longest_streak_weeks > 0) {
      lines.push(`Longest streak: ${data.summary.longest_streak_weeks} weeks`);
    }
    lines.push("\nhttps://celsiuscoffee.com");
    try {
      await Share.share({ message: lines.join("\n") });
    } catch { /* dismissed */ }
  }

  return (
    <View className="flex-1" style={{ backgroundColor: "#1A0200" }}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Top bar — minimal, only back */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 8,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}
        >
          <ChevronLeft size={22} color="#FBBF24" />
        </Pressable>
        <Text
          style={{
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 11,
            color: "rgba(251,191,36,0.7)",
            letterSpacing: 2,
            textTransform: "uppercase",
            marginLeft: 4,
          }}
        >
          Wrapped {year}
        </Text>
      </View>

      {!phone || isLoading || !data ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#FBBF24" />
        </View>
      ) : data.summary.total_orders === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Coffee size={48} color="#FBBF24" strokeWidth={1.5} />
          <Text
            style={{
              fontFamily: "Peachi-Bold",
              fontSize: 24,
              color: "#FBBF24",
              marginTop: 16,
              textAlign: "center",
            }}
          >
            You&apos;re still warming up
          </Text>
          <Text
            style={{
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 14,
              color: "rgba(255,255,255,0.7)",
              marginTop: 8,
              textAlign: "center",
              lineHeight: 20,
            }}
          >
            Place your first order to start brewing your {year} Wrapped story
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Headline cups count */}
          <View style={{ alignItems: "center", paddingVertical: 24 }}>
            <Text
              style={{
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 10,
                color: "rgba(251,191,36,0.7)",
                letterSpacing: 2.5,
                textTransform: "uppercase",
              }}
            >
              You drank
            </Text>
            <Text
              style={{
                fontFamily: "Peachi-Bold",
                fontSize: 120,
                color: "#FBBF24",
                letterSpacing: -6,
                lineHeight: 120,
                marginTop: 4,
              }}
            >
              {data.summary.total_orders}
            </Text>
            <Text
              style={{
                fontFamily: "Peachi-Bold",
                fontSize: 28,
                color: "#FFFFFF",
                marginTop: -8,
              }}
            >
              cup{data.summary.total_orders === 1 ? "" : "s"}
            </Text>
            <Text
              style={{
                fontFamily: "SpaceGrotesk_500Medium",
                fontSize: 14,
                color: "rgba(255,255,255,0.6)",
                marginTop: 8,
                textAlign: "center",
              }}
            >
              in {year} · that&apos;s {(data.summary.total_orders / 52).toFixed(1)} every week
            </Text>
          </View>

          {/* Stats grid */}
          <View style={{ gap: 10 }}>
            {data.favorites.product_name && (
              <BigCard
                eyebrow="Favourite drink"
                value={data.favorites.product_name}
                detail={`${data.favorites.product_count} order${data.favorites.product_count === 1 ? "" : "s"}`}
                icon={Coffee}
              />
            )}
            {data.favorites.hour !== null && (
              <BigCard
                eyebrow="Favourite hour"
                value={formatHour(data.favorites.hour)}
                detail={data.favorites.month ? `usually ${MONTH[data.favorites.month - 1]}` : undefined}
                icon={Clock}
              />
            )}
            <BigCard
              eyebrow="Outlets visited"
              value={String(data.summary.distinct_outlets)}
              detail={`${data.summary.distinct_products} different drinks tried`}
              icon={MapPin}
            />
            {data.summary.longest_streak_weeks > 0 && (
              <BigCard
                eyebrow="Longest streak"
                value={`${data.summary.longest_streak_weeks} wks`}
                detail="Weekly visit chain"
                icon={Sparkles}
              />
            )}
            <View
              style={{
                backgroundColor: "rgba(251,191,36,0.08)",
                borderRadius: 18,
                padding: 18,
                marginTop: 4,
              }}
            >
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_700Bold",
                  fontSize: 10,
                  color: "rgba(251,191,36,0.75)",
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                The damage
              </Text>
              <View className="flex-row" style={{ gap: 18 }}>
                <View className="flex-1">
                  <Text style={{ fontFamily: "Peachi-Bold", fontSize: 24, color: "#FFFFFF" }}>
                    {formatRM(data.summary.total_spent_sen)}
                  </Text>
                  <Text
                    style={{
                      fontFamily: "SpaceGrotesk_500Medium",
                      fontSize: 11,
                      color: "rgba(255,255,255,0.5)",
                      marginTop: 2,
                    }}
                  >
                    Total spent
                  </Text>
                </View>
                <View className="flex-1">
                  <Text style={{ fontFamily: "Peachi-Bold", fontSize: 24, color: "#FBBF24" }}>
                    {formatRM(data.summary.total_saved_sen)}
                  </Text>
                  <Text
                    style={{
                      fontFamily: "SpaceGrotesk_500Medium",
                      fontSize: 11,
                      color: "rgba(255,255,255,0.5)",
                      marginTop: 2,
                    }}
                  >
                    Saved with rewards
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Share */}
          <Pressable
            onPress={share}
            className="active:opacity-80"
            style={{
              marginTop: 28,
              backgroundColor: "#FBBF24",
              borderRadius: 100,
              paddingVertical: 16,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Share2 size={16} color="#1A0200" strokeWidth={2.4} />
            <Text style={{ fontFamily: "Peachi-Bold", fontSize: 15, color: "#1A0200" }}>
              Share my Wrapped
            </Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

function BigCard({
  eyebrow, value, detail, icon: Icon,
}: {
  eyebrow: string;
  value: string;
  detail?: string;
  icon: React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;
}) {
  return (
    <View
      style={{
        backgroundColor: "rgba(255,255,255,0.04)",
        borderRadius: 18,
        padding: 18,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          backgroundColor: "rgba(251,191,36,0.18)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={22} color="#FBBF24" strokeWidth={1.8} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 9,
            color: "rgba(251,191,36,0.65)",
            letterSpacing: 1.8,
            textTransform: "uppercase",
            marginBottom: 3,
          }}
        >
          {eyebrow}
        </Text>
        <Text
          style={{
            fontFamily: "Peachi-Bold",
            fontSize: 20,
            color: "#FFFFFF",
            letterSpacing: -0.3,
          }}
          numberOfLines={1}
        >
          {value}
        </Text>
        {detail && (
          <Text
            style={{
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 11,
              color: "rgba(255,255,255,0.55)",
              marginTop: 2,
            }}
          >
            {detail}
          </Text>
        )}
      </View>
    </View>
  );
}
