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
} from "react-native";
import { Alert } from "@/lib/alert";
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
  Star,
  Coffee,
  CircleHelp,
  Shield,
  Trash2,
  Sparkles,
  Gift,
} from "lucide-react-native";
import QRCode from "react-native-qrcode-svg";
import * as Haptics from "@/lib/haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView } from "react-native";
import { EspressoHeader } from "../components/EspressoHeader";
import { BottomNav } from "../components/BottomNav";
import { TierCardCarousel, type TierLite } from "../components/TierCardCarousel";
import { useApp } from "../lib/store";
import { api } from "../lib/api";
import { fetchMember, fetchRewards, fetchTier, type MemberTier } from "../lib/rewards";
import { supabase } from "../lib/supabase";
import { deregisterPush } from "../lib/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CelsiusLoader } from "../components/CelsiusLoader";
import { TierCardSkeleton } from "../components/TierCardSkeleton";

/** ISO YYYY-MM-DD → display DD/MM/YYYY. Empty/invalid in → empty out. */
function isoToDMY(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** Display DD/MM/YYYY → ISO YYYY-MM-DD. Returns null for empty or any
 *  shape that isn't a complete, calendar-valid date (e.g. 31/02/1990
 *  rejects since Feb has no 31st). The save flow treats null as
 *  "leave birthday unset" rather than surfacing a validation error —
 *  customers shouldn't be blocked from saving name + email because of
 *  a typo in a field they're allowed to leave blank. */
function dmyToIso(dmy: string): string | null {
  const cleaned = dmy.trim();
  if (!cleaned) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(cleaned);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (yyyy < 1900 || yyyy > new Date().getUTCFullYear()) return null;
  if (mm < 1 || mm > 12) return null;
  const daysInMonth = new Date(yyyy, mm, 0).getDate();
  if (dd < 1 || dd > daysInMonth) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Live-format a DD/MM/YYYY input — strip non-digits, cap at 8, splice
 *  in slashes at positions 2 and 4. Lets the customer type 31011990
 *  and see 31/01/1990 emerge as they go without managing the cursor. */
function formatDMYAsType(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

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
  const signOutReset = useApp((s) => s.signOutReset);
  const queryClient = useQueryClient();

  const handleVerified = async (p: string) => {
    setPhone(p);
    try {
      const m = await fetchMember(p);
      setLoyaltyId(m?.id ?? null);
      if (m) {
        setMember({
          id: m.id,
          name: m.name,
          // The server now returns email + birthday from the
          // members table — earlier this hardcoded null, which
          // wiped any locally-saved value every time the member
          // fetch ran and made the "Complete profile" pill
          // reappear after the customer thought they were done.
          email: m.email ?? null,
          birthday: m.birthday ?? null,
          pointsBalance: m.pointsBalance,
          totalVisits: m.totalVisits,
          totalPointsEarned: m.totalPointsEarned,
        });
      }
    } catch {
      // Member doesn't exist yet — first order will create them server-side
    }
  };

  // Hard sign-out: wipe per-customer state, clear React Query cache
  // (rewards, tier, order-history are keyed by phone), and drop the
  // server's push-token row so the next user on this device doesn't
  // inherit the previous customer's data, vouchers, or push pings.
  const handleSignOut = () => {
    deregisterPush().catch(() => {});
    signOutReset();
    queryClient.clear();
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

  // Live points balance — the rewards endpoint is the source of truth
  // post-order. fetchMember() below caches member fields once on mount
  // and the cached pointsBalance ends up stale after the customer
  // earns/spends beans on a checkout. The TierCardCarousel pulled
  // member.pointsBalance straight, which is why the rewards tab and
  // the account tab disagreed by an order or two. Same React Query
  // key the Rewards screen + Home use, so the three surfaces now read
  // from a single cached value.
  const rewardsQ = useQuery({
    queryKey: ["rewards", phone ?? "anonymous"],
    queryFn: () => fetchRewards(phone),
    enabled: !!phone,
    staleTime: 60_000,
  });
  const livePoints = rewardsQ.data?.pointsBalance ?? member?.pointsBalance ?? 0;

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
          // Sourced from the API now so the local store stays in
          // sync with whatever the customer last saved on the
          // Edit Profile screen. Previously hardcoded to null
          // here, which clobbered freshly-saved values on the
          // next mount and forced the "Complete profile" pill to
          // reappear.
          email: m.email ?? null,
          birthday: m.birthday ?? null,
          pointsBalance: m.pointsBalance,
          totalVisits: m.totalVisits,
          totalPointsEarned: m.totalPointsEarned,
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // All tiers — drives the swipeable carousel. 5-min cache because the
  // tier ladder rarely changes; React Query keeps it warm across tabs.
  const allTiersQ = useQuery({
    queryKey: ["all-tiers"],
    queryFn: fetchAllTiers,
    staleTime: 5 * 60_000,
  });
  const allTiers = allTiersQ.data ?? [];

  const memberName = member?.name || "Add your name";
  // Format phone to "+60 10 933 5369" — visual breathing room.
  const formattedPhone = phone.replace(/^(\+\d{2})(\d{2})(\d{3})(\d{4})$/, "$1 $2 $3 $4");

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Standard espresso header (matches Orders / Rewards). The
          name + phone + tier moved out of the hero into a content
          card below so the visual language across tabs stays
          consistent. */}
      <EspressoHeader
        title="Account"
        showCart={false}
        rightSlot={
          // When any profile field (name / email / birthday) is still
          // missing, the edit button doubles as a CTA — labelled
          // "Complete profile" with a leading gift icon so the
          // customer reads it as "claim a perk" rather than "tedious
          // profile chore". Once all three are filled in, the pill
          // collapses back to the bare pencil icon.
          (!member?.birthday || !member?.email || !member?.name) ? (
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setEditing(true);
              }}
              hitSlop={10}
              accessibilityLabel="Complete your profile to unlock rewards"
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: "rgba(255,255,255,0.14)",
              }}
              className="active:opacity-70"
            >
              <Gift size={14} color="#FBBF24" strokeWidth={2.2} />
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_700Bold",
                  fontSize: 11,
                  color: "#FFFFFF",
                  letterSpacing: 0.3,
                }}
              >
                Complete profile
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setEditing(true);
              }}
              hitSlop={10}
              className="p-1 active:opacity-70"
            >
              <Pencil size={18} color="#FFFFFF" />
            </Pressable>
          )
        }
      />

      <ScrollView
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 160 }}
      >
        {/* Membership tier carousel — same TierCardCarousel that powers
            the legacy /tier-benefits screen. The customer's current
            tier is auto-scrolled into view, embedded stats (Points /
            Visits / Earned) render on that card only, and the page
            indicator dots underneath signal swipability. */}
        <Text
          style={{
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 11,
            letterSpacing: 2,
            color: "rgba(26,2,0,0.55)",
            paddingHorizontal: 16,
            marginBottom: 8,
            textTransform: "uppercase",
          }}
        >
          Membership tiers
        </Text>
        <View style={{ marginBottom: 18 }}>
          {/* Show a layout-shaped skeleton until BOTH the tier ladder
              AND the customer's current-tier row have arrived. Without
              this gate the carousel would render with the base tier
              briefly visible, then snap to the real tier card when
              tierQ resolves — reads as a glitch. Skeleton holds the
              same shape as the real card so the swap is silent. */}
          {(allTiersQ.isLoading || (tierQ.isLoading && !tierQ.data)) ? (
            <TierCardSkeleton />
          ) : (
            <TierCardCarousel
              tiers={allTiers}
              currentSlug={tier?.tier_slug ?? null}
              memberVisits={tier?.visits_this_period ?? 0}
              memberSpend={tier?.spend_this_period ?? 0}
              quarterEnd={tier?.quarter_end ?? null}
              stats={{
                points: livePoints,
                visits: member?.totalVisits ?? 0,
                earned: member?.totalPointsEarned ?? 0,
              }}
            />
          )}
        </View>

        {/* Action rows are inset 16 horizontal to match the previous
            layout; the carousel above intentionally bleeds edge-to-edge
            so its cards feel premium. */}
        <View style={{ paddingHorizontal: 16 }}>

        {/* Action rows — same big-Peachii-on-cream rhythm. Grouped
            into sections so the page reads as labelled blocks rather
            than one long undifferentiated list. The legacy
            "Membership benefits" row pointed at /tier-benefits which
            had its own ladder UI; that's redundant now that the
            TierCardCarousel above exposes every tier inline. */}

        <SectionLabel>ACCOUNT</SectionLabel>
        <ActionRow
          icon={ShoppingBag}
          label="Order history"
          onPress={() => router.push("/orders")}
        />
        <ActionRow
          icon={Coffee}
          label="Your usual drinks"
          onPress={() => router.push({ pathname: "/menu", params: { tab: "usual" } })}
        />
        <ActionRow
          icon={Sparkles}
          label={`Coffee Wrapped ${new Date().getFullYear()}`}
          onPress={() => router.push("/wrapped" as never)}
        />

        <SectionLabel>PREFERENCES</SectionLabel>
        <ActionRow
          icon={SettingsIcon}
          label="Settings"
          onPress={() => router.push("/settings")}
        />

        <SectionLabel>ABOUT</SectionLabel>
        <ActionRow
          icon={CircleHelp}
          label="Help & support"
          onPress={() => router.push("/support")}
        />
        <ActionRow
          icon={Shield}
          label="Privacy policy"
          onPress={() => router.push("/privacy")}
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
          <LogOut size={20} color="#A2492C" />
          <Text
            style={{
              color: "#A2492C",
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 16,
              letterSpacing: 0.1,
              flex: 1,
            }}
          >
            Sign out
          </Text>
        </Pressable>

        <Pressable
          onPress={() => router.push("/account-delete")}
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingVertical: 14,
            gap: 14,
          }}
          className="active:opacity-70"
        >
          <Trash2 size={20} color="rgba(26,2,0,0.55)" />
          <Text
            style={{
              color: "rgba(26,2,0,0.55)",
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 14,
              flex: 1,
            }}
          >
            Delete account
          </Text>
        </Pressable>
        </View>
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

// Tiers come from the DB so any backoffice change (rename, add, drop)
// flows into the carousel without a redeploy. Source of truth lives in
// public.tiers — the same table the loyalty app's evaluator reads.
async function fetchAllTiers(): Promise<TierLite[]> {
  const { data, error } = await supabase
    .from("tiers")
    .select("id,slug,name,min_visits,min_spend,multiplier,color,icon,benefits,benefit_rules,qualification_metric,sort_order,discount_percent,stackable,invitation_only")
    .eq("brand_id", "brand-celsius")
    .eq("is_active", true)
    .order("sort_order", { ascending: true, nullsFirst: true });
  if (error) throw error;
  return (data ?? []) as TierLite[];
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

/* ────────────────────────────────────────────────────────────────────────── */
/* Identity card — espresso panel with QR for cashier lookup at the counter.  */
/* ────────────────────────────────────────────────────────────────────────── */

function IdentityCard({
  memberId,
  name,
  phone,
  tierName,
  tierColor,
  tierMultiplier,
}: {
  memberId:       string | null;
  name:           string;
  phone:          string;
  tierName:       string | null;
  tierColor:      string;
  tierMultiplier: number | null;
}) {
  // Payload encoded in the QR. Custom URI scheme so the POS scanner
  // can quickly distinguish a member QR from any other code. The
  // member_id is the loyalty ID — POS swaps in `customer-lookup`
  // for the phone-based search once QR scan input lands on the
  // staff register.
  const qrValue = memberId ? `celsius:member:${memberId}` : "";

  return (
    <View
      style={{
        backgroundColor: "#160800",
        borderRadius: 20,
        padding: 18,
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        shadowColor: "#000",
        shadowOpacity: 0.15,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 4,
      }}
    >
      {/* Left column — identity text + tier pill */}
      <View style={{ flex: 1 }}>
        {tierName ? (
          <View
            className="flex-row items-center self-start"
            style={{
              backgroundColor: "rgba(255,255,255,0.08)",
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 6,
              gap: 5,
            }}
          >
            <Star size={11} color={tierColor} fill={tierColor} />
            <Text
              style={{
                color: tierColor,
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 10,
                letterSpacing: 1.4,
              }}
              numberOfLines={1}
            >
              {tierName.toUpperCase()}
              {tierMultiplier ? ` · ${formatMultiplier(tierMultiplier)}×` : ""}
            </Text>
          </View>
        ) : null}

        <Text
          numberOfLines={1}
          style={{
            color: "#FFFFFF",
            fontFamily: "Peachi-Bold",
            fontSize: 22,
            lineHeight: 26,
            marginTop: 10,
          }}
        >
          {name}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            color: "rgba(255,255,255,0.55)",
            fontFamily: "SpaceGrotesk_400Regular",
            fontSize: 12,
            marginTop: 2,
          }}
        >
          {phone}
        </Text>

        <Text
          style={{
            color: "rgba(255,255,255,0.45)",
            fontFamily: "SpaceGrotesk_500Medium",
            fontSize: 10.5,
            letterSpacing: 1,
            marginTop: 14,
            textTransform: "uppercase",
          }}
        >
          Show at the counter
        </Text>
      </View>

      {/* Right column — QR code on a white tile so the camera reads
          high contrast. Falls back to a "Sign in" placeholder when
          memberId isn't resolved yet (shouldn't happen in SignedIn
          but defensive). */}
      <View
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 10,
          padding: 8,
        }}
      >
        {qrValue ? (
          <QRCode
            value={qrValue}
            size={88}
            color="#160800"
            backgroundColor="#FFFFFF"
          />
        ) : (
          <View style={{ width: 88, height: 88, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "rgba(0,0,0,0.4)", fontSize: 10, textAlign: "center" }}>
              Sign in to show QR
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function formatMultiplier(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/* Section label for action-row groups. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        color: "#1A0200",
        fontFamily: "SpaceGrotesk_700Bold",
        fontSize: 10,
        letterSpacing: 2.5,
        marginTop: 20,
        marginBottom: 4,
      }}
    >
      {children}
    </Text>
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
  // Modal `presentationStyle="pageSheet"` is iOS-only — on Android the
  // sheet covers the full screen including the status bar, which pushes
  // the X close button under the system bar and makes it unhittable.
  // Pad the top by the safe-area inset so the header always sits below
  // the status bar regardless of platform.
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(member?.name ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  // Birthday is shown to the customer as DD/MM/YYYY (MY convention) but
  // persisted as ISO YYYY-MM-DD in member.birthday. Convert at the
  // display boundary, auto-format the slashes as the user types.
  const [birthday, setBirthday] = useState(isoToDMY(member?.birthday));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(member?.name ?? "");
    setEmail(member?.email ?? "");
    setBirthday(isoToDMY(member?.birthday));
  }, [member, visible]);

  const save = async () => {
    if (!member?.id) {
      Alert.alert("Sign in first", "Please verify your phone first.");
      return;
    }
    // Validate DD/MM/YYYY → ISO. Empty is fine (user can clear the
    // birthday); a partial entry is treated as not-set rather than an
    // error so the customer can save name/email even if they typed a
    // wrong digit in birthday and gave up. A fully entered but
    // invalid date (e.g. 31/02/1990) becomes null too — server side
    // tolerates null.
    const birthdayIso = dmyToIso(birthday);
    setSaving(true);
    try {
      await api.updateProfile({
        member_id: member.id,
        phone,
        name: name.trim() || undefined,
        email: email.trim() || undefined,
        birthday: birthdayIso ?? undefined,
      });
      setMember({
        ...member,
        name: name.trim() || null,
        email: email.trim() || null,
        birthday: birthdayIso,
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
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
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
              Birthday (DD/MM/YYYY)
            </Text>
            <TextInput
              value={birthday}
              onChangeText={(raw) => setBirthday(formatDMYAsType(raw))}
              placeholder="31/01/1990"
              placeholderTextColor="#8E8E93"
              keyboardType="number-pad"
              maxLength={10}
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
              <View className="flex-row items-center justify-center" style={{ gap: 10 }}>
                <ActivityIndicator color="#FFFFFF" />
                <Text className="text-white text-base" style={{ fontFamily: "Peachi-Bold" }}>
                  Saving…
                </Text>
              </View>
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
  const [referralCode, setReferralCode] = useState(""); // optional — only sent post-verify
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
      // Optional referral attribution — best-effort, doesn't block sign-in.
      // The session JWT is set by verifyOtp so the attribute endpoint can
      // resolve the new member's id from the Bearer header.
      const ref = referralCode.trim().toUpperCase();
      if (ref) {
        try {
          const { submitReferralCode } = await import("../lib/rewards-v2");
          await submitReferralCode(ref);
        } catch { /* silent — invalid codes just don't attribute */ }
      }
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
              <Phone size={28} color="#A2492C" strokeWidth={1.5} />
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

            {/* Phone input row. Both attempts at matching heights /
                lineHeights failed on iOS because TextInput reports its
                vertical metrics differently than Text. Instead of
                fighting the platform, we now treat the "+60" as just
                another span of typed text by rendering it inside an
                absolutely-positioned overlay aligned to the start of
                the input, then padding the TextInput's leading edge so
                the typed digits start exactly where the +60 ends.
                This way both characters use the SAME TextInput-style
                rendering and metrics on both platforms. */}
            <View
              className="bg-surface rounded-2xl border border-border px-4 flex-row items-center"
              style={{ height: 56, position: "relative" }}
            >
              <Text
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: 16,
                  top: 0,
                  bottom: 0,
                  textAlignVertical: "center",
                  includeFontPadding: false,
                  fontFamily: "SpaceGrotesk_500Medium",
                  fontSize: 16,
                  lineHeight: 56,
                  color: "#8E8E93",
                }}
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
                style={{
                  flex: 1,
                  // Push the cursor + typed digits past the +60 overlay
                  // (~36px = "+60" glyph + 8px gap).
                  paddingLeft: 36,
                  paddingTop: 0,
                  paddingBottom: 0,
                  height: 56,
                  fontFamily: "SpaceGrotesk_500Medium",
                  fontSize: 16,
                  color: "#160800",
                  includeFontPadding: false,
                  textAlignVertical: "center",
                }}
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
                <View className="flex-row items-center justify-center" style={{ gap: 10 }}>
                  <ActivityIndicator color="#FFFFFF" />
                  <Text className="text-white text-base" style={{ fontFamily: "Peachi-Bold" }}>
                    Sending code…
                  </Text>
                </View>
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

            {/* Optional referral code — only attributes on first sign-in.
                Customers who used a code see both sides land a free drink
                voucher after their first paid order. */}
            <View className="mt-4">
              <Text
                className="text-muted-fg text-[10px] uppercase tracking-widest mb-1.5"
                style={{ fontFamily: "SpaceGrotesk_700Bold" }}
              >
                Have a referral code? (optional)
              </Text>
              <TextInput
                value={referralCode}
                onChangeText={(t) => setReferralCode(t.toUpperCase().replace(/\s/g, "").slice(0, 12))}
                placeholder="e.g. CCABCD"
                placeholderTextColor="#C5C5C8"
                autoCapitalize="characters"
                className="text-espresso text-base"
                style={{
                  fontFamily: "Peachi-Bold",
                  letterSpacing: 3,
                  textAlign: "center",
                  borderWidth: 1,
                  borderColor: "rgba(26,2,0,0.10)",
                  borderRadius: 12,
                  paddingVertical: 12,
                  backgroundColor: "#FFFFFF",
                }}
              />
            </View>

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
                <View className="flex-row items-center justify-center" style={{ gap: 10 }}>
                  <ActivityIndicator color="#FFFFFF" />
                  <Text className="text-white text-base" style={{ fontFamily: "Peachi-Bold" }}>
                    Checking code…
                  </Text>
                </View>
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
