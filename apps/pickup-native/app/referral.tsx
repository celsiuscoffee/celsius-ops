/**
 * Referral — share-and-earn screen.
 *
 * Brand: CC v2026 §1.4 — EspressoHeader, white surfaces, terracotta CTAs.
 * The code is a brand mark — large, mono, copy-friendly. Tap Share opens
 * the native share sheet with a friendly invite line.
 */

import { View, Text, Pressable, ScrollView, Share, ActivityIndicator } from "react-native";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Users, Share2 } from "lucide-react-native";
import * as Haptics from "@/lib/haptics";
import { EspressoHeader } from "../components/EspressoHeader";
import { fetchMyReferral } from "../lib/rewards-v2";
import { useApp } from "../lib/store";

export default function ReferralScreen() {
  const insets = useSafeAreaInsets();
  const phone = useApp((s) => s.phone);

  const { data, isLoading } = useQuery({
    queryKey: ["my-referral", phone ?? "anon"],
    queryFn: fetchMyReferral,
    enabled: !!phone,
  });

  async function shareCode() {
    if (!data?.code) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await Share.share({
        message: `Try Celsius Coffee with me\nUse my code ${data.code} when you sign up — we both get a free drink.\n\nhttps://order.celsiuscoffee.com`,
      });
    } catch { /* user dismissed */ }
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader title="Share & Earn" showBack showCart={false} />

      {!phone || isLoading || !data ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#A2492C" />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero: code + share */}
          <View
            className="rounded-2xl px-6 py-8 items-center"
            style={{
              backgroundColor: "#1A0200",
              shadowColor: "#1A0200",
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.18,
              shadowRadius: 18,
              elevation: 6,
            }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                backgroundColor: "rgba(251,191,36,0.18)",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 14,
              }}
            >
              <Users size={28} color="#FBBF24" strokeWidth={1.8} />
            </View>
            <Text
              style={{
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 10,
                color: "rgba(251,191,36,0.85)",
                letterSpacing: 2,
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              Your code
            </Text>
            <Pressable onPress={shareCode} className="active:opacity-70">
              <Text
                style={{
                  fontFamily: "Peachi-Bold",
                  fontSize: 40,
                  color: "#FBBF24",
                  letterSpacing: 4,
                }}
              >
                {data.code}
              </Text>
            </Pressable>
            <Pressable
              onPress={shareCode}
              className="flex-row items-center bg-primary rounded-full mt-5 active:opacity-80"
              style={{ paddingHorizontal: 20, paddingVertical: 10, gap: 6 }}
            >
              <Share2 size={15} color="#FFFFFF" strokeWidth={2} />
              <Text style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: "#FFFFFF" }}>
                Share code
              </Text>
            </Pressable>
          </View>

          {/* Stats */}
          <View className="flex-row mt-4" style={{ gap: 8 }}>
            <StatCard label="Total" value={data.total_referred} />
            <StatCard label="Pending" value={data.pending} tone="warn" />
            <StatCard label="Rewarded" value={data.rewarded} tone="good" />
          </View>

          {/* How it works */}
          <View
            className="mt-4 bg-surface rounded-2xl border border-border p-4"
            style={{
              shadowColor: "#000",
              shadowOpacity: 0.04,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
              elevation: 1,
            }}
          >
            <Text
              className="text-espresso text-[12px] uppercase mb-3"
              style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 1.5 }}
            >
              How it works
            </Text>
            <Step n={1} text="Share your code with a friend" />
            <Step n={2} text="They sign up and enter your code" />
            <Step n={3} text="They complete their first order" />
            <Step n={4} text="Both of you get a free drink reward" last />
          </View>

          {data.recent.length > 0 && (
            <View
              className="mt-4 bg-surface rounded-2xl border border-border p-4"
              style={{
                shadowColor: "#000",
                shadowOpacity: 0.04,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 2 },
                elevation: 1,
              }}
            >
              <Text
                className="text-espresso text-[12px] uppercase mb-3"
                style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 1.5 }}
              >
                Your referrals
              </Text>
              {data.recent.slice(0, 10).map((r, i) => (
                <View
                  key={i}
                  className="flex-row justify-between items-center py-2.5"
                  style={{
                    borderBottomWidth: i === data.recent.length - 1 ? 0 : 1,
                    borderBottomColor: "rgba(26,2,0,0.06)",
                  }}
                >
                  <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 13, color: "#6B6B6B" }}>
                    {new Date(r.created_at).toLocaleDateString("en-MY", {
                      day: "numeric", month: "short", year: "numeric",
                    })}
                  </Text>
                  <View
                    className="rounded-full"
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      backgroundColor: r.status === "rewarded" ? "#E6F1DD" : "#FDF3E0",
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: "SpaceGrotesk_700Bold",
                        fontSize: 10,
                        color: r.status === "rewarded" ? "#2F6A18" : "#8A6614",
                        letterSpacing: 0.5,
                        textTransform: "uppercase",
                      }}
                    >
                      {r.status === "rewarded" ? "Rewarded" : "Pending order"}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" }) {
  const color =
    tone === "good" ? "#2F6A18" : tone === "warn" ? "#8A6614" : "#1A0200";
  return (
    <View
      className="flex-1 bg-surface rounded-2xl border border-border p-3"
      style={{
        shadowColor: "#000",
        shadowOpacity: 0.04,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      }}
    >
      <Text
        style={{
          fontFamily: "Peachi-Bold",
          fontSize: 22,
          color,
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          fontFamily: "SpaceGrotesk_700Bold",
          fontSize: 10,
          color: "#6B6B6B",
          letterSpacing: 1.2,
          textTransform: "uppercase",
          marginTop: 2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function Step({ n, text, last }: { n: number; text: string; last?: boolean }) {
  return (
    <View
      className="flex-row items-center"
      style={{
        paddingVertical: 8,
        gap: 12,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: "rgba(26,2,0,0.06)",
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: "#FBEBE8",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 12, color: "#A2492C" }}>{n}</Text>
      </View>
      <Text
        style={{
          fontFamily: "SpaceGrotesk_500Medium",
          fontSize: 13,
          color: "#1A0200",
          flex: 1,
        }}
      >
        {text}
      </Text>
    </View>
  );
}
