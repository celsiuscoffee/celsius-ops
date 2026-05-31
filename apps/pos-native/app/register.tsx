import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, Pressable, FlatList, ActivityIndicator, Image, ScrollView, Modal,
  TextInput, useWindowDimensions,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import {
  Plus, Minus, LogOut, Banknote, CreditCard, QrCode, X, CheckCircle2,
  Settings as SettingsIcon, User, Gift, LayoutGrid, Pencil, Search, Trash2, Tag,
} from "lucide-react-native";
import { usePos } from "@/lib/store";
import { apiPost } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { fetchCategories, fetchProducts, type Product, type ModifierOption } from "@/lib/menu";
import { useCart, cartSubtotal } from "@/lib/cart";
import { useDisplay } from "@/lib/display";
import { createSale, getNextQueueNumber } from "@/lib/checkout";
import { useSettings, gridColumns, serviceChargeRate, defaultOrderType, receiptConfig } from "@/lib/settings";
import { printReceipt80mm, printKitchenDocket80mm } from "@/lib/printer";
import { outletFull, outletShort } from "@/lib/outlets";
import {
  lookupMember, fetchRewards, fetchUsual, redeemReward, computeRewardDiscount,
  computeTierDiscount, evaluatePromotions,
  type Member, type RewardsResponse, type IssuedVoucher, type CatalogReward, type RedeemDiscount, type UsualItem, type AppliedPromo,
} from "@/lib/loyalty";

const rm = (sen: number) => `RM ${(sen / 100).toFixed(2)}`;

// Wider order panel for the big landscape till (was 360 — too cramped).
const CART_W = 460;

// Per-category tab colours — mirrors the web register's CategoryTabs
// (apps/pos/src/components/register/category-tabs.tsx) so the native menu
// reads with the same colourful coding.
const CAT_COLORS: Record<string, string> = {
  all: "#4A4A4A",
  usual: "#D4A843",
  popular: "#D4A843",
  classic: "#8B6914",
  flavoured: "#C0507E",
  mocha: "#6B3A2A",
  "artisan-choc": "#5C3317",
  "artisan-matcha": "#3A7D44",
  cakes: "#7B5EA7",
  cookies: "#D4792C",
  croissant: "#B8860B",
  fries: "#CC3333",
  "fruit-tea": "#E06B75",
  "gourmet-tea": "#2E8B57",
  mocktails: "#2BA5B5",
  "nasi-lemak": "#6B8E23",
  noodle: "#CD6600",
  pasta: "#B22222",
  "roti-bakar": "#A0722D",
  sandwiches: "#2F8F8F",
};
const CAT_PALETTE = [
  "#8B6914", "#C0507E", "#3A7D44", "#7B5EA7", "#D4792C", "#CC3333",
  "#2E8B57", "#2BA5B5", "#6B8E23", "#CD6600", "#B22222", "#5C3317",
  "#E06B75", "#A0722D", "#2F8F8F", "#B8860B", "#6B3A2A",
];
const catColor = (slug: string, i: number) =>
  CAT_COLORS[slug] ?? CAT_PALETTE[i % CAT_PALETTE.length];

const BRAND = "#A2492C";
const OK = "#86efac";

type AppliedReward = { redemptionId: string; name: string; descriptor: RedeemDiscount } | null;
type Panel = "none" | "customer" | "table" | "notes";

export default function Register() {
  const { staff, outletId, signOut } = usePos();
  const [activeCat, setActiveCat] = useState<string>("all");
  const [showCheckout, setShowCheckout] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState<{ orderNumber: string; total: number } | null>(null);
  const [modProduct, setModProduct] = useState<Product | null>(null);

  // Cashier-applied manual discount (sen) — stacks on top of loyalty/promo.
  const [manualDiscount, setManualDiscount] = useState(0);
  const [showDiscount, setShowDiscount] = useState(false);

  // Order context.
  const [orderType, setOrderType] = useState<"dine_in" | "takeaway">("takeaway");
  const [tableNumber, setTableNumber] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [panel, setPanel] = useState<Panel>("none");

  // Loyalty.
  const [member, setMember] = useState<Member | null>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [usual, setUsual] = useState<UsualItem[]>([]);
  const [reward, setReward] = useState<AppliedReward>(null);
  const [autoPromotions, setAutoPromotions] = useState<AppliedPromo[]>([]);
  const [rewards, setRewards] = useState<RewardsResponse | null>(null);
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [showRewards, setShowRewards] = useState(false);

  const setDisplayStatus = useDisplay((s) => s.setStatus);
  const setDisplayOrderNumber = useDisplay((s) => s.setOrderNumber);
  // Member the CUSTOMER self-identified on the 2nd screen — adopted below.
  const displayMember = useDisplay((s) => s.member);
  // Reward the customer tapped to redeem on the 2nd screen — applied below.
  const redeemRequest = useDisplay((s) => s.redeemRequest);

  // Backoffice-managed per-outlet settings (pos_branch_settings).
  const settings = useSettings((s) => s.settings);
  const outlet = useSettings((s) => s.outlet);
  const refreshSettings = useSettings((s) => s.refresh);
  // Initial load + re-read backoffice settings whenever the register regains
  // focus, so a grid / service-charge / receipt change shows without an app
  // restart (the store used to cache the first load and never refetch).
  useFocusEffect(
    useCallback(() => {
      if (outletId) refreshSettings(outletId);
    }, [outletId, refreshSettings]),
  );
  // Live: a backoffice edit to this outlet's pos_branch_settings row pushes
  // straight to the running till via realtime.
  useEffect(() => {
    if (!outletId) return;
    const ch = supabase
      .channel(`branch-settings-${outletId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pos_branch_settings", filter: `outlet_id=eq.${outletId}` },
        () => { refreshSettings(outletId); },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [outletId, refreshSettings]);

  // Default order type from settings, once.
  const didInitType = useRef(false);
  useEffect(() => {
    if (settings && !didInitType.current) {
      didInitType.current = true;
      setOrderType(defaultOrderType(settings));
    }
  }, [settings]);

  const cats = useQuery({ queryKey: ["pos-categories"], queryFn: fetchCategories });
  const prods = useQuery({ queryKey: ["pos-products"], queryFn: fetchProducts });

  const lines = useCart((s) => s.lines);
  const add = useCart((s) => s.add);
  const inc = useCart((s) => s.inc);
  const dec = useCart((s) => s.dec);
  const clear = useCart((s) => s.clear);

  const liveCats = useMemo(() => {
    const present = new Set((prods.data ?? []).map((p) => p.category));
    return (cats.data ?? []).filter((c) => present.has(c.slug) || present.has(c.id));
  }, [cats.data, prods.data]);

  const usualIds = useMemo(() => new Set(usual.map((u) => u.id)), [usual]);

  const visible = useMemo(() => {
    const all = prods.data ?? [];
    if (activeCat === "usual") return all.filter((p) => usualIds.has(p.id));
    if (activeCat === "all") return all;
    return all.filter((p) => p.category === activeCat);
  }, [prods.data, activeCat, usualIds]);

  const subtotal = cartSubtotal(lines);
  const scRate = serviceChargeRate(settings);
  const serviceCharge = orderType === "dine_in" ? Math.round((subtotal * scRate) / 100) : 0;
  const rewardDiscount = useMemo(
    () => (reward ? computeRewardDiscount(reward.descriptor, lines) : 0),
    [reward, lines],
  );
  // Auto discounts: member tier % (client, stacking-aware) + server-side
  // promotions (time-window / category / promo-code). Tier is computed
  // locally so it never double-counts with the server promos.
  const tierDisc = computeTierDiscount(member?.tier ?? null, subtotal, rewardDiscount);
  const apiPromoDisc = autoPromotions.reduce((s, p) => s + p.discountAmount, 0);
  // Non-stackable tiers (Black Card / Staff) don't stack the tier % with a
  // voucher — charge whichever is larger (mirrors the pickup app). Reactive, so
  // it re-picks the winner if the cart changes.
  const nonStackTier = member?.tier?.stackable === false && (member?.tier?.discount_percent ?? 0) > 0;
  const effRewardDiscount = nonStackTier && rewardDiscount < tierDisc ? 0 : rewardDiscount;
  const effTierDisc = nonStackTier && rewardDiscount >= tierDisc ? 0 : tierDisc;
  const promoDiscount = effTierDisc + apiPromoDisc;
  // Manual discount stacks last; clamp it to what's still owed so the
  // line we show (and the total) never goes negative if the cart shrank
  // after it was applied.
  const beforeManual = Math.max(0, subtotal + serviceCharge - effRewardDiscount - promoDiscount);
  const effManualDiscount = Math.min(manualDiscount, beforeManual);
  const total = beforeManual - effManualDiscount;
  const cols = gridColumns(settings);

  const { width: screenW } = useWindowDimensions();
  const GRID_PAD = 12, GRID_GAP = 10;
  const productAreaW = Math.max(0, screenW - CART_W);
  const tileW = Math.floor((productAreaW - GRID_PAD * 2 - GRID_GAP * (cols - 1)) / cols);

  // ── Mirror order context to the customer-display ──
  useEffect(() => {
    if (paid) return;
    setDisplayStatus(lines.length > 0 ? "ordering" : "idle");
  }, [lines.length, paid]);
  useEffect(() => { useDisplay.getState().setOrderType(orderType); }, [orderType]);
  useEffect(() => {
    useDisplay.getState().setTableNumber(orderType === "dine_in" ? (tableNumber || null) : null);
  }, [orderType, tableNumber]);
  useEffect(() => {
    useDisplay.getState().setMember(
      member
        ? { id: member.id, name: member.name, phone: member.phone, pointsBalance: member.points_balance, tierName: member.tier?.name ?? null, tierColor: member.tier?.color ?? null }
        : null,
    );
  }, [member]);

  // ── Reverse channel: adopt a member the CUSTOMER self-identified on the 2nd
  // screen. The display only holds a subset, so re-hydrate the full record by
  // phone and apply it (same as a cashier lookup). Guarded by id so our own
  // member→display mirror above doesn't loop back. ──
  useEffect(() => {
    const dm = displayMember;
    if (!dm || member?.id === dm.id) return;
    let cancelled = false;
    lookupMember(dm.phone).then((m) => {
      if (cancelled || !m) return;
      setMember(m);
      fetchUsual(m.id).then((u) => { setUsual(u); if (u.length > 0) setActiveCat("usual"); }).catch(() => {});
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMember?.id]);

  // Apply a reward the customer redeemed on the 2nd screen, then clear the request.
  useEffect(() => {
    if (!redeemRequest) return;
    applyRewardArgs(redeemRequest.rewardId, redeemRequest.issuedRewardId);
    useDisplay.getState().setRedeemRequest(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redeemRequest]);

  useEffect(() => {
    // Mirror the EFFECTIVE reward discount — for a non-stackable tier where the
    // tier % wins, this is 0 and we show no voucher line (the tier shows instead).
    useDisplay.getState().setReward(reward && effRewardDiscount > 0 ? { name: reward.name, discountSen: effRewardDiscount } : null);
  }, [reward, effRewardDiscount]);

  // Re-evaluate server auto-promotions whenever the cart / member / voucher
  // changes (tier % is computed locally above, not sent, to avoid double-count).
  useEffect(() => {
    if (lines.length === 0) { setAutoPromotions([]); return; }
    let cancelled = false;
    const pLines = lines.map((l) => ({
      product_id: l.product.id, category: l.product.category, quantity: l.qty, unit_price: l.unit_sen / 100,
    }));
    evaluatePromotions({ lines: pLines, memberId: member?.id ?? null, outletId, rewardDiscountSen: rewardDiscount })
      .then((p) => { if (!cancelled) setAutoPromotions(p); })
      .catch(() => { if (!cancelled) setAutoPromotions([]); });
    return () => { cancelled = true; };
  }, [lines, member?.id, rewardDiscount, outletId]);

  // (Non-stackable tiers no longer DROP the voucher — the higher of tier% vs
  //  voucher is charged reactively above via effRewardDiscount / effTierDisc.)

  // Mirror the combined auto-discount (tier % + promos) to the customer screen.
  // Only label the tier when it's actually being charged (effTierDisc > 0) — a
  // non-stackable tier that lost to the voucher shouldn't appear here.
  useEffect(() => {
    const parts = [
      effTierDisc > 0 && member?.tier && (member.tier.discount_percent ?? 0) > 0
        ? `${member.tier.name} ${member.tier.discount_percent}%`
        : null,
      ...autoPromotions.map((p) => p.description),
    ].filter(Boolean) as string[];
    useDisplay.getState().setExtraDiscount(promoDiscount > 0 ? { label: parts.join(" · ") || "Discount", sen: promoDiscount } : null);
  }, [promoDiscount, autoPromotions, effTierDisc, member?.tier?.discount_percent, member?.tier?.name]);

  // Mirror the cashier's manual discount to the customer screen so its
  // ordering-mode total matches what the cashier sees.
  useEffect(() => {
    useDisplay.getState().setManualDiscount(effManualDiscount > 0 ? { label: "Discount", sen: effManualDiscount } : null);
  }, [effManualDiscount]);

  function onAdd(p: Product) {
    Haptics.selectionAsync();
    if (p.modifiers.length > 0) setModProduct(p);
    else add(p);
  }

  // ── Loyalty: lookup / rewards ──
  async function lookup() {
    const phone = phoneInput.trim();
    if (phone.length < 8) { setLookupError("Enter a phone number"); return; }
    setLookingUp(true);
    setLookupError(null);
    try {
      const m = await lookupMember(phone);
      if (!m) { setLookupError("No member found"); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMember(m);
      setPhoneInput("");
      setPanel("none");
      fetchUsual(m.id).then((u) => {
        setUsual(u);
        if (u.length > 0) setActiveCat("usual");
      }).catch(() => {});
    } catch {
      setLookupError("Lookup failed");
    } finally {
      setLookingUp(false);
    }
  }

  function removeMember() {
    Haptics.selectionAsync();
    setMember(null);
    setUsual([]);
    setReward(null);
    setRewards(null);
    if (activeCat === "usual") setActiveCat("all");
  }

  async function openRewards() {
    if (!member) return;
    Haptics.selectionAsync();
    setShowRewards(true);
    setRewardsLoading(true);
    try {
      setRewards(await fetchRewards(member.id));
    } catch {
      setRewards({ balance: member.points_balance, issued: [], catalog: [] });
    } finally {
      setRewardsLoading(false);
    }
  }

  // Core redemption — shared by the cashier reward modal and the customer's
  // 2nd-screen redeem (reverse channel). Returns false if it couldn't apply.
  async function applyRewardArgs(rewardId: string | null, issuedRewardId: string | null): Promise<boolean> {
    if (!member || !outletId) return false;
    try {
      const res = await redeemReward({ memberId: member.id, rewardId, outletId, issuedRewardId });
      const disc = computeRewardDiscount(res.discount, lines);
      if (disc <= 0 && (res.discount.type === "free_item" || res.discount.type === "free_upgrade")) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return false;
      }
      // Non-stackable tier (Black Card / Staff): only apply the voucher if it
      // beats the tier % — otherwise keep the bigger tier discount (pickup parity).
      const t = member.tier;
      if (t?.stackable === false && (t.discount_percent ?? 0) > 0) {
        const tierD = Math.round((subtotal * (t.discount_percent ?? 0)) / 100);
        if (tierD >= disc) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          return false;
        }
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setReward({ redemptionId: res.redemption_id, name: res.reward_name, descriptor: res.discount });
      // Reflect new Beans balance after a points redemption.
      setMember((m) => (m ? { ...m, points_balance: res.new_balance ?? m.points_balance } : m));
      return true;
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return false;
    }
  }

  async function applyReward(r: IssuedVoucher | CatalogReward, isCatalog: boolean) {
    const ok = await applyRewardArgs(r.reward_id ?? r.id, isCatalog ? null : r.id);
    if (ok) setShowRewards(false);
    else alert("Couldn't apply that reward. If it's a free-item reward, add a qualifying item first.");
  }

  function newOrder() {
    Haptics.selectionAsync();
    setPaid(null);
    setReward(null);
    setAutoPromotions([]);
    setManualDiscount(0);
    setTableNumber("");
    setNotes("");
    setMember(null);
    setUsual([]);
    setActiveCat("all");
    setPanel("none");
    setDisplayStatus("idle");
    useDisplay.getState().setMember(null);
    useDisplay.getState().setExtraDiscount(null);
    useDisplay.getState().setManualDiscount(null);
  }

  async function pay(method: string) {
    if (!outletId || !staff || paying) return;
    setPaying(true);
    const printLines = [...lines];
    try {
      // Respect the backoffice "Checkout Option" — queue_number (default)
      // assigns an auto queue # for takeaway; table_number / none skip it.
      const checkoutOpt = settings?.checkout_option ?? "queue_number";
      const queueNumber =
        checkoutOpt === "queue_number" && orderType === "takeaway"
          ? await getNextQueueNumber(outletId)
          : null;
      const tableNum = orderType === "dine_in" ? (tableNumber || null) : null;
      const promoName = [
        member?.tier && (member.tier.discount_percent ?? 0) > 0 ? `${member.tier.name} ${member.tier.discount_percent}% off` : null,
        ...autoPromotions.map((p) => p.description),
      ].filter(Boolean).join(", ") || null;
      const sale = await createSale({
        outletId,
        staffId: staff.staffId,
        lines,
        orderType,
        serviceChargeRate: scRate,
        paymentMethod: method,
        tableNumber: tableNum,
        queueNumber,
        customerPhone: member?.phone ?? null,
        loyaltyPhone: member?.phone ?? null,
        rewardId: reward?.redemptionId ?? null,
        rewardName: reward?.name ?? null,
        rewardDiscount: effRewardDiscount,
        promoDiscount,
        promoName,
        manualDiscount: effManualDiscount,
        notes: notes || null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDisplayOrderNumber(sale.orderNumber);
      setDisplayStatus("complete");
      setPaid({ orderNumber: sale.orderNumber, total: sale.total });
      clear();
      setShowCheckout(false);

      // Receipt + kitchen dockets — fire-and-forget on the SUNMI head.
      const printOrder = {
        order_number: sale.orderNumber,
        order_type: orderType,
        queue_number: queueNumber,
        table_number: tableNum,
        created_at: sale.createdAt,
        subtotal: sale.subtotal,
        service_charge: sale.serviceCharge,
        discount_amount: sale.discount,
        total: sale.total,
        pos_order_items: printLines.map((l) => ({
          product_name: l.product.name,
          quantity: l.qty,
          unit_price: l.unit_sen,
          modifier_total: l.modifiers.reduce((s, m) => s + m.price_sen, 0),
          item_total: l.unit_sen * l.qty,
          modifiers: l.modifiers.map((m) => ({ name: m.name })),
          kitchen_station: l.product.kitchen_station ?? null,
        })),
        pos_order_payments: [{ payment_method: method, amount: sale.total }],
      };
      const outletInfo = {
        name: settings?.receipt_header || outlet?.name || outletFull(outletId),
        address: outlet?.address ?? null,
        city: outlet?.city ?? null,
        state: outlet?.state ?? null,
        phone: outlet?.phone ?? null,
      };
      setTimeout(() => {
        printKitchenDocket80mm(printOrder, outletInfo).catch((e) => console.error("[print] docket:", e?.message ?? e));
        printReceipt80mm(printOrder, outletInfo, receiptConfig(settings)).catch((e) => console.error("[print] receipt:", e?.message ?? e));
      }, 250);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.error("[checkout]", e?.message ?? e);
      alert(`Checkout failed: ${e?.message ?? "unknown error"}`);
    } finally {
      setPaying(false);
    }
  }

  const eyebrow = [
    orderType === "dine_in" ? "Dine-in" : "Takeaway",
    orderType === "dine_in" && tableNumber ? `Table ${tableNumber}` : null,
    member?.name || (member ? member.phone : null),
  ].filter(Boolean).join("  ·  ");

  return (
    <View className="flex-1 bg-espresso flex-row">
      {/* ── Main: catalog ───────────────────────────── */}
      <View className="flex-1">
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 pt-3 pb-2">
          <View className="flex-row items-center gap-3">
            <Image source={require("@/assets/icon.png")} style={{ width: 38, height: 38, borderRadius: 10 }} resizeMode="contain" />
            <View>
              <Text className="text-cream text-base" style={{ fontFamily: "Peachi-Bold" }}>Celsius POS</Text>
              <Text className="text-cream/45 text-[11px]" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                {staff?.staffName ?? ""} · {outletShort(outletId)}
              </Text>
            </View>
            {/* Order-type toggle */}
            <View className="flex-row ml-3 rounded-xl overflow-hidden border border-cream/15">
              <TypeToggle label="Dine-in" active={orderType === "dine_in"} onPress={() => { Haptics.selectionAsync(); setOrderType("dine_in"); }} />
              <TypeToggle label="Takeaway" active={orderType === "takeaway"} onPress={() => { Haptics.selectionAsync(); setOrderType("takeaway"); }} />
            </View>
          </View>
          <View className="flex-row items-center gap-2">
            <Pressable onPress={() => { Haptics.selectionAsync(); router.push("/settings"); }} className="h-10 w-10 items-center justify-center rounded-xl border border-cream/15 active:opacity-60">
              <SettingsIcon size={18} color="rgba(245,243,240,0.7)" />
            </Pressable>
            <Pressable onPress={() => { signOut(); router.replace("/"); }} className="flex-row items-center gap-2 px-3 py-2 rounded-xl border border-cream/15 active:opacity-60">
              <LogOut size={16} color="rgba(245,243,240,0.7)" />
              <Text className="text-cream/70 text-xs" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>Sign out</Text>
            </Pressable>
          </View>
        </View>

        {/* Category tabs — exactly 2 rows, uniform box size, full labels,
            NO horizontal scroll: each box width is computed to fit the row. */}
        <View className="px-3 py-2" style={{ gap: 6 }}>
          {(() => {
            const tabs = [
              { slug: "all", name: "All" },
              ...(member && usual.length > 0 ? [{ slug: "usual", name: "★ Usual" }] : []),
              ...liveCats.map((c) => ({ slug: c.slug || c.id, name: c.name })),
            ];
            const half = Math.ceil(tabs.length / 2);
            const rows = [tabs.slice(0, half), tabs.slice(half)];
            // Box width sized so `half` boxes fill the catalog area exactly
            // (px-3 = 24 total, 6 gap between) — no scroll, uniform across rows.
            const boxW = Math.max(72, Math.floor((productAreaW - 24 - (half - 1) * 6) / half));
            return rows.map((row, ri) =>
              row.length === 0 ? null : (
                <View key={ri} className="flex-row" style={{ gap: 6 }}>
                  {row.map((t, i) => {
                    const gi = ri === 0 ? i : half + i;
                    return (
                      <ColorTab key={t.slug} width={boxW} label={t.name} color={catColor(t.slug, gi)} active={activeCat === t.slug} onPress={() => setActiveCat(t.slug)} />
                    );
                  })}
                </View>
              ),
            );
          })()}
        </View>

        {/* Product grid */}
        {prods.isLoading ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color="#FBBF24" /></View>
        ) : (
          <FlatList
            key={`grid-${cols}`}
            data={visible}
            keyExtractor={(p) => p.id}
            numColumns={cols}
            contentContainerStyle={{ padding: GRID_PAD, paddingBottom: 32 }}
            columnWrapperStyle={{ gap: GRID_GAP, justifyContent: "flex-start" }}
            ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
            renderItem={({ item }) => <ProductTile product={item} width={tileW} onPress={() => onAdd(item)} />}
            ListEmptyComponent={<Text className="text-cream/30 text-center mt-10" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>No items here yet.</Text>}
            removeClippedSubviews
            initialNumToRender={16}
            windowSize={5}
          />
        )}
      </View>

      {/* ── Cart panel ──────────────────────────────── */}
      <View className="bg-surface border-l border-border" style={{ width: CART_W }}>
        <View className="px-5 pt-4 pb-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-cream text-lg" style={{ fontFamily: "Peachi-Bold" }}>Current Order</Text>
            {lines.length > 0 && (
              <Pressable onPress={() => { Haptics.selectionAsync(); clear(); setReward(null); setManualDiscount(0); }} className="active:opacity-60">
                <Text className="text-primary text-xs" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>CLEAR</Text>
              </Pressable>
            )}
          </View>
          {!!eyebrow && (
            <Text className="text-cream/40 text-[11px] mt-0.5" style={{ fontFamily: "SpaceGrotesk_500Medium" }} numberOfLines={1}>{eyebrow}</Text>
          )}
        </View>

        {/* Action bar */}
        <View className="flex-row px-4 gap-2 pb-2">
          <ActionTab icon={<User size={15} color="#F5F3F0" />} label="Customer" active={panel === "customer"} onPress={() => setPanel(panel === "customer" ? "none" : "customer")} />
          {orderType === "dine_in" && (
            <ActionTab icon={<LayoutGrid size={15} color="#F5F3F0" />} label="Table" active={panel === "table"} onPress={() => setPanel(panel === "table" ? "none" : "table")} />
          )}
          <ActionTab icon={<Pencil size={15} color="#F5F3F0" />} label="Notes" active={panel === "notes"} onPress={() => setPanel(panel === "notes" ? "none" : "notes")} />
          <ActionTab icon={<Tag size={15} color="#F5F3F0" />} label="Discount" active={manualDiscount > 0} onPress={() => { Haptics.selectionAsync(); setShowDiscount(true); }} />
        </View>

        {/* Inline panels */}
        {panel === "customer" && !member && (
          <View className="px-4 pb-3">
            <View className="flex-row gap-2">
              <TextInput
                value={phoneInput}
                onChangeText={(t) => { setPhoneInput(t); setLookupError(null); }}
                placeholder="Customer phone"
                placeholderTextColor="rgba(245,243,240,0.35)"
                keyboardType="number-pad"
                returnKeyType="search"
                onSubmitEditing={lookup}
                className="flex-1 h-11 px-3 rounded-xl border border-cream/15 text-cream"
                style={{ backgroundColor: "rgba(245,243,240,0.06)", fontFamily: "SpaceGrotesk_500Medium", fontSize: 15 }}
              />
              <Pressable onPress={lookup} disabled={lookingUp} className="h-11 px-4 rounded-xl items-center justify-center flex-row gap-1.5" style={{ backgroundColor: BRAND, opacity: lookingUp ? 0.6 : 1 }}>
                {lookingUp ? <ActivityIndicator color="#fff" size="small" /> : <Search size={15} color="#fff" />}
                <Text className="text-white text-sm" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>Look up</Text>
              </Pressable>
            </View>
            {!!lookupError && <Text className="text-[#E5484D] text-xs mt-1.5" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>{lookupError}</Text>}
          </View>
        )}
        {panel === "table" && orderType === "dine_in" && (
          <View className="px-4 pb-3">
            <View className="flex-row flex-wrap" style={{ gap: 6 }}>
              {Array.from({ length: 15 }, (_, i) => String(i + 1)).map((n) => {
                const on = tableNumber === n;
                return (
                  <Pressable key={n} onPress={() => { Haptics.selectionAsync(); if (on) { setTableNumber(""); } else { setTableNumber(n); setPanel("none"); } }} className="h-11 rounded-xl items-center justify-center" style={{ width: 52, backgroundColor: on ? BRAND : "rgba(245,243,240,0.06)", borderWidth: on ? 0 : 1, borderColor: "rgba(245,243,240,0.12)" }}>
                    <Text className={on ? "text-white" : "text-cream/75"} style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 16 }}>{n}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
        {panel === "notes" && (
          <View className="px-4 pb-3">
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Order notes (e.g. less sugar)"
              placeholderTextColor="rgba(245,243,240,0.35)"
              multiline
              className="px-3 py-2.5 rounded-xl border border-cream/15 text-cream"
              style={{ backgroundColor: "rgba(245,243,240,0.06)", fontFamily: "SpaceGrotesk_500Medium", fontSize: 14, minHeight: 64, textAlignVertical: "top" }}
            />
          </View>
        )}

        {/* Member card */}
        {member && (
          <View className="mx-4 mb-2 rounded-2xl p-3 border border-border" style={{ backgroundColor: "rgba(245,243,240,0.05)" }}>
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-2">
                <View className="flex-row items-center gap-2">
                  <Text className="text-cream text-[15px]" style={{ fontFamily: "Peachi-Bold" }} numberOfLines={1}>{member.name || member.phone}</Text>
                  {member.tier?.name && (
                    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: (member.tier.color || BRAND) + "33", borderWidth: 1, borderColor: member.tier.color || BRAND }}>
                      <Text style={{ color: member.tier.color || "#F5F3F0", fontFamily: "SpaceGrotesk_700Bold", fontSize: 10 }}>{member.tier.name.toUpperCase()}</Text>
                    </View>
                  )}
                </View>
                <Text className="text-amber-400 text-xs mt-0.5" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>{member.points_balance} Beans · {member.total_visits} visits</Text>
              </View>
              <View className="flex-row items-center gap-2">
                <Pressable onPress={openRewards} className="flex-row items-center gap-1.5 h-9 px-3 rounded-xl active:opacity-80" style={{ backgroundColor: BRAND }}>
                  <Gift size={15} color="#fff" />
                  <Text className="text-white text-xs" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>Rewards</Text>
                </Pressable>
                <Pressable onPress={removeMember} className="h-9 w-9 items-center justify-center rounded-xl border border-cream/15 active:opacity-60">
                  <Trash2 size={15} color="rgba(245,243,240,0.6)" />
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {/* Applied reward chip */}
        {reward && (
          <View className="mx-4 mb-2 flex-row items-center justify-between rounded-xl px-3 py-2" style={{ backgroundColor: "rgba(134,239,172,0.12)", borderWidth: 1, borderColor: "rgba(134,239,172,0.4)" }}>
            <View className="flex-row items-center gap-2 flex-1 pr-2">
              <Gift size={15} color={OK} />
              <Text className="text-cream text-xs flex-1" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }} numberOfLines={1}>{reward.name}</Text>
            </View>
            <Text style={{ color: OK, fontFamily: "SpaceGrotesk_700Bold", fontSize: 13 }}>−{rm(effRewardDiscount)}</Text>
            <Pressable onPress={() => { Haptics.selectionAsync(); setReward(null); }} className="ml-2 active:opacity-60"><X size={16} color="rgba(245,243,240,0.6)" /></Pressable>
          </View>
        )}

        {/* Cart list */}
        {lines.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-cream/30 text-center" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>Tap products to start an order</Text>
          </View>
        ) : (
          <FlatList
            data={lines}
            keyExtractor={(l) => l.key}
            className="flex-1"
            contentContainerStyle={{ paddingHorizontal: 12 }}
            renderItem={({ item }) => (
              <View className="flex-row items-center py-3 border-b border-border">
                <View className="flex-1 pr-2">
                  <Text className="text-cream text-[13px]" style={{ fontFamily: "Peachi-Medium" }} numberOfLines={1}>{item.product.name}</Text>
                  {item.modifiers.length > 0 && (
                    <Text className="text-cream/45 text-[11px]" style={{ fontFamily: "SpaceGrotesk_400Regular" }} numberOfLines={1}>{item.modifiers.map((m) => m.name).join(", ")}</Text>
                  )}
                  <Text className="text-cream/55 text-[11px] mt-0.5" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>{rm(item.unit_sen)}</Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <Stepper icon={<Minus size={14} color="#F5F3F0" />} onPress={() => { Haptics.selectionAsync(); dec(item.key); }} />
                  <Text className="text-cream w-6 text-center" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{item.qty}</Text>
                  <Stepper icon={<Plus size={14} color="#F5F3F0" />} onPress={() => { Haptics.selectionAsync(); inc(item.key); }} />
                </View>
                <Text className="text-cream w-[72px] text-right text-[13px]" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(item.unit_sen * item.qty)}</Text>
              </View>
            )}
          />
        )}

        {/* Totals + charge */}
        <View className="px-5 pt-3 pb-6 border-t border-border">
          <View className="flex-row justify-between mb-1">
            <Text className="text-cream/55 text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>Subtotal</Text>
            <Text className="text-cream/80 text-sm" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>{rm(subtotal)}</Text>
          </View>
          {serviceCharge > 0 && (
            <View className="flex-row justify-between mb-1">
              <Text className="text-cream/55 text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>Service Charge ({scRate}%)</Text>
              <Text className="text-cream/80 text-sm" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>{rm(serviceCharge)}</Text>
            </View>
          )}
          {effRewardDiscount > 0 && (
            <View className="flex-row justify-between mb-1">
              <Text className="text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium", color: OK }} numberOfLines={1}>Reward</Text>
              <Text className="text-sm" style={{ fontFamily: "SpaceGrotesk_600SemiBold", color: OK }}>−{rm(effRewardDiscount)}</Text>
            </View>
          )}
          {effTierDisc > 0 && member?.tier && (
            <View className="flex-row justify-between mb-1">
              <Text className="text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium", color: OK }} numberOfLines={1}>
                {member.tier.name} {member.tier.discount_percent}%
              </Text>
              <Text className="text-sm" style={{ fontFamily: "SpaceGrotesk_600SemiBold", color: OK }}>−{rm(effTierDisc)}</Text>
            </View>
          )}
          {autoPromotions.map((p, i) => (
            <View key={`promo-${i}`} className="flex-row justify-between mb-1">
              <Text className="text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium", color: OK }} numberOfLines={1}>{p.description}</Text>
              <Text className="text-sm" style={{ fontFamily: "SpaceGrotesk_600SemiBold", color: OK }}>−{rm(p.discountAmount)}</Text>
            </View>
          ))}
          {effManualDiscount > 0 && (
            <View className="flex-row justify-between items-center mb-1">
              <Text className="text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium", color: OK }} numberOfLines={1}>Discount</Text>
              <View className="flex-row items-center gap-2">
                <Text className="text-sm" style={{ fontFamily: "SpaceGrotesk_600SemiBold", color: OK }}>−{rm(effManualDiscount)}</Text>
                <Pressable onPress={() => { Haptics.selectionAsync(); setManualDiscount(0); }} className="active:opacity-60"><X size={14} color="rgba(245,243,240,0.6)" /></Pressable>
              </View>
            </View>
          )}
          <View className="flex-row justify-between items-baseline mb-4">
            <Text className="text-cream text-lg" style={{ fontFamily: "Peachi-Bold" }}>Total</Text>
            <Text className="text-amber-400 text-2xl" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(total)}</Text>
          </View>
          {/* Charge — when dine-in needs a table, the button stays active and
              tapping it OPENS the table picker (instead of being a dead state). */}
          {(() => {
            const needsTable = orderType === "dine_in" && !tableNumber;
            const empty = lines.length === 0;
            return (
              <Pressable
                disabled={empty}
                onPress={() => {
                  Haptics.selectionAsync();
                  if (needsTable) { setPanel("table"); return; }
                  useDisplay.getState().setPayTotal(total);
                  setShowCheckout(true);
                }}
                className={`h-14 rounded-2xl items-center justify-center ${empty ? "bg-primary/30" : "bg-primary active:opacity-80"}`}
              >
                <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
                  {empty ? "Add items" : needsTable ? "Select a table" : `Charge ${rm(total)}`}
                </Text>
              </Pressable>
            );
          })()}
        </View>
      </View>

      {/* ── Checkout: payment method sheet ── */}
      <Modal visible={showCheckout} transparent animationType="fade" onRequestClose={() => setShowCheckout(false)}>
        <View className="flex-1 bg-black/70 items-center justify-center px-8">
          <View className="w-[480px] rounded-3xl bg-surface border border-border p-7">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-cream text-xl" style={{ fontFamily: "Peachi-Bold" }}>Payment</Text>
              <Pressable onPress={() => setShowCheckout(false)} className="active:opacity-60"><X size={22} color="rgba(245,243,240,0.7)" /></Pressable>
            </View>
            <Text className="text-amber-400 text-4xl mb-6" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(total)}</Text>
            {paying ? (
              <View className="h-40 items-center justify-center"><ActivityIndicator color="#FBBF24" size="large" /></View>
            ) : (
              <View className="gap-3">
                <PayMethod icon={<Banknote size={22} color="#F5F3F0" />} label="Cash" onPress={() => pay("cash")} />
                <PayMethod icon={<CreditCard size={22} color="#F5F3F0" />} label="Card" onPress={() => pay("card")} />
                <PayMethod icon={<QrCode size={22} color="#F5F3F0" />} label="QR / E-wallet" onPress={() => pay("qr")} />
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Rewards picker ── */}
      <Modal visible={showRewards} transparent animationType="fade" onRequestClose={() => setShowRewards(false)}>
        <View className="flex-1 bg-black/70 items-center justify-center px-8">
          <View className="w-[560px] max-h-[86%] rounded-3xl bg-surface border border-border p-6">
            <View className="flex-row items-center justify-between mb-3">
              <View>
                <Text className="text-cream text-xl" style={{ fontFamily: "Peachi-Bold" }}>Rewards</Text>
                {!!member && <Text className="text-amber-400 text-xs mt-0.5" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>{rewards?.balance ?? member.points_balance} Beans available</Text>}
              </View>
              <Pressable onPress={() => setShowRewards(false)} className="active:opacity-60"><X size={22} color="rgba(245,243,240,0.7)" /></Pressable>
            </View>
            {rewardsLoading ? (
              <View className="h-40 items-center justify-center"><ActivityIndicator color="#FBBF24" /></View>
            ) : (
              <ScrollView className="max-h-[460px]">
                {(rewards?.issued.length ?? 0) === 0 && (rewards?.catalog.length ?? 0) === 0 && (
                  <Text className="text-cream/45 text-center py-8" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>No rewards available yet.</Text>
                )}
                {(rewards?.issued ?? []).map((v) => (
                  <RewardRow key={v.id} title={v.title} subtitle={discountSummary(v)} onPress={() => applyReward(v, false)} />
                ))}
                {(rewards?.catalog ?? []).map((c) => (
                  <RewardRow key={c.id} title={c.title} subtitle={`${discountSummary(c)} · ${c.points_required} Beans`} onPress={() => applyReward(c, true)} />
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Modifier picker ── */}
      <Modal visible={!!modProduct} transparent animationType="fade" onRequestClose={() => setModProduct(null)}>
        {modProduct && (
          <ModifierSheet product={modProduct} onClose={() => setModProduct(null)} onConfirm={(opts) => { add(modProduct, opts); Haptics.selectionAsync(); setModProduct(null); }} />
        )}
      </Modal>

      {/* ── Manual discount ── */}
      <Modal visible={showDiscount} transparent animationType="fade" onRequestClose={() => setShowDiscount(false)}>
        <DiscountSheet
          subtotal={subtotal}
          staffRole={staff?.role ?? "staff"}
          onClose={() => setShowDiscount(false)}
          onApply={(sen) => { setManualDiscount(sen); setShowDiscount(false); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }}
        />
      </Modal>

      {/* ── Paid confirmation ── */}
      <Modal visible={!!paid} transparent animationType="fade" onRequestClose={newOrder}>
        <View className="flex-1 bg-black/70 items-center justify-center px-8">
          <View className="w-[460px] rounded-3xl bg-surface border border-border p-8 items-center">
            <CheckCircle2 size={64} color={OK} />
            <Text className="text-cream text-2xl mt-4" style={{ fontFamily: "Peachi-Bold" }}>Paid</Text>
            <Text className="text-cream/55 mt-1" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>{paid?.orderNumber}</Text>
            <Text className="text-amber-400 text-4xl mt-3 mb-6" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{paid ? rm(paid.total) : ""}</Text>
            <Pressable onPress={newOrder} className="h-13 px-8 py-3.5 rounded-2xl bg-primary active:opacity-80">
              <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>New Order</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function discountSummary(v: { discount_type: string | null; discount_value: number | null; free_product_name: string | null }): string {
  if (v.discount_type === "percent") return `${v.discount_value ?? 0}% off`;
  if (v.discount_type === "flat") return `${rm(Math.round(v.discount_value ?? 0))} off`;
  if (v.discount_type === "free_item" || v.discount_type === "free_upgrade") return v.free_product_name ? `Free ${v.free_product_name}` : "Free item";
  return "Reward";
}

function TypeToggle({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="px-3.5 py-2 active:opacity-80" style={{ backgroundColor: active ? BRAND : "transparent" }}>
      <Text className={active ? "text-white" : "text-cream/55"} style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function ActionTab({ icon, label, active, onPress }: { icon: React.ReactNode; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-1 flex-row items-center justify-center gap-1.5 h-10 rounded-xl active:opacity-80" style={{ backgroundColor: active ? BRAND : "rgba(245,243,240,0.05)", borderWidth: 1, borderColor: active ? BRAND : "rgba(245,243,240,0.12)" }}>
      {icon}
      <Text className="text-cream text-xs" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>{label}</Text>
    </Pressable>
  );
}

function RewardRow({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center justify-between rounded-2xl px-4 py-3.5 mb-2 active:opacity-80" style={{ backgroundColor: "rgba(245,243,240,0.05)", borderWidth: 1, borderColor: "rgba(245,243,240,0.12)" }}>
      <View className="flex-row items-center gap-3 flex-1 pr-3">
        <Gift size={20} color="#FBBF24" />
        <View className="flex-1">
          <Text className="text-cream text-[15px]" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }} numberOfLines={1}>{title}</Text>
          <Text className="text-cream/45 text-xs mt-0.5" style={{ fontFamily: "SpaceGrotesk_500Medium" }} numberOfLines={1}>{subtitle}</Text>
        </View>
      </View>
      <View className="px-3 py-1.5 rounded-lg" style={{ backgroundColor: BRAND }}>
        <Text className="text-white text-xs" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>Apply</Text>
      </View>
    </Pressable>
  );
}

function ModifierSheet({ product, onClose, onConfirm }: { product: Product; onClose: () => void; onConfirm: (opts: ModifierOption[]) => void }) {
  const [sel, setSel] = useState<Record<string, string[]>>({});
  function toggle(groupId: string, optId: string, multi: boolean) {
    Haptics.selectionAsync();
    setSel((cur) => {
      const have = cur[groupId] ?? [];
      if (multi) return { ...cur, [groupId]: have.includes(optId) ? have.filter((x) => x !== optId) : [...have, optId] };
      return { ...cur, [groupId]: have.includes(optId) ? [] : [optId] };
    });
  }
  const chosen: ModifierOption[] = [];
  for (const g of product.modifiers) {
    const ids = sel[g.id] ?? [];
    for (const o of g.options) if (ids.includes(o.id)) chosen.push(o);
  }
  const addOn = chosen.reduce((s, o) => s + o.price_sen, 0);
  const missingRequired = product.modifiers.some((g) => g.required && (sel[g.id] ?? []).length === 0);

  return (
    <View className="flex-1 bg-black/70 items-center justify-center px-8">
      <View className="w-[560px] max-h-[88%] rounded-3xl bg-surface border border-border p-6">
        <View className="flex-row items-center justify-between mb-4">
          <View>
            <Text className="text-cream text-xl" style={{ fontFamily: "Peachi-Bold" }}>{product.name}</Text>
            <Text className="text-amber-400 text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(product.price_sen)}</Text>
          </View>
          <Pressable onPress={onClose} className="active:opacity-60"><X size={22} color="rgba(245,243,240,0.7)" /></Pressable>
        </View>
        <ScrollView className="max-h-[420px]">
          {product.modifiers.map((g) => (
            <View key={g.id} className="mb-4">
              <Text className="text-cream/55 text-xs tracking-[1.5px] mb-2" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
                {g.name.toUpperCase()}{g.required ? "  • REQUIRED" : ""}{g.multi ? "  • MULTI" : ""}
              </Text>
              <View className="gap-2">
                {g.options.map((o) => {
                  const on = (sel[g.id] ?? []).includes(o.id);
                  return (
                    <Pressable key={o.id} onPress={() => toggle(g.id, o.id, g.multi)} className={`flex-row items-center justify-between h-12 px-4 rounded-2xl border ${on ? "border-amber-400 bg-amber-400/10" : "border-border"}`} style={!on ? { backgroundColor: "rgba(245,243,240,0.04)" } : undefined}>
                      <Text className={on ? "text-cream" : "text-cream/75"} style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>{o.name}</Text>
                      <Text className={on ? "text-amber-400" : "text-cream/45"} style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>{o.price_sen > 0 ? `+${rm(o.price_sen)}` : ""}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
        <Pressable disabled={missingRequired} onPress={() => onConfirm(chosen)} className={`h-14 rounded-2xl items-center justify-center mt-3 ${missingRequired ? "bg-primary/30" : "bg-primary active:opacity-80"}`}>
          <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{missingRequired ? "Select required options" : `Add — ${rm(product.price_sen + addOn)}`}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PayMethod({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-4 h-16 px-5 rounded-2xl border border-border active:opacity-70" style={{ backgroundColor: "rgba(245,243,240,0.05)" }}>
      {icon}
      <Text className="text-cream text-lg" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>{label}</Text>
    </Pressable>
  );
}

// Cashier-applied manual discount. Percentage is taken off the subtotal
// (mirrors the web DiscountModal); the register clamps the result to what's
// still owed. Staff-role cashiers must clear a manager PIN to apply one.
function DiscountSheet({ subtotal, staffRole, onClose, onApply }: { subtotal: number; staffRole: string; onClose: () => void; onApply: (sen: number) => void }) {
  const [type, setType] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [verifying, setVerifying] = useState(false);

  const needsManagerOverride = staffRole === "staff";
  const numValue = parseFloat(value) || 0;
  const raw = type === "percent" ? Math.round(subtotal * (numValue / 100)) : Math.round(numValue * 100);
  const discountAmount = Math.max(0, Math.min(raw, subtotal));
  const after = Math.max(0, subtotal - discountAmount);

  async function apply() {
    if (discountAmount <= 0) return;
    if (needsManagerOverride) {
      if (managerPin.length < 4) { setPinError("Enter manager PIN"); return; }
      setVerifying(true);
      try {
        await apiPost("/api/auth/verify-manager", { pin: managerPin });
      } catch {
        setPinError("Invalid manager PIN");
        setVerifying(false);
        return;
      }
      setVerifying(false);
    }
    onApply(discountAmount);
  }

  return (
    <View className="flex-1 bg-black/70 items-center justify-center px-8">
      <View className="w-[480px] rounded-3xl bg-surface border border-border p-6">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-cream text-xl" style={{ fontFamily: "Peachi-Bold" }}>Apply Discount</Text>
          <Pressable onPress={onClose} className="active:opacity-60"><X size={22} color="rgba(245,243,240,0.7)" /></Pressable>
        </View>

        {/* Type toggle */}
        <View className="flex-row rounded-xl overflow-hidden border border-cream/15 mb-3">
          <DiscToggle label="Percentage (%)" active={type === "percent"} onPress={() => { Haptics.selectionAsync(); setType("percent"); setValue(""); }} />
          <DiscToggle label="Fixed (RM)" active={type === "fixed"} onPress={() => { Haptics.selectionAsync(); setType("fixed"); setValue(""); }} />
        </View>

        {/* Quick percentages */}
        {type === "percent" && (
          <View className="flex-row gap-2 mb-3">
            {[5, 10, 15, 20, 50].map((pct) => {
              const on = value === String(pct);
              return (
                <Pressable key={pct} onPress={() => { Haptics.selectionAsync(); setValue(String(pct)); }} className="flex-1 h-11 rounded-xl items-center justify-center" style={{ backgroundColor: on ? BRAND : "rgba(245,243,240,0.06)", borderWidth: on ? 0 : 1, borderColor: "rgba(245,243,240,0.12)" }}>
                  <Text className={on ? "text-white" : "text-cream/75"} style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 14 }}>{pct}%</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Value input */}
        <TextInput
          value={value}
          onChangeText={setValue}
          keyboardType={type === "percent" ? "number-pad" : "decimal-pad"}
          placeholder={type === "percent" ? "e.g. 10" : "e.g. 5.00"}
          placeholderTextColor="rgba(245,243,240,0.35)"
          className="h-12 px-3 rounded-xl border border-cream/15 text-cream mb-3"
          style={{ backgroundColor: "rgba(245,243,240,0.06)", fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 16 }}
        />

        {/* Preview */}
        {numValue > 0 && (
          <View className="rounded-xl p-3 mb-3" style={{ backgroundColor: "rgba(245,243,240,0.04)" }}>
            <View className="flex-row justify-between mb-1">
              <Text className="text-cream/55 text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>Subtotal</Text>
              <Text className="text-cream/80 text-sm" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>{rm(subtotal)}</Text>
            </View>
            <View className="flex-row justify-between mb-1">
              <Text className="text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium", color: OK }}>Discount{type === "percent" ? ` (${numValue}%)` : ""}</Text>
              <Text className="text-sm" style={{ fontFamily: "SpaceGrotesk_600SemiBold", color: OK }}>−{rm(discountAmount)}</Text>
            </View>
            <View className="flex-row justify-between border-t border-border pt-1">
              <Text className="text-cream text-sm" style={{ fontFamily: "Peachi-Bold" }}>After</Text>
              <Text className="text-cream text-sm" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(after)}</Text>
            </View>
          </View>
        )}

        {/* Manager PIN (staff role only) */}
        {needsManagerOverride && (
          <View className="mb-3">
            <Text className="text-[#D4A843] text-xs mb-1.5" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>Manager PIN required</Text>
            <TextInput
              value={managerPin}
              onChangeText={(t) => { setManagerPin(t); setPinError(""); }}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              placeholder="Enter manager PIN"
              placeholderTextColor="rgba(245,243,240,0.35)"
              className="h-12 px-3 rounded-xl border text-cream"
              style={{ backgroundColor: "rgba(245,243,240,0.06)", borderColor: pinError ? "#E5484D" : "rgba(245,243,240,0.15)", fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 16 }}
            />
            {!!pinError && <Text className="text-[#E5484D] text-xs mt-1.5" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>{pinError}</Text>}
          </View>
        )}

        <Pressable disabled={discountAmount <= 0 || verifying} onPress={apply} className={`h-14 rounded-2xl items-center justify-center ${discountAmount <= 0 ? "bg-primary/30" : "bg-primary active:opacity-80"}`}>
          {verifying ? <ActivityIndicator color="#F5F3F0" /> : (
            <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{discountAmount > 0 ? `Apply Discount · −${rm(discountAmount)}` : "Enter a discount"}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function DiscToggle({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-1 py-2.5 items-center active:opacity-80" style={{ backgroundColor: active ? BRAND : "transparent" }}>
      <Text className={active ? "text-white" : "text-cream/55"} style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function ColorTab({ label, color, width, active, onPress }: { label: string; color: string; width: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="rounded-lg px-1.5 items-center justify-center active:opacity-90" style={{ width, height: 44, backgroundColor: color, opacity: active ? 1 : 0.6, borderWidth: 2, borderColor: active ? "rgba(255,255,255,0.85)" : "transparent" }}>
      <Text className="text-white text-center" numberOfLines={2} style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 12.5, lineHeight: 15 }}>{label}</Text>
    </Pressable>
  );
}

function ProductTile({ product, width, onPress }: { product: Product; width: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="rounded-2xl overflow-hidden border border-border active:opacity-70" style={{ width, backgroundColor: "rgba(245,243,240,0.04)" }}>
      <View className="aspect-square w-full bg-cream/5">
        {product.image_url ? <Image source={{ uri: product.image_url }} className="w-full h-full" resizeMode="cover" /> : null}
      </View>
      <View className="px-2 py-2">
        <Text className="text-cream text-[12px]" style={{ fontFamily: "Peachi-Medium" }} numberOfLines={2}>{product.name}</Text>
        <Text className="text-amber-400 text-[12px] mt-0.5" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(product.price_sen)}</Text>
      </View>
    </Pressable>
  );
}

function Stepper({ icon, onPress }: { icon: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="h-7 w-7 rounded-full items-center justify-center active:opacity-60" style={{ backgroundColor: "rgba(245,243,240,0.08)" }}>
      {icon}
    </Pressable>
  );
}
