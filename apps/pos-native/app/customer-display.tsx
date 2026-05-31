import { useEffect, useState } from "react";
import { View, Text, Image, FlatList, ScrollView, Pressable, ActivityIndicator } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { Gift, Tag, Coffee, Sparkles, Delete } from "lucide-react-native";
import { useCart, cartSubtotal } from "@/lib/cart";
import { useDisplay } from "@/lib/display";
import { usePos } from "@/lib/store";
import { useSettings, serviceChargeRate } from "@/lib/settings";
import { useMaybankQr } from "@/lib/maybank-qr";
import { outletShort } from "@/lib/outlets";
import {
  lookupMember, fetchSnapshot, claimMystery, fetchRewards, fetchActivePromos,
  type LoyaltySnapshot, type VoucherCard, type ClaimableCard, type ShopCard, type MissionCard, type BiteItem, type IssuedVoucher, type ActivePromo,
} from "@/lib/loyalty";
import { fetchPosters, type DisplayPoster } from "@/lib/posters";
import { fetchBites, type DisplayBite } from "@/lib/menu";

/**
 * Customer-facing second screen — native rebuild matching the web POS
 * customer-display PWA (apps/pos/src/app/customer-display). Reads the
 * shared in-process zustand stores the register writes (cart + display)
 * and self-fetches the loyalty snapshot + posters. Hosted full-screen on
 * the SUNMI secondary display by the customer-display Presentation module.
 */
const PAGE = "#160800";
const SUB = "#0F0500";
const CREAM = "#F5F3F0";
const GOLD = "#FBBF24";
const TERRA = "#A2492C";
const GREEN = "#86efac";
const DARKFG = "#1A0200";
const rm = (sen: number) => `RM ${(sen / 100).toFixed(2)}`;

function lum(hex?: string | null): number {
  if (!hex) return 1;
  const c = hex.replace("#", "");
  if (c.length < 6) return 1;
  const r = parseInt(c.slice(0, 2), 16) / 255, g = parseInt(c.slice(2, 4), 16) / 255, b = parseInt(c.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export default function CustomerDisplay() {
  const lines = useCart((s) => s.lines);
  const status = useDisplay((s) => s.status);
  const member = useDisplay((s) => s.member);
  const orderType = useDisplay((s) => s.orderType);
  const tableNumber = useDisplay((s) => s.tableNumber);
  const reward = useDisplay((s) => s.reward);
  const extraDiscount = useDisplay((s) => s.extraDiscount);
  const manualDiscount = useDisplay((s) => s.manualDiscount);
  const orderNumber = useDisplay((s) => s.orderNumber);
  const payTotal = useDisplay((s) => s.payTotal);
  const outletId = usePos((s) => s.outletId);
  const settings = useSettings((s) => s.settings);
  // Backoffice-managed Maybank QR (live via realtime on app_settings).
  // Returns { payload, image_url }: image_url is the uploaded Maybank
  // poster (preferred — actual pink poster customers know), payload is
  // the merchant id fallback that we render via QRCode.
  const maybankQr = useMaybankQr(outletId);
  // 60/40 columns sized from the row's ACTUAL on-screen width (measured via
  // onLayout). We can't use useWindowDimensions here: this view lives on the
  // secondary SUNMI screen via a Presentation, and useWindowDimensions reports
  // the MAIN display's metrics — 60% of that overflows the 1280px panel and
  // shoves the right column off-screen. onLayout reflects reality on any display.
  const [rowW, setRowW] = useState(0);
  const heroW = rowW > 0 ? Math.round(rowW * 0.65) : 0;
  const sideW = rowW > 0 ? rowW - heroW : 0;
  // The Scan-to-Pay screen measures its own frame (the SUNMI customer
  // display is FLAG_SECURE — can't be screenshot — so we size everything
  // off the REAL on-screen dimensions instead of hardcoded guesses that
  // overflow). Logged once so the actual panel size is knowable.
  const [payFrame, setPayFrame] = useState({ w: 0, h: 0 });
  // Measured size of the flex-middle QR slot (the space left after the fixed
  // amount/beans header + bottom hints). The QR is sized off THIS, never the
  // whole frame, so the card can't push the amount/hints off-screen.
  const [paySlot, setPaySlot] = useState({ w: 0, h: 0 });

  const [snapshot, setSnapshot] = useState<LoyaltySnapshot | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);
  const [posters, setPosters] = useState<DisplayPoster[]>([]);
  const [heroBites, setHeroBites] = useState<DisplayBite[]>([]);
  // Guest fallback: snapshot.active_promos is member-gated, so when no
  // one's signed in we'd otherwise show NO combo banners. Load promos
  // independently from the public promotions table so the deals
  // surface for every customer, member or not.
  const [guestPromos, setGuestPromos] = useState<ActivePromo[]>([]);
  // Pop-up sign-in keypad for the ORDERING screen (its right column is too
  // narrow for an inline keypad; idle keeps the keypad always visible).
  const [signInOpen, setSignInOpen] = useState(false);
  // Redeem-reward pop-up (ordering screen). Sends the picked voucher to the
  // register via the reverse channel; the register applies it to the cart.
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeemList, setRedeemList] = useState<IssuedVoucher[]>([]);
  const [redeemLoading, setRedeemLoading] = useState(false);
  const setRedeemRequest = useDisplay((s) => s.setRedeemRequest);

  useEffect(() => { fetchPosters().then(setPosters).catch(() => {}); }, []);
  useEffect(() => { fetchBites(9).then(setHeroBites).catch(() => {}); }, []);
  useEffect(() => { fetchActivePromos().then(setGuestPromos).catch(() => {}); }, []);
  // Close the pop-up once a member is identified.
  useEffect(() => { if (member) setSignInOpen(false); }, [member]);

  useEffect(() => {
    if (!member?.id) { setSnapshot(null); return; }
    setSnapLoading(true);
    fetchSnapshot(member.id).then(setSnapshot).finally(() => setSnapLoading(false));
  }, [member?.id]);

  // Re-pull on completion so a freshly-awarded mystery drop surfaces.
  useEffect(() => {
    if (status === "complete" && member?.id) fetchSnapshot(member.id).then(setSnapshot).catch(() => {});
  }, [status]);

  function openRedeem() {
    if (!member) return;
    setRedeemOpen(true);
    setRedeemLoading(true);
    fetchRewards(member.id)
      .then((r) => setRedeemList(r.issued))
      .catch(() => setRedeemList([]))
      .finally(() => setRedeemLoading(false));
  }

  const subtotal = cartSubtotal(lines);
  const scRate = serviceChargeRate(settings);
  const serviceCharge = orderType === "dine_in" ? Math.round((subtotal * scRate) / 100) : 0;
  const rewardDisc = reward?.discountSen ?? 0;
  const extraDisc = extraDiscount?.sen ?? 0;
  const manualDisc = manualDiscount?.sen ?? 0;
  const total = Math.max(0, subtotal + serviceCharge - rewardDisc - extraDisc - manualDisc);
  const outletName = outletShort(outletId) || "Celsius Coffee";
  const hasCart = lines.length > 0;

  // ── 1. Payment ──
  if (status === "payment") {
    const imageUrl = maybankQr?.image_url ?? null;
    const merchantId = maybankQr?.payload ?? "";
    const hasAny = !!imageUrl || !!merchantId;
    // Beans this order earns. 1 Bean per RM (points_per_rm default) on the
    // post-discount total — members bank it; guests see what they're
    // missing as a sign-up nudge. (Matches the order app's basePoints =
    // floor(afterDiscount/100 * pointsPerRm), members only.)
    const beans = Math.max(0, Math.floor((payTotal || total) / 100));
    const cardShadow = {
      shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 28,
      shadowOffset: { width: 0, height: 14 }, elevation: 10,
    } as const;
    // Amount scales with the frame height (capped). The QR is sized off the
    // MEASURED middle slot below — card height ≈ qr×1.39 and width ≈ qr×1.2,
    // so dividing the slot by those (≈ ×0.70 / ×0.80) keeps the whole card
    // inside the leftover space. Conservative slot fallback errs SMALL so the
    // first paint is never oversized.
    const fh = payFrame.h || 600;
    const amt = Math.max(28, Math.min(Math.round(fh * 0.075), 50));
    const sh = paySlot.h || 280;
    const sw = paySlot.w || 880;
    const qr = Math.max(150, Math.min(Math.round(sh * 0.70), Math.round(sw * 0.80), 320));
    return (
      <View
        onLayout={(e) => {
          const l = e.nativeEvent.layout;
          if (Math.abs(l.width - payFrame.w) > 2 || Math.abs(l.height - payFrame.h) > 2) {
            setPayFrame({ w: l.width, h: l.height });
          }
        }}
        className="flex-1 items-center"
        style={{ backgroundColor: PAGE, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 }}
      >
        {/* Fixed header — amount + Beans (always visible) */}
        <View className="items-center">
          <Eyebrow color={GOLD}>SCAN TO PAY</Eyebrow>
          <Text style={{ fontFamily: "Peachi-Bold", fontSize: amt, lineHeight: Math.round(amt * 1.05), color: GOLD, marginTop: 2 }}>{rm(payTotal || total)}</Text>
          {beans > 0 && (
            <View
              className="flex-row items-center rounded-full"
              style={{
                marginTop: 8, gap: 7, paddingHorizontal: 14, paddingVertical: 5,
                backgroundColor: member ? "rgba(251,191,36,0.12)" : "rgba(134,239,172,0.10)",
                borderWidth: 1,
                borderColor: member ? "rgba(251,191,36,0.40)" : "rgba(134,239,172,0.30)",
              }}
            >
              <Sparkles size={14} color={member ? GOLD : GREEN} />
              <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 13, color: member ? GOLD : GREEN }}>
                {member ? `You'll earn ${beans} Beans` : `Sign up & earn ${beans} Beans`}
              </Text>
            </View>
          )}
        </View>

        {/* Flex middle — the QR card fits THIS slot; can't overflow the panel */}
        <View
          className="self-stretch items-center justify-center"
          style={{ flex: 1, marginVertical: 8 }}
          onLayout={(e) => {
            const l = e.nativeEvent.layout;
            if (Math.abs(l.width - paySlot.w) > 2 || Math.abs(l.height - paySlot.h) > 2) {
              setPaySlot({ w: l.width, h: l.height });
              console.log(`[cust-pay] slot ${Math.round(l.width)}x${Math.round(l.height)} qr=${qr}`);
            }
          }}
        >
          {hasAny ? (
            <View className="items-center" style={{ backgroundColor: "#fff", borderRadius: Math.round(qr * 0.09), paddingHorizontal: Math.round(qr * 0.1), paddingVertical: Math.round(qr * 0.085), ...cardShadow }}>
              <View className="flex-row items-center" style={{ gap: 6, marginBottom: Math.round(qr * 0.05) }}>
                <Text style={{ fontFamily: "Peachi-Bold", fontSize: Math.round(qr * 0.075), color: "#EC1C7E" }}>DuitNow</Text>
                <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: Math.round(qr * 0.048), color: "#555" }}>QR</Text>
              </View>
              {imageUrl ? (
                <Image source={{ uri: imageUrl }} style={{ width: qr, height: qr }} resizeMode="contain" />
              ) : (
                <QRCode value={merchantId} size={qr} backgroundColor="#fff" color="#160800" />
              )}
              <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: Math.round(qr * 0.044), letterSpacing: 0.4, color: "#555", marginTop: Math.round(qr * 0.05) }}>Malaysia National QR · Maybank</Text>
            </View>
          ) : (
            <View className="items-center justify-center" style={{ maxWidth: 420, paddingVertical: 34, paddingHorizontal: 40, borderRadius: 28, borderWidth: 1, borderColor: "rgba(251,191,36,0.35)", backgroundColor: "rgba(251,191,36,0.07)" }}>
              <Text style={{ fontFamily: "Peachi-Bold", fontSize: 28, color: GOLD, textAlign: "center" }}>Pay at the counter</Text>
              <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 15, color: "rgba(245,243,240,0.7)", marginTop: 10, textAlign: "center" }}>Please complete payment with our cashier</Text>
            </View>
          )}
        </View>

        {/* Fixed footer hints (always visible) */}
        {hasAny && (
          <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 13, color: "rgba(245,243,240,0.55)" }}>
            Scan with any banking or e-wallet app
          </Text>
        )}
        {!!orderNumber && (
          <Text style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 12, letterSpacing: 2, color: "rgba(245,243,240,0.35)", marginTop: 5 }}>
            {orderNumber}
          </Text>
        )}
      </View>
    );
  }

  // ── 2. Complete / Thank-you ──
  if (status === "complete") {
    const mystery = snapshot?.claimables.find((c) => c.source_type === "mystery_pending");
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: PAGE }}>
        <View className="h-24 w-24 rounded-full items-center justify-center mb-6" style={{ backgroundColor: "rgba(34,197,94,0.18)" }}>
          <Text style={{ fontSize: 52, color: GREEN, fontFamily: "Peachi-Bold" }}>✓</Text>
        </View>
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 52, color: CREAM }}>Thank You</Text>
        {!!orderNumber && <Eyebrow color="rgba(245,243,240,0.55)" style={{ marginTop: 12 }}>{orderNumber}</Eyebrow>}
        <Text style={{ fontFamily: "Peachi-Medium", fontSize: 22, color: "rgba(245,243,240,0.7)", marginTop: 16 }}>Your order is being prepared</Text>
        {mystery && member?.id && <MysteryBox memberId={member.id} claimable={mystery} />}
      </View>
    );
  }

  // ── 3. Idle / welcome ──
  if (!hasCart) {
    // Identified member (rewards loaded) → AVAILABLE REWARDS on the LEFT,
    // identity card on the RIGHT. Gives a returning regular something to act
    // on while idle. Poster sits above the rewards so brand content stays.
    if (member && snapshot) {
      return (
        <View className="flex-1 flex-row" style={{ backgroundColor: PAGE }}>
          <View className="flex-1 p-6">
            {posters.length > 0 && (
              <View style={{ flex: 0.85 }} className="items-center">
                <Posters posters={posters} />
                <Eyebrow color="rgba(245,243,240,0.45)" style={{ marginTop: 10 }}>TODAY AT CELSIUS COFFEE</Eyebrow>
              </View>
            )}
            <View style={{ flex: 1.15, marginTop: posters.length > 0 ? 14 : 0 }}>
              <Eyebrow color="rgba(245,243,240,0.45)" style={{ marginBottom: 8, paddingHorizontal: 4 }}>AVAILABLE REWARDS</Eyebrow>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
                <ClaimableRewards snapshot={snapshot} memberId={member.id} />
              </ScrollView>
            </View>
          </View>
          <View className="items-center justify-center p-8" style={{ width: 430, borderLeftWidth: 1, borderColor: "rgba(245,243,240,0.08)", backgroundColor: SUB }}>
            <Image source={require("@/assets/icon.png")} style={{ width: 72, height: 72, borderRadius: 18, marginBottom: 12 }} resizeMode="contain" />
            <PendingOrMemberHeader member={member} />
          </View>
        </View>
      );
    }
    // Guest, or member still loading → poster + self-identify.
    return (
      <View className="flex-1 flex-row" style={{ backgroundColor: PAGE }}>
        {posters.length > 0 && (
          <View className="flex-1 items-center p-6">
            <Posters posters={posters} />
            <Eyebrow color="rgba(245,243,240,0.45)" style={{ marginTop: 10 }}>TODAY AT CELSIUS COFFEE</Eyebrow>
          </View>
        )}
        <View
          className="items-center justify-center p-8"
          style={posters.length > 0 ? { width: 460, borderLeftWidth: 1, borderColor: "rgba(245,243,240,0.08)", backgroundColor: SUB } : { flex: 1 }}
        >
          <Image source={require("@/assets/icon.png")} style={{ width: 72, height: 72, borderRadius: 18, marginBottom: 10 }} resizeMode="contain" />
          {member ? <PendingOrMemberHeader member={member} /> : (
            <>
              <Text style={{ fontFamily: "Peachi-Bold", fontSize: 28, color: CREAM }}>Welcome back</Text>
              <Eyebrow color="rgba(245,243,240,0.55)" style={{ marginTop: 6 }}>ENTER YOUR PHONE FOR REWARDS</Eyebrow>
              <Numpad outletId={outletId} />
            </>
          )}
        </View>
      </View>
    );
  }

  // ── 4. Ordering — 60/20/20: upsell hero (main) | order | rewards ──
  // Guest-friendly bites (general fetch) drive the hero; fall back to the
  // member's popular bites if the general list hasn't loaded. 8 items =
  // two rows of 4 — gives customers more choice without scrolling.
  const bites = (heroBites.length > 0 ? heroBites : pickBites(snapshot)).slice(0, 8);
  // Combo/promo offers are badged ONTO the matching bite card (matched by
  // category/name). Anything that doesn't map to a shown bite surfaces as a
  // slim chip row so no live offer is lost. Snapshot is member-only;
  // fall through to the guest promos so non-members still see deals.
  const liveOffers = (snapshot?.active_promos && snapshot.active_promos.length > 0
    ? snapshot.active_promos
    : guestPromos
  ).filter((p) => p.live);
  const biteOffers = bites.map((b) => matchOffer(b, liveOffers));
  const matchedIds = new Set(biteOffers.filter(Boolean).map((p) => p!.id));
  const unmatchedOffers = liveOffers.filter((p) => !matchedIds.has(p.id)).slice(0, 3);
  return (
    <View
      className="flex-1 flex-row"
      style={{ backgroundColor: PAGE }}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - rowW) > 0.5) setRowW(w);
      }}
    >
      {/* ═══ MAIN UPSELL — 60% (explicit px from measured width; flex until measured) ═══
          Designed to fit on display 1 (1280×800) with NO vertical scroll.
          Header (~50px) + chips row (~28px when shown) + 2 tile rows
          (~620px) = ~700px, leaves room within the column's height. */}
      <View style={rowW > 0 ? { width: heroW } : { flex: 3 }} className="px-5 pt-4 pb-3">
        <View className="flex-row items-center" style={{ gap: 8, marginBottom: 1 }}>
          <Image source={require("@/assets/icon.png")} style={{ width: 28, height: 28, borderRadius: 7 }} resizeMode="contain" />
          <Text style={{ fontFamily: "Peachi-Bold", fontSize: 22, color: CREAM }}>Pair with a bite</Text>
        </View>
        <Eyebrow color="rgba(251,191,36,0.85)" style={{ letterSpacing: 2, fontSize: 10 }}>ADD A LITTLE SOMETHING TO YOUR ORDER</Eyebrow>

        {/* No ScrollView — content sizes to fit the column. flex:1 lets
            the bite grid take the remaining vertical room evenly. */}
        <View style={{ flex: 1, marginTop: 10 }}>
          {unmatchedOffers.length > 0 && (
            <View className="flex-row flex-wrap" style={{ gap: 6, marginBottom: 8 }}>
              {unmatchedOffers.map((p) => (
                <View key={p.id} className="flex-row items-center rounded-full px-2.5 py-1" style={{ backgroundColor: TERRA + "22", borderWidth: 1, borderColor: TERRA + "55", gap: 5 }}>
                  <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10, color: GOLD }}>{offerPill(p.discount_label)}</Text>
                  <Text style={{ fontFamily: "Peachi-Medium", fontSize: 11, color: CREAM }} numberOfLines={1}>{offerHook(p)}</Text>
                </View>
              ))}
            </View>
          )}
          <View className="flex-row flex-wrap" style={{ justifyContent: "space-between", rowGap: 10 }}>
            {bites.map((b, i) => <BiteCard key={b.id} bite={b} offer={biteOffers[i]} />)}
            {bites.length === 0 && (
              <Text style={{ fontFamily: "SpaceGrotesk_500Medium", color: "rgba(245,243,240,0.4)", fontSize: 14 }}>Ask our barista about today's treats.</Text>
            )}
          </View>
        </View>
      </View>

      {/* ═══ RIGHT 40% = MEMBER/TIER (top) + CART (below) ═══ */}
      <View style={rowW > 0 ? { width: sideW, borderLeftWidth: 1, borderColor: "rgba(245,243,240,0.08)", backgroundColor: SUB } : { flex: 2, borderLeftWidth: 1, borderColor: "rgba(245,243,240,0.08)", backgroundColor: SUB }}>
        {/* ── NAME + TIER — top (compact, content-sized; full rewards live on
            the idle screen so this stays small and the cart gets the room) ── */}
        <View style={{ borderBottomWidth: 1, borderColor: "rgba(245,243,240,0.1)" }} className="px-4 py-4">
          {member ? (
            snapshot ? (
              <BeansHero
                snapshot={snapshot}
                memberName={member.name}
                redeemedReward={reward ? { name: reward.name } : null}
                onRedeem={openRedeem}
              />
            ) :
            snapLoading ? <View className="items-center py-6"><ActivityIndicator color={GOLD} /></View> :
            <PendingMemberPanel member={member} />
          ) : (
            <SignInButton onPress={() => setSignInOpen(true)} />
          )}
        </View>

        {/* ── CART — below ── */}
        <View style={{ flex: 1 }} className="px-5 pt-4 pb-4">
          <View className="flex-row items-center justify-between mb-2">
            <Text style={{ fontFamily: "Peachi-Bold", fontSize: 16, color: CREAM }}>Your Order</Text>
            <Text style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 11, color: "rgba(245,243,240,0.6)" }}>
              {orderType === "dine_in" ? (tableNumber ? `Dine-in · T${tableNumber}` : "Dine-in") : "Takeaway"}
            </Text>
          </View>
          <FlatList
            data={lines}
            keyExtractor={(l) => l.key}
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const gross = item.unit_sen * item.qty;
              const lineDisc = item.line_discount_sen ?? 0;
              const net = Math.max(0, gross - lineDisc);
              return (
                <View className="py-1.5">
                  <View className="flex-row items-center justify-between">
                    <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 12.5, color: "rgba(245,243,240,0.85)", flex: 1 }} numberOfLines={1}>
                      <Text style={{ color: "rgba(245,243,240,0.4)" }}>{item.qty}× </Text>{item.product.name}
                    </Text>
                    <View className="items-end" style={{ marginLeft: 8 }}>
                      {lineDisc > 0 && (
                        <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 10, color: "rgba(245,243,240,0.35)", textDecorationLine: "line-through" }}>{rm(gross)}</Text>
                      )}
                      <Text style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 12, color: "rgba(245,243,240,0.7)" }}>{rm(net)}</Text>
                    </View>
                  </View>
                  {lineDisc > 0 && (
                    <Text style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 10, color: GREEN, marginLeft: 14, marginTop: 1 }}>
                      − {rm(lineDisc)} OFF
                    </Text>
                  )}
                </View>
              );
            }}
          />
          {/* Redeem button moved onto the BeansHero tier card above to
              free vertical room in the cart for more order lines. */}
          <View style={{ borderTopWidth: 1, borderColor: "rgba(245,243,240,0.12)", paddingTop: 8, gap: 3 }}>
            <Row label="Subtotal" value={rm(subtotal)} />
            {serviceCharge > 0 && <Row label="Service" value={rm(serviceCharge)} />}
            {rewardDisc > 0 && <Row label={reward?.name ?? "Reward"} value={`−${rm(rewardDisc)}`} green />}
            {extraDisc > 0 && <Row label={extraDiscount?.label || "Discount"} value={`−${rm(extraDisc)}`} green />}
            {manualDisc > 0 && <Row label={manualDiscount?.label || "Discount"} value={`−${rm(manualDisc)}`} green />}
            <View className="flex-row justify-between items-baseline" style={{ marginTop: 2 }}>
              <Text style={{ fontFamily: "Peachi-Bold", fontSize: 16, color: CREAM }}>Total</Text>
              <Text style={{ fontFamily: "Peachi-Bold", fontSize: 22, color: GOLD }}>{rm(total)}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Pop-up sign-in keypad — ordering screen only (compact right column). */}
      {signInOpen && (
        <Pressable onPress={() => setSignInOpen(false)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.78)", alignItems: "center", justifyContent: "center" }}>
          <Pressable onPress={() => {}} className="rounded-3xl px-7 py-6 items-center" style={{ backgroundColor: SUB, borderWidth: 1, borderColor: "rgba(245,243,240,0.12)" }}>
            <Text style={{ fontFamily: "Peachi-Bold", fontSize: 20, color: CREAM }}>Sign in for rewards</Text>
            <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 12.5, color: "rgba(245,243,240,0.55)", marginTop: 2 }}>Enter your phone number</Text>
            <Numpad outletId={outletId} />
            <Pressable onPress={() => setSignInOpen(false)} className="mt-3 active:opacity-60">
              <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 12, letterSpacing: 1, color: "rgba(245,243,240,0.5)" }}>CLOSE</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      )}

      {/* Pop-up redeem-reward picker (ordering screen). */}
      {redeemOpen && (
        <Pressable onPress={() => setRedeemOpen(false)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.78)", alignItems: "center", justifyContent: "center" }}>
          <Pressable onPress={() => {}} className="rounded-3xl px-6 py-6" style={{ width: 470, maxHeight: "84%", backgroundColor: SUB, borderWidth: 1, borderColor: "rgba(245,243,240,0.12)" }}>
            <Text style={{ fontFamily: "Peachi-Bold", fontSize: 20, color: CREAM, textAlign: "center" }}>Redeem a reward</Text>
            <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 12.5, color: "rgba(245,243,240,0.55)", textAlign: "center", marginTop: 2, marginBottom: 12 }}>Tap a reward to apply it to your order</Text>
            {redeemLoading ? (
              <View className="items-center py-10"><ActivityIndicator color={GOLD} /></View>
            ) : redeemList.length === 0 ? (
              <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 13, color: "rgba(245,243,240,0.5)", textAlign: "center", paddingVertical: 28 }}>No rewards to redeem yet.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {redeemList.map((v) => (
                  <Pressable key={v.id} onPress={() => { setRedeemRequest({ rewardId: v.reward_id ?? v.id, issuedRewardId: v.id, name: v.title }); setRedeemOpen(false); }} className="flex-row items-center rounded-2xl px-3.5 py-3 active:opacity-80" style={{ backgroundColor: "#FBEBE8", borderWidth: 1, borderColor: "rgba(162,73,44,0.22)", gap: 11 }}>
                    <View className="h-10 w-10 rounded-xl items-center justify-center" style={{ backgroundColor: TERRA }}><Tag size={18} color="#fff" /></View>
                    <View className="flex-1">
                      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 15, color: DARKFG }} numberOfLines={1}>{v.title}</Text>
                      <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 11, color: "rgba(26,2,0,0.55)" }} numberOfLines={1}>{voucherSummary(v)}</Text>
                    </View>
                    <View className="rounded-full px-3 py-1.5" style={{ backgroundColor: TERRA }}><Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10, color: "#fff" }}>USE</Text></View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Pressable onPress={() => setRedeemOpen(false)} className="mt-3 items-center active:opacity-60">
              <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 12, letterSpacing: 1, color: "rgba(245,243,240,0.5)" }}>CLOSE</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      )}
    </View>
  );
}

// ─── shared bits ───────────────────────────────────────────

function Eyebrow({ children, color, style }: { children: React.ReactNode; color: string; style?: any }) {
  return <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 11, letterSpacing: 2, color, ...(style ?? {}) }}>{children}</Text>;
}
function Row({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <View className="flex-row justify-between">
      <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 13, color: green ? GREEN : "rgba(245,243,240,0.55)" }} numberOfLines={1}>{label}</Text>
      <Text style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 13, color: green ? GREEN : "rgba(245,243,240,0.8)" }}>{value}</Text>
    </View>
  );
}
function Centered({ children }: { children: React.ReactNode }) {
  return <View className="flex-1 items-center justify-center p-6">{children}</View>;
}

function PendingOrMemberHeader({ member }: { member: NonNullable<ReturnType<typeof useDisplay.getState>["member"]> }) {
  // Name on its own line, auto-shrinks to fit — "Welcome back, {name}" was
  // wrapping awkwardly in this narrow column when the name was long.
  const tierColor = member?.tierColor && lum(member.tierColor) >= 0.08 ? member.tierColor : GOLD;
  return (
    <View className="items-center w-full">
      <Eyebrow color="rgba(245,243,240,0.55)">WELCOME BACK</Eyebrow>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{ fontFamily: "Peachi-Bold", fontSize: 26, color: CREAM, marginTop: 3, textAlign: "center" }}
      >
        {member?.name ?? "Member"}
      </Text>
      {!!member?.tierName && (
        <View className="mt-2 rounded-full px-3 py-1" style={{ backgroundColor: tierColor + "22", borderWidth: 1, borderColor: tierColor + "55" }}>
          <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10, letterSpacing: 1.5, color: tierColor }}>{member.tierName.toUpperCase()}</Text>
        </View>
      )}
      {/* Compact beans chip (about half the previous card) */}
      <View className="mt-3 flex-row items-baseline rounded-2xl px-5 py-2" style={{ backgroundColor: "rgba(251,191,36,0.1)", borderWidth: 1, borderColor: "rgba(251,191,36,0.3)", gap: 6 }}>
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 24, color: GOLD }}>{(member?.pointsBalance ?? 0).toLocaleString()}</Text>
        <Eyebrow color="rgba(251,191,36,0.7)">BEANS</Eyebrow>
      </View>
    </View>
  );
}

// ─── Poster carousel ───────────────────────────────────────
function Posters({ posters }: { posters: DisplayPoster[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (posters.length < 2) return;
    const ms = posters[i]?.durationMs ?? 4500;
    const t = setTimeout(() => setI((x) => (x + 1) % posters.length), ms);
    return () => clearTimeout(t);
  }, [i, posters]);
  const p = posters[Math.min(i, posters.length - 1)];
  return (
    <View className="w-full rounded-2xl overflow-hidden" style={{ flex: 1, backgroundColor: PAGE }}>
      {p && <Image source={{ uri: p.imageUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />}
      {posters.length > 1 && (
        <View className="absolute bottom-3 left-0 right-0 flex-row justify-center" style={{ gap: 6 }}>
          {posters.map((_, n) => (
            <View key={n} style={{ height: 6, borderRadius: 3, width: n === i ? 18 : 6, backgroundColor: n === i ? "#fff" : "rgba(255,255,255,0.55)" }} />
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Guest sign-in CTA (opens the pop-up keypad) ───────────
/** Compact "Sign in" CTA for the ordering screen's narrow column. Tapping it
 *  opens the pop-up keypad (idle keeps the keypad inline & always visible). */
function SignInButton({ onPress }: { onPress: () => void }) {
  return (
    <View className="items-center" style={{ gap: 9 }}>
      {/* Headline phrased for the customer, not the staff — "Member? Earn
          Beans" assumed customers know the loyalty currency name. "Get
          Rewards" reads cold and still invites the action. */}
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 19, color: CREAM, textAlign: "center" }}>Get Rewards</Text>
      <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 12.5, color: "rgba(245,243,240,0.55)", textAlign: "center" }}>Sign in with your phone to earn + redeem</Text>
      <Pressable onPress={onPress} className="rounded-2xl px-8 py-3 mt-1 active:opacity-80" style={{ backgroundColor: GOLD }}>
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 13, letterSpacing: 1.6, color: DARKFG }}>SIGN IN</Text>
      </Pressable>
    </View>
  );
}

// ─── Self-identify numpad ──────────────────────────────────
function Numpad({ outletId }: { outletId: string | null }) {
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (val.length < 9 || busy) return;
    setBusy(true); setErr(null);
    try {
      const m = await lookupMember(val);
      if (!m) { setErr("No member found"); return; }
      useDisplay.getState().setMember({ id: m.id, name: m.name, phone: m.phone, pointsBalance: m.points_balance, tierName: m.tier?.name ?? null, tierColor: m.tier?.color ?? null });
      setVal("");
    } catch { setErr("Lookup failed"); }
    finally { setBusy(false); }
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "<"];
  return (
    <View style={{ width: 330, marginTop: 14 }}>
      <View className="h-12 rounded-2xl items-center justify-center" style={{ borderWidth: 1.5, borderColor: "rgba(245,243,240,0.18)", backgroundColor: "rgba(245,243,240,0.04)" }}>
        <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 22, letterSpacing: 2, color: val ? CREAM : "rgba(245,243,240,0.3)" }}>{val || "+60 / 01x…"}</Text>
      </View>
      {!!err && <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 14, color: "#FCA5A5", textAlign: "center", marginTop: 8 }}>{err}</Text>}
      <View className="flex-row flex-wrap mt-3" style={{ gap: 8 }}>
        {keys.map((k) => (
          <Pressable
            key={k}
            onPress={() => { if (k === "C") setVal(""); else if (k === "<") setVal((v) => v.slice(0, -1)); else if (val.length < 13) setVal((v) => v + k); }}
            className="rounded-2xl items-center justify-center active:opacity-70"
            style={{ width: 98, height: 50, backgroundColor: "rgba(245,243,240,0.04)", borderWidth: 1, borderColor: "rgba(245,243,240,0.10)" }}
          >
            {k === "<" ? <Delete size={22} color="rgba(245,243,240,0.55)" />
              : k === "C" ? <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 11, letterSpacing: 1, color: "rgba(245,243,240,0.55)" }}>CLEAR</Text>
              : <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 22, color: CREAM }}>{k}</Text>}
          </Pressable>
        ))}
      </View>
      <Pressable onPress={submit} disabled={val.length < 9 || busy} className="mt-3 h-11 rounded-2xl items-center justify-center" style={{ backgroundColor: val.length >= 9 ? GOLD : "rgba(245,243,240,0.08)" }}>
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 12, letterSpacing: 2, color: val.length >= 9 ? DARKFG : "rgba(245,243,240,0.35)" }}>{busy ? "LOADING…" : "VIEW MY REWARDS"}</Text>
      </Pressable>
    </View>
  );
}

// ─── Member rewards panel ──────────────────────────────────
function PendingMemberPanel({ member }: { member: any }) {
  return (
    <View className="items-center py-2">
      <Eyebrow color="rgba(251,191,36,0.85)">WELCOME BACK</Eyebrow>
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 22, color: CREAM, marginTop: 4 }} numberOfLines={1}>Hi, {member.name ?? "friend"}</Text>
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 28, color: GOLD, marginTop: 6 }}>{(member.pointsBalance ?? 0).toLocaleString()}</Text>
      <Eyebrow color="rgba(245,243,240,0.55)">BEANS</Eyebrow>
    </View>
  );
}

function RewardsPanel({ snapshot, member }: { snapshot: LoyaltySnapshot; member: any }) {
  return (
    <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14 }} showsVerticalScrollIndicator={false}>
      <BeansHero snapshot={snapshot} memberName={member.name} />

      <Eyebrow color="rgba(245,243,240,0.45)" style={{ marginTop: 12, marginBottom: 6, paddingHorizontal: 4 }}>AVAILABLE REWARDS</Eyebrow>
      <RewardsList snapshot={snapshot} />
    </ScrollView>
  );
}

/** The reward rows (vouchers / claimables / shop / missions). Shared by the
 *  ordering RewardsPanel and the idle screen's left column. Denser rows fit
 *  more; caps are generous and the parent scrolls. */
function RewardsList({ snapshot }: { snapshot: LoyaltySnapshot }) {
  // Drop "challenge" rewards (mission-sourced vouchers + the mission rows) —
  // not useful on the customer screen.
  const vouchers = snapshot.vouchers.filter((v) => v.source_type !== "mission");
  const empty = snapshot.claimables.length === 0 && vouchers.length === 0 && snapshot.shop.length === 0;
  return (
    <View style={{ gap: 5 }}>
      {snapshot.claimables.slice(0, 3).map((c) => <RewardRow key={c.id} theme="terra" icon={c.source_type === "mystery_pending" ? "spark" : "gift"} eyebrow={c.source_type === "mystery_pending" ? "Mystery Bag" : "Promo"} title={c.title} sub={c.description ?? ""} pill={c.cta_label} />)}
      {vouchers.slice(0, 6).map((v) => <RewardRow key={v.id} theme="terra" icon="tag" eyebrow={voucherSource(v.source_type)} title={v.title} sub={voucherSummary(v)} pill="Use" />)}
      {snapshot.shop.slice(0, 5).map((s) => <RewardRow key={s.id} theme={s.affordable ? "gold" : "neutral"} icon="coffee" eyebrow="Bean Points" title={s.name} sub={s.description ?? ""} pill={`${s.points_required}`} disabled={!s.affordable} />)}
      {empty && (
        <View className="rounded-2xl p-4 items-center" style={{ backgroundColor: "rgba(245,243,240,0.05)" }}>
          <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 13, color: "rgba(245,243,240,0.5)", textAlign: "center" }}>Keep ordering to unlock rewards</Text>
        </View>
      )}
    </View>
  );
}

/** Compact, tap-to-claim rewards for the idle screen's left column. Shows the
 *  3 most relevant rewards as larger cards: unopened mystery bags / promos are
 *  tappable to claim on the spot; issued vouchers show "Use at till". A "+N
 *  more" line hints at the rest. Challenges (mission-sourced) are excluded. */
function ClaimableRewards({ snapshot, memberId }: { snapshot: LoyaltySnapshot; memberId: string }) {
  type Item =
    | { kind: "claim"; id: string; title: string; sub: string; mystery: boolean }
    | { kind: "voucher"; id: string; title: string; sub: string };
  const claims: Item[] = snapshot.claimables.map((c) => ({
    kind: "claim",
    id: c.id,
    title: c.title,
    sub: c.source_type === "mystery_pending" ? "Tap to open your bag" : (c.cta_label || "Tap to claim"),
    mystery: c.source_type === "mystery_pending",
  }));
  const vouchers: Item[] = snapshot.vouchers
    .filter((v) => v.source_type !== "mission")
    .map((v) => ({ kind: "voucher", id: v.id, title: v.title, sub: voucherSummary(v) }));
  const all = [...claims, ...vouchers];
  const shown = all.slice(0, 3);
  const more = all.length - shown.length;

  if (all.length === 0) {
    return (
      <View className="rounded-2xl p-4 items-center" style={{ backgroundColor: "rgba(245,243,240,0.05)" }}>
        <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 13, color: "rgba(245,243,240,0.5)", textAlign: "center" }}>Keep ordering to unlock rewards</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {shown.map((it) =>
        it.kind === "claim"
          ? <ClaimCard key={it.id} memberId={memberId} claimId={it.id} title={it.title} sub={it.sub} mystery={it.mystery} />
          : <RewardCardStatic key={it.id} title={it.title} sub={it.sub} />,
      )}
      {more > 0 && (
        <Text style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 12, color: "rgba(245,243,240,0.5)", paddingHorizontal: 4, marginTop: 2 }}>
          +{more} more reward{more === 1 ? "" : "s"} — show your app at the till
        </Text>
      )}
    </View>
  );
}

/** Tappable claim card (mystery bag / promo). Reveals inline on claim. */
function ClaimCard({ memberId, claimId, title, sub, mystery }: { memberId: string; claimId: string; title: string; sub: string; mystery: boolean }) {
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<{ label: string; emoji: string } | null>(null);
  async function onPress() {
    if (busy || revealed) return;
    setBusy(true);
    const out = mystery ? await claimMystery(memberId, claimId) : null;
    setRevealed(out ?? { label: "Added to your rewards", emoji: "🎁" });
    setBusy(false);
  }
  if (revealed) {
    return (
      <View className="flex-row items-center rounded-2xl px-3.5 py-3" style={{ backgroundColor: "rgba(251,191,36,0.12)", borderWidth: 1, borderColor: "rgba(251,191,36,0.45)", gap: 11 }}>
        <Text style={{ fontSize: 26 }}>{revealed.emoji}</Text>
        <View className="flex-1">
          <Text style={{ fontFamily: "Peachi-Bold", fontSize: 15, color: GOLD }} numberOfLines={1}>{revealed.label}</Text>
          <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 11, color: "rgba(245,243,240,0.6)" }}>Added to your rewards</Text>
        </View>
      </View>
    );
  }
  return (
    <Pressable onPress={onPress} className="flex-row items-center rounded-2xl px-3.5 py-3 active:opacity-80" style={{ backgroundColor: "rgba(251,191,36,0.10)", borderWidth: 1, borderColor: "rgba(251,191,36,0.40)", gap: 11 }}>
      <View className="h-10 w-10 rounded-xl items-center justify-center" style={{ backgroundColor: GOLD }}>{mystery ? <Sparkles size={18} color={DARKFG} /> : <Gift size={18} color={DARKFG} />}</View>
      <View className="flex-1">
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 15, color: CREAM }} numberOfLines={1}>{title}</Text>
        <Text style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 11, color: GOLD }} numberOfLines={1}>{busy ? "Opening…" : sub}</Text>
      </View>
      <View className="rounded-full px-3 py-1.5" style={{ backgroundColor: GOLD }}>
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10, letterSpacing: 0.5, color: DARKFG }}>{mystery ? "OPEN" : "CLAIM"}</Text>
      </View>
    </Pressable>
  );
}

/** Issued voucher — used at checkout, not claimed on the display. */
function RewardCardStatic({ title, sub }: { title: string; sub: string }) {
  return (
    <View className="flex-row items-center rounded-2xl px-3.5 py-3" style={{ backgroundColor: "#FBEBE8", borderWidth: 1, borderColor: "rgba(162,73,44,0.22)", gap: 11 }}>
      <View className="h-10 w-10 rounded-xl items-center justify-center" style={{ backgroundColor: TERRA }}><Tag size={18} color="#fff" /></View>
      <View className="flex-1">
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 15, color: DARKFG }} numberOfLines={1}>{title}</Text>
        <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 11, color: "rgba(26,2,0,0.55)" }} numberOfLines={1}>{sub}</Text>
      </View>
      <View className="rounded-full px-3 py-1.5" style={{ backgroundColor: "rgba(26,2,0,0.08)" }}>
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10, letterSpacing: 0.5, color: DARKFG }}>USE AT TILL</Text>
      </View>
    </View>
  );
}

function BeansHero({
  snapshot,
  memberName,
  redeemedReward,
  onRedeem,
}: {
  snapshot: LoyaltySnapshot;
  memberName: string | null;
  // Pulled up onto the tier card to free vertical room in the cart for
  // more order lines. When a voucher is already applied we show a small
  // "✓ APPLIED" pill instead of the action button.
  redeemedReward?: { name: string } | null;
  onRedeem?: () => void;
}) {
  const t = snapshot.tier.current;
  const tierColor = t?.color ?? TERRA;
  const fg = lum(tierColor) >= 0.08 ? tierColor : CREAM;
  const prog = snapshot.tier.progress;
  const pct = prog && prog.target > 0 ? Math.min(100, Math.round((prog.current / prog.target) * 100)) : 0;
  const moreNeeded = prog ? Math.max(0, prog.target - prog.current) : 0;
  const next = snapshot.tier.next;
  const nextName = next?.name;
  // Next-tier perks to motivate spending up ("spend X → unlock Y").
  const nextPerks = next
    ? [
        (next.discount_percent ?? 0) > (t?.discount_percent ?? 0) ? `${next.discount_percent}% off` : null,
        (next.multiplier ?? 1) > (t?.multiplier ?? 1) ? `${next.multiplier}× Beans` : null,
      ].filter(Boolean).join(" + ")
    : "";
  const spendLabel = prog?.metric === "spend" ? `RM ${(moreNeeded / 100).toFixed(0)}` : `${moreNeeded} visit${moreNeeded === 1 ? "" : "s"}`;
  // Tier card — sized down ~25% from the original on 2026-05-31 per
  // request, freeing more vertical room in the right column for the
  // cart / order list below. All font sizes, paddings, bars, and gaps
  // scaled proportionally.
  return (
    <View className="rounded-xl overflow-hidden" style={{ backgroundColor: tierColor + "1A", borderWidth: 1, borderColor: tierColor + "38" }}>
      <View style={{ height: 3, backgroundColor: tierColor }} />
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 9 }}>
        <View className="flex-row items-start justify-between">
          <View className="flex-1 pr-2">
            <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 8.5, letterSpacing: 1.5, color: fg + "B3" }}>{memberName ? `HI, ${memberName.toUpperCase()}` : "WELCOME"}</Text>
            <Text style={{ fontFamily: "Peachi-Bold", fontSize: 17, color: fg, marginTop: 1 }}>{t?.name ?? "Member"}</Text>
          </View>
          <View className="items-end">
            <Text style={{ fontFamily: "Peachi-Bold", fontSize: 20, color: GOLD, lineHeight: 22 }}>{snapshot.balance.toLocaleString()}</Text>
            <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 8.5, letterSpacing: 1.5, color: fg + "8C" }}>BEANS</Text>
          </View>
        </View>
        {/* Redeem pill — absolute, overlays the empty bottom-right corner. */}
        {onRedeem && (
          <View style={{ position: "absolute", right: 9, bottom: 7, zIndex: 1 }}>
            {redeemedReward ? (
              <View className="flex-row items-center rounded-full px-2 py-0.5" style={{ backgroundColor: "rgba(134,239,172,0.18)", borderWidth: 1, borderColor: "rgba(134,239,172,0.5)", gap: 4 }}>
                <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 7.5, letterSpacing: 0.6, color: GREEN }}>✓</Text>
                <Text style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 8, color: GREEN, maxWidth: 90 }} numberOfLines={1}>{redeemedReward.name}</Text>
              </View>
            ) : (
              <Pressable onPress={onRedeem} className="flex-row items-center rounded-full px-2 py-0.5 active:opacity-80" style={{ backgroundColor: GOLD + "26", borderWidth: 1, borderColor: GOLD + "80", gap: 3 }}>
                <Gift size={8} color={GOLD} />
                <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 7, letterSpacing: 0.8, color: GOLD }}>REDEEM</Text>
              </Pressable>
            )}
          </View>
        )}
        {prog && nextName && (
          <View style={{ marginTop: 7 }}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: fg + "2E", overflow: "hidden" }}>
              <View style={{ height: 4, width: `${pct}%`, backgroundColor: fg }} />
            </View>
            {/* Motivator: spend X → unlock the next tier + its perks. */}
            <Text style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 9, color: GOLD, marginTop: 4 }}>
              {spendLabel} more → {nextName}
            </Text>
            {!!nextPerks && (
              <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 8, color: fg + "99", marginTop: 1 }}>
                Unlock {nextPerks}
              </Text>
            )}
          </View>
        )}
        {(t?.benefits?.length ?? 0) > 0 && (
          <View style={{ marginTop: 7, paddingTop: 6, borderTopWidth: 1, borderColor: fg + "22", gap: 2 }}>
            {t!.benefits.slice(0, 2).map((b, i) => (
              <View key={i} className="flex-row items-center" style={{ gap: 6 }}>
                <View style={{ width: 2.5, height: 2.5, borderRadius: 2, backgroundColor: fg }} />
                <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 8.5, color: fg + "C7" }}>{b}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function UsualStripView({ usual }: { usual: LoyaltySnapshot["usual"] }) {
  return (
    <View>
      <Eyebrow color="rgba(245,243,240,0.45)" style={{ marginTop: 12, marginBottom: 6, paddingHorizontal: 4 }}>YOUR USUAL</Eyebrow>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {usual.slice(0, 8).map((u) => (
          <View key={u.id} className="rounded-xl p-1.5" style={{ width: 92, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(245,243,240,0.10)" }}>
            <View style={{ aspectRatio: 1, borderRadius: 8, overflow: "hidden", backgroundColor: "rgba(245,243,240,0.06)" }}>
              {u.image_url && <Image source={{ uri: u.image_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />}
              <View className="absolute right-1 top-1 rounded-full px-1.5 py-0.5" style={{ backgroundColor: "rgba(26,2,0,0.78)" }}>
                <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9, color: GOLD }}>×{u.times_ordered}</Text>
              </View>
            </View>
            <Text style={{ fontFamily: "Peachi-Medium", fontSize: 11, color: CREAM, marginTop: 6 }} numberOfLines={1}>{u.name}</Text>
            <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 10, color: "rgba(245,243,240,0.55)" }}>{rm(u.price_sen)}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function RewardRow({ theme, icon, eyebrow, title, sub, pill, disabled }: { theme: "terra" | "gold" | "neutral"; icon: "gift" | "tag" | "coffee" | "spark"; eyebrow: string; title: string; sub: string; pill: string; disabled?: boolean }) {
  const T = theme === "terra"
    ? { bg: "#FBEBE8", border: "rgba(162,73,44,0.22)", iconBg: TERRA, iconC: "#fff", fg: DARKFG, fgDim: "rgba(26,2,0,0.55)", accent: TERRA, pillBg: TERRA, pillFg: "#fff" }
    : theme === "gold"
    ? { bg: "rgba(251,191,36,0.10)", border: "rgba(251,191,36,0.30)", iconBg: DARKFG, iconC: GOLD, fg: CREAM, fgDim: "rgba(245,243,240,0.5)", accent: GOLD, pillBg: GOLD, pillFg: DARKFG }
    : { bg: "rgba(245,243,240,0.05)", border: "rgba(245,243,240,0.12)", iconBg: "rgba(245,243,240,0.08)", iconC: "rgba(245,243,240,0.6)", fg: CREAM, fgDim: "rgba(245,243,240,0.5)", accent: "rgba(245,243,240,0.5)", pillBg: "rgba(245,243,240,0.12)", pillFg: CREAM };
  const Icon = icon === "tag" ? Tag : icon === "coffee" ? Coffee : icon === "spark" ? Sparkles : Gift;
  return (
    <View className="flex-row items-center rounded-xl px-2.5 py-1.5" style={{ backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, opacity: disabled ? 0.5 : 1, gap: 9 }}>
      <View className="h-8 w-8 rounded-lg items-center justify-center" style={{ backgroundColor: T.iconBg }}><Icon size={16} color={T.iconC} /></View>
      <View className="flex-1">
        {/* Denser: title + the discount/eyebrow on one sub-line, no extra row. */}
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 13, color: T.fg }} numberOfLines={1}>{title}</Text>
        <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 9.5, color: T.fgDim, marginTop: 0.5 }} numberOfLines={1}>
          {sub ? `${eyebrow} · ${sub}` : eyebrow}
        </Text>
      </View>
      <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: T.pillBg }}>
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9.5, color: T.pillFg }}>{pill}</Text>
      </View>
    </View>
  );
}

function MissionRow({ m }: { m: MissionCard }) {
  const pct = m.progress_target > 0 ? Math.min(100, Math.round((m.progress_current / m.progress_target) * 100)) : 0;
  const fmt = (n: number) => (m.unit === "sen" ? `RM ${(n / 100).toFixed(0)}` : `${n}`);
  return (
    <View className="rounded-2xl p-3" style={{ backgroundColor: "rgba(251,191,36,0.06)", borderWidth: 1, borderColor: "rgba(251,191,36,0.22)" }}>
      <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9.5, letterSpacing: 1.4, color: GOLD }}>CHALLENGE · +{m.reward_bonus_beans} BEANS</Text>
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: CREAM, marginTop: 2 }} numberOfLines={1}>{m.title}</Text>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: "rgba(251,191,36,0.15)", marginTop: 8, overflow: "hidden" }}>
        <View style={{ height: 6, width: `${pct}%`, backgroundColor: GOLD }} />
      </View>
      <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 10, color: "rgba(245,243,240,0.5)", marginTop: 4 }}>{fmt(m.progress_current)} / {fmt(m.progress_target)}</Text>
    </View>
  );
}

// ─── Cart-side AOV nudges ──────────────────────────────────
/** Consolidated AOV nudge: bite suggestions + any live promotions under
 *  one "Pair with a bite" header (promotions appear beneath the bites). */
function Suggestions({ bites, promos }: { bites: BiteItem[]; promos: LoyaltySnapshot["active_promos"] }) {
  if (bites.length === 0 && promos.length === 0) return null;
  return (
    <View style={{ marginTop: 10 }}>
      <Eyebrow color="rgba(251,191,36,0.85)" style={{ marginBottom: 4, letterSpacing: 2.2 }}>PAIR WITH A BITE</Eyebrow>
      {/* Discount/promo on top of the bite cards. */}
      {promos.length > 0 && (
        <View style={{ gap: 4 }}>
          {promos.map((p) => {
            const accent = p.flavour === "time_window" ? GOLD : TERRA;
            return (
              <View key={p.id} className="flex-row items-center rounded-lg px-2.5 py-1" style={{ backgroundColor: accent + "1A", borderWidth: 1, borderColor: accent + "33", gap: 8 }}>
                <View className="rounded-md px-2 py-0.5" style={{ backgroundColor: accent }}>
                  <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10, color: DARKFG }}>{p.discount_label}</Text>
                </View>
                <Text style={{ fontFamily: "Peachi-Medium", fontSize: 11, color: CREAM, flex: 1 }} numberOfLines={1}>{p.name}</Text>
                <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9, color: "rgba(245,243,240,0.55)" }}>{p.window_label}</Text>
              </View>
            );
          })}
        </View>
      )}
      {bites.length > 0 && (
        <View className="flex-row" style={{ gap: 8, marginTop: promos.length > 0 ? 6 : 0 }}>
          {bites.slice(0, 4).map((b) => (
            <View key={b.id} className="flex-1 rounded-xl p-1.5" style={{ backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(245,243,240,0.10)" }}>
              <View style={{ aspectRatio: 16 / 10, borderRadius: 8, overflow: "hidden", backgroundColor: "rgba(245,243,240,0.06)" }}>
                {b.image_url && <Image source={{ uri: b.image_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />}
              </View>
              <Text style={{ fontFamily: "Peachi-Medium", fontSize: 10.5, color: CREAM, marginTop: 3 }} numberOfLines={1}>{b.name}</Text>
              <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 9.5, color: "rgba(245,243,240,0.6)" }}>{rm(b.price_sen)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Upsell hero cards ─────────────────────────────────────
/** Bite tile for the Pair-with-a-bite upsell row — 4 across in ONE row.
 *  Card width is ~23.5% so all four fit side-by-side in the upsell area.
 *  Product name still allowed to wrap onto 2 lines so long names like
 *  "Mini Chocolate Chip No Nuts (3 pcs)" stay fully readable. When a live
 *  combo/promo matches this bite, the card carries a full-width gold
 *  banner stripe across the top with the discount label + combo hook —
 *  visible at a glance from customer side. */
function BiteCard({ bite, offer }: { bite: { id: string; name: string; price_sen: number; image_url: string | null }; offer?: LoyaltySnapshot["active_promos"][number] | null }) {
  return (
    <View style={{ width: "23.5%", backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: offer ? GOLD + "80" : "rgba(245,243,240,0.1)", borderRadius: 14, overflow: "hidden" }}>
      {/* Promotion banner — full-width stripe above the image. Stays
          compact for the narrower 4-up tiles: smaller pill + tighter
          padding so the hook text still has room to read. */}
      {offer && (
        <View className="flex-row items-center" style={{ backgroundColor: GOLD, paddingHorizontal: 6, paddingVertical: 4, gap: 5 }}>
          <View style={{ backgroundColor: DARKFG, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1.5 }}>
            <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9, color: GOLD, letterSpacing: 0.3 }}>{offerPill(offer.discount_label)}</Text>
          </View>
          <Text style={{ fontFamily: "Peachi-Bold", fontSize: 10.5, color: DARKFG, flex: 1 }} numberOfLines={1}>{offerHook(offer)}</Text>
        </View>
      )}
      {/* Shorter aspect ratio (4:3 vs 1:1) keeps each tile ~50px less
          tall — needed so two rows fit on the 800px tall display 1 with
          header + chips above. */}
      <View style={{ aspectRatio: 4 / 3, backgroundColor: "rgba(245,243,240,0.06)" }}>
        {bite.image_url && <Image source={{ uri: bite.image_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />}
      </View>
      <View style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
        {/* Wraps to 2 lines for long names. Tight lineHeight saves a few
            more pixels per tile while still reading clearly. */}
        <Text style={{ fontFamily: "Peachi-Medium", fontSize: 12.5, color: CREAM, lineHeight: 15 }} numberOfLines={2}>{bite.name}</Text>
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 12, color: GOLD, marginTop: 1 }}>{rm(bite.price_sen)}</Text>
      </View>
    </View>
  );
}

// ─── Mystery box ───────────────────────────────────────────
function MysteryBox({ memberId, claimable }: { memberId: string; claimable: ClaimableCard }) {
  const [revealed, setRevealed] = useState<{ label: string; emoji: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function reveal() {
    if (busy || revealed) return;
    setBusy(true);
    const out = await claimMystery(memberId, claimable.id);
    setRevealed(out ?? { label: "Reward unlocked", emoji: "🎁" });
    setBusy(false);
  }
  if (revealed) {
    return (
      <View className="mt-8 rounded-3xl p-6 items-center" style={{ width: 384, backgroundColor: "rgba(251,191,36,0.10)", borderWidth: 1, borderColor: "rgba(251,191,36,0.40)" }}>
        <Text style={{ fontSize: 56 }}>{revealed.emoji}</Text>
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 24, color: GOLD, marginTop: 4 }}>{revealed.label}</Text>
        <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 14, color: "rgba(245,243,240,0.65)", marginTop: 4 }}>Added to your rewards</Text>
      </View>
    );
  }
  return (
    <Pressable onPress={reveal} className="mt-8 rounded-3xl p-6 items-center active:opacity-80" style={{ width: 384, backgroundColor: "rgba(162,73,44,0.14)", borderWidth: 1, borderColor: "rgba(162,73,44,0.45)" }}>
      <View className="h-20 w-20 rounded-2xl items-center justify-center" style={{ backgroundColor: TERRA }}><Gift size={40} color="#FBEBE8" /></View>
      <Eyebrow color="rgba(251,191,36,0.85)" style={{ marginTop: 12, letterSpacing: 2.2 }}>MYSTERY BEAN</Eyebrow>
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 20, color: CREAM, marginTop: 4 }}>{busy ? "Opening…" : "Tap to reveal"}</Text>
    </Pressable>
  );
}

// ─── helpers ───────────────────────────────────────────────
function voucherSource(s: string | null): string {
  return s === "mystery" ? "Mystery Bag" : s === "mission" ? "Challenge" : s === "birthday" ? "Birthday" : s === "referral" ? "Referral" : s === "points_redemption" ? "Bean Points" : "Reward";
}
function voucherSummary(v: VoucherCard): string {
  if (v.discount_type === "percent") return `${v.discount_value ?? 0}% off`;
  if (v.discount_type === "flat") return `${rm(Math.round(v.discount_value ?? 0))} off`;
  if (v.discount_type === "free_item" || v.discount_type === "free_upgrade") return v.free_product_name ? `Free ${v.free_product_name}` : "Free item";
  return v.description ?? "Reward";
}
/** "RM2" → "RM2 OFF", "20%" → "20% OFF"; leaves labels that already say off/%. */
function offerPill(discountLabel: string): string {
  const d = (discountLabel || "").trim();
  if (!d) return "OFFER";
  return /off|%/i.test(d) ? d.toUpperCase() : `${d} OFF`;
}
/** Pairing hook for a combo, dropping the trailing "— RM2 off" bit:
 *  "Classic + Roti Bakar — RM2 off" → "Classic + Roti Bakar". */
function offerHook(p: LoyaltySnapshot["active_promos"][number]): string {
  return p.name.split("—")[0].trim() || p.name;
}
/** Match a live combo offer to a bite by its CATEGORY appearing in the promo
 *  name (e.g. "nasi lemak" in "Classic + Nasi Lemak — RM2 off"). We deliberately
 *  do NOT match on the bite's name words: combo names lead with the drink
 *  category ("Classic + …"), so a "Classic Fries" bite would falsely match
 *  every "Classic + …" combo. */
function matchOffer(
  b: { name: string; category: string },
  offers: LoyaltySnapshot["active_promos"],
): LoyaltySnapshot["active_promos"][number] | null {
  const cat = (b.category || "").replace(/[-_]/g, " ").trim().toLowerCase();
  if (cat.length <= 2) return null;
  return offers.find((p) => p.name.toLowerCase().includes(cat)) ?? null;
}
function pickBites(snapshot: LoyaltySnapshot | null): BiteItem[] {
  if (!snapshot) return [];
  const seen = new Set<string>();
  const out: BiteItem[] = [];
  for (const b of snapshot.popular_bites ?? []) {
    if (!seen.has(b.id)) { seen.add(b.id); out.push(b); }
    if (out.length >= 4) break;
  }
  return out;
}
