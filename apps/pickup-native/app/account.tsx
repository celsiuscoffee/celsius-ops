import { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Alert,
} from "react-native";
import { Stack, router } from "expo-router";
import {
  User,
  LogOut,
  ChevronRight,
  Phone,
  ArrowLeft,
  ShoppingBag,
  Settings as SettingsIcon,
  Pencil,
  X,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView } from "react-native";
import { EspressoHeader } from "../components/EspressoHeader";
import { BottomNav } from "../components/BottomNav";
import { TierHero } from "../components/TierHero";
import { tierStyle } from "../lib/tier-styles";
import { useApp } from "../lib/store";
import { api } from "../lib/api";
import { fetchMember, fetchTier, type MemberTier } from "../lib/rewards";
import { SafeBoundary } from "../components/SafeBoundary";
import { useQuery } from "@tanstack/react-query";
import { CelsiusLoader } from "../components/CelsiusLoader";

function normalisePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("60")) return `+${digits}`;
  if (digits.startsWith("0")) return `+6${digits}`;
  return `+60${digits}`;
}

function isValidLocalPhone(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  // Malaysian mobile: at least 9 digits after country code
  if (digits.startsWith("60")) return digits.length >= 11;
  if (digits.startsWith("0")) return digits.length >= 10;
  return digits.length >= 9;
}

export default function AccountTab() {
  const phone = useApp((s) => s.phone);
  const setPhone = useApp((s) => s.setPhone);
  const setLoyaltyId = useApp((s) => s.setLoyaltyId);
  const setMember = useApp((s) => s.setMember);

  const handleVerified = async (p: string) => {
    setPhone(p);
    try {
      const m = await fetchMember(p);
      setLoyaltyId(m?.id ?? null);
      if (m) {
        setMember({
          id: m.id,
          name: m.name,
          email: null,
          birthday: null,
          pointsBalance: m.pointsBalance,
          totalVisits: m.totalVisits,
          totalPointsEarned: m.totalPointsEarned,
        });
      }
    } catch {
      // Member doesn't exist yet — first order will create them server-side
    }
  };

  const handleSignOut = () => {
    setPhone("");
    setLoyaltyId(null);
    setMember(null);
  };

  if (phone) return <SignedIn phone={phone} onSignOut={handleSignOut} />;
  return <SignIn onVerified={handleVerified} />;
}

function SignedIn({ phone, onSignOut }: { phone: string; onSignOut: () => void }) {
  const insets = useSafeAreaInsets();
  const member = useApp((s) => s.member);
  const setMember = useApp((s) => s.setMember);
  const loyaltyId = useApp((s) => s.loyaltyId);
  const [editing, setEditing] = useState(false);

  // Tier is read via React Query so the prefetch warm-up in _layout.tsx
  // (fired the moment we know loyaltyId) populates this view's cache —
  // tier eyebrow + benefits render on first paint instead of after a
  // 500ms round-trip. The 5-min staleTime keeps it from refetching on
  // every tab visit; cacheTime (default) keeps it warm across nav.
  const tierQ = useQuery({
    queryKey: ["tier", loyaltyId],
    queryFn: () => (loyaltyId ? fetchTier(loyaltyId) : Promise.resolve(null)),
    enabled: !!loyaltyId,
    staleTime: 5 * 60_000,
  });
  const tier = tierQ.data ?? null;

  // Refresh member fields (points balance, name, etc.) on screen focus.
  // Member is in zustand for write-through to the rest of the app, so
  // we keep the imperative fetch here. fetchTier runs through the
  // queryClient now so we don't need to call it here too.
  useEffect(() => {
    fetchMember(phone)
      .then((m) => {
        if (!m) return;
        setMember({
          id: m.id,
          name: m.name,
          email: null,
          birthday: null,
          pointsBalance: m.pointsBalance,
          totalVisits: m.totalVisits,
          totalPointsEarned: m.totalPointsEarned,
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ts = tierStyle(tier);
  const showTierEyebrow = !!tier?.tier_slug;
  const memberName = member?.name || "Add your name";
  // Format phone to "+60 10 933 5369" — visual breathing room.
  const formattedPhone = phone.replace(/^(\+\d{2})(\d{2})(\d{3})(\d{4})$/, "$1 $2 $3 $4");

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Tier-themed hero — eyebrow + name + phone. Curve drapes into
          the body. Replaces both the old EspressoHeader and the
          standalone profile card. */}
      <TierHero
        style={ts}
        paddingTop={insets.top + 12}
        paddingBottom={36}
        variant="tall"
      >
        <View className="flex-row items-start justify-between">
          <View className="flex-1">
            {showTierEyebrow ? (
              <Text
                className="text-[10px] uppercase"
                style={{
                  color: ts.eyebrowColor,
                  fontFamily: "SpaceGrotesk_700Bold",
                  letterSpacing: 3.5,
                }}
                numberOfLines={1}
              >
                {`${ts.displayName} MEMBER`}
              </Text>
            ) : tierQ.isLoading ? (
              // Cold cache: tier query hasn't resolved yet. Show the
              // brand spinner in the eyebrow slot so we never print a
              // tier name we'd have to swap a moment later.
              <CelsiusLoader size="sm" style={{ alignItems: "flex-start" }} />
            ) : (
              <Text
                className="text-[10px] uppercase"
                style={{
                  color: ts.eyebrowColor,
                  fontFamily: "SpaceGrotesk_700Bold",
                  letterSpacing: 3.5,
                }}
                numberOfLines={1}
              >
                MEMBER
              </Text>
            )}
            <Text
              className="text-[26px] mt-2"
              style={{ color: ts.textColor, fontFamily: "Peachi-Bold" }}
              numberOfLines={1}
            >
              {memberName}
            </Text>
            <Text
              className="text-[11px] mt-1.5"
              style={{ color: ts.mutedColor, fontFamily: "SpaceGrotesk_400Regular" }}
              numberOfLines={1}
            >
              {formattedPhone}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setEditing(true);
            }}
            hitSlop={10}
            className="active:opacity-70"
          >
            <Pencil size={18} color={ts.textColor} />
          </Pressable>
        </View>
      </TierHero>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 100 }}
      >
        {/* Stats card — espresso bg with 3 numerals. Same content as
            the old profile card's bottom row, lifted out so it stands
            alone now that the hero shows name + phone. */}
        <View
          className="rounded-2xl"
          style={{
            backgroundColor: "#160800",
            paddingVertical: 16,
            paddingHorizontal: 8,
            marginBottom: 16,
          }}
        >
          <View className="flex-row items-center justify-around">
            <Stat label="Points" value={(member?.pointsBalance ?? 0).toLocaleString()} />
            <View style={{ width: 1, height: 40, backgroundColor: "rgba(255,255,255,0.10)" }} />
            <Stat label="Visits" value={String(member?.totalVisits ?? 0)} />
            <View style={{ width: 1, height: 40, backgroundColor: "rgba(255,255,255,0.10)" }} />
            <Stat label="Earned" value={(member?.totalPointsEarned ?? 0).toLocaleString()} />
          </View>
        </View>

        {/* Tier benefits — sectioned list per the brand poster, with
            big Peachii lines like "Birthday drink" / "Free monthly". */}
        <SafeBoundary name="account-tier-benefits">
          {tier && tier.tier_benefits && tier.tier_benefits.length > 0 ? (
            <View>
              <Pressable
                onPress={() => router.push("/rewards")}
                style={{
                  flexDirection: "row",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  marginTop: 8,
                  marginBottom: 8,
                }}
              >
                <Text
                  style={{
                    color: "#1A0200",
                    fontFamily: "SpaceGrotesk_700Bold",
                    fontSize: 10,
                    letterSpacing: 2.5,
                  }}
                >
                  {ts.displayName} BENEFITS
                </Text>
                <Text
                  style={{
                    color: "#C05040",
                    fontFamily: "Peachi-Bold",
                    fontSize: 12,
                  }}
                >
                  See all
                </Text>
              </Pressable>
              {tier.tier_benefits.slice(0, 3).map((b, i) => (
                <View key={i} style={{ paddingVertical: 8 }}>
                  <Text
                    style={{
                      color: "#1A0200",
                      fontFamily: "SpaceGrotesk_500Medium",
                      fontSize: 16,
                      letterSpacing: 0.1,
                    }}
                  >
                    {b}
                  </Text>
                </View>
              ))}
              <View
                style={{
                  height: 1,
                  backgroundColor: "rgba(26, 2, 0, 0.12)",
                  marginTop: 18,
                  marginBottom: 8,
                }}
              />
            </View>
          ) : null}
        </SafeBoundary>

        {/* Action rows — same big-Peachii-on-cream rhythm. No card
            chrome, just the row label + chevron, divider after the
            block. Matches the brand poster's "WAZE / GOOGLE MAPS"
            address block aesthetic. */}
        <Text
          style={{
            color: "#1A0200",
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 10,
            letterSpacing: 2.5,
            marginTop: 16,
            marginBottom: 8,
          }}
        >
          ACCOUNT
        </Text>
        <ActionRow
          icon={ShoppingBag}
          label="My orders"
          onPress={() => router.push("/orders")}
        />
        {/* Support / Privacy / Delete moved into a dedicated Settings
            sub-screen — they're low-frequency and the wall of rows
            made the signed-in profile feel like an admin panel. */}
        <ActionRow
          icon={SettingsIcon}
          label="Settings"
          onPress={() => router.push("/settings")}
        />

        <View
          style={{
            height: 1,
            backgroundColor: "rgba(26, 2, 0, 0.12)",
            marginTop: 18,
            marginBottom: 8,
          }}
        />

        <Pressable
          onPress={() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            onSignOut();
          }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingVertical: 14,
            gap: 14,
          }}
          className="active:opacity-70"
        >
          <LogOut size={20} color="#C05040" />
          <Text
            style={{
              color: "#C05040",
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 16,
              letterSpacing: 0.1,
              flex: 1,
            }}
          >
            Sign out
          </Text>
        </Pressable>
      </ScrollView>

      <BottomNav />

      <ProfileEditModal
        visible={editing}
        member={member}
        phone={phone}
        onClose={() => setEditing(false)}
      />
    </View>
  );
}

function ActionRow({
  icon: Icon,
  label,
  onPress,
}: {
  icon: any;
  label: string;
  onPress: () => void;
  isFirst?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="active:opacity-70"
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 14,
        gap: 14,
      }}
    >
      <Icon size={20} color="#1A0200" strokeWidth={1.5} />
      <Text
        style={{
          color: "#1A0200",
          // Functional menu rows — Space Grotesk Medium per the brand
          // poster's address-block treatment ("Persiaran Korporat...").
          fontFamily: "SpaceGrotesk_500Medium",
          fontSize: 16,
          letterSpacing: 0.1,
          flex: 1,
        }}
      >
        {label}
      </Text>
      <ChevronRight size={18} color="rgba(26, 2, 0, 0.35)" />
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="items-center" style={{ flex: 1 }}>
      <Text
        style={{
          color: "#FFFFFF",
          fontFamily: "Peachi-Bold",
          fontSize: 22,
          letterSpacing: 0.3,
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          // Bumped 0.55 → 0.72 — 9pt uppercase eyebrows need more contrast
          // than body text. Below 0.65 they read as decorative noise.
          color: "rgba(255,255,255,0.72)",
          fontFamily: "SpaceGrotesk_700Bold",
          fontSize: 9,
          letterSpacing: 2,
          textTransform: "uppercase",
          marginTop: 4,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function ProfileEditModal({
  visible,
  member,
  phone,
  onClose,
}: {
  visible: boolean;
  member: ReturnType<typeof useApp.getState>["member"];
  phone: string;
  onClose: () => void;
}) {
  const setMember = useApp((s) => s.setMember);
  const [name, setName] = useState(member?.name ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [birthday, setBirthday] = useState(member?.birthday ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(member?.name ?? "");
    setEmail(member?.email ?? "");
    setBirthday(member?.birthday ?? "");
  }, [member, visible]);

  const save = async () => {
    if (!member?.id) {
      Alert.alert("Sign in first", "Please verify your phone first.");
      return;
    }
    setSaving(true);
    try {
      await api.updateProfile({
        member_id: member.id,
        phone,
        name: name.trim() || undefined,
        email: email.trim() || undefined,
        birthday: birthday.trim() || undefined,
      });
      setMember({
        ...member,
        name: name.trim() || null,
        email: email.trim() || null,
        birthday: birthday.trim() || null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message ?? "Try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View className="flex-1 bg-background">
        <View className="flex-row items-center justify-between p-4 border-b border-border">
          <Pressable onPress={onClose} hitSlop={12}>
            <X size={20} color="#160800" />
          </Pressable>
          <Text
            className="text-espresso text-base"
            style={{ fontFamily: "Peachi-Bold" }}
          >
            Edit profile
          </Text>
          <View style={{ width: 20 }} />
        </View>

        <View className="p-5 gap-4">
          <View>
            <Text
              className="text-muted-fg text-[11px] tracking-widest uppercase mb-1"
              style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}
            >
              Name
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="What should we call you?"
              placeholderTextColor="#8E8E93"
              className="bg-surface border border-border rounded-2xl px-4 py-3 text-espresso text-base"
              style={{ fontFamily: "SpaceGrotesk_500Medium" }}
              autoCapitalize="words"
            />
          </View>
          <View>
            <Text
              className="text-muted-fg text-[11px] tracking-widest uppercase mb-1"
              style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}
            >
              Email
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#8E8E93"
              keyboardType="email-address"
              autoCapitalize="none"
              className="bg-surface border border-border rounded-2xl px-4 py-3 text-espresso text-base"
              style={{ fontFamily: "SpaceGrotesk_500Medium" }}
            />
          </View>
          <View>
            <Text
              className="text-muted-fg text-[11px] tracking-widest uppercase mb-1"
              style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}
            >
              Birthday (YYYY-MM-DD)
            </Text>
            <TextInput
              value={birthday}
              onChangeText={setBirthday}
              placeholder="1990-01-31"
              placeholderTextColor="#8E8E93"
              className="bg-surface border border-border rounded-2xl px-4 py-3 text-espresso text-base"
              style={{ fontFamily: "SpaceGrotesk_500Medium" }}
            />
            <Text
              className="text-muted-fg text-[11px] mt-1"
              style={{ fontFamily: "SpaceGrotesk_400Regular" }}
            >
              We'll send you a treat on your special day.
            </Text>
          </View>

          <Pressable
            onPress={save}
            disabled={saving}
            className={`mt-4 rounded-full items-center justify-center ${
              saving ? "bg-espresso/40" : "bg-espresso active:opacity-80"
            }`}
            style={{ paddingVertical: 16 }}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text
                className="text-white text-base"
                style={{ fontFamily: "Peachi-Bold" }}
              >
                Save
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function NavRow({
  icon: Icon,
  label,
  onPress,
}: {
  icon: any;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="bg-surface rounded-2xl border border-border p-4 flex-row items-center gap-3 active:opacity-70"
    >
      <View className="w-9 h-9 rounded-lg bg-background items-center justify-center">
        <Icon size={18} color="#160800" strokeWidth={1.75} />
      </View>
      <Text
        className="text-espresso flex-1"
        style={{ fontFamily: "Peachi-Bold" }}
      >
        {label}
      </Text>
      <ChevronRight size={18} color="#8E8E93" />
    </Pressable>
  );
}

type Step = "phone" | "code";

function SignIn({ onVerified }: { onVerified: (phone: string) => void }) {
  const [step, setStep] = useState<Step>("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [code, setCode] = useState("");
  const [normalised, setNormalised] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After we send the OTP, count up so the "Didn't get it? Resend"
  // affordance only reveals once enough time has passed for SMS
  // delivery to plausibly have failed (~30s). Avoids triggering an
  // immediate retry loop that hammers our SMS provider's per-second
  // rate limit when customers thumb-tap "resend" twice.
  const [secondsSince, setSecondsSince] = useState(0);
  useEffect(() => {
    if (step !== "code") {
      setSecondsSince(0);
      return;
    }
    const id = setInterval(() => setSecondsSince((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [step]);

  // Live preview of the normalised number as the user types — turns
  // "0123456789" into "+60 12 345 6789" so they can see exactly which
  // number we'll text before they tap Send.
  const livePreview = (() => {
    const digits = phoneInput.replace(/\D/g, "");
    if (digits.length < 9) return null;
    const norm = normalisePhone(phoneInput);
    return norm.replace(/^(\+\d{2})(\d{2})(\d{3})(\d{4})$/, "$1 $2 $3 $4");
  })();

  const handleSend = async () => {
    if (!isValidLocalPhone(phoneInput)) {
      setError("Enter a valid Malaysian phone number");
      return;
    }
    setError(null);
    setLoading(true);
    const norm = normalisePhone(phoneInput);
    try {
      await api.sendOtp(norm);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNormalised(norm);
      setStep("code");
    } catch (e: any) {
      setError(e?.message ?? "Could not send code. Try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  // Reset to phone step with the same number pre-filled — used by the
  // "Use a different number" link on the code step. Different from the
  // simple Back arrow because we don't pre-fill on Back; from here the
  // customer is correcting a typo and needs the input editable.
  const handleChangeNumber = () => {
    Haptics.selectionAsync();
    setStep("phone");
    setCode("");
    setError(null);
  };

  const handleVerify = async () => {
    if (!normalised) return;
    if (code.length < 4) {
      setError("Enter the 6-digit code");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await api.verifyOtp(normalised, code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onVerified(normalised);
    } catch (e: any) {
      setError(e?.message ?? "Verification failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="bg-background"
    >
      <Stack.Screen options={{ headerShown: false }} />
      {/* showBack lets users escape the sign-in flow even when the keyboard
          is up and the bottom tab bar is offscreen. router.back() returns
          to wherever they came from (home / rewards), and we ensure home is
          always reachable via the "Continue browsing" link below too. */}
      <EspressoHeader title="Sign in" showCart={false} showBack />

      <View className="flex-1 px-5 pt-8">
        {step === "phone" ? (
          <>
            <View
              className="bg-primary/10 items-center justify-center mb-4"
              style={{ width: 64, height: 64, borderRadius: 32 }}
            >
              <Phone size={28} color="#C05040" strokeWidth={1.5} />
            </View>
            <Text
              className="text-espresso text-2xl"
              style={{ fontFamily: "Peachi-Bold" }}
            >
              What's your number?
            </Text>
            <Text
              className="text-muted-fg text-sm mt-1.5 mb-6"
              style={{ fontFamily: "SpaceGrotesk_400Regular" }}
            >
              We'll text you a 6-digit code to verify it's you.
            </Text>

            <View className="bg-surface rounded-2xl border border-border px-4 py-3 flex-row items-center gap-2">
              <Text
                className="text-muted-fg text-base"
                style={{ fontFamily: "SpaceGrotesk_500Medium" }}
              >
                +60
              </Text>
              <TextInput
                value={phoneInput.replace(/^(\+?60|0)/, "")}
                onChangeText={(t) => {
                  setPhoneInput(t);
                  if (error) setError(null);
                }}
                placeholder="12 345 6789"
                placeholderTextColor="#8E8E93"
                keyboardType="phone-pad"
                autoFocus
                className="flex-1 text-espresso text-base"
                style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                maxLength={11}
                accessibilityLabel="Phone number"
              />
            </View>
            {/* Show either the live preview (good state) or the error
                (bad state). They occupy the same vertical slot so the
                Send button doesn't shift when the user starts typing. */}
            <View style={{ minHeight: 18, marginTop: 8 }}>
              {error ? (
                <Text
                  className="text-primary text-xs px-1"
                  style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                >
                  {error}
                </Text>
              ) : livePreview ? (
                <Text
                  className="text-muted-fg text-xs px-1"
                  style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                >
                  We'll text {livePreview}
                </Text>
              ) : null}
            </View>

            <Pressable
              disabled={loading || !isValidLocalPhone(phoneInput)}
              onPress={handleSend}
              className={`mt-6 rounded-full items-center justify-center flex-row gap-2 ${
                loading || !isValidLocalPhone(phoneInput)
                  ? "bg-espresso/40"
                  : "bg-espresso active:opacity-80"
              }`}
              style={{ paddingVertical: 16 }}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text
                  className="text-white text-base"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  Text me the code
                </Text>
              )}
            </Pressable>

            {/* Escape hatch — guests should never be trapped in the OTP
                flow. Routes home regardless of nav stack state. */}
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                router.replace("/");
              }}
              className="mt-4 self-center active:opacity-60"
              hitSlop={12}
            >
              <Text
                className="text-muted-fg text-sm"
                style={{ fontFamily: "SpaceGrotesk_500Medium" }}
              >
                Continue browsing →
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={() => {
                setStep("phone");
                setCode("");
                setError(null);
              }}
              className="flex-row items-center gap-1 active:opacity-60 mb-4 -ml-1 self-start"
              hitSlop={12}
              accessibilityLabel="Back to phone number"
            >
              <ArrowLeft size={16} color="#6E6E73" />
              <Text
                className="text-muted-fg text-sm"
                style={{ fontFamily: "SpaceGrotesk_500Medium" }}
              >
                Back
              </Text>
            </Pressable>

            <Text
              className="text-espresso text-2xl"
              style={{ fontFamily: "Peachi-Bold" }}
            >
              Enter the code
            </Text>
            {/* Format the normalised phone for readability ("+60 12 345
                6789" vs "+60123456789"). Customers spot a typo faster
                in the spaced version. */}
            {(() => {
              const formatted = normalised
                ? normalised.replace(/^(\+\d{2})(\d{2})(\d{3})(\d{4})$/, "$1 $2 $3 $4")
                : null;
              return (
                <Text
                  className="text-muted-fg text-sm mt-1.5 mb-6"
                  style={{ fontFamily: "SpaceGrotesk_400Regular" }}
                >
                  Sent to{" "}
                  <Text style={{ fontFamily: "SpaceGrotesk_700Bold", color: "#1A0200" }}>
                    {formatted}
                  </Text>
                  . Should arrive in a few seconds.
                </Text>
              );
            })()}

            <View className="bg-surface rounded-2xl border border-border px-4 py-3">
              <TextInput
                value={code}
                onChangeText={(t) => {
                  setCode(t.replace(/\D/g, "").slice(0, 6));
                  if (error) setError(null);
                }}
                placeholder="••••••"
                placeholderTextColor="#C5C5C8"
                keyboardType="number-pad"
                autoFocus
                maxLength={6}
                textAlign="center"
                className="text-espresso text-2xl tracking-[8px]"
                style={{ fontFamily: "Peachi-Bold" }}
                accessibilityLabel="6-digit verification code"
                textContentType="oneTimeCode"
              />
            </View>
            {error && (
              <Text
                className="text-primary text-xs mt-2 px-1 text-center"
                style={{ fontFamily: "SpaceGrotesk_500Medium" }}
              >
                {error}
              </Text>
            )}

            <Pressable
              disabled={loading || code.length < 4}
              onPress={handleVerify}
              className={`mt-6 rounded-full items-center justify-center flex-row gap-2 ${
                loading || code.length < 4
                  ? "bg-espresso/40"
                  : "bg-espresso active:opacity-80"
              }`}
              style={{ paddingVertical: 16 }}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text
                  className="text-white text-base"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  Let me in
                </Text>
              )}
            </Pressable>

            {/* "Didn't get it?" stays muted until 30s have passed —
                stops customers from spamming our SMS provider in the
                first 5 seconds because the SMS is "slow". After 30s
                we surface Resend + Use a different number side-by-
                side so the right answer is obvious whether the issue
                is delivery (resend) or a typo (change number). */}
            <View
              className="flex-row items-center justify-center mt-4"
              style={{ gap: 16 }}
            >
              {secondsSince < 30 ? (
                <Text
                  className="text-muted-fg text-xs text-center"
                  style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                >
                  {`Didn't get it? You can resend in ${30 - secondsSince}s`}
                </Text>
              ) : (
                <>
                  <Pressable
                    onPress={handleSend}
                    disabled={loading}
                    className="active:opacity-60"
                    hitSlop={12}
                    accessibilityLabel="Resend verification code"
                  >
                    <Text
                      className="text-primary text-sm"
                      style={{ fontFamily: "SpaceGrotesk_700Bold" }}
                    >
                      Resend code
                    </Text>
                  </Pressable>
                  <Text
                    className="text-muted-fg text-sm"
                    style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                  >
                    ·
                  </Text>
                  <Pressable
                    onPress={handleChangeNumber}
                    disabled={loading}
                    className="active:opacity-60"
                    hitSlop={12}
                    accessibilityLabel="Use a different phone number"
                  >
                    <Text
                      className="text-primary text-sm"
                      style={{ fontFamily: "SpaceGrotesk_700Bold" }}
                    >
                      Use a different number
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          </>
        )}
      </View>

      <BottomNav />
    </KeyboardAvoidingView>
  );
}
