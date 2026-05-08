import { View, Text, ScrollView, Pressable, Linking } from "react-native";
import { Stack } from "expo-router";
import { Mail, MapPin } from "lucide-react-native";
import { EspressoHeader } from "../components/EspressoHeader";

export default function AccountDelete() {
  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader title="Delete account" showBack showCart={false} />
      <ScrollView contentContainerClassName="px-5 py-5 gap-6 pb-20">
        <View>
          <Text
            className="text-espresso text-xl"
            style={{ fontFamily: "Peachi-Bold" }}
          >
            Delete your account
          </Text>
          <Text
            className="text-muted-fg text-xs mt-1"
            style={{ fontFamily: "SpaceGrotesk_400Regular" }}
          >
            Celsius Coffee account & data deletion
          </Text>
        </View>

        <Section title="How to request deletion">
          <Text className="text-espresso text-[14px] leading-[22px]" style={fontBody}>
            You can request permanent deletion of your Celsius Coffee account and all associated personal data using either method below.
          </Text>

          <Pressable
            onPress={() =>
              Linking.openURL(
                "mailto:barista@celsiuscoffee.com?subject=Delete%20my%20account"
              )
            }
            className="mt-3 bg-surface rounded-2xl border border-border p-3 flex-row items-center gap-3 active:opacity-70"
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
          </Pressable>

          <View className="mt-2 bg-surface rounded-2xl border border-border p-3 flex-row items-center gap-3">
            <View className="w-10 h-10 rounded-lg bg-primary/10 items-center justify-center">
              <MapPin size={18} color="#C05040" strokeWidth={1.75} />
            </View>
            <View className="flex-1">
              <Text className="text-espresso text-[14px]" style={fontPeachi}>
                In person
              </Text>
              <Text className="text-muted-fg text-[12px] leading-[16px]" style={fontBody}>
                Visit any Celsius outlet with photo ID
              </Text>
            </View>
          </View>
        </Section>

        <Section title="What gets deleted">
          <Bullet>Your name, email, phone number, and birthday</Bullet>
          <Bullet>Your points balance and rewards history</Bullet>
          <Bullet>Your full transaction and visit history</Bullet>
          <Bullet>Push notification tokens linked to your devices</Bullet>
          <Bullet>SMS opt-in records and marketing preferences</Bullet>
          <Text
            className="text-muted-fg text-[12px] mt-2 leading-[18px]"
            style={fontBody}
          >
            Anonymised aggregate analytics that cannot be linked back to you may be retained.
          </Text>
        </Section>

        <Section title="Timeline">
          <Text className="text-espresso text-[14px] leading-[22px]" style={fontBody}>
            We will permanently delete your account within <Text style={fontPeachi}>30 days</Text> of receiving a verified request, and we will email a confirmation when the deletion is complete.
          </Text>
        </Section>

        <Section title="Important note">
          <Text className="text-espresso text-[14px] leading-[22px]" style={fontBody}>
            Deletion is permanent and cannot be reversed. Unredeemed points will be forfeited at the time of deletion. If you simply want to stop promotional SMS, reply STOP to any promotional message instead.
          </Text>
        </Section>

        <Text
          className="text-muted-fg text-[11px] mt-2 leading-[16px]"
          style={fontBody}
        >
          See our Privacy Policy for full details on how we handle your personal data under the Personal Data Protection Act 2010 (Act 709) of Malaysia.
        </Text>
      </ScrollView>
    </View>
  );
}

const fontBody = { fontFamily: "SpaceGrotesk_400Regular" } as const;
const fontPeachi = { fontFamily: "Peachi-Bold" } as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text
        className="text-espresso text-[15px] mb-2"
        style={{ fontFamily: "Peachi-Bold" }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-row gap-2 mb-1">
      <Text className="text-primary text-[14px]">•</Text>
      <Text
        className="text-espresso text-[14px] flex-1 leading-[22px]"
        style={fontBody}
      >
        {children}
      </Text>
    </View>
  );
}
