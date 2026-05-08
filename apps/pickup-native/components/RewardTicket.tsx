import { View, Text, Pressable, Image } from "react-native";
import * as Haptics from "expo-haptics";
import { Gift } from "lucide-react-native";
import { rewardUrgencyLabel, type Reward } from "../lib/rewards";

type Props = {
  reward: Reward;
  onPress?: () => void;
  /** Optional accent override — auto-issued (welcome/birthday) get gold;
   *  everything else gets terracotta. */
  accent?: "terracotta" | "gold";
};

/**
 * Ticket-stub reward card for the home "Available rewards" strip.
 *
 * Replaces the prior image-led 16:9 card. The image-led design forced
 * a fallback gift icon for every reward without photography, which made
 * cards look interchangeable — customers couldn't tell BOGO from RM5
 * off from a free drink at a glance. The ticket aesthetic puts the
 * VALUE on top in big Peachii ("Buy 1 Free 1", "RM 5 off"), name and
 * cost beneath a perforated separator. Maps to the brand book's
 * poster/coupon sensibility.
 *
 * Auto-issued rewards (welcome BOGO, birthday) get a gold accent —
 * makes "this is yours, free" visually distinct from "spend your points
 * on this".
 */
export function RewardTicket({ reward, onPress, accent }: Props) {
  // Accent default: gold for free-to-claim rewards, terracotta otherwise.
  const isFree = reward.points_required === 0;
  const tone = accent ?? (isFree ? "gold" : "terracotta");

  const topBg = tone === "gold" ? "#1A0200" : "#C05040";
  const topAccent = tone === "gold" ? "#FBBF24" : "#FFFFFF";
  const topMuted = tone === "gold" ? "rgba(251,191,36,0.65)" : "rgba(255,255,255,0.75)";

  const { eyebrow, headline, sub } = describeReward(reward);
  const urgency = rewardUrgencyLabel(reward);

  return (
    <Pressable
      onPress={() => {
        if (!onPress) return;
        Haptics.selectionAsync();
        onPress();
      }}
      className="active:opacity-80"
      style={{
        width: 144,
        borderRadius: 14,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      }}
      accessibilityRole="button"
      accessibilityLabel={`${headline}. ${reward.name}. ${sub}`}
    >
      {/* Top "stub" — value in big Peachii. Eyebrow caps above tells
          the customer the type at a glance ("BOGO" / "DISCOUNT" /
          "GIFT"). Urgency pill floats top-right when relevant. */}
      <View style={{ backgroundColor: topBg, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 14, minHeight: 92 }}>
        {/* Celsius cup mark anchored bottom-right of the top stub —
            same brand-anchor pattern Zus uses on its home tiles. Sits
            below the headline so it doesn't compete with the value
            ("Buy 1 Free 1") but reads as identity at a glance. */}
        <Image
          source={require("../assets/icon.png")}
          style={{
            position: "absolute",
            right: -6,
            bottom: -6,
            width: 44,
            height: 44,
            borderRadius: 8,
            opacity: 0.85,
          }}
          resizeMode="cover"
        />
        <View className="flex-row items-center justify-between">
          <Text
            style={{
              color: topMuted,
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 9,
              letterSpacing: 1.6,
              textTransform: "uppercase",
            }}
          >
            {eyebrow}
          </Text>
          {tone === "gold" && (
            <Gift size={12} color={topAccent} strokeWidth={2} />
          )}
        </View>
        <Text
          style={{
            color: topAccent,
            fontFamily: "Peachi-Bold",
            fontSize: 19,
            lineHeight: 21,
            marginTop: 5,
            paddingRight: 36,
          }}
          numberOfLines={2}
        >
          {headline}
        </Text>
        {urgency && (
          <View
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              backgroundColor: tone === "gold" ? "#FBBF24" : "#FFFFFF",
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 999,
            }}
          >
            <Text
              style={{
                color: tone === "gold" ? "#1A0200" : "#C05040",
                fontFamily: "Peachi-Bold",
                fontSize: 9,
              }}
            >
              {urgency}
            </Text>
          </View>
        )}
      </View>

      {/* Perforated separator — half-circle "punches" on each edge so
          the bottom section reads as a tear-off stub. Achieved with two
          absolutely-positioned circles overlapping the divider line. */}
      <View style={{ position: "relative", height: 0 }}>
        <View
          style={{
            position: "absolute",
            left: -7,
            top: -7,
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: "#FFFFFF",
          }}
        />
        <View
          style={{
            position: "absolute",
            right: -7,
            top: -7,
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: "#FFFFFF",
          }}
        />
        {/* Dotted line connecting the punches. Chunky enough to read
            on small thumbnails, subtle enough not to scream. */}
        <View
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            top: -1,
            height: 2,
            borderTopWidth: 1,
            borderTopColor: "rgba(26, 2, 0, 0.18)",
            borderStyle: "dashed",
          }}
        />
      </View>

      {/* Bottom "stub" — reward name + cost. White on subtle border,
          name in Peachi-Bold, cost in small caps Space Grotesk. */}
      <View style={{ backgroundColor: "#FFFFFF", paddingHorizontal: 12, paddingTop: 13, paddingBottom: 10, borderWidth: 1, borderTopWidth: 0, borderColor: "rgba(26, 2, 0, 0.10)" }}>
        <Text
          style={{ color: "#1A0200", fontFamily: "Peachi-Bold", fontSize: 12 }}
          numberOfLines={1}
        >
          {reward.name}
        </Text>
        <Text
          style={{
            color: tone === "gold" ? "#C05040" : "rgba(26, 2, 0, 0.55)",
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 10,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            marginTop: 4,
          }}
          numberOfLines={1}
        >
          {sub}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Map a reward shape to the eyebrow/headline/sub triple the ticket
 * displays. Ordering matches the loyalty engine's discount_type union;
 * each branch picks the most concrete value to communicate ("RM 5 off"
 * is more useful than "Discount").
 */
function describeReward(r: Reward): { eyebrow: string; headline: string; sub: string } {
  const isFree = r.points_required === 0;
  const sub = isFree ? "Free to claim" : `${r.points_required} pts`;

  // Auto-issued / new-member / birthday — call out the gift framing
  if ((r as { reward_type?: string }).reward_type === "new_member") {
    return { eyebrow: "Welcome gift", headline: "Buy 1\nFree 1", sub };
  }
  if ((r as { reward_type?: string }).reward_type === "birthday") {
    return { eyebrow: "Birthday gift", headline: "Free drink", sub };
  }

  // Discount-type-driven
  switch (r.discount_type) {
    case "bogo": {
      const buy = r.bogo_buy_qty ?? 1;
      const free = r.bogo_free_qty ?? 1;
      return {
        eyebrow: "Buy & free",
        headline: buy === 1 && free === 1 ? "Buy 1\nFree 1" : `Buy ${buy}\nFree ${free}`,
        sub,
      };
    }
    case "free_item":
      return {
        eyebrow: "On us",
        headline: r.free_product_name ? `Free\n${r.free_product_name}` : "Free drink",
        sub,
      };
    case "percentage":
    case "percent":
      return {
        eyebrow: "Discount",
        headline: r.discount_value ? `${Math.round(r.discount_value)}%\noff` : "Discount",
        sub,
      };
    case "flat":
    case "fixed_amount": {
      // `flat` is stored in cents (DB convention); `fixed_amount` is
      // already in ringgit. Mirrors formatRewardValue() in lib/rewards.
      const raw = r.discount_value ?? 0;
      const value = r.discount_type === "flat" ? raw / 100 : raw;
      const formatted = value.toFixed(2).replace(/\.00$/, "");
      return {
        eyebrow: "Discount",
        headline: raw ? `RM ${formatted}\noff` : "Discount",
        sub,
      };
    }
    default: {
      // Last resort — surface name parsing if backoffice didn't set
      // discount_type. Matches the heuristic the order-app proxy uses.
      const rmMatch = r.name.match(/RM\s*(\d+(?:\.\d+)?)/i);
      if (rmMatch) {
        return { eyebrow: "Discount", headline: `RM ${rmMatch[1]}\noff`, sub };
      }
      const pctMatch = r.name.match(/(\d+(?:\.\d+)?)\s*%/);
      if (pctMatch) {
        return { eyebrow: "Discount", headline: `${pctMatch[1]}%\noff`, sub };
      }
      return { eyebrow: "Reward", headline: r.name, sub };
    }
  }
}
