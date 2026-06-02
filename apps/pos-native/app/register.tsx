import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, Pressable, FlatList, ActivityIndicator, Image, ScrollView, Modal,
  TextInput, useWindowDimensions, Keyboard, Alert,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Minus, LogOut, X, CheckCircle2,
  Settings as SettingsIcon, User, Gift, LayoutGrid, Search, Trash2, Tag,
  Grid3x3, QrCode, CreditCard, ClipboardList, Bike, ShoppingBag, ChefHat, Power,
} from "lucide-react-native";
import { usePos } from "@/lib/store";
import { apiPost } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { usePickupPrinter } from "@/lib/use-pickup-printer";
import { useGrabPrinter } from "@/lib/use-grab-printer";
import { chargeMaybankCard, type MaybankTerminalResult } from "@/lib/maybank-terminal";
import { fetchCategories, fetchProducts, type Product, type ModifierOption } from "@/lib/menu";
import { useCart, cartSubtotal, type CartLine } from "@/lib/cart";
import { useDisplay } from "@/lib/display";
import { createSale, getNextQueueNumber } from "@/lib/checkout";
import { useSettings, gridColumns, serviceChargeRate, defaultOrderType, receiptConfig, tableZones } from "@/lib/settings";
import { useTablesPanel, type TableSlot, type TableOrderRef } from "@/lib/use-tables-panel";
import { useOrdersPanel, type KdsOrder } from "@/lib/use-orders-panel";
import { useShift, openShift, closeShift, shiftTotals, type Shift, type ShiftTotals } from "@/lib/shift";
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
const DANGER = "#E5484D";

/** Floor-plan tile dimensions, matching the BO editor. Square seats render as
 *  ATTACHED 2-tops pushed together (4-pax = two squares, 6-pax = three); round
 *  tables stay a single scaled circle. */
function tableDims(seats: number | null | undefined, shape: "square" | "round"): { w: number; h: number; cells: number } {
  const s = seats ?? 4;
  if (shape === "round") {
    const d = s <= 2 ? 58 : s <= 4 ? 74 : s <= 6 ? 90 : 104;
    return { w: d, h: d, cells: 1 };
  }
  const cells = s <= 2 ? 1 : s <= 4 ? 2 : s <= 6 ? 3 : 4;
  const unit = 56;
  return { w: unit * cells, h: unit, cells };
}

type AppliedReward = { redemptionId: string; name: string; descriptor: RedeemDiscount } | null;
type Panel = "none" | "customer" | "table";

export default function Register() {
  const { staff, outletId, signOut } = usePos();
  const [activeCat, setActiveCat] = useState<string>("all");
  // One "Orders" command center — a single panel with three tabs: Tables
  // (dine-in floor) · QR self-orders · Pickup & Grab. `hub` is the active
  // tab, or null when the panel is closed.
  const [hub, setHub] = useState<"tables" | "qr" | "online" | null>(null);
  // Which order's status update is in flight (uid) — disables its buttons.
  const [bumpingUid, setBumpingUid] = useState<string | null>(null);
  // Shift open/close UI.
  const [showShift, setShowShift] = useState(false);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [openingCash, setOpeningCash] = useState("");
  const [closingCash, setClosingCash] = useState("");
  const [liveTotals, setLiveTotals] = useState<ShiftTotals | null>(null);
  const [closedSummary, setClosedSummary] = useState<ShiftTotals | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  // Which payment method the cashier has picked inside the checkout
  // modal. `null` = method picker; "qr" = show Maybank QR awaiting
  // payment; "card" = drive the Maybank terminal flow.
  const [payMethod, setPayMethod] = useState<null | "qr" | "card">(null);
  // Card terminal state — purely a UI proxy until the real Maybank
  // terminal SDK is wired (see lib/maybank-terminal.ts).
  const [cardStage, setCardStage] = useState<"idle" | "prompting" | "approved" | "declined">("idle");
  // The terminal's approval payload — held so the cashier-verification
  // screen can show the approval code + masked PAN before we record the
  // sale. Card payments now require a manual confirm (mirrors QR), so the
  // terminal "approved" result no longer auto-commits.
  const [cardResult, setCardResult] = useState<Extract<MaybankTerminalResult, { status: "approved" }> | null>(null);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState<{ orderNumber: string; total: number } | null>(null);
  const [modProduct, setModProduct] = useState<Product | null>(null);

  // Cashier-applied manual discount (sen) — stacks on top of loyalty/promo.
  const [manualDiscount, setManualDiscount] = useState(0);
  const [showDiscount, setShowDiscount] = useState(false);

  // Order context.
  const [orderType, setOrderType] = useState<"dine_in" | "takeaway">("takeaway");
  const [tableNumber, setTableNumber] = useState<string>("");
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
  // Live dine-in tables grid for the Tables modal — pulled here so the
  // hook is mounted persistently (catch-up + Realtime subscribe) instead
  // of being torn down each time the modal closes.
  const tableZonesInput = useMemo(() => tableZones(settings), [settings]);
  const tableSlots = useTablesPanel(outletId, tableZonesInput);
  // QR self-orders (guests who scanned the table QR) flattened off the table
  // map into a flat queue for the Orders hub's "QR self-orders" tab.
  const qrOrders = useMemo<TableOrderRef[]>(() => {
    const seen = new Set<string>();
    const out: TableOrderRef[] = [];
    for (const slot of tableSlots) {
      for (const o of slot.orders) {
        if (o.source === "qr" && !seen.has(o.id)) { seen.add(o.id); out.push(o); }
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [tableSlots]);
  // Live Grab + Pickup order feed for the on-register KDS (Orders modal).
  // Mounted persistently so it keeps catching up + receiving Realtime even
  // while the modal is closed (drives the header badge count).
  const { orders: kdsOrders, reload: reloadOrders } = useOrdersPanel(outletId);

  // Advance a Grab/Pickup order's fulfilment status via the service-role
  // route (anon can't UPDATE printed pickup rows under RLS). Realtime
  // flows the change back through useOrdersPanel so the card re-buckets.
  const advanceOrderStatus = useCallback(async (order: KdsOrder, status: "preparing" | "ready" | "completed") => {
    setBumpingUid(order.uid);
    console.log(`[order-status] tap ${order.source} ${order.orderNumber} -> ${status}`);
    try {
      const res = await apiPost<{ ok?: boolean; grabPushed?: boolean }>("/api/pos/order-status", { source: order.source, id: order.id, status });
      console.log(`[order-status] ok ${order.orderNumber} grabPushed=${res?.grabPushed ?? false}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Force an immediate refresh rather than waiting on the Realtime
      // round-trip — keeps the card from looking stuck right after a tap.
      await reloadOrders();
    } catch (e) {
      console.error(`[order-status] FAIL ${order.orderNumber}:`, e instanceof Error ? e.message : e);
      alert(`Couldn't mark ${order.orderNumber} ${status}.\n${e instanceof Error ? e.message : "Check the connection and try again."}`);
    } finally {
      setBumpingUid(null);
    }
  }, [reloadOrders]);

  // ── Shift open/close ──
  const { shift, reload: reloadShift } = useShift(outletId);
  const openShiftModal = useCallback(() => {
    Haptics.selectionAsync();
    setClosedSummary(null);
    setOpeningCash("");
    setClosingCash("");
    setLiveTotals(null);
    setShowShift(true);
    // Pull live sales for the open shift so the close screen shows a summary.
    if (shift) shiftTotals(shift.id).then(setLiveTotals).catch(() => setLiveTotals(null));
  }, [shift]);
  const doOpenShift = useCallback(async () => {
    if (!outletId || !staff?.staffId) return;
    setShiftBusy(true);
    const sen = Math.round((parseFloat(openingCash) || 0) * 100);
    await openShift(outletId, staff.staffId, sen);
    await reloadShift();
    setShiftBusy(false);
    setOpeningCash("");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [outletId, staff?.staffId, openingCash, reloadShift]);
  const doCloseShift = useCallback(async () => {
    if (!shift || !staff?.staffId) return;
    setShiftBusy(true);
    const sen = Math.round((parseFloat(closingCash) || 0) * 100);
    const totals = await closeShift(shift, staff.staffId, sen);
    setClosedSummary(totals ?? { orders: 0, sales: 0 });
    await reloadShift();
    setShiftBusy(false);
    setClosingCash("");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [shift, staff?.staffId, closingCash, reloadShift]);
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

  // Resolve the POS outlet → its pickup STORE slug (e.g. "shah-alam"). The
  // per-outlet availability ("86") table is keyed by that slug — the same key
  // the pickup app reads and the backoffice Availability matrix writes.
  const queryClient = useQueryClient();
  const [storeId, setStoreId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setStoreId(null);
    if (!outletId) return;
    (async () => {
      const { data } = await supabase
        .from("outlet_settings").select("store_id")
        .eq("loyalty_outlet_id", outletId).maybeSingle();
      if (!cancelled) setStoreId((data as { store_id?: string } | null)?.store_id ?? null);
    })();
    return () => { cancelled = true; };
  }, [outletId]);
  // Live availability: a 86 toggle anywhere (this register, another register,
  // or the backoffice matrix) refetches the catalog so the grid greys /
  // un-greys instantly.
  useEffect(() => {
    if (!storeId) return;
    const ch = supabase
      .channel(`pos-availability-${storeId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "outlet_product_availability", filter: `outlet_id=eq.${storeId}` },
        () => void queryClient.invalidateQueries({ queryKey: ["pos-products"] }))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [storeId, queryClient]);

  const cats = useQuery({ queryKey: ["pos-categories"], queryFn: fetchCategories });
  const prods = useQuery({ queryKey: ["pos-products", storeId], queryFn: () => fetchProducts(storeId) });

  // Pickup-order auto-printer — subscribes to the `orders` table and
  // fires a kitchen docket on the native SUNMI head when a paid pickup
  // or QR-dine-in order lands for this outlet. Ported from the
  // (retiring) Capacitor web POS's use-pickup-printer.ts. Needs the
  // products catalog as a Map for per-line kitchen_station routing.
  const productsByIdForPrinter = useMemo(() => {
    const m = new Map<string, { id: string; kitchen_station: string | null }>();
    for (const p of prods.data ?? []) {
      m.set(p.id, { id: p.id, kitchen_station: p.kitchen_station ?? null });
    }
    return m;
  }, [prods.data]);
  usePickupPrinter(outletId, productsByIdForPrinter);
  // Mirror: auto-print kitchen dockets when Grab's webhook lands a new
  // pos_orders row (source='grabfood') for this outlet.
  useGrabPrinter(outletId, productsByIdForPrinter);

  const lines = useCart((s) => s.lines);
  const add = useCart((s) => s.add);
  const inc = useCart((s) => s.inc);
  const dec = useCart((s) => s.dec);
  const remove = useCart((s) => s.remove);
  const setLineDiscount = useCart((s) => s.setLineDiscount);
  const setLineNote = useCart((s) => s.setLineNote);
  const clear = useCart((s) => s.clear);
  // Cart line editor sheet — tap any line in the cart to open. From
  // here the cashier can adjust qty, apply a per-line discount, or
  // remove the line.
  const [editLineKey, setEditLineKey] = useState<string | null>(null);

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
    if (p.available === false) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert(p.name, `Out of stock at ${outletShort(outletId)}. Long-press the item to mark it back in stock.`);
      return;
    }
    Haptics.selectionAsync();
    if (p.modifiers.length > 0) setModProduct(p);
    else add(p);
  }

  // Long-press a product tile → 86 it (or un-86 it) at THIS outlet. Writes the
  // per-outlet override through the service-role API, which also live-pushes
  // the status to GrabFood. Optimistic cache flip + the realtime subscription
  // keep every register, the customer display, the pickup app and Grab in sync.
  function promptAvailability(p: Product) {
    Haptics.selectionAsync();
    const makeOos = p.available !== false;
    Alert.alert(
      p.name,
      makeOos
        ? `Mark out of stock at ${outletShort(outletId)}? It greys out here and drops off pickup + GrabFood.`
        : `Mark back in stock at ${outletShort(outletId)}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: makeOos ? "Mark out of stock" : "Mark in stock",
          style: makeOos ? "destructive" : "default",
          onPress: () => void setAvailability(p, !makeOos),
        },
      ],
    );
  }

  async function setAvailability(p: Product, isAvailable: boolean) {
    // Optimistic: flip it in the cached catalog so the grid updates instantly.
    queryClient.setQueryData<Product[]>(["pos-products", storeId], (old) =>
      (old ?? []).map((x) => (x.id === p.id ? { ...x, available: isAvailable } : x)),
    );
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await apiPost("/api/pos/availability", { outlet_id: outletId, product_id: p.id, is_available: isAvailable });
    } catch (e) {
      // Revert from the source of truth + surface the failure.
      void queryClient.invalidateQueries({ queryKey: ["pos-products"] });
      Alert.alert("Couldn't update availability", e instanceof Error ? e.message : String(e));
    }
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
    setPayMethod(null);
    setCardStage("idle");
    setCardResult(null);
    setTableNumber("");
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
        table_label: "Stand", // counter dine-in → "Stand #" (vs QR self-order "Table")
        created_at: sale.createdAt,
        subtotal: sale.subtotal,
        service_charge: sale.serviceCharge,
        discount_amount: sale.discount,
        total: sale.total,
        pos_order_items: printLines.map((l) => {
          const lineDisc = l.line_discount_sen ?? 0;
          const gross = l.unit_sen * l.qty;
          return {
            product_name: l.product.name,
            quantity: l.qty,
            unit_price: l.unit_sen,
            modifier_total: l.modifiers.reduce((s, m) => s + m.price_sen, 0),
            discount_amount: lineDisc,
            item_total: Math.max(0, gross - lineDisc),
            modifiers: l.modifiers.map((m) => ({ name: m.name })),
            kitchen_station: l.product.kitchen_station ?? null,
            notes: l.note ?? null,
          };
        }),
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
        printKitchenDocket80mm(printOrder, outletInfo, outletId).catch((e) => console.error("[print] docket:", e?.message ?? e));
        printReceipt80mm(printOrder, outletInfo, receiptConfig(settings), outletId).catch((e) => console.error("[print] receipt:", e?.message ?? e));
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
    orderType === "dine_in" && tableNumber ? `Stand #${tableNumber}` : null,
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
            {/* Shift — open/close the register's cashier shift. Green dot
                = open, amber = none. Tap to open (with a cash float) or
                close (with an end-of-shift summary). */}
            <Pressable onPress={openShiftModal} className="flex-row items-center gap-2 px-3 py-2 rounded-xl border border-cream/15 active:opacity-60">
              <Power size={16} color={shift ? "#22C55E" : "#FBBF24"} />
              <Text className="text-cream/70 text-xs" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>Shift</Text>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: shift ? "#22C55E" : "#FBBF24" }} />
            </Pressable>
            {/* Orders command center — one button opens a tabbed panel for
                every order channel: dine-in Tables, QR self-orders, and
                Pickup + Grab. Badge = live incoming orders (QR + delivery). */}
            <Pressable onPress={() => { Haptics.selectionAsync(); setHub((v) => (v ? null : "tables")); }} className={`flex-row items-center gap-2 px-3 py-2 rounded-xl border active:opacity-60 ${hub ? "border-primary bg-primary/10" : "border-cream/15"}`}>
              <ClipboardList size={16} color="rgba(245,243,240,0.7)" />
              <Text className="text-cream/70 text-xs" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>Orders</Text>
              {(() => {
                const liveKds = kdsOrders.filter((o) => o.status !== "ready").length;
                const incoming = kdsOrders.length + qrOrders.length;
                if (incoming === 0) return null;
                return (
                  <View className="rounded-full px-1.5" style={{ backgroundColor: liveKds > 0 ? "#22C55E" : "rgba(245,243,240,0.25)" }}>
                    <Text className="text-espresso text-[10px]" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{incoming}</Text>
                  </View>
                );
              })()}
            </Pressable>
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

        {/* Product grid — wait for settings AND products to load before
            mounting the FlatList. Without this gate, gridColumns(null) ran
            with its 4-column default on first paint, then the BO setting
            (5) arrived and the FlatList re-mounted via key change, making
            the tiles visibly snap from 4-wide to 5-wide. */}
        {prods.isLoading || !settings ? (
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
            renderItem={({ item }) => <ProductTile product={item} width={tileW} onPress={() => onAdd(item)} onLongPress={() => promptAvailability(item)} />}
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
            <ActionTab icon={<LayoutGrid size={15} color="#F5F3F0" />} label="Stand" active={panel === "table"} onPress={() => setPanel(panel === "table" ? "none" : "table")} />
          )}
        </View>

        {/* Inline panels */}
        {panel === "customer" && !member && (
          <View className="px-4 pb-3">
            <View className="flex-row gap-2">
              <NumpadField
                value={phoneInput}
                onChangeText={(t) => { setPhoneInput(t); setLookupError(null); }}
                placeholder="Customer phone"
                mode="integer"
                title="Customer phone"
                onDone={lookup}
                className="flex-1 h-11 px-3 rounded-xl border border-cream/15"
                style={{ backgroundColor: "rgba(245,243,240,0.06)" }}
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
            <Text className="text-cream/50 text-[11px] mb-1.5" style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 0.8 }}>TABLE STAND NO. — the numbered stand you hand the guest</Text>
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <NumpadField
                value={tableNumber}
                onChangeText={setTableNumber}
                placeholder="Tap to enter stand #"
                mode="integer"
                prefix="#"
                title="Table Stand No."
                onDone={() => { if (tableNumber) setPanel("none"); }}
                className="flex-1 h-11 px-3 rounded-xl border border-cream/15"
                style={{ backgroundColor: "rgba(245,243,240,0.06)" }}
              />
              {!!tableNumber && (
                <Pressable onPress={() => { Haptics.selectionAsync(); setTableNumber(""); }} className="h-11 px-3 rounded-xl items-center justify-center" style={{ backgroundColor: "rgba(245,243,240,0.06)", borderWidth: 1, borderColor: "rgba(245,243,240,0.12)" }}>
                  <Text className="text-cream/70 text-xs" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>Clear</Text>
                </Pressable>
              )}
            </View>
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
            renderItem={({ item }) => {
              const gross = item.unit_sen * item.qty;
              const lineDisc = item.line_discount_sen ?? 0;
              const net = Math.max(0, gross - lineDisc);
              return (
                // Tap anywhere on the line (except the +/- steppers) to
                // open the line editor — qty, discount, remove.
                <Pressable
                  onPress={() => { Haptics.selectionAsync(); setEditLineKey(item.key); }}
                  className="flex-row items-center py-3 border-b border-border active:opacity-70"
                >
                  <View className="flex-1 pr-2">
                    <Text className="text-cream text-[13px]" style={{ fontFamily: "Peachi-Medium" }} numberOfLines={1}>{item.product.name}</Text>
                    {item.modifiers.length > 0 && (
                      <Text className="text-cream/45 text-[11px]" style={{ fontFamily: "SpaceGrotesk_400Regular" }} numberOfLines={1}>{item.modifiers.map((m) => m.name).join(", ")}</Text>
                    )}
                    <View className="flex-row items-center" style={{ gap: 6 }}>
                      <Text className="text-cream/55 text-[11px] mt-0.5" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>{rm(item.unit_sen)}</Text>
                      {lineDisc > 0 && (
                        <View className="rounded-full mt-0.5 px-2 py-0.5" style={{ backgroundColor: "rgba(134,239,172,0.14)", borderWidth: 1, borderColor: "rgba(134,239,172,0.4)" }}>
                          <Text className="text-[9.5px]" style={{ fontFamily: "SpaceGrotesk_700Bold", color: OK, letterSpacing: 0.4 }}>−{rm(lineDisc)} OFF</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Stepper icon={<Minus size={14} color="#F5F3F0" />} onPress={() => { Haptics.selectionAsync(); dec(item.key); }} />
                    <Text className="text-cream w-6 text-center" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{item.qty}</Text>
                    <Stepper icon={<Plus size={14} color="#F5F3F0" />} onPress={() => { Haptics.selectionAsync(); inc(item.key); }} />
                  </View>
                  <View className="w-[72px] items-end">
                    {lineDisc > 0 && (
                      <Text className="text-cream/35 text-[10px]" style={{ fontFamily: "SpaceGrotesk_500Medium", textDecorationLine: "line-through" }}>{rm(gross)}</Text>
                    )}
                    <Text className="text-cream text-[13px]" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(net)}</Text>
                  </View>
                </Pressable>
              );
            }}
          />
        )}

        {/* Totals + charge */}
        <View className="px-5 pt-3 pb-6 border-t border-border">
          {/* Subtotal row doubles as the manual-discount entry: tap it to
              open the DiscountSheet (discount applies to the total). The
              standalone Discount tab was removed in favour of this. */}
          <Pressable
            onPress={() => { if (lines.length === 0) return; Haptics.selectionAsync(); setShowDiscount(true); }}
            className="flex-row justify-between items-center mb-1 active:opacity-60"
          >
            <View className="flex-row items-center gap-1.5">
              <Text className="text-cream/55 text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>Subtotal</Text>
              <Tag size={11} color="rgba(245,243,240,0.32)" />
            </View>
            <Text className="text-cream/80 text-sm" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>{rm(subtotal)}</Text>
          </Pressable>
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
                  // Push the amount + flip the customer display to the QR
                  // payment screen BEFORE opening the modal — the customer
                  // should see "Scan to Pay" the instant the cashier hits
                  // Charge, not after a tap-through.
                  useDisplay.getState().setPayTotal(total);
                  setDisplayStatus("payment");
                  setShowCheckout(true);
                }}
                className={`h-14 rounded-2xl items-center justify-center ${empty ? "bg-primary/30" : "bg-primary active:opacity-80"}`}
              >
                <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
                  {empty ? "Add items" : needsTable ? "Give a stand #" : `Charge ${rm(total)}`}
                </Text>
              </Pressable>
            );
          })()}
        </View>
      </View>

      {/* ── Checkout: QR-only flow ─────────────────────────────────────
          We decided cash + card are off the table at the counter — every
          customer pays via Maybank DuitNow QR (or another QR/e-wallet that
          scans the same payload). Flow:

          1. Cashier hits "Charge" → opens this modal, customer-display
             switches to status="payment" (renders the QR + amount).
          2. Customer scans + pays. Maybank has no callback to our POS, so
             confirmation is a manual visual check on the cashier's phone
             /Maybank app.
          3. Cashier taps "Payment Received" → we call pay("qr") which
             records the sale + fires the receipt + kitchen docket.

          The modal opens already in the payment-display state — we set
          displayStatus="payment" the moment showCheckout becomes true
          (see effect below) so the customer sees the QR immediately. */}
      {/* ── Tables panel — live dine-in occupancy ─────────────────────
          Grid of T1..Tn, colour-coded by status. Tapping a busy tile
          shows the current order summary (read-only — tabs/cart edits
          live in the customer's own QR session on their phone). When the
          cashier taps a FREE tile in dine_in mode, we pre-fill the cart
          flow's tableNumber and close so the next checkout points to
          that table. */}
      <Modal visible={hub !== null} transparent animationType="fade" onRequestClose={() => setHub(null)}>
        <View className="flex-1 bg-black/80 items-center justify-center px-6">
          {/* Tap the dark backdrop to close — same as pressing Orders again. */}
          <Pressable onPress={() => setHub(null)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          <View className="rounded-3xl bg-surface border border-border p-6" style={{ width: "92%", maxWidth: 1180, height: "84%" }}>
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-1">
                <Text className="text-cream text-xl" style={{ fontFamily: "Peachi-Bold" }}>Orders · {outletShort(outletId)}</Text>
                <Text className="text-cream/55 text-xs mt-0.5" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                  {hub === "tables"
                    ? `${tableSlots.filter((t) => t.orders.length > 0).length} of ${tableSlots.length} tables have orders · live`
                    : hub === "qr"
                    ? (qrOrders.length === 0 ? "No live QR table orders" : `${qrOrders.length} QR table order${qrOrders.length === 1 ? "" : "s"} · self-ordered · live`)
                    : (kdsOrders.length === 0 ? "No live delivery or pickup orders" : `${kdsOrders.length} in the kitchen · Grab + Pickup · live`)}
                </Text>
              </View>
              <View className="flex-row items-center gap-4">
                {hub === "tables" && (<><TableLegendDot color="#3B82F6" label="QR table" /><TableLegendDot color="#FBBF24" label="Register" /></>)}
                {hub === "online" && (<>
                  <View className="flex-row items-center gap-1.5"><Bike size={14} color="#22C55E" /><Text className="text-cream/55 text-[11px]" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>Grab</Text></View>
                  <View className="flex-row items-center gap-1.5"><ShoppingBag size={14} color="#3B82F6" /><Text className="text-cream/55 text-[11px]" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>Pickup</Text></View>
                </>)}
                <Pressable onPress={() => setHub(null)} className="active:opacity-60 ml-2">
                  <X size={22} color="rgba(245,243,240,0.7)" />
                </Pressable>
              </View>
            </View>
            {/* Tab switcher — one command center for every order channel. */}
            <View className="flex-row gap-2 mb-4">
              {(() => {
                const tabs: { key: "tables" | "qr" | "online"; label: string; Icon: typeof Grid3x3; count: number }[] = [
                  { key: "tables", label: "Tables", Icon: Grid3x3, count: tableSlots.filter((t) => t.orders.length > 0).length },
                  { key: "qr", label: "QR self-orders", Icon: QrCode, count: qrOrders.length },
                  { key: "online", label: "Pickup & Grab", Icon: Bike, count: kdsOrders.length },
                ];
                return tabs.map(({ key, label, Icon, count }) => (
                  <Pressable key={key} onPress={() => { Haptics.selectionAsync(); setHub(key); }}
                    className={`flex-row items-center gap-2 px-4 py-2.5 rounded-xl border active:opacity-70 ${hub === key ? "border-primary bg-primary/15" : "border-cream/12"}`}>
                    <Icon size={15} color={hub === key ? "#C2452D" : "rgba(245,243,240,0.6)"} />
                    <Text className={hub === key ? "text-cream text-xs" : "text-cream/60 text-xs"} style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{label}</Text>
                    {count > 0 && (
                      <View className="rounded-full px-1.5" style={{ backgroundColor: hub === key ? "#C2452D" : "rgba(245,243,240,0.18)" }}>
                        <Text className="text-cream text-[10px]" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{count}</Text>
                      </View>
                    )}
                  </Pressable>
                ));
              })()}
            </View>
            <ScrollView style={{ maxHeight: 600 }} showsVerticalScrollIndicator={false}>
              {hub === "tables" && (() => {
                // Group the flat slots back into their zones for display.
                const groups: { name: string; slots: TableSlot[] }[] = [];
                for (const slot of tableSlots) {
                  let g = groups.find((x) => x.name === slot.zone);
                  if (!g) { g = { name: slot.zone, slots: [] }; groups.push(g); }
                  g.slots.push(slot);
                }
                if (groups.length === 0) {
                  return (
                    <View className="py-12 items-center w-full">
                      <Text className="text-cream/40 text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                        No tables configured. Add a Table Layout in BackOffice → POS Settings.
                      </Text>
                    </View>
                  );
                }
                return groups.map((g) => (
                  <View key={g.name} style={{ width: "100%", marginBottom: 18 }}>
                    <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 12, letterSpacing: 1.2, color: "rgba(245,243,240,0.5)", marginBottom: 8 }}>
                      {g.name.toUpperCase()}
                    </Text>
                    {/* Floor-plan canvas: tables at their saved (normalised) positions. */}
                    <View style={{ position: "relative", width: "100%", height: 440, backgroundColor: "rgba(245,243,240,0.03)", borderRadius: 14, borderWidth: 1, borderColor: "rgba(245,243,240,0.08)" }}>
                      {g.slots.map((slot) => {
                        const has = slot.orders.length > 0;
                        const dim = tableDims(slot.seats, slot.shape);
                        return (
                          <Pressable
                            key={slot.label}
                            onPress={() => {
                              // QR floor plan is view-only: it shows which physical
                              // tables have QR self-orders. Counter orders use a
                              // Table Stand # (not a floor-plan table), so no assign.
                              Haptics.selectionAsync();
                            }}
                            className="active:opacity-80 items-center justify-center"
                            style={{
                              position: "absolute",
                              left: `${slot.x * 100}%`, top: `${slot.y * 100}%`,
                              marginLeft: -dim.w / 2, marginTop: -dim.h / 2,
                              width: dim.w, height: dim.h,
                              borderRadius: slot.shape === "round" ? dim.h / 2 : 14, borderWidth: 1,
                              backgroundColor: has ? "rgba(194,69,45,0.18)" : "rgba(245,243,240,0.06)",
                              borderColor: has ? "rgba(194,69,45,0.6)" : "rgba(245,243,240,0.14)",
                            }}
                          >
                            {slot.shape !== "round" && dim.cells > 1 && Array.from({ length: dim.cells - 1 }).map((_, i) => (
                              <View key={`d${i}`} style={{ position: "absolute", top: 8, bottom: 8, width: 1, left: `${((i + 1) / dim.cells) * 100}%`, backgroundColor: "rgba(245,243,240,0.18)" }} />
                            ))}
                            <Text style={{ fontFamily: "Peachi-Bold", fontSize: 18, color: has ? "#F5F3F0" : "rgba(245,243,240,0.6)" }} numberOfLines={1}>{slot.label}</Text>
                            {slot.seats != null && (
                              <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 9, color: "rgba(245,243,240,0.4)" }}>{slot.seats}p</Text>
                            )}
                            {has && (
                              <View style={{ position: "absolute", top: -7, right: -7, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "#C2452D", alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
                                <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 11, color: "#F5F3F0" }}>{slot.orders.length}</Text>
                              </View>
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ));
              })()}
              {/* ── QR self-orders tab — guests who scanned the table QR. ── */}
              {hub === "qr" && (
                <View className="flex-row flex-wrap" style={{ gap: 12 }}>
                  {qrOrders.map((o) => (
                    <View key={o.id} className="rounded-2xl border border-border p-4" style={{ width: 264, backgroundColor: "rgba(245,243,240,0.03)" }}>
                      <View className="flex-row items-center justify-between mb-2">
                        <View className="flex-row items-center gap-2">
                          <QrCode size={15} color="#3B82F6" />
                          <Text className="text-cream text-sm" style={{ fontFamily: "Peachi-Bold" }}>{o.orderNumber}</Text>
                        </View>
                        <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: "rgba(245,243,240,0.08)" }}>
                          <Text className="text-cream/70 text-[10px]" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{o.status}</Text>
                        </View>
                      </View>
                      <View className="flex-row items-center justify-between">
                        <Text className="text-cream/60 text-xs" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>Table {o.tableKey}</Text>
                        <Text className="text-cream text-sm" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(o.total)}</Text>
                      </View>
                      <Text className="text-cream/40 text-[11px] mt-1" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                        {new Date(o.createdAt).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: true })}
                      </Text>
                    </View>
                  ))}
                  {qrOrders.length === 0 && (
                    <View className="py-16 items-center w-full">
                      <QrCode size={40} color="rgba(245,243,240,0.18)" />
                      <Text className="text-cream/40 text-sm mt-3" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                        Orders guests place by scanning the table QR will appear here.
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* ── Pickup & Grab tab — on-register KDS. Status writes go through
                  the service-role API (RLS blocks anon updates on printed rows). */}
              {hub === "online" && (
                <View className="flex-row flex-wrap" style={{ gap: 12 }}>
                  {kdsOrders.map((order) => (
                    <KdsCard
                      key={order.uid}
                      order={order}
                      busy={bumpingUid === order.uid}
                      onAdvance={(status) => advanceOrderStatus(order, status)}
                    />
                  ))}
                  {kdsOrders.length === 0 && (
                    <View className="py-16 items-center w-full">
                      <ChefHat size={40} color="rgba(245,243,240,0.18)" />
                      <Text className="text-cream/40 text-sm mt-3" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                        Grab and pickup orders will appear here as they come in.
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Shift open / close ─────────────────────────────────────────
          Explicit cashier-shift control. Open a shift (optional cash
          float) at the start; close it at the end to stamp closed_at +
          roll up the shift's sales for the Z-report. The checkout still
          auto-attaches whatever shift is open, so selling is never
          blocked — this just gives staff the bookend actions. */}
      <Modal visible={showShift} transparent animationType="fade" onRequestClose={() => setShowShift(false)}>
        <View className="flex-1 bg-black/70 items-center justify-center px-8">
          {/* Tap the dark backdrop to close (unless a shift op is in flight). */}
          <Pressable onPress={() => { if (!shiftBusy) setShowShift(false); }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          <View className="w-[460px] rounded-3xl bg-surface border border-border p-7">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-cream text-xl" style={{ fontFamily: "Peachi-Bold" }}>
                {closedSummary ? "Shift Closed" : shift ? "Close Shift" : "Open Shift"}
              </Text>
              <Pressable onPress={() => setShowShift(false)} className="active:opacity-60" disabled={shiftBusy}>
                <X size={22} color="rgba(245,243,240,0.7)" />
              </Pressable>
            </View>
            <Text className="text-cream/55 text-xs mb-5" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
              {outletShort(outletId)} · {staff?.staffName ?? "Cashier"}
            </Text>

            {closedSummary ? (
              // ── Closed summary ──
              <View className="gap-3">
                <View className="rounded-2xl px-5 py-5 items-center" style={{ backgroundColor: "rgba(34,197,94,0.10)", borderWidth: 1, borderColor: "rgba(34,197,94,0.4)" }}>
                  <CheckCircle2 size={34} color="#22C55E" />
                  <Text className="text-cream text-base mt-2" style={{ fontFamily: "Peachi-Bold" }}>Shift closed</Text>
                  <View className="flex-row gap-8 mt-4">
                    <View className="items-center">
                      <Text className="text-amber-400 text-2xl" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{closedSummary.orders}</Text>
                      <Text className="text-cream/50 text-[11px] tracking-widest" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>ORDERS</Text>
                    </View>
                    <View className="items-center">
                      <Text className="text-amber-400 text-2xl" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(closedSummary.sales)}</Text>
                      <Text className="text-cream/50 text-[11px] tracking-widest" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>SALES</Text>
                    </View>
                  </View>
                </View>
                <Pressable onPress={() => setShowShift(false)} className="h-14 rounded-2xl items-center justify-center bg-primary active:opacity-80">
                  <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>Done</Text>
                </Pressable>
              </View>
            ) : shift ? (
              // ── Close an open shift ──
              <View className="gap-4">
                <View className="rounded-2xl px-4 py-3 flex-row justify-between" style={{ backgroundColor: "rgba(245,243,240,0.04)", borderWidth: 1, borderColor: "rgba(245,243,240,0.1)" }}>
                  <View>
                    <Text className="text-cream/50 text-[11px] tracking-widest" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>OPENED</Text>
                    <Text className="text-cream text-sm mt-0.5" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>
                      {new Date(shift.opened_at).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: true })}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-cream/50 text-[11px] tracking-widest" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>THIS SHIFT</Text>
                    <Text className="text-cream text-sm mt-0.5" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>
                      {liveTotals ? `${liveTotals.orders} orders · ${rm(liveTotals.sales)}` : "…"}
                    </Text>
                  </View>
                </View>
                <View>
                  <Text className="text-cream/55 text-xs mb-1.5" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>Closing cash count (optional)</Text>
                  <NumpadField
                    value={closingCash}
                    onChangeText={setClosingCash}
                    placeholder="0.00"
                    mode="decimal"
                    prefix="RM "
                    title="Closing cash count"
                    className="h-14 rounded-2xl px-4"
                    style={{ backgroundColor: "rgba(245,243,240,0.05)", borderWidth: 1, borderColor: "rgba(245,243,240,0.12)" }}
                  />
                </View>
                <Pressable onPress={doCloseShift} disabled={shiftBusy} className={`h-14 rounded-2xl items-center justify-center ${shiftBusy ? "bg-primary/40" : "bg-primary active:opacity-80"}`}>
                  {shiftBusy ? <ActivityIndicator color="#F5F3F0" /> : <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>Close Shift</Text>}
                </Pressable>
              </View>
            ) : (
              // ── Open a new shift ──
              <View className="gap-4">
                <View>
                  <Text className="text-cream/55 text-xs mb-1.5" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>Opening cash float (optional)</Text>
                  <NumpadField
                    value={openingCash}
                    onChangeText={setOpeningCash}
                    placeholder="0.00"
                    mode="decimal"
                    prefix="RM "
                    title="Opening cash float"
                    className="h-14 rounded-2xl px-4"
                    style={{ backgroundColor: "rgba(245,243,240,0.05)", borderWidth: 1, borderColor: "rgba(245,243,240,0.12)" }}
                  />
                  <Text className="text-cream/40 text-[11px] mt-2" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                    Cash in the drawer at the start of the shift. Leave blank for a cashless (QR/card) register.
                  </Text>
                </View>
                <Pressable onPress={doOpenShift} disabled={shiftBusy} className={`h-14 rounded-2xl items-center justify-center flex-row gap-2 ${shiftBusy ? "bg-primary/40" : "bg-primary active:opacity-80"}`}>
                  {shiftBusy ? <ActivityIndicator color="#F5F3F0" /> : <><Power size={20} color="#F5F3F0" /><Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>Open Shift</Text></>}
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={showCheckout} transparent animationType="fade" onRequestClose={() => { setShowCheckout(false); setPayMethod(null); setCardStage("idle"); setCardResult(null); if (!paying && !paid) setDisplayStatus(lines.length > 0 ? "ordering" : "idle"); }}>
        <View className="flex-1 bg-black/70 items-center justify-center px-8">
          {/* Tap the dark backdrop to close — but not mid-payment. */}
          <Pressable onPress={() => { if (paying || cardStage === "prompting") return; setShowCheckout(false); setPayMethod(null); setCardStage("idle"); setCardResult(null); if (!paid) setDisplayStatus(lines.length > 0 ? "ordering" : "idle"); }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          <View className="w-[560px] rounded-3xl bg-surface border border-border p-7">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-cream text-xl" style={{ fontFamily: "Peachi-Bold" }}>
                {payMethod === "qr" ? "Scan to Pay" : payMethod === "card" ? "Card Payment" : "Payment"}
              </Text>
              <Pressable
                onPress={() => { setShowCheckout(false); setPayMethod(null); setCardStage("idle"); setCardResult(null); if (!paying && !paid) setDisplayStatus(lines.length > 0 ? "ordering" : "idle"); }}
                className="active:opacity-60"
                disabled={paying || cardStage === "prompting"}
              >
                <X size={22} color={(paying || cardStage === "prompting") ? "rgba(245,243,240,0.3)" : "rgba(245,243,240,0.7)"} />
              </Pressable>
            </View>
            <Text className="text-amber-400 text-5xl mb-4" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(total)}</Text>

            {/* ── METHOD PICKER ── */}
            {!payMethod && !paying && (
              <View className="gap-3 mt-2">
                <Text className="text-cream/55 text-xs uppercase tracking-widest mb-1" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>Choose payment method</Text>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setPayMethod("qr");
                    // Customer display already in payment status from
                    // Charge press → QR is rendered there.
                  }}
                  className="h-20 rounded-2xl flex-row items-center px-5 active:opacity-80"
                  style={{ backgroundColor: "rgba(251,191,36,0.10)", borderWidth: 1, borderColor: "rgba(251,191,36,0.45)", gap: 14 }}
                >
                  <View className="h-12 w-12 rounded-xl items-center justify-center" style={{ backgroundColor: "#FBBF24" }}>
                    <QrCode size={24} color="#160800" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-cream text-base" style={{ fontFamily: "Peachi-Bold" }}>QR Payment</Text>
                    <Text className="text-cream/55 text-xs mt-0.5" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>Maybank DuitNow QR on customer display</Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    Haptics.selectionAsync();
                    setPayMethod("card");
                    setCardStage("prompting");
                    setCardResult(null);
                    try {
                      const result = await chargeMaybankCard(total);
                      if (result.status === "approved") {
                        // Don't auto-commit. Park on a verify screen so the
                        // cashier confirms the approval on the physical
                        // terminal before we record + print (mirrors QR).
                        setCardResult(result);
                        setCardStage("approved");
                      } else if (result.status === "declined") {
                        setCardStage("declined");
                      } else {
                        // Cancelled → return to method picker.
                        setCardStage("idle");
                        setPayMethod(null);
                      }
                    } catch (e) {
                      console.error("[card]", e);
                      setCardStage("declined");
                    }
                  }}
                  className="h-20 rounded-2xl flex-row items-center px-5 active:opacity-80"
                  style={{ backgroundColor: "rgba(59,130,246,0.10)", borderWidth: 1, borderColor: "rgba(59,130,246,0.45)", gap: 14 }}
                >
                  <View className="h-12 w-12 rounded-xl items-center justify-center" style={{ backgroundColor: "#3B82F6" }}>
                    <CreditCard size={24} color="#F5F3F0" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-cream text-base" style={{ fontFamily: "Peachi-Bold" }}>Card Payment</Text>
                    <Text className="text-cream/55 text-xs mt-0.5" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>Tap or insert on Maybank terminal</Text>
                  </View>
                </Pressable>
              </View>
            )}

            {/* ── QR PAYMENT ── */}
            {payMethod === "qr" && !paying && (
              <>
                <Text className="text-cream/55 text-sm mb-6" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                  QR is on the customer display. Confirm receipt in your Maybank app before tapping below.
                </Text>
                <View className="gap-3">
                  <Pressable
                    onPress={() => pay("qr")}
                    className="h-16 rounded-2xl items-center justify-center flex-row gap-3 bg-primary active:opacity-80"
                  >
                    <CheckCircle2 size={24} color="#F5F3F0" />
                    <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>PAYMENT RECEIVED</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { setPayMethod(null); }}
                    className="h-11 rounded-xl items-center justify-center active:opacity-60"
                  >
                    <Text className="text-cream/55 text-xs tracking-widest" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>‹ Back to methods</Text>
                  </Pressable>
                </View>
              </>
            )}

            {/* ── CARD PAYMENT ── */}
            {payMethod === "card" && !paying && (
              <View className="gap-3">
                {cardStage === "prompting" && (
                  <View className="h-44 items-center justify-center gap-3">
                    <ActivityIndicator color="#3B82F6" size="large" />
                    <Text className="text-cream text-base" style={{ fontFamily: "Peachi-Bold" }}>Tap or insert card</Text>
                    <Text className="text-cream/55 text-xs text-center" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                      Hand the terminal to your customer. Verify the approval before recording.
                    </Text>
                  </View>
                )}
                {cardStage === "approved" && (
                  <View className="gap-3">
                    {/* Terminal said approved — cashier must eyeball the
                        physical terminal slip + tap to record the sale.
                        Nothing is persisted until they confirm. */}
                    <View className="rounded-2xl px-5 py-4" style={{ backgroundColor: "rgba(34,197,94,0.10)", borderWidth: 1, borderColor: "rgba(34,197,94,0.45)" }}>
                      <View className="flex-row items-center gap-2 mb-2">
                        <CheckCircle2 size={20} color="#22C55E" />
                        <Text className="text-base" style={{ fontFamily: "Peachi-Bold", color: "#22C55E" }}>Terminal Approved</Text>
                      </View>
                      {!!cardResult && (
                        <View className="gap-0.5">
                          <Text className="text-cream/80 text-sm" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>
                            {cardResult.cardBrand} · {cardResult.maskedPan}
                          </Text>
                          <Text className="text-cream/55 text-xs" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                            Approval {cardResult.approvalCode} · {cardResult.txnRef}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text className="text-cream/55 text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                      Confirm the approval on the Maybank terminal, then record the sale to print the receipt + kitchen docket.
                    </Text>
                    <Pressable
                      onPress={() => pay("card")}
                      className="h-16 rounded-2xl items-center justify-center flex-row gap-3 bg-primary active:opacity-80"
                    >
                      <CheckCircle2 size={24} color="#F5F3F0" />
                      <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>PAYMENT VERIFIED</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { setCardStage("idle"); setCardResult(null); setPayMethod(null); }}
                      className="h-11 rounded-xl items-center justify-center active:opacity-60"
                    >
                      <Text className="text-cream/55 text-xs tracking-widest" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>‹ Back to methods</Text>
                    </Pressable>
                  </View>
                )}
                {cardStage === "declined" && (
                  <View className="gap-3">
                    <View className="rounded-2xl px-5 py-4 items-center" style={{ backgroundColor: DANGER + "14", borderWidth: 1, borderColor: DANGER + "55" }}>
                      <Text className="text-base" style={{ fontFamily: "Peachi-Bold", color: DANGER }}>Card Declined</Text>
                      <Text className="text-cream/60 text-xs mt-1 text-center" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>Ask customer to try another card or switch to QR.</Text>
                    </View>
                    <Pressable
                      onPress={() => { setCardStage("idle"); setPayMethod(null); }}
                      className="h-12 rounded-xl items-center justify-center bg-primary active:opacity-80"
                    >
                      <Text className="text-cream text-sm" style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 1.4 }}>BACK TO METHODS</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}

            {/* ── PAYING (shared loading state for both methods) ── */}
            {paying && (
              <View className="h-44 items-center justify-center gap-3">
                <ActivityIndicator color="#FBBF24" size="large" />
                <Text className="text-cream/60 text-xs tracking-widest" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>RECORDING SALE…</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Rewards picker ── */}
      <Modal visible={showRewards} transparent animationType="fade" onRequestClose={() => setShowRewards(false)}>
        <View className="flex-1 bg-black/70 items-center justify-center px-8">
          <Pressable onPress={() => setShowRewards(false)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
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

      {/* ── Cart line editor — qty, per-line discount, remove ── */}
      <Modal visible={!!editLineKey} transparent animationType="fade" onRequestClose={() => setEditLineKey(null)}>
        {(() => {
          const line = lines.find((l) => l.key === editLineKey);
          if (!line) return null;
          return (
            <LineEditorSheet
              line={line}
              onClose={() => setEditLineKey(null)}
              onInc={() => inc(line.key)}
              onDec={() => dec(line.key)}
              onRemove={() => { remove(line.key); setEditLineKey(null); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); }}
              onSetDiscount={(sen) => { setLineDiscount(line.key, sen); }}
              onSetNote={(note) => { setLineNote(line.key, note); }}
            />
          );
        })()}
      </Modal>

      {/* ── Paid confirmation ── */}
      <Modal visible={!!paid} transparent animationType="fade" onRequestClose={newOrder}>
        <View className="flex-1 bg-black/70 items-center justify-center px-8">
          <Pressable onPress={newOrder} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
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
      <Pressable onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
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

// ── Tables panel tile + legend ────────────────────────────────────
/** Single table tile in the live Tables panel. Colour scheme:
 *  free=neutral, pending=gold (awaiting QR payment), active=blue
 *  (paid/preparing), ready=green (out to customer). Total appears as RM
 *  on busy tiles so staff can match Maybank payment confirmations
 *  against the right table at a glance. */
function TableTile({ slot, onPress }: { slot: TableSlot; onPress: () => void }) {
  // Pure mapping tile: terracotta when the table has orders mapped to it,
  // muted when it has none. Lists each order (source dot + number + total);
  // no free/occupied flow. Source dot: blue = QR self-order, amber = register.
  const has = slot.orders.length > 0;
  const SHOWN = 4;
  return (
    <Pressable
      onPress={onPress}
      className="active:opacity-80"
      style={{
        width: 160, minHeight: 96, padding: 12, borderRadius: 16, borderWidth: 1,
        backgroundColor: has ? "rgba(194,69,45,0.10)" : "rgba(245,243,240,0.04)",
        borderColor: has ? "rgba(194,69,45,0.45)" : "rgba(245,243,240,0.10)",
      }}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-baseline" style={{ gap: 5, flexShrink: 1 }}>
          <Text style={{ fontFamily: "Peachi-Bold", fontSize: 24, color: has ? "#F5F3F0" : "rgba(245,243,240,0.5)" }}>{slot.label}</Text>
          {slot.seats != null && (
            <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 10, color: "rgba(245,243,240,0.4)" }}>{slot.seats} pax</Text>
          )}
        </View>
        {has && (
          <View className="rounded-full" style={{ minWidth: 22, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: "#C2452D", alignItems: "center" }}>
            <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 12, color: "#F5F3F0" }}>{slot.orders.length}</Text>
          </View>
        )}
      </View>
      {!has ? (
        <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 10, color: "rgba(245,243,240,0.30)", marginTop: 10 }}>No orders</Text>
      ) : (
        <View style={{ marginTop: 8, gap: 5 }}>
          {slot.orders.slice(0, SHOWN).map((o) => (
            <View key={o.id} className="flex-row items-center justify-between" style={{ gap: 6 }}>
              <View className="flex-row items-center" style={{ gap: 5, flexShrink: 1 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: o.source === "qr" ? "#3B82F6" : "#FBBF24" }} />
                <Text numberOfLines={1} style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 11, color: "rgba(245,243,240,0.82)" }}>{o.orderNumber}</Text>
              </View>
              <Text style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 11, color: "rgba(245,243,240,0.55)" }}>RM {(o.total / 100).toFixed(2)}</Text>
            </View>
          ))}
          {slot.orders.length > SHOWN && (
            <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 10, color: "rgba(245,243,240,0.4)" }}>+{slot.orders.length - SHOWN} more</Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

function TableLegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View className="flex-row items-center" style={{ gap: 5 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 10, letterSpacing: 0.8, color: "rgba(245,243,240,0.6)" }}>{label}</Text>
    </View>
  );
}

// ── On-register KDS card ──────────────────────────────────────────
/** One Grab/Pickup order in the Orders panel. Shows what to make + a
 *  single bump button that advances the order to its next state. */
function KdsCard({
  order, busy, onAdvance,
}: {
  order: KdsOrder;
  busy: boolean;
  onAdvance: (status: "preparing" | "ready" | "completed") => void;
}) {
  const isGrab = order.source === "grab";
  const accent = isGrab ? "#22C55E" : "#3B82F6";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000));
  const ago = mins < 1 ? "just now" : `${mins} min ago`;
  // Status → pill + the next bump action.
  const pill =
    order.status === "ready" ? { text: "READY", color: "#22C55E" }
    : { text: "NEW", color: accent };
  // Two-tap lifecycle: a new order goes straight to Ready (no separate
  // "preparing" step), then Ready → Collected clears it off the queue.
  const next =
    order.status === "ready"
      ? { label: "Mark Collected", status: "completed" as const, color: "#22C55E" }
      : { label: "Mark Ready", status: "ready" as const, color: "#22C55E" };

  return (
    <View style={{ width: 272, borderRadius: 18, borderWidth: 1, borderColor: "rgba(245,243,240,0.10)", backgroundColor: "rgba(245,243,240,0.03)", overflow: "hidden" }}>
      <View style={{ height: 4, backgroundColor: accent }} />
      <View style={{ padding: 14 }}>
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center" style={{ gap: 7 }}>
            {isGrab ? <Bike size={16} color={accent} /> : <ShoppingBag size={16} color={accent} />}
            <Text style={{ fontFamily: "Peachi-Bold", fontSize: 16, color: "#F5F3F0" }}>{order.orderNumber}</Text>
          </View>
          <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: pill.color + "22" }}>
            <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9, letterSpacing: 1, color: pill.color }}>{pill.text}</Text>
          </View>
        </View>
        <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 11, color: "rgba(245,243,240,0.45)", marginTop: 3 }}>
          {isGrab ? "GrabFood" : "Pickup"} · {ago}
        </Text>

        <View style={{ marginTop: 10, gap: 4 }}>
          {order.items.length === 0 && (
            <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 12, color: "rgba(245,243,240,0.4)" }}>Loading items…</Text>
          )}
          {order.items.slice(0, 6).map((it, i) => (
            <View key={i} className="flex-row" style={{ gap: 8 }}>
              <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 13, color: accent, minWidth: 22 }}>{it.qty}×</Text>
              <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 13, color: "#F5F3F0", flex: 1 }} numberOfLines={1}>
                {it.name}{it.variant ? ` · ${it.variant}` : ""}
              </Text>
            </View>
          ))}
          {order.items.length > 6 && (
            <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 11, color: "rgba(245,243,240,0.4)" }}>+{order.items.length - 6} more</Text>
          )}
        </View>

        <View className="flex-row items-center justify-between" style={{ marginTop: 12 }}>
          <Text style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 12, color: "rgba(245,243,240,0.55)" }}>{rm(order.total)}</Text>
          <Pressable
            disabled={busy}
            onPress={() => onAdvance(next.status)}
            style={{ borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: busy ? "rgba(245,243,240,0.12)" : next.color }}
            className="active:opacity-80"
          >
            {busy
              ? <ActivityIndicator size="small" color="#F5F3F0" />
              : <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 12, color: "#fff", letterSpacing: 0.4 }}>{next.label}</Text>}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ── Cart line editor ──────────────────────────────────────────────
/** Tap-a-line sheet. Lets the cashier change the qty, apply a per-line
 *  discount (% off line subtotal OR fixed RM off), or remove the line.
 *  Discount is fixed-amount in storage; the % toggle just computes the
 *  RM equivalent at set time so reporting always sees the actual sen
 *  taken off. Order-level manual discount is unchanged — that still
 *  lives behind the Discount tab in the cart panel. */
function LineEditorSheet({
  line,
  onClose,
  onInc,
  onDec,
  onRemove,
  onSetDiscount,
  onSetNote,
}: {
  line: CartLine;
  onClose: () => void;
  onInc: () => void;
  onDec: () => void;
  onRemove: () => void;
  onSetDiscount: (sen: number) => void;
  onSetNote: (note: string) => void;
}) {
  const lineGross = line.unit_sen * line.qty;
  const currentDisc = line.line_discount_sen ?? 0;
  const [mode, setMode] = useState<"percent" | "fixed">("fixed");
  const [value, setValue] = useState(currentDisc > 0 ? (currentDisc / 100).toFixed(2) : "");
  const [noteVal, setNoteVal] = useState(line.note ?? "");
  // Keyboard-avoidance: when the soft keyboard opens (Item note focused) the
  // bottom of this centered sheet gets covered. Track the keyboard height and
  // anchor the card just above it, with a scrollable body so nothing clips.
  // (RN <KeyboardAvoidingView> is unreliable inside a <Modal> on Android.)
  const { height: winH } = useWindowDimensions();
  const [kb, setKb] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setKb(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKb(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const cardMaxH = kb > 0 ? Math.max(240, winH - kb - 28) : Math.round(winH * 0.92);
  const parsed = Number(value) || 0;
  const computedDiscSen =
    mode === "percent"
      ? Math.round((lineGross * Math.min(100, Math.max(0, parsed))) / 100)
      : Math.round(parsed * 100);
  const clampedDisc = Math.max(0, Math.min(computedDiscSen, lineGross));
  const net = Math.max(0, lineGross - clampedDisc);

  return (
    <Pressable
      onPress={onClose}
      className="flex-1 bg-black/75 items-center px-8"
      style={{ justifyContent: kb > 0 ? "flex-end" : "center", paddingBottom: kb > 0 ? kb + 16 : 0 }}
    >
      <Pressable onPress={() => {}} className="w-[520px] rounded-3xl bg-surface border border-border p-6" style={{ maxHeight: cardMaxH }}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14 }}>
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-cream text-xl" style={{ fontFamily: "Peachi-Bold" }} numberOfLines={1}>{line.product.name}</Text>
            {line.modifiers.length > 0 && (
              <Text className="text-cream/55 text-xs mt-0.5" style={{ fontFamily: "SpaceGrotesk_500Medium" }} numberOfLines={2}>
                {line.modifiers.map((m) => m.name).join(", ")}
              </Text>
            )}
            <Text className="text-cream/55 text-xs mt-0.5" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>{rm(line.unit_sen)} each</Text>
          </View>
          <Pressable onPress={onClose} className="active:opacity-60"><X size={22} color="rgba(245,243,240,0.7)" /></Pressable>
        </View>

        {/* Quantity stepper */}
        <View className="flex-row items-center justify-between rounded-2xl px-4 py-3" style={{ backgroundColor: "rgba(245,243,240,0.04)", borderWidth: 1, borderColor: "rgba(245,243,240,0.10)" }}>
          <Text className="text-cream/60 text-xs uppercase tracking-widest" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>Quantity</Text>
          <View className="flex-row items-center" style={{ gap: 10 }}>
            <Stepper icon={<Minus size={18} color="#F5F3F0" />} onPress={() => { Haptics.selectionAsync(); onDec(); }} />
            <Text className="text-cream w-10 text-center text-lg" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{line.qty}</Text>
            <Stepper icon={<Plus size={18} color="#F5F3F0" />} onPress={() => { Haptics.selectionAsync(); onInc(); }} />
          </View>
        </View>

        {/* Discount editor */}
        <View className="rounded-2xl px-4 py-3" style={{ backgroundColor: "rgba(245,243,240,0.04)", borderWidth: 1, borderColor: "rgba(245,243,240,0.10)", gap: 10 }}>
          <View className="flex-row items-center justify-between">
            <Text className="text-cream/60 text-xs uppercase tracking-widest" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>Discount</Text>
            <View className="flex-row rounded-xl overflow-hidden" style={{ borderWidth: 1, borderColor: "rgba(245,243,240,0.14)" }}>
              {(["percent", "fixed"] as const).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => { Haptics.selectionAsync(); setMode(m); setValue(""); }}
                  className="px-3 py-1.5"
                  style={{ backgroundColor: mode === m ? "#A2492C" : "transparent" }}
                >
                  <Text className="text-xs" style={{ fontFamily: "SpaceGrotesk_700Bold", color: mode === m ? "#F5F3F0" : "rgba(245,243,240,0.55)", letterSpacing: 0.8 }}>{m === "percent" ? "%" : "RM"}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View className="flex-row items-center" style={{ gap: 10 }}>
            <NumpadField
              value={value}
              onChangeText={setValue}
              placeholder={mode === "percent" ? "0" : "0.00"}
              mode={mode === "percent" ? "integer" : "decimal"}
              title="Line discount"
              className="flex-1 rounded-xl px-3 py-2.5"
              style={{ backgroundColor: "rgba(245,243,240,0.04)", borderWidth: 1, borderColor: "rgba(245,243,240,0.14)" }}
            />
            <Text className="text-cream/45 text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
              {mode === "percent" ? "% off line" : "RM off line"}
            </Text>
          </View>
          {currentDisc > 0 && (
            <Pressable onPress={() => { onSetDiscount(0); setValue(""); Haptics.selectionAsync(); }} className="active:opacity-60">
              <Text className="text-xs text-primary" style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 1 }}>CLEAR DISCOUNT</Text>
            </Pressable>
          )}
        </View>

        {/* Item note — prints under this item on the kitchen docket */}
        <View className="rounded-2xl px-4 py-3" style={{ backgroundColor: "rgba(245,243,240,0.04)", borderWidth: 1, borderColor: "rgba(245,243,240,0.10)", gap: 8 }}>
          <Text className="text-cream/60 text-xs uppercase tracking-widest" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>Item note</Text>
          <TextInput
            value={noteVal}
            onChangeText={setNoteVal}
            placeholder="e.g. no sugar, extra hot"
            placeholderTextColor="rgba(245,243,240,0.3)"
            multiline
            className="rounded-xl px-3 py-2.5 text-cream text-base"
            style={{ backgroundColor: "rgba(245,243,240,0.04)", borderWidth: 1, borderColor: "rgba(245,243,240,0.14)", fontFamily: "SpaceGrotesk_500Medium", minHeight: 44 }}
          />
          <Text className="text-cream/40 text-[11px]" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>Prints under this item on the kitchen docket.</Text>
        </View>

        {/* Net preview */}
        <View className="flex-row items-baseline justify-between px-1">
          <Text className="text-cream/55 text-xs uppercase tracking-widest" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>Line total</Text>
          <View className="flex-row items-baseline" style={{ gap: 8 }}>
            {clampedDisc > 0 && (
              <Text className="text-cream/35 text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium", textDecorationLine: "line-through" }}>{rm(lineGross)}</Text>
            )}
            <Text className="text-amber-400 text-xl" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(net)}</Text>
          </View>
        </View>

        {/* Actions */}
        <View className="flex-row" style={{ gap: 10 }}>
          <Pressable onPress={onRemove} className="flex-1 h-12 rounded-2xl items-center justify-center flex-row active:opacity-80" style={{ borderWidth: 1, borderColor: DANGER + "55", backgroundColor: DANGER + "14", gap: 6 }}>
            <Trash2 size={15} color={DANGER} />
            <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 12, letterSpacing: 1.4, color: DANGER }}>REMOVE</Text>
          </Pressable>
          <Pressable
            onPress={() => { onSetDiscount(clampedDisc); onSetNote(noteVal); onClose(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }}
            className="flex-1 h-12 rounded-2xl items-center justify-center bg-primary active:opacity-80"
          >
            <Text className="text-cream" style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 12, letterSpacing: 1.6 }}>APPLY</Text>
          </Pressable>
        </View>
        </ScrollView>
      </Pressable>
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
        await apiPost("/api/pos/auth/verify-manager", { pin: managerPin });
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
      <Pressable onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
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
        <NumpadField
          value={value}
          onChangeText={setValue}
          mode={type === "percent" ? "integer" : "decimal"}
          placeholder={type === "percent" ? "e.g. 10" : "e.g. 5.00"}
          title="Discount"
          className="h-12 px-3 rounded-xl border border-cream/15 mb-3"
          style={{ backgroundColor: "rgba(245,243,240,0.06)" }}
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
            <NumpadField
              value={managerPin}
              onChangeText={(t) => { setManagerPin(t); setPinError(""); }}
              mode="integer"
              secure
              maxLength={6}
              placeholder="Enter manager PIN"
              title="Manager PIN"
              className="h-12 px-3 rounded-xl border"
              style={{ backgroundColor: "rgba(245,243,240,0.06)", borderColor: pinError ? "#E5484D" : "rgba(245,243,240,0.15)" }}
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

function ProductTile({ product, width, onPress, onLongPress }: { product: Product; width: number; onPress: () => void; onLongPress?: () => void }) {
  const oos = product.available === false;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={350} className="rounded-2xl overflow-hidden border border-border active:opacity-70" style={{ width, backgroundColor: "rgba(245,243,240,0.04)" }}>
      <View className="aspect-square w-full bg-cream/5">
        {product.image_url ? <Image source={{ uri: product.image_url }} className="w-full h-full" resizeMode="cover" style={oos ? { opacity: 0.35 } : undefined} /> : null}
        {oos && (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(22,8,0,0.5)" }}>
            <View style={{ backgroundColor: "#E5484D", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
              <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10, color: "#fff", letterSpacing: 0.4 }}>OUT OF STOCK</Text>
            </View>
          </View>
        )}
      </View>
      <View className="px-2 py-2">
        <Text className="text-cream text-[12px]" style={{ fontFamily: "Peachi-Medium", opacity: oos ? 0.5 : 1 }} numberOfLines={2}>{product.name}</Text>
        <Text className="text-amber-400 text-[12px] mt-0.5" style={{ fontFamily: "SpaceGrotesk_700Bold", opacity: oos ? 0.5 : 1 }}>{rm(product.price_sen)}</Text>
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

/** Drop-in replacement for a numeric <TextInput>: shows the value styled like a
 *  field, but tapping opens an in-app keypad (big targets, decimal/integer,
 *  backspace + clear) instead of the OS keyboard — far better on the SUNMI. */
function NumpadField({
  value, onChangeText, placeholder, mode = "decimal", title, prefix = "",
  secure = false, maxLength, className, style, onDone,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  mode?: "integer" | "decimal";
  title?: string;
  prefix?: string;
  secure?: boolean;
  maxLength?: number;
  className?: string;
  style?: any;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const display = value ? (secure ? "•".repeat(value.length) : `${prefix}${value}`) : "";
  function press(k: string) {
    Haptics.selectionAsync();
    if (k === "←") return onChangeText(value.slice(0, -1));
    if (k === "C") return onChangeText("");
    if (k === ".") { if (mode !== "decimal" || value.includes(".")) return; return onChangeText((value || "0") + "."); }
    if (maxLength && value.replace(".", "").length >= maxLength) return;
    onChangeText(value === "0" ? k : value + k);
  }
  return (
    <>
      <Pressable onPress={() => setOpen(true)} className={className} style={[{ justifyContent: "center" }, style]}>
        <Text numberOfLines={1} style={{ color: value ? "#F5F3F0" : "rgba(245,243,240,0.35)", fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 15 }}>
          {display || placeholder || ""}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 bg-black/70 items-center justify-center px-8">
          <Pressable onPress={() => setOpen(false)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          <View className="w-[340px] rounded-3xl bg-surface border border-border p-5">
            {!!title && <Text className="text-cream/55 text-xs mb-2" style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 0.6 }}>{title.toUpperCase()}</Text>}
            <View className="h-16 rounded-2xl mb-3 px-4 justify-center" style={{ backgroundColor: "rgba(245,243,240,0.06)", borderWidth: 1, borderColor: "rgba(245,243,240,0.12)" }}>
              <Text className="text-3xl" style={{ fontFamily: "SpaceGrotesk_700Bold", color: value ? "#F5F3F0" : "rgba(245,243,240,0.3)" }} numberOfLines={1}>
                {value ? display : (prefix || "0")}
              </Text>
            </View>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {(["1", "2", "3", "4", "5", "6", "7", "8", "9", mode === "decimal" ? "." : "C", "0", "←"]).map((k) => (
                <Pressable key={k} onPress={() => press(k)} className="items-center justify-center rounded-2xl active:opacity-70"
                  style={{ width: 92, height: 58, backgroundColor: k === "←" || k === "C" ? "rgba(245,243,240,0.06)" : "rgba(245,243,240,0.1)" }}>
                  <Text className="text-cream" style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 24 }}>{k}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={() => { setOpen(false); onDone?.(); }} className="h-14 rounded-2xl items-center justify-center bg-primary active:opacity-80 mt-3">
              <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
