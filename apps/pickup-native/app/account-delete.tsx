import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Stack, router } from "expo-router";
import { Trash2, AlertTriangle } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { EspressoHeader } from "../components/EspressoHeader";
import { useApp } from "../lib/store";
import { api } from "../lib/api";
import { deregisterPush } from "../lib/notifications";

export default function AccountDelete() {
  const phone = useApp((s) => s.phone);
  const member = useApp((s) => s.member);
  const loyaltyId = useApp((s) => s.loyaltyId);
  const signOutReset = useApp((s) => s.signOutReset);
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const memberId = member?.id ?? loyaltyId;
  const signedIn = !!phone && !!memberId;

  const onDelete = async () => {
    if (!signedIn || !phone || !memberId) return;
    if (confirmText.trim().toUpperCase() !== "DELETE") return;
    setDeleting(true);
    try {
      await api.deleteAccount({ member_id: memberId, phone });
      // Deregister push (best-effort) + wipe local state, then bounce home.
      deregisterPush().catch(() => {});
      signOutReset();
      queryClient.clear();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Account deleted", "Your account and data have been removed.");
      router.replace("/");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not delete the account.";
      Alert.alert("Deletion failed", msg);
    } finally {
      setDeleting(false);
      setConfirming(false);
      setConfirmText("");
    }
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader title="Delete account" showBack showCart={false} />
      <ScrollView contentContainerClassName="px-5 py-5 gap-6 pb-20">
        <View>
          <Text className="text-espresso text-xl" style={fontPeachi}>
            Delete your account
          </Text>
          <Text className="text-muted-fg text-xs mt-1" style={fontBody}>
            Celsius Coffee account & data deletion
          </Text>
        </View>

        <Section title="What gets deleted">
          <Bullet>Your name, email, phone number, and birthday</Bullet>
          <Bullet>Your points balance and rewards history</Bullet>
          <Bullet>Your full transaction and visit history</Bullet>
          <Bullet>Push notification tokens linked to your devices</Bullet>
          <Bullet>SMS opt-in records and marketing preferences</Bullet>
          <Text className="text-muted-fg text-[12px] mt-2 leading-[18px]" style={fontBody}>
            Anonymised aggregate analytics that cannot be linked back to you may be retained.
          </Text>
        </Section>

        <Section title="Important note">
          <Text className="text-espresso text-[14px] leading-[22px]" style={fontBody}>
            Deletion is permanent and cannot be reversed. Unredeemed points will be forfeited at the time of deletion. If you simply want to stop promotional SMS, reply STOP to any promotional message instead.
          </Text>
        </Section>

        {signedIn ? (
          <Pressable
            onPress={() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              setConfirming(true);
            }}
            className="mt-2 rounded-2xl border border-primary/40 bg-primary/5 p-4 flex-row items-center gap-3 active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel="Delete my account"
          >
            <View className="w-10 h-10 rounded-lg bg-primary/15 items-center justify-center">
              <Trash2 size={18} color="#C05040" strokeWidth={1.75} />
            </View>
            <View className="flex-1">
              <Text className="text-primary text-[15px]" style={fontPeachi}>
                Delete my account
              </Text>
              <Text className="text-muted-fg text-[12px] mt-0.5" style={fontBody}>
                Permanent · cannot be undone
              </Text>
            </View>
          </Pressable>
        ) : (
          <View className="mt-2 rounded-2xl border border-border bg-surface p-4">
            <Text className="text-espresso text-[14px] leading-[22px]" style={fontBody}>
              Sign in first to delete your account.
            </Text>
          </View>
        )}

        <Text className="text-muted-fg text-[11px] mt-2 leading-[16px]" style={fontBody}>
          See our Privacy Policy for full details on how we handle your personal data under the Personal Data Protection Act 2010 (Act 709) of Malaysia.
        </Text>
      </ScrollView>

      <Modal
        visible={confirming}
        transparent
        animationType="fade"
        onRequestClose={() => !deleting && setConfirming(false)}
      >
        <View className="flex-1 bg-black/60 justify-center px-6">
          <View className="bg-background rounded-2xl p-5">
            <View className="flex-row items-center gap-2 mb-2">
              <AlertTriangle size={18} color="#C05040" />
              <Text className="text-espresso text-[16px]" style={fontPeachi}>
                Delete account?
              </Text>
            </View>
            <Text className="text-espresso text-[13px] leading-[20px]" style={fontBody}>
              This will permanently delete your account and all data. To confirm, type <Text style={fontPeachi}>DELETE</Text> below.
            </Text>
            <TextInput
              value={confirmText}
              onChangeText={setConfirmText}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Type DELETE"
              editable={!deleting}
              className="mt-3 rounded-lg border border-border bg-surface px-3 py-2 text-espresso"
              style={[fontBody, { fontSize: 14 }]}
            />
            <View className="flex-row gap-2 mt-4">
              <Pressable
                onPress={() => {
                  setConfirming(false);
                  setConfirmText("");
                }}
                disabled={deleting}
                className="flex-1 rounded-lg border border-border py-2.5 items-center active:opacity-70"
              >
                <Text className="text-espresso text-[14px]" style={fontPeachi}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={onDelete}
                disabled={deleting || confirmText.trim().toUpperCase() !== "DELETE"}
                className={`flex-1 rounded-lg py-2.5 items-center ${
                  confirmText.trim().toUpperCase() === "DELETE" && !deleting
                    ? "bg-primary"
                    : "bg-primary/40"
                }`}
              >
                {deleting ? (
                  <View className="flex-row items-center justify-center" style={{ gap: 8 }}>
                    <ActivityIndicator color="#fff" />
                    <Text className="text-white text-[14px]" style={fontPeachi}>
                      Deleting…
                    </Text>
                  </View>
                ) : (
                  <Text className="text-white text-[14px]" style={fontPeachi}>
                    Delete
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const fontBody = { fontFamily: "SpaceGrotesk_400Regular" } as const;
const fontPeachi = { fontFamily: "Peachi-Bold" } as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text className="text-espresso text-[15px] mb-2" style={fontPeachi}>
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
      <Text className="text-espresso text-[14px] flex-1 leading-[22px]" style={fontBody}>
        {children}
      </Text>
    </View>
  );
}
