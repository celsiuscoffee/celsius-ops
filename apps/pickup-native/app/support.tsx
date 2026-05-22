import { View, Text, ScrollView, Pressable, Linking } from "react-native";
import { Stack, router } from "expo-router";
import { Mail, AtSign, ChevronRight } from "lucide-react-native";
import { EspressoHeader } from "../components/EspressoHeader";

const fontBody = { fontFamily: "SpaceGrotesk_400Regular" } as const;
const fontPeachi = { fontFamily: "Peachi-Bold" } as const;

export default function Support() {
  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader title="Support" showBack showCart={false} />
      <ScrollView contentContainerClassName="px-5 py-5 gap-6 pb-20">
        <View>
          <Text className="text-espresso text-xl" style={fontPeachi}>
            How can we help?
          </Text>
          <Text className="text-muted-fg text-xs mt-1" style={fontBody}>
            Help with your account, orders, and rewards.
          </Text>
        </View>

        <View>
          <Text className="text-espresso text-[15px] mb-2" style={fontPeachi}>
            Contact us
          </Text>
          <Text
            className="text-espresso text-[13px] leading-[20px] mb-3"
            style={fontBody}
          >
            The fastest way to reach us is by email. We reply within one business day, Mon–Fri.
          </Text>

          <Pressable
            onPress={() => Linking.openURL("mailto:barista@celsiuscoffee.com")}
            className="bg-surface rounded-2xl border border-border p-3 flex-row items-center gap-3 active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel="Email us"
          >
            <View className="w-10 h-10 rounded-lg bg-primary/10 items-center justify-center">
              <Mail size={18} color="#C05040" strokeWidth={1.75} />
            </View>
            <View className="flex-1">
              <Text className="text-espresso text-[14px]" style={fontPeachi}>
                Email us
              </Text>
              <Text className="text-muted-fg text-[12px]" style={fontBody}>
                barista@celsiuscoffee.com
              </Text>
            </View>
            <ChevronRight size={16} color="#8E8E93" />
          </Pressable>

          <Pressable
            onPress={() => Linking.openURL("https://instagram.com/celsiuscoffeemy")}
            className="mt-2 bg-surface rounded-2xl border border-border p-3 flex-row items-center gap-3 active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel="Follow us on Instagram"
          >
            <View className="w-10 h-10 rounded-lg bg-primary/10 items-center justify-center">
              <AtSign size={18} color="#C05040" strokeWidth={1.75} />
            </View>
            <View className="flex-1">
              <Text className="text-espresso text-[14px]" style={fontPeachi}>
                Instagram
              </Text>
              <Text className="text-muted-fg text-[12px]" style={fontBody}>
                @celsiuscoffeemy
              </Text>
            </View>
            <ChevronRight size={16} color="#8E8E93" />
          </Pressable>
        </View>

        <View>
          <Text className="text-espresso text-[15px] mb-3" style={fontPeachi}>
            Common questions
          </Text>

          <FAQ q="I didn't receive my OTP code">
            OTP codes are sent by SMS and usually arrive within 30 seconds. Check signal, wait a minute, then tap Resend code. If still nothing, email us with your phone number.
          </FAQ>

          <FAQ q="My order didn't go through">
            If your payment was charged but the order didn't appear, show your bank notification to a barista at the outlet — they can manually fulfil or refund. For failed payments, no money was taken; just try again.
          </FAQ>

          <FAQ q="My loyalty points are missing">
            Points are awarded after the order is marked complete by outlet staff. If they don't show up after 24 hours, email us with your phone number and visit details and we'll credit them manually.
          </FAQ>

          <FAQ q="How do I redeem a reward?">
            Go to the Rewards tab, tap Apply on the reward you want — it'll be applied at checkout. Show the barista the order on pickup; the discount is automatic.
          </FAQ>

          <FAQ q="How do I update my profile?">
            Account → tap your profile to edit name, email, birthday. To change phone, email barista@celsiuscoffee.com from your registered email — phone changes need extra verification.
          </FAQ>

          <FAQ q="Stop promotional SMS">
            Reply STOP to any promotional message. Transactional messages like OTP codes will continue. You can also opt out by emailing us.
          </FAQ>

          <FAQ q="How do I delete my account?" onPress={() => router.push("/account-delete")}>
            Tap to see deletion options.
          </FAQ>
        </View>

        <View>
          <Text className="text-espresso text-[15px] mb-2" style={fontPeachi}>
            About Celsius Coffee
          </Text>
          <Text
            className="text-espresso text-[13px] leading-[20px]"
            style={fontBody}
          >
            Celsius Coffee Sdn. Bhd. is a Malaysian specialty coffee brand. Find us at celsiuscoffee.com and on Instagram @celsiuscoffeemy.
          </Text>
        </View>

        <Text
          className="text-muted-fg text-[11px] mt-2 leading-[16px] border-t border-border pt-4"
          style={fontBody}
        >
          See our Privacy Policy for details on how we handle your personal data.
        </Text>
      </ScrollView>
    </View>
  );
}

function FAQ({
  q,
  children,
  onPress,
}: {
  q: string;
  children: React.ReactNode;
  onPress?: () => void;
}) {
  const Wrapper: any = onPress ? Pressable : View;
  return (
    <Wrapper
      onPress={onPress}
      className={`bg-surface rounded-2xl border border-border p-3 mb-2 ${
        onPress ? "active:opacity-70" : ""
      }`}
    >
      <View className="flex-row items-center gap-2">
        <Text className="text-espresso text-[13px] flex-1" style={fontPeachi}>
          {q}
        </Text>
        {onPress && <ChevronRight size={14} color="#8E8E93" />}
      </View>
      <Text
        className="text-muted-fg text-[12px] mt-1 leading-[18px]"
        style={fontBody}
      >
        {children}
      </Text>
    </Wrapper>
  );
}
