import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  Animated,
  Easing,
  Platform,
} from "react-native";
import { Alert } from "@/lib/alert";
// TextInput stays imported — it's still used by the phone / OTP entry steps.
import { Stack, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Check,
  AlertCircle,
  Coffee,
  MapPin,
  Clock,
  CalendarClock,
  ChevronDown,
} from "lucide-react-native";
import { OrderTypeBar } from "@/components/OrderTypeBar";
import { validateAppliedReward } from "@/lib/order-type";

// Customer-facing labels for each payment method. No provider names — the
// customer doesn't (and shouldn't) need to know whether their card runs
// through Stripe or whether TNG runs through Revenue Monster. The backoffice
// keeps that as an internal routing concern via payment_gateway_config.
const METHOD_LABELS: Record<string, string> = {
  card:       "Card",
  apple_pay:  "Apple Pay",
  google_pay: "Google Pay",
  fpx:        "FPX online banking",
  grabpay:    "GrabPay",
  tng:        "Touch ’n Go eWallet",
  boost:      "Boost",
  shopeepay:  "ShopeePay",
  duitnow:    "DuitNow QR",
  maybank_qr: "Maybank QR",
};

type GatewayMethod = {
  method_id: string;
  enabled: boolean;
  provider: "stripe" | "revenue_monster";
};
import * as Haptics from "@/lib/haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { RmCheckoutModal } from "../components/RmCheckoutModal";
import { useStripe } from "@/lib/stripe-shim";

// Remember the customer's last-used payment method so the next
// checkout starts with it pre-selected — Uber Eats-style "collapsed"
// feel without forcing them to re-pick every time.
const LAST_METHOD_KEY = "celsius:lastPaymentMethod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, type Outlet } from "../lib/supabase";
import { useApp, cartTotal, cartCount } from "../lib/store";
import { api, formatPrice } from "../lib/api";
import {
  calcRewardDiscount,
  fetchTier,
  fetchRewards,
  type MemberTier,
  type EvaluatedCart,
} from "../lib/rewards";
import { useEvaluatePromotions } from "../lib/use-evaluate-promotions";
import { getSetting } from "../lib/settings";
import { useMaybankQrConfig, maybankQrAvailableFor } from "../lib/maybank-qr";
import { showToast } from "../lib/toast";
import { trackEvent } from "../lib/analytics";
import { EspressoHeader } from "../components/EspressoHeader";
import { PrimaryButton } from "../components/PrimaryButton";
import { FpxBankPicker } from "../components/FpxBankPicker";
import { FPX_BANKS } from "../lib/fpx-banks";
import { BankChip } from "../components/BankChip";
import { PaymentBrandIcon } from "../components/PaymentBrandIcon";
import { BottomSheet } from "../components/BottomSheet";

type Step = "phone" | "otp" | "review";

// One row of the grouped payment-method picker. Radio on the left, title +
// optional subtitle in the middle, brand icon on the right, optional
// chevron for categories that expand into a sub-picker. Lives in this
// file because it only ever appears here and its visual rules are
// specific to the checkout chrome.
function CategoryRow({
  selected,
  onPress,
  title,
  subtitle,
  iconMethodId,
  iconNode,
  expandable = false,
  expanded = false,
  hasDivider = false,
}: {
  selected:      boolean;
  onPress:       () => void;
  title:         string;
  subtitle?:     string;
  iconMethodId:  string;
  // Override the methodId-based icon with a custom node — used when the
  // chip needs to reflect a sub-selection that isn't a method id (e.g. a
  // specific FPX bank picked under Online Banking).
  iconNode?:     React.ReactNode;
  expandable?:   boolean;
  expanded?:     boolean;
  hasDivider?:   boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-3 px-4 py-4 active:bg-background ${
        hasDivider ? "border-t border-border" : ""
      }`}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          borderWidth: 2,
          borderColor: selected ? "#A2492C" : "#D6CCC2",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: selected ? "#A2492C" : "transparent",
        }}
      >
        {selected && (
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFFFFF" }} />
        )}
      </View>
      <View className="flex-1">
        <Text className="text-espresso font-bold text-[15px]">{title}</Text>
        {subtitle && (
          <Text
            className="text-muted-fg text-[12px] mt-0.5"
            style={{ fontFamily: "SpaceGrotesk_500Medium" }}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {iconNode ?? <PaymentBrandIcon methodId={iconMethodId} size={36} />}
      {/* Always reserve the chevron column — invisible on non-expandable
          rows — so the brand icons line up vertically across every row.
          Without this the right edge "shifts" between expandable and
          non-expandable categories. */}
      <View style={{ width: 16, alignItems: "center", justifyContent: "center" }}>
        {expandable && (
          <ChevronDown
            size={16}
            color="#8E8E93"
            style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
          />
        )}
      </View>
    </Pressable>
  );
}

export default function Checkout() {
  const insets = useSafeAreaInsets();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const cart = useApp((s) => s.cart);
  const outletId = useApp((s) => s.outletId);
  const outletName = useApp((s) => s.outletName);
  const phoneFromStore = useApp((s) => s.phone);
  const setPhone = useApp((s) => s.setPhone);
  const clearCart = useApp((s) => s.clearCart);
  const setReservedVoucher = useApp((s) => s.setReservedVoucher);
  const appliedReward = useApp((s) => s.appliedReward);
  const setAppliedReward = useApp((s) => s.setAppliedReward);
  const loyaltyId = useApp((s) => s.loyaltyId);
  const orderType = useApp((s) => s.orderType);
  const tableNumber = useApp((s) => s.tableNumber);
  const isDineIn = orderType === "dine_in";
  const queryClient = useQueryClient();

  // SST is config-driven via /api/settings?key=sst — admin can toggle/adjust
  // from backoffice without redeploy.
  const [sstConfig, setSstConfig] = useState({ rate: 0.06, enabled: true });
  const [paymentsEnabled, setPaymentsEnabled] = useState(true);
  // Payment methods + per-method provider routing, fetched once from the
  // backoffice config. Empty until the gateway-config API responds, which
  // is also what we treat as "still loading" for the payment tile section.
  const [gatewayMethods, setGatewayMethods] = useState<GatewayMethod[]>([]);
  const [tier, setTier] = useState<MemberTier | null>(null);
  // Backoffice-managed Maybank static QR config (live via realtime).
  // Gates the "Maybank QR" tile + drives the per-outlet payload shown on
  // the post-checkout scan-to-pay screen.
  const maybankQrConfig = useMaybankQrConfig();
  const maybankQrAvail = maybankQrAvailableFor(maybankQrConfig, outletId);
  useEffect(() => {
    getSetting("sst").then(setSstConfig);
    // One round-trip to read both the global on/off and the per-method list.
    // The endpoint also collapses platform-irrelevant rows on our side
    // (Apple Pay hidden on Android, Google Pay hidden on iOS) so we don't
    // present a method the platform can't actually fulfil.
    fetch("https://order.celsiuscoffee.com/api/payments/gateway-config")
      .then((r) => r.json())
      .then((data: { paymentsEnabled: boolean; methods: GatewayMethod[] }) => {
        setPaymentsEnabled(data.paymentsEnabled);
        const platformOk = (id: string) => {
          if (id === "apple_pay") return Platform.OS === "ios";
          if (id === "google_pay") return Platform.OS === "android";
          return true;
        };
        const visible = data.methods.filter((m) => m.enabled && platformOk(m.method_id));
        setGatewayMethods(visible);
      })
      .catch(() => {
        // Network error before the first render — keep payments enabled so
        // the customer isn't blocked, but methods will stay empty until the
        // next mount. The Place Order button gates on a selected method so
        // we don't accidentally submit an order with no provider.
      });
  }, []);

  // Fetch tier whenever loyaltyId is known so we can show the points-earning
  // line with the right multiplier ("Gold member · earning 1.5× = 12 pts").
  useEffect(() => {
    if (!loyaltyId) {
      setTier(null);
      return;
    }
    fetchTier(loyaltyId).then(setTier).catch(() => setTier(null));
  }, [loyaltyId]);

  // ── Promotion preview ──────────────────────────────────────────────────
  // Discount engine eval — shared cache with the cart screen via
  // the useEvaluatePromotions hook. When the customer transitions
  // cart → checkout with an unchanged cart, the eval is instant
  // (hits the React Query cache) instead of firing a 600-900ms
  // network round-trip on the checkout side. Stale time = 30s, so
  // a fresh navigation always reuses the cart's just-fetched result.
  const promoEvalReady = !loyaltyId || !!tier;
  const { data: promoEval, isError: promoEvalError } = useEvaluatePromotions({
    memberTierId: tier?.tier_id ?? null,
    enabled: promoEvalReady,
  });
  // Surface a one-time toast when the engine is unreachable —
  // checkout still proceeds at full price.
  const promoErrorToastShown = useRef(false);
  useEffect(() => {
    if (promoEvalError && !promoErrorToastShown.current) {
      promoErrorToastShown.current = true;
      showToast({
        message: "Couldn't check for discounts. Pull to retry.",
        variant: "info",
      });
    } else if (!promoEvalError) {
      promoErrorToastShown.current = false;
    }
  }, [promoEvalError]);

  const promoDiscount = promoEval?.total_discount ?? 0;

  // Pull live outlet record so the pickup card shows status + ETA.
  // Polled every 30s while the checkout screen is mounted so the
  // customer doesn't commit to an outlet that closed mid-flow —
  // e.g. they took 4 min on payment selection and the outlet
  // shuttered for the night. refetchOnWindowFocus catches the
  // common "switched apps to grab card, came back" pattern.
  const outlets = useQuery({
    queryKey: ["outlets"],
    queryFn: async (): Promise<Outlet[]> => {
      // Pull outlet rows + the org-wide opening-hours map in parallel.
      // Hours live in app_settings keyed by "outlet_hours" — same source
      // the auto-hours cron reads. Map back onto each outlet row so the
      // pickup-time picker can decide which scheduled offsets are
      // reachable before close (or after open, when the outlet's still
      // shut at order time).
      const [outletsRes, hoursRes] = await Promise.all([
        supabase
          .from("outlet_settings")
          .select("store_id,name,address,lat,lng,is_open,is_busy,pickup_time_mins")
          .eq("is_active", true),
        supabase
          .from("app_settings")
          .select("value")
          .eq("key", "outlet_hours")
          .maybeSingle(),
      ]);
      if (outletsRes.error) throw outletsRes.error;
      const rows = outletsRes.data ?? [];
      const hoursMap = (hoursRes.data?.value ?? {}) as Record<
        string,
        { open: string; close: string; daysOpen: number[] }
      >;
      return rows.map((o) => ({ ...o, hours: hoursMap[o.store_id] ?? null }));
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const currentOutlet = (outlets.data ?? []).find((o) => o.store_id === outletId) ?? null;
  const outletClosed = currentOutlet ? currentOutlet.is_open === false : false;

  const subtotal = cartTotal(cart);
  const rewardDiscountRaw = calcRewardDiscount(appliedReward, cart, subtotal);
  // Re-validate the applied reward against the current order type + cart, so a
  // channel-restricted / under-minimum / missing-qualifier reward surfaces a
  // clear reason and blocks checkout instead of silently failing server-side.
  const rewardValidity = validateAppliedReward(appliedReward, cart, orderType);
  const rewardInvalidReason = rewardValidity.valid ? null : rewardValidity.reason;

  // Non-stackable tier exclusivity (Staff, Black Card). Mirrors the
  // server-side auto-pick-larger so the cart, summary, and Place
  // Order button all read the same number. Without this, both
  // discounts stack client-side, hit the Math.max(0, ...) floor at
  // 0, and produce a bug: button "RM0.00" + summary "Total RM7.45"
  // (the leftover tier-perk after the cap absorbs the voucher).
  const isNonStackableTier = tier?.tier_stackable === false;
  const rawTierPerk = (promoEval?.discounts ?? []).find((d) => d.reason === "tier_perk");
  const rawTierPerkAmt = rawTierPerk?.discount_amount ?? 0;
  const rawOtherPromoSum = (promoEval?.discounts ?? [])
    .filter((d) => d.reason !== "tier_perk")
    .reduce((s, d) => s + d.discount_amount, 0);

  let rewardDiscount = rewardDiscountRaw;
  let effectivePromoDiscount = promoDiscount;
  let dropTierPerk = false;
  if (isNonStackableTier && rawTierPerkAmt > 0) {
    if (rewardDiscountRaw >= rawTierPerkAmt) {
      // Voucher wins — drop the tier perk, keep voucher + any other
      // promo-engine discounts (auto, reward_link).
      dropTierPerk = true;
      effectivePromoDiscount = rawOtherPromoSum;
    } else if (rewardDiscountRaw > 0) {
      // Tier wins — drop the voucher, keep tier perk + any other
      // promo-engine discounts.
      rewardDiscount = 0;
    }
  }

  const afterDiscount = Math.max(0, subtotal - rewardDiscount - effectivePromoDiscount);
  const sst = sstConfig.enabled ? +(afterDiscount * sstConfig.rate).toFixed(2) : 0;
  const grandTotal = +(afterDiscount + sst).toFixed(2);

  const [step, setStep] = useState<Step>(phoneFromStore ? "review" : "phone");
  const [phoneInput, setPhoneInput] = useState(phoneFromStore ?? "");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  // Contextual message shown next to the spinner during checkout. Lets
  // the customer see WHAT is happening at each step instead of a bare
  // spinner — particularly important after the Stripe sheet dismisses,
  // when the wait between "paid" and the order-detail screen used to
  // feel like a stall.
  const [busyLabel, setBusyLabel] = useState<string | undefined>(undefined);
  // Single Stripe-routed payment flow. The sheet presents whatever
  // methods are enabled in Stripe Dashboard (card, Apple Pay, FPX,
  // GrabPay, etc.) via automatic_payment_methods, so the app no
  // longer asks the customer to pre-pick. We still send a value to
  // the server because it requires one; "card" is the most common
  // and the actual method gets recorded post-payment via Stripe's
  // PaymentIntent metadata.
  const [lastError, setLastError] = useState<string | null>(null);
  // Success acknowledgement — toggled the moment payment is confirmed
  // (or we hit the skipPayment branch for zero-amount orders). The
  // overlay animates in, holds ~1.5s, then router.replace navigates
  // to the order detail screen.
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  // Frozen snapshot of the order summary, captured the instant Place
  // Order is tapped. clearCart() runs immediately after the server
  // creates the pending order (to prevent duplicate-order submissions
  // if the customer back-navigates and retries) — but that empties
  // `cart`, recomputes all derived totals to 0, and made the order
  // summary flash "Total RM 0.00" behind the Apple Pay sheet while
  // the user authorised payment. Pinning the summary values here
  // keeps the display stable until we navigate away.
  type FrozenSummary = {
    items:          typeof cart;
    subtotal:       number;
    rewardDiscount: number;
    rewardName:     string | null;
    promoDiscounts: NonNullable<typeof promoEval>["discounts"];
    sst:            number;
    grandTotal:     number;
    afterDiscount:  number;
  };
  const [frozenSummary, setFrozenSummary] = useState<FrozenSummary | null>(null);

  // The specific payment method the customer picked (e.g. "card", "tng").
  // Defaults to null until gatewayMethods loads, then we auto-select the
  // ZUS-style grouped picker. Customer picks a category first; if the
  // category bundles multiple sub-methods (e-wallets, online banking
  // banks) they then pick a specific one inside the expanded row. The
  // existing place-order code reads selectedMethodId, so we keep that as
  // a derived value rather than refactoring the downstream code.
  type Category = "online_banking" | "ewallet" | "card" | "apple_pay" | "google_pay" | "maybank_qr";
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  // The specific wallet inside the e-wallet category. Reset whenever the
  // customer switches away from e-wallet so a stale choice can't ride
  // into another category.
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  // FPX bank from FPX_BANKS — required when the online banking category
  // is selected. Same reset rule as selectedWalletId.
  const [fpxBankCode, setFpxBankCode] = useState<string | null>(null);
  // Bottom-sheet visibility for the wallet + bank pickers. Sub-pickers
  // open as modal sheets instead of inline expansion so the layout stays
  // compact and the picker has its own focused surface.
  const [walletSheetOpen, setWalletSheetOpen] = useState(false);

  // Scheduled pickup. Null = Now (default, brew immediately). When
  // set, the customer wants pickup at that offset from now — server
  // stores the timestamp on the order; the future KDS gating layer
  // will hold scheduled orders until ~prep-time before pickup.
  const [pickupOffsetMin, setPickupOffsetMin] = useState<number | null>(null);
  const [pickupSheetOpen, setPickupSheetOpen] = useState(false);
  // Offsets shown in the picker — covers most "I'll arrive in N min"
  // intents without overwhelming. Closer to ZUS/Starbucks defaults.
  // 15 min dropped — already covered by "Now" (5-15 min range on a
  // 10-min outlet). Picker starts at 30 min for the genuinely-later
  // option.
  const PICKUP_OFFSETS = [30, 45, 60, 90, 120];

  // Compute the outlet's open/close timestamps for *today*, given the
  // "08:00"/"22:00" string format the auto-hours cron stores. JS Date
  // arithmetic in the device's local TZ is fine — the outlets are MY
  // and customers using the app are MY-resident; off-by-tz is a
  // separate problem for a different day.
  const parseTodayClock = (clock: string): Date => {
    const [h, m] = clock.split(":").map((n) => parseInt(n, 10));
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  };
  const outletHours = currentOutlet?.hours ?? null;
  const todayOpen   = outletHours ? parseTodayClock(outletHours.open)  : null;
  const todayClose  = outletHours ? parseTodayClock(outletHours.close) : null;
  // If close is earlier than open the outlet runs past midnight; bump
  // close to tomorrow. Same for after-close (already past today's close).
  const closeIsAfterOpen = todayOpen && todayClose
    ? todayClose.getTime() > todayOpen.getTime()
    : true;
  const effectiveClose = todayClose && !closeIsAfterOpen
    ? new Date(todayClose.getTime() + 24 * 3600_000)
    : todayClose;
  // Next opening — if we're still before today's open, that's it.
  // Otherwise it's tomorrow's open at the same clock time.
  const nextOpenAt = (() => {
    if (!todayOpen) return null;
    if (Date.now() < todayOpen.getTime()) return todayOpen;
    const tomorrow = new Date(todayOpen.getTime() + 24 * 3600_000);
    return tomorrow;
  })();
  // Is the outlet currently inside its open/close window? Independent
  // from is_open (which may be flipped manually by staff) — we use
  // both to decide what the customer can pick.
  const insideOpenWindow = !!(todayOpen && effectiveClose &&
    Date.now() >= todayOpen.getTime() && Date.now() <= effectiveClose.getTime());
  // Treat the outlet as available for a "Now" order when staff's
  // manual flag says so AND (either we have no hours config, in which
  // case we trust is_open, or the current time is inside the window).
  // Without the outletHours fallback, the card defaulted to "Pick a
  // time" any time the hours map hadn't loaded yet — even on a
  // clearly-open outlet — which is what the screenshot showed.
  const nowAvailable = currentOutlet?.is_open !== false &&
    (outletHours == null || insideOpenWindow);
  // Filter the relative offsets to those that land inside opening
  // hours. We accept a pickup window that ENDS by close.
  const visibleOffsets = PICKUP_OFFSETS.filter((mins) => {
    if (!todayOpen || !effectiveClose) return true;
    const at = Date.now() + mins * 60_000;
    return at >= todayOpen.getTime() && at <= effectiveClose.getTime();
  });
  const pickupAtIso = pickupOffsetMin == null
    ? null
    : new Date(Date.now() + pickupOffsetMin * 60_000).toISOString();
  // Format a single absolute clock time, e.g. "9:56 AM".
  const fmtClock = (d: Date): string => {
    const h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    const h12  = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m} ${ampm}`;
  };
  // Format a +/- window range, e.g. "9:54-10:00 AM" (or "9:58 AM-12:02 PM"
  // when the window crosses noon/midnight). Window is the half-width
  // in minutes, so the full range is 2 * window.
  const fmtRange = (center: Date, windowMins: number): string => {
    const start = new Date(center.getTime() - windowMins * 60_000);
    const end   = new Date(center.getTime() + windowMins * 60_000);
    const startStr = fmtClock(start);
    const endStr   = fmtClock(end);
    // Same AM/PM → collapse the suffix on the start half.
    const startAmpm = startStr.slice(-2);
    const endAmpm   = endStr.slice(-2);
    if (startAmpm === endAmpm) {
      return `${startStr.slice(0, -3)}-${endStr}`;
    }
    return `${startStr}-${endStr}`;
  };
  // Honesty hedge: brew time varies, queue is unpredictable. A 10-min
  // total window (±5 around the chosen target) is wide enough to absorb
  // a normal queue spike without reading as a precise promise. For
  // "Now", the window is around the outlet's pickup_time_mins
  // (so a 10-min outlet reads "5-15 min").
  const RANGE_WINDOW_MIN = 5;
  const formatPickupLabel = (mins: number | null): string => {
    if (mins == null) return "Now";
    const at = new Date(Date.now() + mins * 60_000);
    return `Today · ${fmtRange(at, RANGE_WINDOW_MIN)}`;
  };
  const nowRangeMins = (() => {
    // Low bound = outlet's prep time as the optimistic floor; high
    // bound = +5 min for queue variance. So a 10-min outlet reads
    // "10-15 min" — never promises faster than the kitchen can
    // actually deliver, never reads as wildly off when busy.
    const base = currentOutlet?.pickup_time_mins ?? 10;
    return `${base}-${base + 5}`;
  })();

  // RM checkout modal — full-screen WebView wrapper that replaces the
  // expo-web-browser flow (which surfaced an iOS system URL bar like
  // card.revenuemonster.my / tngdigital.com.my). The modal hides chrome
  // entirely and intercepts the celsiuscoffee:// return scheme. openRmCheckout
  // wraps the modal in a Promise so onPlaceOrder can `await` it as before.
  const [rmModal, setRmModal] = useState<{ url: string; method: string; amount: string; methodId: string } | null>(null);
  const rmModalResolveRef = useRef<((r: "success" | "cancel") => void) | null>(null);
  const openRmCheckout = (url: string, method: string, amount: string, methodId: string): Promise<"success" | "cancel"> =>
    new Promise((resolve) => {
      rmModalResolveRef.current = resolve;
      setRmModal({ url, method, amount, methodId });
    });
  const [bankSheetOpen, setBankSheetOpen]     = useState(false);

  const selectedMethodId: string | null = (() => {
    if (selectedCategory === "online_banking") return "fpx";
    if (selectedCategory === "ewallet")        return selectedWalletId;
    if (selectedCategory === "card")           return "card";
    if (selectedCategory === "apple_pay")      return "apple_pay";
    if (selectedCategory === "google_pay")     return "google_pay";
    if (selectedCategory === "maybank_qr")     return "maybank_qr";
    return null;
  })();

  // Methods grouped for the ZUS-style layout. Each row is rendered from
  // these arrays, so the visible categories follow whatever backoffice
  // enabled in payment_gateway_config without extra plumbing.
  const wallets        = gatewayMethods.filter((m) => ["tng", "boost", "shopeepay", "grabpay", "duitnow"].includes(m.method_id));
  const onlineBanking  = gatewayMethods.find((m) => m.method_id === "fpx");
  const card           = gatewayMethods.find((m) => m.method_id === "card");
  const applePay       = gatewayMethods.find((m) => m.method_id === "apple_pay");
  const googlePay      = gatewayMethods.find((m) => m.method_id === "google_pay");

  // Auto-select once gateway config arrives. Preference order: the
  // customer's previous choice (read from AsyncStorage at mount) → ZUS
  // fallback (card → e-wallet → online banking → device wallets).
  // savedMethodLoaded gates the autoselect so we never race the
  // AsyncStorage read and pick "card" by default for a customer who
  // habitually pays with TNG.
  const [savedMethodLoaded, setSavedMethodLoaded] = useState(false);
  const [savedMethodId, setSavedMethodId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(LAST_METHOD_KEY)
      .then((v) => {
        if (cancelled) return;
        setSavedMethodId(v);
        setSavedMethodLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSavedMethodLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!savedMethodLoaded) return;
    if (selectedCategory !== null) return;
    // Try the saved method first if it's still enabled in the current
    // gateway config. Only set if the corresponding method is actually
    // available on this platform (skips Apple Pay on Android, etc.).
    if (savedMethodId) {
      if (savedMethodId === "card" && card) { setSelectedCategory("card"); return; }
      if (savedMethodId === "fpx"  && onlineBanking) { setSelectedCategory("online_banking"); return; }
      if (savedMethodId === "apple_pay"  && applePay)  { setSelectedCategory("apple_pay"); return; }
      if (savedMethodId === "google_pay" && googlePay) { setSelectedCategory("google_pay"); return; }
      const w = wallets.find((m) => m.method_id === savedMethodId);
      if (w) { setSelectedCategory("ewallet"); setSelectedWalletId(w.method_id); return; }
    }
    if (card)          { setSelectedCategory("card"); return; }
    if (wallets[0])    { setSelectedCategory("ewallet"); return; }
    if (onlineBanking) { setSelectedCategory("online_banking"); return; }
    if (applePay)      { setSelectedCategory("apple_pay"); return; }
    if (googlePay)     { setSelectedCategory("google_pay"); return; }
  }, [savedMethodLoaded, savedMethodId, selectedCategory, card, wallets, onlineBanking, applePay, googlePay]);
  const successOpacity = useRef(new Animated.Value(0)).current;
  const successScale   = useRef(new Animated.Value(0.6)).current;

  // Run the success animation + auto-navigate to /order/[id] after a
  // brief hold. Used by every "we're done, get out of checkout"
  // path (Stripe success, zero-amount skipPayment, payment-cancel
  // fallback) so the customer always sees the same exit moment.
  const routeAfterSuccess = (
    orderId: string,
    opts?: { holdMs?: number; params?: Record<string, string> },
  ) => {
    const holdMs = opts?.holdMs ?? 1400;
    setPaymentSuccess(true);
    Animated.parallel([
      Animated.timing(successOpacity, {
        toValue:  1,
        duration: 220,
        easing:   Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(successScale, {
        toValue:  1,
        friction: 6,
        tension:  90,
        useNativeDriver: true,
      }),
    ]).start();
    setTimeout(() => {
      router.replace({
        pathname: "/order/[id]",
        params: { id: orderId, ...(opts?.params ?? {}) },
      });
    }, holdMs);
  };

  const onSendOtp = async () => {
    const normalized = phoneInput.trim().replace(/\s/g, "");
    if (!/^\+?6?01\d{8,9}$/.test(normalized)) {
      Alert.alert("Invalid phone", "Enter a Malaysian number, e.g. 0123456789");
      return;
    }
    setBusy(true);
    setBusyLabel("Sending code…");
    try {
      await api.sendOtp(normalized);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep("otp");
    } catch (e) {
      Alert.alert("Couldn't send code", String(e));
    } finally {
      setBusy(false);
      setBusyLabel(undefined);
    }
  };

  const onVerifyOtp = async () => {
    if (otp.length < 4) return;
    setBusy(true);
    setBusyLabel("Checking code…");
    try {
      await api.verifyOtp(phoneInput.trim(), otp.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      trackEvent("login_success", { surface: "checkout" });
      setPhone(phoneInput.trim());
      setStep("review");
    } catch (e) {
      Alert.alert("Couldn't verify", String(e));
    } finally {
      setBusy(false);
      setBusyLabel(undefined);
    }
  };

  const onPlaceOrder = async () => {
    if (!outletId) {
      Alert.alert("No outlet selected", "Pick an outlet first.");
      return;
    }
    // Remember the customer's choice so the next checkout starts with
    // it pre-selected. Fire-and-forget — a failure here would only mean
    // the next visit auto-picks "card" by default; not worth blocking
    // place-order on.
    if (selectedMethodId) {
      AsyncStorage.setItem(LAST_METHOD_KEY, selectedMethodId).catch(() => {});
    }
    trackEvent("checkout_started", {
      itemCount: cart.length,
      subtotal,
      hasReward: !!appliedReward,
      outletId,
    });

    // Guard: re-validate the applied reward right before submitting.
    // Customers can sit on the cart screen for hours; a reward that
    // was eligible at add-time may have expired, hit its
    // max_redemptions cap, or been deactivated. Catching it client-
    // side is friendlier than the server-side 422 surprise.
    //
    // Only runs for legacy points-shop rewards (no voucher_id). Wallet
    // vouchers (voucher_id set) live in issued_rewards — their id will
    // never match a points-shop reward.id, so without this guard the
    // .find() returned undefined and silently cleared every wallet
    // voucher right before place-order: the discount disappeared from
    // the order. Wallet validation runs server-side on /api/orders.
    if (appliedReward && !appliedReward.voucher_id) {
      try {
        const fresh = await fetchRewards(phoneInput.trim() || phoneFromStore || null);
        const live = fresh.rewards.find((r) => r.id === appliedReward.id);
        const now = Date.now();
        const stillValid =
          live &&
          live.is_active !== false &&
          (!live.valid_until || new Date(live.valid_until).getTime() > now) &&
          (live.stock == null || live.stock > 0) &&
          (live.max_redemptions_per_member == null ||
            (live.redemption_count ?? 0) < live.max_redemptions_per_member);
        if (!stillValid) {
          // Clear the stale reward, surface a toast, bounce out so
          // the customer sees the corrected total before tapping
          // place-order again.
          setAppliedReward(null);
          showToast({
            message: "Your reward expired. Updated total below.",
            variant: "info",
            durationMs: 3500,
          });
          return;
        }
      } catch {
        // Network failure on the re-check is non-blocking — let the
        // server be the final arbiter rather than holding up the
        // order over a transient connectivity blip.
      }
    }

    setBusy(true);
    setBusyLabel("Reviewing your order…");
    setLastError(null);
    let stage = "init";
    try {
      stage = "create-order";
      // 1. Create the order on the server.
      //    Server expects: selectedStore (object), loyaltyPhone, total (RM), items, paymentMethod.
      // Cart is cleared the moment the order is committed server-side —
      // any retry happens from the order page using the existing orderId,
      // never by re-submitting the cart (which would create a duplicate).
      const res = await api.placeOrder({
        selectedStore: { id: outletId, name: outletName ?? undefined },
        loyaltyPhone: phoneInput.trim(),
        loyaltyId: loyaltyId ?? undefined,
        // Send the actual method the customer picked. The server stores
        // this on the order so the analytics + reconciliation can split
        // by method later (which is why we don't always send "card").
        paymentMethod: selectedMethodId ?? "card",
        total: subtotal, // pre-discount subtotal in RM; server applies discount + SST
        items: cart.map((i) => ({
          productId: i.productId,
          name: i.name,
          quantity: i.quantity,
          basePrice: i.basePrice,
          totalPrice: i.totalPrice,
          modifiers: i.modifiers.map((m) => ({
            groupName: m.groupName,
            label: m.label,
            priceDelta: m.priceDelta,
          })),
          specialInstructions: i.specialInstructions,
        })),
        rewardId: appliedReward?.id ?? null,
        rewardName: appliedReward?.name ?? null,
        rewardPointsCost: appliedReward?.points_required ?? 0,
        rewardDiscountSen: Math.round(rewardDiscount * 100),
        walletVoucherId: appliedReward?.voucher_id ?? null,
        pickupAt:         pickupAtIso,
        // Fulfilment context — dine_in + table# when the customer entered via
        // a table-QR deep link; the server tags the orders row so it lands on
        // the POS register's "QR Tables" tab. Defaults to pickup otherwise.
        orderType:        orderType ?? "pickup",
        tableNumber:      orderType === "dine_in" ? (tableNumber ?? null) : null,
      });
      // Pin the summary BEFORE clearCart so the customer keeps seeing
      // their RM 4.45 (or whatever) behind the Stripe / Apple Pay
      // sheet — otherwise the live total recomputes to 0 the moment
      // the cart empties.
      setFrozenSummary({
        items:          cart,
        subtotal,
        rewardDiscount,
        rewardName:     appliedReward?.name ?? null,
        promoDiscounts: promoEval?.discounts ?? [],
        sst,
        grandTotal,
        afterDiscount,
      });
      clearCart();
      // Voucher (if reserved) has now been redeemed at checkout. Clear the
      // wallet hold so the banner stops showing on menu/cart for the next
      // order.
      setReservedVoucher(null);
      trackEvent("order_placed", {
        orderId:        res.orderId,
        orderNumber:    res.orderNumber,
        total:          grandTotal,
        subtotal,
        rewardDiscount,
        promoDiscount,
        rewardId:       appliedReward?.id ?? null,
        outletId,
      });
      // Reward was just consumed (server deducts points + decrements stock)
      // and points were earned on the after-discount subtotal. The home,
      // rewards, and account screens cache tier + rewards for 5 min — without
      // these invalidations the customer sees the OLD points balance and
      // their just-used reward still sitting there as "available".
      setAppliedReward(null);
      queryClient.invalidateQueries({ queryKey: ["tier", loyaltyId] });
      queryClient.invalidateQueries({ queryKey: ["rewards", phoneInput.trim() || phoneFromStore || "anonymous"] });
      // Order list query keys to wipe — the screen uses kebab-case
      // ["order-history", phone]; the home page uses ["recent-orders"].
      // Both need to refetch so the just-placed order shows up
      // immediately in In progress / Recents instead of waiting out
      // the 5-min staleTime.
      queryClient.invalidateQueries({ queryKey: ["order-history"] });
      queryClient.invalidateQueries({ queryKey: ["recent-orders"] });

      // Pre-flight: a zero-amount order (full reward / 100%-off promo)
      // skips Stripe entirely, so "Opening secure payment…" would be
      // a lie. Show "Sending to kitchen…" up-front for those — the
      // server confirms the order in the same PaymentIntent call.
      const isFreeOrder = grandTotal <= 0.001;
      setBusyLabel(isFreeOrder ? "Sending to kitchen…" : "Opening secure payment…");

      // ─── Revenue Monster branch ─────────────────────────────────
      // When the customer picked a method routed to Revenue Monster (per
      // the backoffice gateway-config), we skip Stripe entirely and open
      // RM's hosted page filtered to just that one method. RM redirects
      // back to celsiuscoffee:// which dismisses the in-app browser; the
      // webhook (HMAC-signed via the same CLIENT_SECRET we ship) flips
      // the order to "preparing" server-side. No client-side mutation.
      const selectedMethod = gatewayMethods.find((m) => m.method_id === selectedMethodId);
      const isRmMethod = selectedMethod?.provider === "revenue_monster";
      if (isRmMethod && !isFreeOrder) {
        stage = "create-rm-payment";
        const rmRes = await fetch(
          `https://order.celsiuscoffee.com/api/payments/create`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin:  "https://order.celsiuscoffee.com",
              Referer: "https://order.celsiuscoffee.com/",
            },
            body: JSON.stringify({
              orderId: res.orderId,
              paymentMethod: selectedMethodId, // specific method id (tng / boost / etc)
              redirectUrl: "celsiuscoffee://rm-return",
              // Only send for FPX; ignored server-side for other methods.
              ...(selectedMethodId === "fpx" && fpxBankCode
                ? { fpxBankCode }
                : {}),
            }),
          },
        );
        const rmJson = (await rmRes.json()) as { paymentUrl?: string; error?: string };
        if (!rmRes.ok || !rmJson.paymentUrl) {
          throw new Error(`create-rm-payment HTTP ${rmRes.status}: ${rmJson.error || "no paymentUrl"}`);
        }
        trackEvent("payment_rm_opened", { orderId: res.orderId });
        const methodLabel = METHOD_LABELS[selectedMethodId!] ?? selectedMethodId!;
        const result = await openRmCheckout(rmJson.paymentUrl, methodLabel, formatPrice(grandTotal), selectedMethodId!);
        if (result === "success") {
          trackEvent("payment_rm_returned", { orderId: res.orderId });
          setBusyLabel("Sending to kitchen…");
          // RM redirected back to celsiuscoffee://rm-return — this happens
          // for BOTH paid and cancelled/failed payments (RM doesn't reliably
          // expose status in the redirect URL). Skip the green-check
          // animation here; the order page polls RM and flips between
          // "Confirming payment…" → "Brewing now" / "Payment failed"
          // based on the actual server-side status within 5–30s.
          router.replace({
            pathname: "/order/[id]",
            params: { id: res.orderId, justPaid: "1" },
          });
        } else {
          // User explicitly cancelled the RM modal (X button). The order
          // is now pending+unpaid and lives in /orders → In progress, so
          // route there directly instead of the detail page (which would
          // show "Awaiting payment" and feels like we forced them deeper
          // than they wanted). They can retry from the list when ready.
          trackEvent("payment_rm_cancelled", { orderId: res.orderId, type: result });
          router.replace("/orders");
        }
        return;
      }

      // ─── Maybank static QR branch ───────────────────────────────
      // No payment gateway — order sits as `pending` until a staff member
      // verifies the Maybank transfer and releases it (which flips it to
      // `preparing` and triggers the kitchen print). The order detail
      // screen renders the per-outlet Maybank QR + a waiting state.
      if (selectedMethodId === "maybank_qr" && !isFreeOrder) {
        stage = "maybank-qr-pending";
        setBusyLabel("Saving your order…");
        trackEvent("order_placed_maybank_qr", { orderId: res.orderId });
        router.replace({
          pathname: "/order/[id]",
          params: { id: res.orderId, justPaid: "1" },
        });
        return;
      }

      stage = "create-payment-intent";
      // 2. Card / ewallet — Stripe native PaymentSheet. The server mints a
      //    PaymentIntent for this orderId; we hand the clientSecret to the
      //    native sheet. Vercel cold-starts can intermittently 500 with a
      //    StripeConnectionError; one retry after a short delay reliably
      //    succeeds once the function is warm.
      const fetchIntent = async () =>
        fetch(`https://order.celsiuscoffee.com/api/checkout/create-payment-intent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin:  "https://order.celsiuscoffee.com",
            Referer: "https://order.celsiuscoffee.com/",
          },
          // Pass the customer-picked method so the server pins
          // payment_method_types and PaymentSheet shows only that flow
          // (card form, FPX bank picker, GrabPay redirect, etc.) instead
          // of the old consolidated multi-method sheet.
          body: JSON.stringify({ orderId: res.orderId, paymentMethod: selectedMethodId }),
        });
      let piRes = await fetchIntent();
      let piJson = (await piRes.json()) as {
        clientSecret?:    string;
        paymentIntentId?: string;
        skipPayment?:     boolean;
        error?:           string;
        type?:            string;
      };
      if (
        !piRes.ok &&
        (piJson.type === "StripeConnectionError" ||
          /connection/i.test(piJson.error ?? ""))
      ) {
        // Cold-start retry — wait 1.2s then try once more.
        await new Promise((r) => setTimeout(r, 1200));
        piRes = await fetchIntent();
        piJson = (await piRes.json()) as typeof piJson;
      }
      // Zero-amount orders (free-drink reward, etc.) — server already
      // moved the order to "preparing" and ran earn/deduct hooks.
      // Skip Stripe PaymentSheet and route straight to the order page.
      if (piRes.ok && piJson.skipPayment) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        trackEvent("payment_skipped", { orderId: res.orderId, reason: "zero_amount" });
        routeAfterSuccess(res.orderId);
        return;
      }
      if (!piRes.ok || !piJson.clientSecret) {
        throw new Error(
          `${stage} HTTP ${piRes.status}: ${piJson.error || "no clientSecret"}`
        );
      }

      stage = "init-payment-sheet";
      const initRes = await initPaymentSheet({
        merchantDisplayName: "Celsius Coffee",
        paymentIntentClientSecret: piJson.clientSecret,
        applePay: { merchantCountryCode: "MY" },
        // Google Pay's live-mode "Buying Intent" check denies any AAB that
        // isn't on the public Play Store (we're still on internal testing).
        // The Stripe publishable key prefix is the authoritative signal:
        // pk_test_* → not real money → test wallet is the right surface and
        // also bypasses the Play Store presence check. pk_live_* keeps the
        // live wallet so production builds work the moment we hit the public
        // store. No env toggle needed — flips automatically when keys swap.
        googlePay: {
          merchantCountryCode: "MY",
          currencyCode: "myr",
          testEnv: (process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "").startsWith("pk_test_"),
        },
        defaultBillingDetails: { phone: phoneInput.trim() },
        returnURL: "celsiuscoffee://stripe-redirect",
        allowsDelayedPaymentMethods: false,
      });
      if (initRes.error) {
        throw new Error(
          `${stage} [${initRes.error.code ?? "?"}]: ${initRes.error.message}`
        );
      }

      stage = "present-payment-sheet";
      const presentRes = await presentPaymentSheet();
      if (presentRes.error) {
        if (presentRes.error.code !== "Canceled") {
          // Hard failure (card declined, network, etc.) — route to the
          // order page where the retry / change-method UI lives.
          trackEvent("payment_failed", { orderId: res.orderId, code: presentRes.error.code, message: presentRes.error.message });
          Alert.alert("Payment failed", presentRes.error.message);
          router.replace({ pathname: "/order/[id]", params: { id: res.orderId } });
        } else {
          // Customer dismissed the sheet — they decided not to pay
          // right now. Mirror the RM cancel destination: route to
          // /orders (In progress list) instead of the deeper detail
          // page. Order stays pending; abandoned-orders cron expires
          // it later.
          trackEvent("payment_cancelled", { orderId: res.orderId });
          router.replace("/orders");
        }
        return;
      }
      trackEvent("payment_success", { orderId: res.orderId });
      // The Stripe sheet has dismissed, payment is captured, and the
      // server is finishing the loop (confirm-stripe + mystery drop
      // mint). This is the gap the customer used to stare at a bare
      // spinner — now they get a clear cue that work is happening.
      setBusyLabel("Sending to kitchen…");

      // Payment succeeded — confirm server-side immediately so the order is
      // already "preparing" by the time we navigate.
      try {
        await fetch(
          `https://order.celsiuscoffee.com/api/orders/${encodeURIComponent(res.orderId)}/confirm-stripe`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin:  "https://order.celsiuscoffee.com",
              Referer: "https://order.celsiuscoffee.com/",
            },
            body: JSON.stringify({
              paymentIntentId:
                piJson.paymentIntentId ?? piJson.clientSecret.split("_secret_")[0],
            }),
          }
        );
      } catch {
        // Webhook is the backstop if this fails.
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Pass justPaid=1 so the order page can also fire the success
      // overlay on mount if the customer ever lands there from
      // history (push tap, etc.) — same path RM payments take.
      routeAfterSuccess(res.orderId, { params: { justPaid: "1" } });
    } catch (e: any) {
      const detail = `[${stage}] ${e?.message ?? String(e)}`;
      setLastError(detail);
      Alert.alert("Couldn't place order", detail);
      console.warn("[checkout]", detail, e);
    } finally {
      setBusy(false);
      setBusyLabel(undefined);
    }
  };

  // Empty cart guard — covers deep-link / back-nav cases where the user
  // lands here with nothing to pay for. Suppressed while `busy` is true
  // (an order is in flight) or while the success overlay is showing
  // (we're about to navigate to /order/[id] but the cart was already
  // cleared, so without this gate the empty-cart placeholder flashes
  // for ~1.4s before navigation).
  if (cartCount(cart) === 0 && !busy && !paymentSuccess) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ headerShown: false }} />
        <EspressoHeader title="Checkout" showBack showCart={false} />
        <View className="flex-1 items-center justify-center px-6">
          <Coffee size={48} color="#8E8E93" strokeWidth={1.25} />
          <Text
            className="text-espresso text-base mt-4"
            style={{ fontFamily: "Peachi-Bold" }}
          >
            Your cart is empty
          </Text>
          <Text
            className="text-muted-fg text-sm text-center mt-1"
            style={{ fontFamily: "SpaceGrotesk_400Regular" }}
          >
            Add a drink first, then we'll get you to pickup quick.
          </Text>
          <Pressable
            onPress={() => router.replace(outletId ? "/menu" : "/store")}
            className="mt-6 bg-espresso rounded-full active:opacity-80"
            style={{ paddingHorizontal: 22, paddingVertical: 11 }}
          >
            <Text
              className="text-white text-[14px]"
              style={{ fontFamily: "Peachi-Bold" }}
            >
              Browse menu
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader title="Checkout" showBack showCart={false} />

      <ScrollView contentContainerClassName="px-4 py-4 pb-32 gap-4">
        {step === "phone" && (
          <View className="bg-surface rounded-2xl border border-border p-5">
            <Text className="text-espresso text-xs font-bold uppercase tracking-wider">
              Phone number
            </Text>
            <Text className="text-muted-fg text-xs mt-1">
              We'll text you a code, then notify you when your order is ready.
            </Text>
            <TextInput
              value={phoneInput}
              onChangeText={setPhoneInput}
              placeholder="0123456789"
              placeholderTextColor="#8E8E93"
              keyboardType="phone-pad"
              autoFocus
              className="mt-3 bg-background border border-border rounded-2xl px-4 py-3 text-espresso text-lg"
            />
            <View className="mt-5">
              <PrimaryButton label="Text me the code" onPress={onSendOtp} loading={busy} loadingLabel={busyLabel} />
            </View>
          </View>
        )}

        {step === "otp" && (
          <View className="bg-surface rounded-2xl border border-border p-5">
            <Text className="text-espresso text-xs font-bold uppercase tracking-wider">
              Enter code
            </Text>
            <Text className="text-muted-fg text-xs mt-1">Sent to {phoneInput}</Text>
            <TextInput
              value={otp}
              onChangeText={setOtp}
              placeholder="••••••"
              placeholderTextColor="#8E8E93"
              keyboardType="number-pad"
              autoFocus
              maxLength={6}
              className="mt-3 bg-background border border-border rounded-2xl px-4 py-3 text-espresso text-2xl tracking-widest text-center"
            />
            <View className="mt-5">
              <PrimaryButton label="Let me in" onPress={onVerifyOtp} loading={busy} loadingLabel={busyLabel} />
            </View>
            <Pressable onPress={() => setStep("phone")} className="mt-3 items-center active:opacity-70">
              <Text className="text-muted-fg text-sm">Wrong number? Edit</Text>
            </Pressable>
          </View>
        )}

        {step === "review" && (
          <>
            {/* Order type — Takeaway | Dine-In toggle + outlet/table summary.
                Replaces the old "Pickup at" card: takeaway shows the outlet +
                Change; dine-in shows the locked table + outlet (and hides the
                pickup-time card below). */}
            <OrderTypeBar />

            {/* Pickup time — defaults to Now. Tap to open the
                bottom-sheet picker and choose a delayed pickup so
                the drink is freshest when the customer arrives.
                Dine-in has no pickup time (served to the table), so the
                whole card hides when the order type is dine-in. */}
            {!isDineIn && (
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setPickupSheetOpen(true);
              }}
              className="bg-surface rounded-2xl border border-border p-4 active:opacity-70"
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-muted-fg text-[10px] font-bold uppercase tracking-widest">
                  Pickup time
                </Text>
                <Text
                  className="text-primary text-[11px]"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  Change
                </Text>
              </View>
              <View className="flex-row items-center gap-2 mt-1">
                {pickupOffsetMin == null && nowAvailable ? (
                  <Clock size={14} color="#160800" />
                ) : (
                  <CalendarClock size={14} color="#160800" />
                )}
                <Text className="text-espresso font-bold text-[15px]" numberOfLines={1}>
                  {pickupOffsetMin == null
                    ? nowAvailable
                      ? "Now"
                      : "Pick a time"
                    : formatPickupLabel(pickupOffsetMin)}
                </Text>
                {pickupOffsetMin == null && nowAvailable && (
                  <View
                    style={{
                      backgroundColor: "#FBEBE8",
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      borderRadius: 4,
                      marginLeft: 4,
                    }}
                  >
                    <Text
                      style={{
                        color: "#A2492C",
                        fontSize: 9,
                        fontFamily: "Peachi-Bold",
                        letterSpacing: 1,
                      }}
                    >
                      DEFAULT
                    </Text>
                  </View>
                )}
              </View>
              <Text
                className="text-muted-fg text-[12px] mt-2"
                style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}
              >
                {pickupOffsetMin == null
                  ? nowAvailable
                    ? `Ready in ${nowRangeMins} min`
                    : nextOpenAt
                      ? `${currentOutlet?.name ?? "This outlet"} opens at ${fmtClock(nextOpenAt)}`
                      : "Pick a pickup time to continue"
                  : `Brew starts ~${Math.max(0, pickupOffsetMin - (currentOutlet?.pickup_time_mins ?? 10))} min before pickup`}
              </Text>
            </Pressable>
            )}

            {/* Payment Methods — grouped, ZUS-style. One row per category;
                e-wallet and online-banking categories expand to a sub-picker
                when selected. Card / Apple Pay / Google Pay are single-tap.
                When global payments are off, the whole block hides and the
                warning banner below replaces it. */}
            {paymentsEnabled && gatewayMethods.length > 0 && (
              <View>
                <Text
                  className="text-muted-fg text-[11px] font-bold uppercase tracking-wider px-1 mb-2"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  Payment method
                </Text>
                <View className="bg-surface rounded-2xl border border-border overflow-hidden">
                  {/* Card */}
                  {card && (
                    <CategoryRow
                      selected={selectedCategory === "card"}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setSelectedCategory("card");
                        setSelectedWalletId(null);
                        setFpxBankCode(null);
                      }}
                      title="Credit / Debit Card"
                      iconMethodId="card"
                    />
                  )}

                  {/* Apple Pay (iOS only — gatewayMethods is already platform-filtered) */}
                  {applePay && (
                    <CategoryRow
                      selected={selectedCategory === "apple_pay"}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setSelectedCategory("apple_pay");
                        setSelectedWalletId(null);
                        setFpxBankCode(null);
                      }}
                      title="Apple Pay"
                      iconMethodId="apple_pay"
                      hasDivider
                    />
                  )}

                  {/* Google Pay (Android only — same platform filter) */}
                  {googlePay && (
                    <CategoryRow
                      selected={selectedCategory === "google_pay"}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setSelectedCategory("google_pay");
                        setSelectedWalletId(null);
                        setFpxBankCode(null);
                      }}
                      title="Google Pay"
                      iconMethodId="google_pay"
                      hasDivider
                    />
                  )}

                  {/* E-Wallet — taps open a bottom-sheet sub-picker. The
                      group tile itself shows the chosen wallet's icon +
                      label as the subtitle so the customer sees what's
                      currently selected without opening the sheet. */}
                  {wallets.length > 0 && (
                    <CategoryRow
                      selected={selectedCategory === "ewallet"}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setSelectedCategory("ewallet");
                        setFpxBankCode(null);
                        setWalletSheetOpen(true);
                      }}
                      title="E-Wallet"
                      subtitle={
                        selectedCategory === "ewallet" && selectedWalletId
                          ? METHOD_LABELS[selectedWalletId] ?? selectedWalletId
                          : undefined
                      }
                      iconMethodId={
                        selectedCategory === "ewallet" && selectedWalletId
                          ? selectedWalletId
                          : "ewallet"
                      }
                      expandable
                      expanded={false}
                      hasDivider
                    />
                  )}

                  {/* Online Banking — taps open the FPX bank-picker sheet.
                      Mirrors the E-Wallet row's "icon swaps to current
                      sub-selection" behaviour: once the customer picks a
                      bank, the row's chip becomes that bank's colored
                      chip + the subtitle shows the bank name. */}
                  {onlineBanking && (() => {
                    const pickedBank = fpxBankCode
                      ? FPX_BANKS.find((b) => b.code === fpxBankCode)
                      : null;
                    return (
                      <CategoryRow
                        selected={selectedCategory === "online_banking"}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setSelectedCategory("online_banking");
                          setSelectedWalletId(null);
                          setBankSheetOpen(true);
                        }}
                        title="Online Banking"
                        subtitle={
                          pickedBank
                            ? pickedBank.name
                            : selectedCategory === "online_banking"
                              ? "FPX"
                              : undefined
                        }
                        iconMethodId="fpx"
                        iconNode={pickedBank ? <BankChip bank={pickedBank} size={36} /> : undefined}
                        expandable
                        expanded={false}
                        hasDivider
                      />
                    );
                  })()}

                  {/* Maybank QR — manual / cash-counter confirmation.
                      No payment gateway: order sits as pending until staff
                      verify the Maybank transfer in the staff order feed
                      and release it (which is when the kitchen receives it). */}
                  {maybankQrAvail && (
                    <CategoryRow
                      selected={selectedCategory === "maybank_qr"}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setSelectedCategory("maybank_qr");
                        setSelectedWalletId(null);
                        setFpxBankCode(null);
                      }}
                      title="Maybank QR"
                      subtitle="Scan-to-pay, staff confirms"
                      iconMethodId="duitnow"
                      hasDivider
                    />
                  )}
                </View>
              </View>
            )}

            <View className="bg-surface rounded-2xl border border-border p-4">
              <Text className="text-muted-fg text-[10px] font-bold uppercase tracking-widest">
                Order
              </Text>
              {/* Use frozenSummary values when set (during the Place Order
                  → Stripe sheet → navigate window) so the summary behind
                  the payment sheet doesn't recompute to RM 0 once the
                  cart is cleared. Falls back to live values when not
                  frozen — i.e. normal browsing of the checkout screen. */}
              {(() => {
                const items          = frozenSummary?.items          ?? cart;
                const dispSubtotal   = frozenSummary?.subtotal       ?? subtotal;
                // Reward + promo lists already reflect the
                // non-stackable-tier exclusivity (computed at
                // component-top so the Place Order button stays in
                // sync). When frozenSummary is in effect (payment
                // in progress) we use the snapshot verbatim — that's
                // a frozen receipt of what got billed.
                const dispReward     = frozenSummary?.rewardDiscount ?? rewardDiscount;
                const dispRewardName = frozenSummary?.rewardName     ?? (rewardDiscount > 0 ? (appliedReward?.name ?? null) : null);
                const rawDispPromos  = frozenSummary?.promoDiscounts ?? promoEval?.discounts ?? [];
                const dispPromos     = frozenSummary
                  ? rawDispPromos
                  : dropTierPerk
                    ? rawDispPromos.filter((d) => d.reason !== "tier_perk")
                    : rawDispPromos;
                const dispSst        = frozenSummary?.sst            ?? sst;
                const dispGrand      = frozenSummary?.grandTotal     ?? grandTotal;
                const dispAfter      = frozenSummary?.afterDiscount  ?? afterDiscount;
                const effRewardName  = dispRewardName;
                const effReward      = dispReward;
                return (
                  <View className="mt-2 gap-1.5">
                    {items.map((i) => (
                      <View key={i.cartId} style={{ gap: 2 }}>
                        <View className="flex-row justify-between">
                          <Text className="text-espresso flex-1">
                            {i.quantity}× {i.name}
                          </Text>
                          <Text className="text-espresso">{formatPrice(i.totalPrice)}</Text>
                        </View>
                        {/* Modifier chips and special instructions —
                            previously hidden on checkout. Customer
                            confirms exactly what they're ordering, including
                            "oat milk · less sweet" and any free-text note
                            for the barista, before paying. */}
                        {i.modifiers.length > 0 && (
                          <Text
                            className="text-muted-fg text-[12px]"
                            numberOfLines={2}
                            style={{ paddingRight: 60 }}
                          >
                            {i.modifiers.map((m) => m.label).join(" · ")}
                          </Text>
                        )}
                        {i.specialInstructions ? (
                          <Text
                            className="text-muted-fg text-[12px] italic"
                            numberOfLines={2}
                            style={{ paddingRight: 60 }}
                          >
                            “{i.specialInstructions}”
                          </Text>
                        ) : null}
                      </View>
                    ))}
                    <View className="flex-row justify-between mt-3 pt-3 border-t border-border">
                      <Text className="text-muted-fg">Subtotal</Text>
                      <Text className="text-espresso">{formatPrice(dispSubtotal)}</Text>
                    </View>
                    {effRewardName && effReward > 0 && (
                      <View className="flex-row justify-between">
                        <Text className="text-primary text-[13px]" numberOfLines={1}>
                          Reward · {effRewardName}
                        </Text>
                        <Text className="text-primary">−{formatPrice(effReward)}</Text>
                      </View>
                    )}
                    {dispPromos.map((d) => (
                      <View key={d.promotion_id} className="flex-row justify-between">
                        <Text className="text-primary text-[13px]" numberOfLines={1}>
                          {d.promotion_name}
                        </Text>
                        <Text className="text-primary">
                          −{formatPrice(d.discount_amount)}
                        </Text>
                      </View>
                    ))}
                    {sstConfig.enabled && dispSst > 0 && (
                      <View className="flex-row justify-between">
                        <Text className="text-muted-fg text-[13px]">
                          SST ({Math.round(sstConfig.rate * 100)}%)
                        </Text>
                        <Text className="text-muted-fg text-[13px]">{formatPrice(dispSst)}</Text>
                      </View>
                    )}
                    <View className="flex-row justify-between mt-2 pt-2 border-t border-border">
                      <Text className="text-espresso font-bold">Total</Text>
                      <Text
                        className="text-primary"
                        style={{ fontFamily: "Peachi-Bold" }}
                      >
                        {formatPrice(dispGrand)}
                      </Text>
                    </View>
                    {tier && tier.tier_name && (
                      <View className="flex-row justify-between mt-2">
                        <Text className="text-muted-fg text-[13px]" numberOfLines={1}>
                          {tier.tier_name}{(tier.tier_multiplier ?? 1) > 1 ? ` · earning ${tier.tier_multiplier}×` : ""}
                        </Text>
                        <Text
                          className="text-[13px]"
                          style={{ color: tier.tier_color ?? "#92400e" }}
                        >
                          +{Math.round(dispAfter * (tier.tier_multiplier ?? 1))} pts
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })()}
            </View>

            {!paymentsEnabled && (
              <View className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex-row gap-3">
                <AlertCircle size={18} color="#B45309" />
                <View className="flex-1">
                  <Text
                    className="text-amber-900 text-[14px]"
                    style={{ fontFamily: "Peachi-Bold" }}
                  >
                    Online ordering paused
                  </Text>
                  <Text
                    className="text-amber-800 text-[12px] mt-0.5"
                    style={{ fontFamily: "SpaceGrotesk_400Regular" }}
                  >
                    We're not taking online payments right now. Please order at the counter.
                  </Text>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Sticky bottom Place Order — visible without scrolling, total stays
          in view as customer scrolls through the summary above. */}
      {step === "review" && (
        <View
          className="bg-surface border-t border-border"
          style={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: insets.bottom + 12,
          }}
        >
          {lastError && (
            <Pressable
              onPress={() => setLastError(null)}
              className="bg-red-50 border border-red-200 rounded-2xl px-3 py-2 mb-2 flex-row items-start gap-2"
            >
              <AlertCircle size={14} color="#B91C1C" />
              <Text
                className="text-red-800 text-[11px] flex-1"
                style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                selectable
              >
                {lastError}
              </Text>
            </Pressable>
          )}
          {!isDineIn && outletClosed && pickupOffsetMin == null && (
            <View
              className="bg-amber-50 border border-amber-200 rounded-2xl px-3 py-2 mb-2 flex-row items-start gap-2"
            >
              <AlertCircle size={14} color="#92400e" />
              <Text
                className="text-amber-900 text-[12px] flex-1"
                style={{ fontFamily: "SpaceGrotesk_500Medium" }}
              >
                {currentOutlet?.name ?? "This outlet"} is closed right now. Schedule a pickup time above to place this order.
              </Text>
            </View>
          )}
          {rewardInvalidReason && (
            <View className="bg-red-50 border border-red-200 rounded-2xl px-3 py-2.5 mb-2 flex-row items-start gap-2">
              <AlertCircle size={15} color="#B91C1C" />
              <View className="flex-1">
                <Text className="text-red-800 text-[12.5px]" style={{ fontFamily: "Peachi-Bold" }}>
                  {appliedReward?.name
                    ? `${appliedReward.name} — can't be used here`
                    : "Reward can't be used here"}
                </Text>
                <Text
                  className="text-red-700 text-[12px] mt-0.5"
                  style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                >
                  {rewardInvalidReason}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setAppliedReward(null);
                  setReservedVoucher(null);
                }}
                hitSlop={8}
                className="active:opacity-70"
              >
                <Text className="text-red-700 text-[12px]" style={{ fontFamily: "Peachi-Bold" }}>
                  Remove
                </Text>
              </Pressable>
            </View>
          )}
          <PrimaryButton
            label={
              rewardInvalidReason
                ? "Remove reward to continue"
                : !paymentsEnabled
                ? "Online ordering paused"
                : !isDineIn && outletClosed && pickupOffsetMin == null
                  ? "Schedule a pickup time"
                  : selectedCategory === "ewallet" && !selectedWalletId
                    ? "Pick your wallet"
                    : !selectedMethodId
                      ? "Select a payment method"
                      : selectedMethodId === "fpx" && !fpxBankCode
                        ? "Pick your bank"
                        : `Place order · ${formatPrice(grandTotal)}`
            }
            onPress={onPlaceOrder}
            loading={busy}
            loadingLabel={busyLabel}
            disabled={
              !paymentsEnabled ||
              (!isDineIn && outletClosed && pickupOffsetMin == null) ||
              !selectedMethodId ||
              (selectedMethodId === "fpx" && !fpxBankCode) ||
              !!rewardInvalidReason
            }
          />
        </View>
      )}

      {/* Payment success overlay — animates over the checkout content
          for ~1.4s after a successful payment (or zero-amount bypass)
          before router.replace navigates to /order/[id]. Gives the
          customer a clear "yes, that worked" moment instead of an
          abrupt screen swap. Backdrop is semi-opaque cream so the
          rest of the page recedes without going to black. */}
      {paymentSuccess && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(255,247,231,0.96)",
            alignItems: "center",
            justifyContent: "center",
            opacity: successOpacity,
          }}
        >
          <Animated.View
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              backgroundColor: "#2E7D32", // success — Payment successful
              alignItems: "center",
              justifyContent: "center",
              transform: [{ scale: successScale }],
              shadowColor: "#2E7D32",
              shadowOpacity: 0.35,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 6 },
              elevation: 6,
            }}
          >
            <Check size={48} color="#FFFFFF" strokeWidth={3} />
          </Animated.View>
          <Animated.Text
            style={{
              marginTop: 18,
              color: "#160800",
              fontFamily: "Peachi-Bold",
              fontSize: 22,
              opacity: successOpacity,
            }}
          >
            Payment successful
          </Animated.Text>
          <Animated.Text
            style={{
              marginTop: 4,
              color: "rgba(26,2,0,0.6)",
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 13,
              opacity: successOpacity,
            }}
          >
            We're starting on your order now
          </Animated.Text>
        </Animated.View>
      )}

      {/* E-Wallet picker sheet — tapping the E-Wallet group row opens
          this. Selecting a wallet sets selectedWalletId + closes. */}
      <BottomSheet
        visible={walletSheetOpen}
        onClose={() => setWalletSheetOpen(false)}
        title="Select your E-Wallet"
      >
        <View style={{ paddingHorizontal: 16, gap: 4 }}>
          {wallets.map((w, idx) => {
            const picked = selectedWalletId === w.method_id;
            return (
              <Pressable
                key={w.method_id}
                onPress={() => {
                  Haptics.selectionAsync();
                  setSelectedWalletId(w.method_id);
                  setWalletSheetOpen(false);
                }}
                className={`flex-row items-center gap-3 py-3 ${
                  idx > 0 ? "border-t border-border" : ""
                } active:opacity-70`}
              >
                <PaymentBrandIcon methodId={w.method_id} size={40} />
                <Text className="flex-1 text-espresso text-[15px] font-bold">
                  {METHOD_LABELS[w.method_id] ?? w.method_id}
                </Text>
                {picked && <Check size={18} color="#A2492C" />}
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>

      {/* FPX bank picker sheet — same pattern, but the row component
          (FpxBankPicker) renders its own list. We dismiss as soon as a
          bank is picked. */}
      <BottomSheet
        visible={bankSheetOpen}
        onClose={() => setBankSheetOpen(false)}
        title="Select your Bank"
      >
        <View style={{ paddingHorizontal: 16 }}>
          <FpxBankPicker
            selectedCode={fpxBankCode}
            onSelect={(code) => {
              setFpxBankCode(code);
              setBankSheetOpen(false);
            }}
          />
        </View>
      </BottomSheet>

      {/* Pickup time picker — Now row first (Starbucks default),
          then a list of +15/+30/+45/+60/+90/+120 min offsets with the
          absolute clock time alongside. Mirrors the wallet sheet's
          single-tap-and-close pattern. */}
      <BottomSheet
        visible={pickupSheetOpen}
        onClose={() => setPickupSheetOpen(false)}
        title="When do you want it?"
      >
        <View style={{ paddingHorizontal: 16, gap: 4 }}>
          {/* When outlet is closed and we know next-open, surface a
              dedicated "When we open" row at the top. Selecting it
              schedules pickup_at to ~5 min after next_open so brew can
              actually start at open-time. */}
          {!nowAvailable && nextOpenAt && (() => {
            const offsetToOpen = Math.max(
              1,
              Math.round((nextOpenAt.getTime() - Date.now()) / 60_000) + 5,
            );
            const picked = pickupOffsetMin === offsetToOpen;
            const openLabel = fmtClock(nextOpenAt);
            return (
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setPickupOffsetMin(offsetToOpen);
                  setPickupSheetOpen(false);
                }}
                className="flex-row items-center gap-3 py-3 active:opacity-70"
              >
                <View
                  style={{
                    width: 40, height: 40, borderRadius: 20,
                    backgroundColor: "#FBEBE8",
                    alignItems: "center", justifyContent: "center",
                  }}
                >
                  <CalendarClock size={18} color="#A2492C" />
                </View>
                <View className="flex-1">
                  <Text className="text-espresso text-[15px] font-bold">
                    When we open
                  </Text>
                  <Text className="text-muted-fg text-[12px]">
                    {nextOpenAt.toDateString() === new Date().toDateString()
                      ? `Today · ${openLabel}`
                      : `Tomorrow · ${openLabel}`}
                  </Text>
                </View>
                {picked && <Check size={18} color="#A2492C" />}
              </Pressable>
            );
          })()}
          {nowAvailable && (
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setPickupOffsetMin(null);
                setPickupSheetOpen(false);
              }}
              className="flex-row items-center gap-3 py-3 active:opacity-70"
            >
              <View
                style={{
                  width: 40, height: 40, borderRadius: 20,
                  backgroundColor: "#FBEBE8",
                  alignItems: "center", justifyContent: "center",
                }}
              >
                <Clock size={18} color="#A2492C" />
              </View>
              <View className="flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className="text-espresso text-[15px] font-bold">
                    Now
                  </Text>
                  <View
                    style={{
                      backgroundColor: "#FBEBE8",
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      borderRadius: 4,
                    }}
                  >
                    <Text
                      style={{
                        color: "#A2492C",
                        fontSize: 9,
                        fontFamily: "Peachi-Bold",
                        letterSpacing: 1,
                      }}
                    >
                      DEFAULT
                    </Text>
                  </View>
                </View>
                <Text className="text-muted-fg text-[12px]">
                  Ready in {nowRangeMins} min
                </Text>
              </View>
              {pickupOffsetMin == null && <Check size={18} color="#A2492C" />}
            </Pressable>
          )}
          {visibleOffsets.map((mins) => {
            const picked = pickupOffsetMin === mins;
            return (
              <Pressable
                key={mins}
                onPress={() => {
                  Haptics.selectionAsync();
                  setPickupOffsetMin(mins);
                  setPickupSheetOpen(false);
                }}
                className="flex-row items-center gap-3 py-3 border-t border-border active:opacity-70"
              >
                <View
                  style={{
                    width: 40, height: 40, borderRadius: 20,
                    backgroundColor: picked ? "#FBEBE8" : "#F5F5F5",
                    alignItems: "center", justifyContent: "center",
                  }}
                >
                  <CalendarClock size={18} color={picked ? "#A2492C" : "#8E8E93"} />
                </View>
                <View className="flex-1">
                  <Text className="text-espresso text-[15px] font-bold">
                    In {mins} min
                  </Text>
                  <Text className="text-muted-fg text-[12px]">
                    {formatPickupLabel(mins)}
                  </Text>
                </View>
                {picked && <Check size={18} color="#A2492C" />}
              </Pressable>
            );
          })}
          {!nowAvailable && visibleOffsets.length === 0 && !nextOpenAt && (
            <View className="py-6 items-center">
              <Text className="text-muted-fg text-sm text-center">
                No pickup times available right now.
              </Text>
            </View>
          )}
        </View>
      </BottomSheet>

      <RmCheckoutModal
        visible={!!rmModal}
        url={rmModal?.url ?? null}
        methodLabel={rmModal?.method ?? ""}
        amountLabel={rmModal?.amount}
        methodId={rmModal?.methodId}
        onSuccess={() => {
          setRmModal(null);
          rmModalResolveRef.current?.("success");
          rmModalResolveRef.current = null;
        }}
        onCancel={() => {
          setRmModal(null);
          rmModalResolveRef.current?.("cancel");
          rmModalResolveRef.current = null;
        }}
      />
    </View>
  );
}
