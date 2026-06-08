import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, Pressable, FlatList, ActivityIndicator, Image, ScrollView, Modal,
  TextInput, useWindowDimensions, Keyboard, Alert,
  LayoutAnimation, Platform, UIManager,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Minus, LogOut, X, CheckCircle2,
  Settings as SettingsIcon, User, Gift, Trash2, Tag,
  Grid3x3, QrCode, CreditCard, ClipboardList, Bike, ShoppingBag, ChefHat, Coffee, Power, Sparkles,
  AlertTriangle, RotateCcw,
} from "lucide-react-native";
import { usePos, shiftSessionExpired } from "@/lib/store";
import { apiPost } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { usePickupPrinter } from "@/lib/use-pickup-printer";
import { useGrabPrinter } from "@/lib/use-grab-printer";
import LockScreen from "@/components/lock-screen";
import { chargeMaybankCard, type MaybankTerminalResult } from "@/lib/maybank-terminal";
import { fetchCategories, fetchProducts, type Product, type ModifierOption } from "@/lib/menu";
import { useCart, cartSubtotal, type CartLine } from "@/lib/cart";
import { useDisplay } from "@/lib/display";
import { createSale, getNextQueueNumber } from "@/lib/checkout";
import { startSyncLoop } from "@/lib/sale-sync";
import { saveDraft, loadDraft, clearDraft, type DraftOrder } from "@/lib/draft-order";
import { getOnline, subscribeOnline } from "@/lib/connectivity";
import { subscribePending, pendingCount } from "@/lib/offline-queue";
import { useSettings, gridColumns, serviceChargeRate, receiptConfig, tableZones } from "@/lib/settings";
import { useGridPrefs } from "@/lib/grid-prefs";
import { usePrintPrefs } from "@/lib/print-prefs";
import { useTablesPanel, type TableSlot, type TableOrderRef } from "@/lib/use-tables-panel";
import { useOrdersPanel, type KdsOrder } from "@/lib/use-orders-panel";
import { useOrderChime } from "@/lib/use-order-chime";
import { useServingAlarm, type ServingItem } from "@/lib/use-serving-alarm";
import { useOrderHistory, type HistoryOrder, type HistoryChannel } from "@/lib/use-order-history";
import { useShift, openShift, closeShift, reopenShift, findRecentClosedShift, shiftTotals, type Shift, type ShiftTotals } from "@/lib/shift";
import { printReceipt80mm, printKitchenDocket80mm } from "@/lib/printer";
import { outletFull, outletShort } from "@/lib/outlets";
import {
  lookupMember, fetchRewards, fetchUsual, redeemReward, computeRewardDiscount, redeemBlockReason,
  computeTierDiscount, evaluatePromotions,
  fetchSuggestedPairs, logPairAdd, fetchSnapshot, claimMystery,
  type Member, type RewardsResponse, type IssuedVoucher, type CatalogReward, type RedeemDiscount, type UsualItem, type AppliedPromo,
  type SuggestedPair, type ClaimableCard, type MysteryReveal, type ShopCard, type VoucherCard,
} from "@/lib/loyalty";

const rm = (sen: number) => `RM ${(sen / 100).toFixed(2)}`;

// Smooth the layout reflow when a member is identified / cleared — the member
// card, Usual tab and bottom upsell bar all appear at once, which snapped in
// abruptly. LayoutAnimation eases that next reflow instead.
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
const smoothNext = () =>
  LayoutAnimation.configureNext(
    LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
  );

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
function tableDims(seats: number | null | undefined, shape: "square" | "round", orientation: "h" | "v"): { w: number; h: number; cells: number; vertical: boolean } {
  const s = seats ?? 4;
  if (shape === "round") {
    const d = s <= 2 ? 58 : s <= 4 ? 74 : s <= 6 ? 90 : 104;
    return { w: d, h: d, cells: 1, vertical: false };
  }
  const cells = s <= 2 ? 1 : s <= 4 ? 2 : s <= 6 ? 3 : 4;
  const unit = 56;
  const vertical = orientation === "v";
  return { w: vertical ? unit : unit * cells, h: vertical ? unit * cells : unit, cells, vertical };
}

// A reward applied to the cart. For a DEFERRED catalog redemption (the normal
// case now), `redemptionId` is null and `rewardId` carries the catalog reward
// id — the Beans burn + redemption record are committed at payment by
// /api/pos/loyalty/complete. For an issued voucher it's the other way round
// (committed immediately, `redemptionId` set). pay() records whichever is
// present on pos_orders.reward_id.
type AppliedReward = { redemptionId: string | null; rewardId: string | null; name: string; descriptor: RedeemDiscount; pointsCost: number } | null;
type Panel = "none" | "customer" | "table";

export default function Register() {
  const { staff, outletId, signOut, loggedInAt, shiftEndsAt, locked, lock } = usePos();
  const [activeCat, setActiveCat] = useState<string>("all");
  // One "Orders" command center — four tabs: QR Tables (dine-in floor + QR
  // self-orders) · Pickup · Grab · History (today, all channels, filterable).
  // `hub` is the active tab, or null when the panel is closed.
  const [hub, setHub] = useState<"tables" | "pickup" | "grab" | "history" | null>(null);
  // QR Tables tab: which floor/zone is shown (null = first), and the table the
  // cashier tapped to inspect its order(s).
  const [activeFloor, setActiveFloor] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<TableSlot | null>(null);
  // Floor-plan pager: the measured canvas box (so each floor fits one screen, no
  // scroll) + a ref so tapping a floor chip and swiping stay in sync.
  const [floorBox, setFloorBox] = useState({ w: 0, h: 0 });
  const floorPagerRef = useRef<ScrollView>(null);
  // Channel filter for the History tab (all channels in one list).
  const [histFilter, setHistFilter] = useState<"all" | HistoryChannel>("all");
  // Which order's status update is in flight (uid) — disables its buttons.
  const [bumpingUid, setBumpingUid] = useState<string | null>(null);
  // Shift open/close UI.
  const [showShift, setShowShift] = useState(false);
  const [shiftBusy, setShiftBusy] = useState(false);
  // Offline / sync status for the header chip (lib/connectivity + offline-queue).
  const [online, setOnline] = useState(getOnline());
  const [pendingSales, setPendingSales] = useState(0);
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
  const [paid, setPaid] = useState<{ orderNumber: string; total: number; beansEarned: number; beansBalance: number } | null>(null);
  const [modProduct, setModProduct] = useState<Product | null>(null);

  // Cashier-applied manual discount (sen) — stacks on top of loyalty/promo.
  const [manualDiscount, setManualDiscount] = useState(0);
  const [showDiscount, setShowDiscount] = useState(false);

  // Order context.
  const [orderType, setOrderType] = useState<"dine_in" | "takeaway">("takeaway");
  // Order type + stand are now chosen at CHECKOUT (a compulsory step) rather than
  // via an upfront toggle. orderConfirmed gates the checkout modal (order-details
  // → payment); coTouched = the cashier explicitly tapped a type this checkout.
  const [orderConfirmed, setOrderConfirmed] = useState(false);
  const [coTouched, setCoTouched] = useState(false);
  const [tableNumber, setTableNumber] = useState<string>("");
  const [panel, setPanel] = useState<Panel>("none");
  // "Ask first": until the cashier identifies a member OR taps Guest, a prompt
  // sits at the top of the cart so membership is asked before ringing up.
  // Reset per order (newOrder / cart clear).
  const [memberAsked, setMemberAsked] = useState(false);

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
  // Crash/hang recovery: a recent, durable draft of the in-progress order
  // (lib/draft-order) offered for resume on relaunch; draftChecked gates the
  // auto-save until the initial load runs so it can't clobber the draft first.
  const [recoverableDraft, setRecoverableDraft] = useState<DraftOrder | null>(null);
  const [draftChecked, setDraftChecked] = useState(false);
  const [showRewards, setShowRewards] = useState(false);
  // ── Upsell mirror — the SAME 3 pairs + claimable rewards the customer
  //    sees on their display (shared scoring endpoint + snapshot), so the
  //    cashier can add a suggestion or open a reward the moment the customer
  //    asks. `pairs` is cart-driven; `claimables` is member-driven. ──
  const [pairs, setPairs] = useState<SuggestedPair[]>([]);
  const [claimables, setClaimables] = useState<ClaimableCard[]>([]);
  // Points shop — what the member can redeem with their Beans (mirrors the
  // customer display's "Redeem your Beans"). Tapping a card applies it to the
  // cart, so the cashier can redeem on request.
  const [shop, setShop] = useState<ShopCard[]>([]);
  // Owned vouchers (birthday / mystery-bag wins / promo gifts), mirrored from the
  // same snapshot — so the "Redeem your rewards" strip isn't points-only.
  const [vouchers, setVouchers] = useState<VoucherCard[]>([]);
  // In-flight guard for redemption. /api/pos/loyalty/redeem burns Beans +
  // writes a CONFIRMED redemption on every call, so a double-tap or a rapid
  // reverse-channel burst would spend the member's Beans several times over.
  // This ref makes a redeem strictly one-at-a-time (the cards also disable
  // once a reward is applied, so it's one-per-order).
  const redeemBusyRef = useRef(false);

  const setDisplayStatus = useDisplay((s) => s.setStatus);
  const setDisplayOrderNumber = useDisplay((s) => s.setOrderNumber);
  // Member the CUSTOMER self-identified on the 2nd screen — adopted below.
  const displayMember = useDisplay((s) => s.member);
  // Reward the customer tapped to redeem on the 2nd screen — applied below.
  const redeemRequest = useDisplay((s) => s.redeemRequest);

  // Backoffice-managed per-outlet settings (pos_branch_settings).
  const settings = useSettings((s) => s.settings);
  const outlet = useSettings((s) => s.outlet);
  const sstCfg = useSettings((s) => s.sst);
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
  // The tapped table's LIVE slot, re-derived from tableSlots so its detail
  // reflects Realtime status changes (a row marked Done updates immediately
  // rather than showing the stale snapshot captured at tap time).
  const liveSelectedTable = useMemo<TableSlot | null>(() => {
    if (!selectedTable) return null;
    return tableSlots.find((s) => s.label === selectedTable.label && s.zone === selectedTable.zone) ?? selectedTable;
  }, [selectedTable, tableSlots]);
  // Live Grab + Pickup order feed for the on-register KDS (Orders modal).
  // Mounted persistently so it keeps catching up + receiving Realtime even
  // while the modal is closed (drives the header badge count).
  const { orders: kdsOrders, reload: reloadOrders } = useOrdersPanel(outletId);
  // Serving-time alarm candidates: pickup orders not yet "ready" + QR-table
  // orders not yet "done". Pressing Ready/Done drops the order from these
  // lists, which silences the alarm for it. (Grab runs to its own SLA.)
  const servingAlarmItems = useMemo<ServingItem[]>(() => {
    const pickup = kdsOrders
      .filter((o) => o.source === "pickup" && o.status !== "ready")
      .map((o) => ({ id: o.uid, createdAt: o.createdAt, channel: "pickup" as const, label: o.orderNumber }));
    const tables = tableSlots.flatMap((s) =>
      s.orders
        .filter((o) => o.source === "qr")
        .map((o) => ({ id: o.id, createdAt: o.createdAt, channel: "table" as const, label: s.label })),
    );
    return [...pickup, ...tables];
  }, [kdsOrders, tableSlots]);
  // Orders past the 15-min serving target → drives the alarm sound + the popup.
  const overdueOrders = useServingAlarm(servingAlarmItems);
  const [overdueAck, setOverdueAck] = useState(false);
  const prevOverdueCount = useRef(0);
  useEffect(() => {
    if (overdueOrders.length > prevOverdueCount.current) setOverdueAck(false); // a new order went overdue → re-pop
    if (overdueOrders.length === 0) setOverdueAck(false);                      // all cleared → reset
    prevOverdueCount.current = overdueOrders.length;
  }, [overdueOrders]);
  // Only over the main register (not while the orders panel is already open).
  const showOverduePopup = overdueOrders.length > 0 && !overdueAck && hub === null;
  const openOverdueHub = useCallback(() => {
    setOverdueAck(true);
    setHub(overdueOrders.every((o) => o.channel === "table") ? "tables" : "pickup");
  }, [overdueOrders]);
  // Today's order history (all channels) for the History tab. Refreshed each
  // time the tab is opened so the counter always sees the latest day's sales.
  const { orders: historyOrders, loading: historyLoading, reload: reloadHistory } = useOrderHistory(outletId);
  useEffect(() => { if (hub === "history") void reloadHistory(); }, [hub, reloadHistory]);
  // Start the offline-sale sync loop once — drains the local buffer to the cloud
  // on reconnect / foreground / interval (see lib/sale-sync.ts) — and subscribe
  // to online + pending-sales state for the header chip.
  useEffect(() => {
    startSyncLoop();
    void useGridPrefs.getState().load();
    void usePrintPrefs.getState().load();
    const offOnline = subscribeOnline(setOnline);
    const offPending = subscribePending(setPendingSales);
    void pendingCount();
    return () => { offOnline(); offPending(); };
  }, []);

  // Feed the BO-managed outlet default for the counter master docket
  // (pos_branch_settings.print_master_docket) into the per-till print prefs.
  // A local override on this till still wins; reacts to backoffice edits live.
  useEffect(() => {
    usePrintPrefs.getState().setOutletDefault(settings?.print_master_docket !== false);
  }, [settings?.print_master_docket]);

  // Drop any selected-table detail when the panel closes or switches tab.
  useEffect(() => { if (hub !== "tables") setSelectedTable(null); }, [hub]);

  // Outstanding live orders (pickup + Grab KDS + active QR-table orders). Used
  // to guard the shift end/close so a shift can never end while customers are
  // still waiting on orders.
  const openLiveCount = useMemo(
    () => kdsOrders.length + tableSlots.reduce((n, s) => n + s.orders.length, 0),
    [kdsOrders, tableSlots],
  );
  // True once a rostered shift's clock has run out but the cashier is kept in to
  // finish open orders → drives a non-blocking "shift ended" banner.
  const [shiftEnded, setShiftEnded] = useState(false);
  // A recently-closed shift available to resume (set when the Open Store sheet opens).
  const [recentClosed, setRecentClosed] = useState<Shift | null>(null);

  // ── Open Store (cashier shift) ──────────────────────────────────────
  // Resolved up here (ahead of the order handlers) so the ring-up + Orders
  // gates can read whether the store is open. `shift` non-null = store open.
  const { shift, loading: shiftLoading, reload: reloadShift } = useShift(outletId);
  // One-shot guard so a scheduled login auto-opens the store exactly once.
  const autoOpenedRef = useRef(false);

  // Advance a Grab/Pickup order's fulfilment status via the service-role
  // route (anon can't UPDATE printed pickup rows under RLS). Realtime
  // flows the change back through useOrdersPanel so the card re-buckets.
  const advanceOrderStatus = useCallback(async (order: KdsOrder, status: "preparing" | "ready" | "completed") => {
    // NOTE: deliberately NOT gated on the store being open. A live order that
    // already arrived must always be advance-able / hand-over-able — even after
    // the shift closed — so a close can never freeze a customer's in-progress
    // order. (Ringing up a NEW sale still requires the store open; see onAdd.)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadOrders, shift, shiftLoading]);

  // Mark a QR-table self-order served/done. QR dine-in orders are `orders`
  // rows (order_type=dine_in); the service-role route flips status→completed,
  // which lights up the guest's "Served" step and re-buckets the table.
  const markTableOrderDone = useCallback(async (order: TableOrderRef) => {
    // Not gated on store-open — see advanceOrderStatus: a table order must be
    // serve-able / clearable even after the shift closed.
    setBumpingUid(`qr:${order.id}`);
    try {
      await apiPost("/api/pos/order-status", { source: "qr", id: order.id, status: "completed" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // useTablesPanel's Realtime sub re-buckets the slot automatically.
    } catch (e) {
      alert(`Couldn't mark ${order.orderNumber} done.\n${e instanceof Error ? e.message : "Check the connection and try again."}`);
    } finally {
      setBumpingUid(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift, shiftLoading]);

  // ── Open Store (cashier shift) open/close ──
  const openShiftModal = useCallback(() => {
    Haptics.selectionAsync();
    setClosedSummary(null);
    setLiveTotals(null);
    setRecentClosed(null);
    setShowShift(true);
    // Pull live sales for the open shift so the close screen shows a summary;
    // if the store is closed, surface a recently-closed shift to resume.
    if (shift) shiftTotals(shift.id).then(setLiveTotals).catch(() => setLiveTotals(null));
    else if (outletId) findRecentClosedShift(outletId).then(setRecentClosed).catch(() => setRecentClosed(null));
  }, [shift, outletId]);
  const doReopenShift = useCallback(async (s: Shift) => {
    setShiftBusy(true);
    await reopenShift(s.id);
    await reloadShift();
    setRecentClosed(null);
    setShiftEnded(false);
    setShiftBusy(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [reloadShift]);
  const doOpenShift = useCallback(async () => {
    if (!outletId || !staff?.staffId) return;
    setShiftBusy(true);
    await openShift(outletId, staff.staffId);
    await reloadShift();
    setShiftBusy(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [outletId, staff?.staffId, reloadShift]);
  const performCloseShift = useCallback(async () => {
    if (!shift || !staff?.staffId) return;
    setShiftBusy(true);
    const totals = await closeShift(shift, staff.staffId);
    setClosedSummary(totals ?? { orders: 0, sales: 0 });
    setShiftEnded(false);
    await reloadShift();
    setShiftBusy(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [shift, staff?.staffId, reloadShift]);
  const doCloseShift = useCallback(() => {
    // Don't strand customers: closing with live orders open needs a confirm.
    // (They stay on the Orders screen + actionable after close — but the cashier
    // should know they're walking away from open work.)
    if (openLiveCount > 0) {
      Alert.alert(
        "Close store?",
        `${openLiveCount} live order${openLiveCount === 1 ? "" : "s"} still open. They'll stay on the Orders screen and can still be handed over — close anyway?`,
        [
          { text: "Keep open", style: "cancel" },
          { text: "Close anyway", style: "destructive", onPress: () => void performCloseShift() },
        ],
      );
      return;
    }
    void performCloseShift();
  }, [openLiveCount, performCloseShift]);
  // Initial load + re-read backoffice settings whenever the register regains
  // focus, so a grid / service-charge / receipt change shows without an app
  // restart (the store used to cache the first load and never refetch).
  useFocusEffect(
    useCallback(() => {
      if (outletId) refreshSettings(outletId);
    }, [outletId, refreshSettings]),
  );
  // Live: a backoffice edit to this outlet's pos_branch_settings row pushes
  // straight to the running till via realtime. SST now lives on that row too
  // (per-outlet sst_enabled / sst_rate), so a tax toggle reflects live without
  // an app restart — covered by this same listener.
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

  // Order type is chosen at CHECKOUT now (compulsory step), so it is NOT pre-set
  // from settings here — every order starts neutral (takeaway, no service charge)
  // and the cashier confirms Dine-in/Takeaway (+ stand) in the checkout modal.

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
  // Audible chime when a new external order (table QR / pickup app / GrabFood)
  // arrives — so staff away from the till still notice. Till sales don't chime.
  useOrderChime(outletId);

  // Full catalog lookup — resolve a suggested-pair product_id back to its
  // Product so a tap can route through onAdd (86 check + modifier sheet + add).
  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of prods.data ?? []) m.set(p.id, p);
    return m;
  }, [prods.data]);

  const lines = useCart((s) => s.lines);
  const add = useCart((s) => s.add);
  const inc = useCart((s) => s.inc);
  const dec = useCart((s) => s.dec);
  const remove = useCart((s) => s.remove);
  const setLineDiscount = useCart((s) => s.setLineDiscount);
  const setLineNote = useCart((s) => s.setLineNote);
  const setLineTakeaway = useCart((s) => s.setLineTakeaway);
  const replaceLines = useCart((s) => s.replaceLines);
  const clear = useCart((s) => s.clear);
  // Cart line editor sheet — tap any line in the cart to open. From
  // here the cashier can adjust qty, apply a per-line discount, or
  // remove the line.
  const [editLineKey, setEditLineKey] = useState<string | null>(null);

  // ── Auto-logout at end of shift ──────────────────────────────────────
  // A rostered ("Open Store") session ends at its scheduled shift end; an
  // off-schedule / manager session falls back to a 2h TTL. Either way we don't
  // yank it out mid-sale — the till signs out at the next safe gap (empty cart,
  // no checkout/paid screen). A rostered end also closes the store (Z-roll-up)
  // on the way out. Re-checked on every cart change plus a slow idle poll.
  useEffect(() => {
    if (!staff || locked) return; // already asleep → nothing to re-check
    const maybeLogout = () => {
      if (!shiftSessionExpired(loggedInAt, shiftEndsAt)) { setShiftEnded(false); return; }
      // The session's clock is up. Never yank the cashier mid-task: hold for an
      // empty cart, no checkout in flight, AND no open live orders (customers
      // are still waiting on those).
      if (lines.length > 0 || showCheckout || paid) return;
      if (openLiveCount > 0) { setShiftEnded(true); return; } // keep them in to finish + hand over
      setShiftEnded(false);
      if (shiftEndsAt != null) {
        // Rostered shift END = a real financial close → close the store
        // (Z-roll-up) and fully sign out, exactly as before. The next rostered
        // cashier logs in fresh and auto-opens; no shift-lifecycle ambiguity.
        if (shift) void closeShift(shift, staff.staffId);
        signOut();
        router.replace("/");
      } else {
        // Off-schedule / manager session hit the 2h idle TTL → SLEEP/LOCK rather
        // than sign out + leave the register. No shift is closed here, so the
        // same (manually-opened) shift simply continues on resume. The register
        // stays mounted, so its online-order auto-printers + chime keep firing
        // while the till is asleep; a staff PIN on the overlay resumes it.
        lock();
      }
    };
    maybeLogout();
    const id = setInterval(maybeLogout, 20000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff, locked, loggedInAt, shiftEndsAt, lines.length, showCheckout, paid, shift, openLiveCount]);

  // ── Open Store on scheduled login ────────────────────────────────────
  // A rostered session (shiftEndsAt set) auto-opens the store the first time
  // the register mounts with no shift yet — no extra "Open Store" tap. Off-
  // schedule / manager sessions (shiftEndsAt null) open it manually instead.
  useEffect(() => {
    if (shiftEndsAt == null) return;
    if (!outletId || !staff?.staffId) return;
    if (shiftLoading || shift) return;
    if (autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    void (async () => { await openShift(outletId, staff.staffId); await reloadShift(); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftEndsAt, outletId, staff?.staffId, shiftLoading, shift, reloadShift]);

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

  // ── Upsell mirror fetches ───────────────────────────────────────────
  // 1) PAIRS — the exact 3 suggestions the customer display shows, from the
  //    shared scoring endpoint (cart + usual signals). Keyed on the cart's
  //    product ids so it re-asks as the order changes; cleared on empty cart.
  const cartKeyForPairs = useMemo(() => lines.map((l) => l.product.id).sort().join(","), [lines]);
  const usualKeyForPairs = useMemo(() => usual.map((u) => u.id).join(","), [usual]);
  useEffect(() => {
    if (cartKeyForPairs === "") { setPairs([]); return; }
    let cancelled = false;
    const ids = cartKeyForPairs.split(",");
    const usualP = usualKeyForPairs ? usualKeyForPairs.split(",") : [];
    fetchSuggestedPairs(outletId, ids, usualP).then((p) => { if (!cancelled) setPairs(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [cartKeyForPairs, usualKeyForPairs, outletId]);
  // 2) CLAIMABLES — promos / welcome gifts the member can claim. Pulled from the
  //    same snapshot the display reads; member-driven (not cart). Mystery bags
  //    are excluded: they reveal on the customer display's thank-you screen and
  //    any missed one is silently auto-granted there — so the till never shows a
  //    mystery "open" button.
  useEffect(() => {
    if (!member?.id) { setClaimables([]); setShop([]); setVouchers([]); return; }
    let cancelled = false;
    fetchSnapshot(member.id).then((s) => {
      if (cancelled) return;
      setClaimables((s?.claimables ?? []).filter((c) => c.source_type !== "mystery_pending"));
      setShop(s?.shop ?? []);
      // Mission/challenge vouchers surface under their own section; everything
      // else (mystery, birthday, referral, gifts) is a redeemable reward.
      setVouchers((s?.vouchers ?? []).filter((v) => v.source_type !== "mission"));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [member?.id]);

  // Curated "Redeem your rewards" — built for VARIETY (feel-good), not a wall of
  // the same gift. We round-robin across three lanes so the row leads with
  // something owned, something redeemable now, and something to aim for; and the
  // owned-voucher lane itself round-robins across its sources (Mystery Bag,
  // Birthday, …) so even back-to-back vouchers span types. Mirrors the display.
  const redeemChips = useMemo(() => {
    type Chip = { kind: "voucher"; v: VoucherCard } | { kind: "shop"; s: ShopCard };
    const bySource = new Map<string, Chip[]>();
    for (const v of vouchers) {
      const key = v.source_type ?? "reward";
      const arr = bySource.get(key);
      if (arr) arr.push({ kind: "voucher", v });
      else bySource.set(key, [{ kind: "voucher", v }]);
    }
    const srcLists = [...bySource.values()];
    const voucherLane: Chip[] = [];
    for (let i = 0; srcLists.some((l) => i < l.length); i++) {
      for (const l of srcLists) if (i < l.length) voucherLane.push(l[i]);
    }
    const affLane: Chip[] = shop.filter((s) => s.affordable).map((s) => ({ kind: "shop", s }));
    const goalLane: Chip[] = [...shop]
      .filter((s) => !s.affordable)
      .sort((a, b) => a.points_required - b.points_required)
      .map((s) => ({ kind: "shop", s }));
    const lanes = [voucherLane, affLane, goalLane];
    const mixed: Chip[] = [];
    for (let i = 0; lanes.some((l) => i < l.length); i++) {
      for (const l of lanes) if (i < l.length) mixed.push(l[i]);
    }
    return mixed;
  }, [vouchers, shop]);

  // Resolve a suggested pair → its catalog Product, then route through onAdd
  // (so an 86'd item is blocked + a modifier item opens its sheet, exactly
  // like tapping the grid). No-op if the product isn't in this outlet's menu.
  const addPair = useCallback((pair: SuggestedPair) => {
    const p = productById.get(pair.product_id);
    if (!p) return;
    onAdd(p);
    // Upsell attribution — record that a suggested bite was added (with its 1..3
    // slot), so pair-adds ÷ orders is measurable. Best-effort; never blocks.
    const rank = pairs.findIndex((x) => x.product_id === pair.product_id) + 1;
    logPairAdd(outletId, pair, rank, "register", staff?.staffId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productById, pairs, outletId]);

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
  // Non-stackable tiers (Black Card / Staff) are EXCLUSIVE: the member gets the
  // single larger of the tier % vs EVERYTHING else combined (voucher + store
  // auto-promos), never the sum — so a 50% Black Card doesn't also pile promos
  // on top of the half-price bill. Stackable tiers (Bronze→Platinum) keep
  // stacking tier + voucher + promos. Reactive — re-picks the winner as the cart
  // changes.
  const nonStackTier = member?.tier?.stackable === false && (member?.tier?.discount_percent ?? 0) > 0;
  const otherDisc = rewardDiscount + apiPromoDisc; // the "everything except the tier" side
  const tierWins = nonStackTier && tierDisc >= otherDisc;
  const effRewardDiscount = tierWins ? 0 : rewardDiscount;
  const effTierDisc = nonStackTier && !tierWins ? 0 : tierDisc;
  const effPromoDisc = tierWins ? 0 : apiPromoDisc;
  const promoDiscount = effTierDisc + effPromoDisc;
  // Manual discount stacks last; clamp it to what's still owed so the
  // line we show (and the total) never goes negative if the cart shrank
  // after it was applied.
  const beforeManual = Math.max(0, subtotal + serviceCharge - effRewardDiscount - promoDiscount);
  const effManualDiscount = Math.min(manualDiscount, beforeManual);
  const afterDiscount = beforeManual - effManualDiscount;
  // SST mirrors createSale exactly so the displayed amount, the card/cash
  // charge, and the recorded order all agree. Single source: the global
  // app_settings.sst the pickup app also reads.
  const sstAmount = sstCfg.enabled ? Math.round(afterDiscount * sstCfg.rate) : 0;
  const total = afterDiscount + sstAmount;
  // The "All" tab can be compacted independently (more columns + shorter/no
  // product image) via on-device prefs (lib/grid-prefs) so the full catalogue
  // scrolls less; every other category keeps the BO grid_columns + square cards.
  const allCols = useGridPrefs((s) => s.allColumns);
  const allImg = useGridPrefs((s) => s.allImageHeight);
  const gridPrefsLoaded = useGridPrefs((s) => s.loaded);
  const cols = activeCat === "all" ? allCols : gridColumns(settings);

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
  // Mirror whether the cashier has actually PICKED dine-in/takeaway yet — the
  // 2nd screen shouldn't show "Takeaway" just because that's the internal default.
  useEffect(() => { useDisplay.getState().setOrderTypeChosen(coTouched); }, [coTouched]);
  // Mirror the chosen tender to the customer screen so card payments show a
  // "pay by card on the terminal" prompt instead of the QR.
  useEffect(() => { useDisplay.getState().setPayMethod(payMethod); }, [payMethod]);
  useEffect(() => {
    useDisplay.getState().setTableNumber(orderType === "dine_in" ? (tableNumber || null) : null);
  }, [orderType, tableNumber]);
  useEffect(() => {
    useDisplay.getState().setMember(
      member
        ? { id: member.id, name: member.name, phone: member.phone, pointsBalance: member.points_balance, tierName: member.tier?.name ?? null, tierColor: member.tier?.color ?? null, isNew: (member.total_visits ?? 0) === 0 }
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
      smoothNext();
      setMember(m);
      fetchUsual(m.id).then((u) => { smoothNext(); setUsual(u); if (u.length > 0) setActiveCat("usual"); }).catch(() => {});
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMember?.id]);

  // Apply a reward the customer redeemed on the 2nd screen, then clear the
  // request. Drop it if a reward is already applied — one per order — so a
  // burst of taps on the 2nd screen can't redeem (and burn Beans) repeatedly.
  useEffect(() => {
    if (!redeemRequest) return;
    const req = redeemRequest;
    useDisplay.getState().setRedeemRequest(null);
    if (reward) return;
    void (async () => {
      const res = await applyRewardArgs(req.rewardId, req.issuedRewardId);
      // The customer tapped on the 2nd screen and can't see the cashier's Alert,
      // so mirror a short reason to the display when the reward can't be applied.
      if (!res.ok && res.reason !== "busy") {
        useDisplay.getState().setRedeemError(redeemErrorMessage(res.reason, res.min));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redeemRequest]);

  useEffect(() => {
    // Mirror the EFFECTIVE reward discount — for a non-stackable tier where the
    // tier % wins, this is 0 and we show no voucher line (the tier shows instead).
    useDisplay.getState().setReward(reward && effRewardDiscount > 0 ? { name: reward.name, discountSen: effRewardDiscount } : null);
  }, [reward, effRewardDiscount]);

  // ── Crash/hang recovery: offer to resume an unfinished order on relaunch ──
  // The cart is in-memory, so a restart (e.g. after a freeze) starts blank and
  // the whole order had to be re-keyed. We keep a durable, time-boxed draft and,
  // if a recent one exists, prompt to resume it. Checked once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const d = await loadDraft();
      if (cancelled) return;
      if (d) setRecoverableDraft(d);
      setDraftChecked(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-save the in-progress order (debounced). Gated until the initial draft
  // check runs (so we never clobber a draft before offering it), paused while the
  // resume prompt is open, and skipped on the thank-you screen. An empty cart
  // clears the draft (handled inside saveDraft).
  useEffect(() => {
    if (!draftChecked || recoverableDraft || paid) return;
    saveDraft({ lines, member, reward, manualDiscount, orderType, tableNumber, memberAsked });
  }, [draftChecked, recoverableDraft, paid, lines, member, reward, manualDiscount, orderType, tableNumber, memberAsked]);

  // Restore the saved order into the live cart + context. The existing
  // member/reward/orderType/table mirror effects re-sync the 2nd screen.
  function resumeDraft() {
    const d = recoverableDraft;
    if (!d) return;
    Haptics.selectionAsync();
    replaceLines(d.lines);
    setMember(d.member);
    setReward(d.reward);
    setManualDiscount(d.manualDiscount);
    setOrderType(d.orderType);
    setTableNumber(d.tableNumber);
    setMemberAsked(d.memberAsked || !!d.member);
    setRecoverableDraft(null);
  }

  function discardDraft() {
    Haptics.selectionAsync();
    setRecoverableDraft(null);
    void clearDraft();
  }

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
      ...(effPromoDisc > 0 ? autoPromotions.map((p) => p.description) : []),
    ].filter(Boolean) as string[];
    useDisplay.getState().setExtraDiscount(promoDiscount > 0 ? { label: parts.join(" · ") || "Discount", sen: promoDiscount } : null);
  }, [promoDiscount, autoPromotions, effTierDisc, effPromoDisc, member?.tier?.discount_percent, member?.tier?.name]);

  // Mirror the cashier's manual discount to the customer screen so its
  // ordering-mode total matches what the cashier sees.
  useEffect(() => {
    useDisplay.getState().setManualDiscount(effManualDiscount > 0 ? { label: "Discount", sen: effManualDiscount } : null);
  }, [effManualDiscount]);

  // Block ringing up until the store is open. Scheduled staff auto-open on
  // login; off-schedule / manager sessions open it here first.
  function promptOpenStore() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert("Store closed", "Open the store before starting an order.", [
      { text: "Not now", style: "cancel" },
      { text: "Open Store", onPress: openShiftModal },
    ]);
  }

  function onAdd(p: Product) {
    if (!shiftLoading && !shift) { promptOpenStore(); return; }
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
      smoothNext();
      setMember(m);
      setPhoneInput("");
      setPanel("none");
      fetchUsual(m.id).then((u) => {
        smoothNext();
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
    smoothNext();
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
  // 2nd-screen redeem (reverse channel). Returns { ok, reason } so callers can
  // show an accurate message (tier-bigger / needs-item / error) rather than a
  // misleading generic one.
  type RedeemFail = "busy" | "needs_item" | "tier_bigger" | "error" | "min_order";
  async function applyRewardArgs(rewardId: string | null, issuedRewardId: string | null): Promise<{ ok: boolean; reason?: RedeemFail; min?: number | null }> {
    if (!member || !outletId) return { ok: false, reason: "error" };
    // In-flight guard — strictly one redeem call at a time so a concurrent
    // double-tap can't reserve/commit twice. (The single-reward-per-order limit
    // is enforced at the card/reverse-channel call sites so the Rewards modal
    // can still SWITCH.)
    if (redeemBusyRef.current) return { ok: false, reason: "busy" };
    redeemBusyRef.current = true;
    try {
      // preview=true RESERVES a catalog reward on the cart without burning
      // points — the burn happens at payment (/complete). Issued vouchers ignore
      // it and commit immediately (they cost no points).
      const res = await redeemReward({ memberId: member.id, rewardId, outletId, issuedRewardId, preview: true });
      const disc = computeRewardDiscount(res.discount, lines);
      // No discount on THIS cart → don't apply a dead reward. Surface the precise
      // reason (minimum spend not met, or no qualifying item) instead of a silent
      // no-op or a misleading "tier discount is bigger".
      if (disc <= 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        const { block, min } = redeemBlockReason(res.discount, lines);
        if (block === "min_order") return { ok: false, reason: "min_order", min };
        return { ok: false, reason: "needs_item" };
      }
      // Non-stackable tier (Black Card / Staff): only apply the voucher if it
      // beats the tier % — otherwise keep the bigger tier discount (pickup parity).
      const t = member.tier;
      if (t?.stackable === false && (t.discount_percent ?? 0) > 0) {
        const tierD = Math.round((subtotal * (t.discount_percent ?? 0)) / 100);
        if (tierD >= disc) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          return { ok: false, reason: "tier_bigger" };
        }
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Deferred (catalog) redemption → no redemption_id yet; carry the reward
      // id so pay() records it on the order for the burn at /complete.
      const deferred = !res.redemption_id;
      setReward({
        redemptionId: res.redemption_id ?? null,
        rewardId: deferred ? rewardId : null,
        name: res.reward_name,
        descriptor: res.discount,
        pointsCost: res.points_spent ?? 0, // points this reward costs — shown on the receipt
      });
      // Only drop the displayed balance when points were ACTUALLY spent now (an
      // immediate issued-voucher commit). A reserved catalog reward keeps the
      // member's full balance until it burns at payment.
      if (!deferred) setMember((m) => (m ? { ...m, points_balance: res.new_balance ?? m.points_balance } : m));
      return { ok: true };
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return { ok: false, reason: "error" };
    } finally {
      redeemBusyRef.current = false;
    }
  }

  // Accurate redeem-failure alert (the old generic "add a qualifying item" was
  // shown even when the real reason was the non-stackable tier discount).
  function showRedeemError(reason?: RedeemFail, min?: number | null) {
    if (reason === "busy") return; // silent — another redeem is in flight
    if (reason === "min_order") {
      Alert.alert("Spend a little more", `This reward needs a minimum spend of RM${((min ?? 0) / 100).toFixed(2)} before it can be applied.`);
    } else if (reason === "tier_bigger") {
      Alert.alert(
        `${member?.tier?.name ?? "Tier"} discount is bigger`,
        "This reward is smaller than the discount already on the bill, so it wouldn't save more — the member keeps their points.",
      );
    } else if (reason === "needs_item") {
      Alert.alert("Add an item first", "This reward needs a qualifying item in the cart before it can be applied.");
    } else {
      Alert.alert("Couldn't redeem", "Something went wrong applying that reward. Please try again.");
    }
  }

  // Customer-facing one-liner mirrored to the 2nd screen when a tap THERE can't be
  // applied — the customer never sees the cashier's Alert, so they'd otherwise get
  // no feedback. Frames the min-spend case as how much more to add.
  function redeemErrorMessage(reason?: RedeemFail, min?: number | null): string {
    if (reason === "min_order") {
      const short = (min ?? 0) - subtotal;
      return short > 0
        ? `Spend RM${(short / 100).toFixed(2)} more to use this reward`
        : `This reward needs a minimum spend of RM${((min ?? 0) / 100).toFixed(2)}`;
    }
    if (reason === "tier_bigger") return "Your tier discount already beats this reward";
    if (reason === "needs_item") return "Add a qualifying item to use this reward";
    return "This reward can't be applied to this order";
  }

  async function applyReward(r: IssuedVoucher | CatalogReward, isCatalog: boolean) {
    const res = await applyRewardArgs(r.reward_id ?? r.id, isCatalog ? null : r.id);
    if (res.ok) setShowRewards(false);
    else showRedeemError(res.reason, res.min);
  }

  // Redeem a points-shop reward on the member's behalf (cashier taps when the
  // customer asks). This BURNS the member's Beans immediately and applies the
  // reward to the cart. One reward per order — if one's already applied, the
  // cashier removes it (the chip's X) before redeeming a different one. That
  // single-reward gate is what stops a tap-storm from draining Beans.
  async function redeemBeans(s: ShopCard) {
    if (reward) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Reward already applied", "Remove the current reward before redeeming a different one.");
      return;
    }
    if (!s.affordable) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert(s.name, `Needs ${s.points_required} Points — not enough yet.`);
      return;
    }
    const res = await applyRewardArgs(s.id, null);
    if (!res.ok) showRedeemError(res.reason, res.min);
  }

  // Apply an owned voucher (birthday / mystery-bag win / promo gift) to the bill.
  // Costs no Points — commits immediately. One reward per order, same as Points.
  async function redeemVoucher(v: VoucherCard) {
    if (reward) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Reward already applied", "Remove the current reward before applying a different one.");
      return;
    }
    // Pass the issued-reward id as BOTH reward_id (a non-null value the /redeem
    // guard requires) and issued_reward_id (what it actually resolves the voucher
    // by). Mirrors the Rewards modal's `reward_id ?? id` so mystery/owned vouchers
    // with a null reward_id still redeem instead of 400-ing.
    const res = await applyRewardArgs(v.id, v.id);
    if (!res.ok) showRedeemError(res.reason, res.min);
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
    setMemberAsked(false);
    setOrderType("takeaway");
    setOrderConfirmed(false);
    setCoTouched(false);
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
        effTierDisc > 0 && member?.tier && (member.tier.discount_percent ?? 0) > 0 ? `${member.tier.name} ${member.tier.discount_percent}% off` : null,
        ...(effPromoDisc > 0 ? autoPromotions.map((p) => p.description) : []),
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
        memberId: member?.id ?? null,
        // For a deferred catalog reward this is the catalog reward id, which
        // /api/pos/loyalty/complete looks up to burn the Beans now that payment
        // is confirmed. For an issued voucher it's the (already-committed)
        // redemption id, which /complete won't match → no double-burn.
        rewardId: reward?.rewardId ?? reward?.redemptionId ?? null,
        rewardName: reward?.name ?? null,
        rewardDiscount: effRewardDiscount,
        promoDiscount,
        promoName,
        manualDiscount: effManualDiscount,
      });
      // The sale is now in the durable offline buffer → drop the recovery draft
      // immediately, so a hang on the thank-you screen can't offer to "resume"
      // an order that's already been paid (which would double-charge it).
      void clearDraft();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Points this member earns — mirror the server formula in
      // /api/pos/loyalty/complete (floor of the pre-SST net). Tiers no longer
      // multiply points (fixed discounts only), so it's a straight 1 pt / RM.
      // A GUEST can claim the same amount by entering their phone on the
      // thank-you screen — so we mirror the order's worth (not 0) either way.
      const orderBeans = Math.floor((sale.total - sale.sst) / 100);
      const beansEarned = member?.id ? orderBeans : 0; // only an identified member actually earned (register chip + receipt)
      // Points spent on a redeemed catalog reward burn at /complete (deferred), so
      // member.points_balance here is still pre-burn — subtract them for the true
      // post-order balance on the receipt + chip.
      const pointsSpent = member?.id ? (reward?.pointsCost ?? 0) : 0;
      const beansBalance = member?.id ? (member.points_balance ?? 0) + beansEarned - pointsSpent : 0;
      setDisplayOrderNumber(sale.orderNumber);
      useDisplay.getState().setOrderId(sale.id);          // for the guest claim-Beans keypad
      useDisplay.getState().setBeansEarned(orderBeans);   // member's earned, or a guest's claimable potential
      setDisplayStatus("complete");
      setPaid({ orderNumber: sale.orderNumber, total: sale.total, beansEarned, beansBalance });
      // Loyalty order-hooks (award points, re-eval tier, spawn Mystery Bean)
      // are fired by the sale-sync AFTER the order confirms to the cloud — see
      // lib/sale-sync.ts. Deferring there means an offline sale still earns on
      // reconnect, and the hook never runs before the order row exists.
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
        beans_earned: beansEarned,
        beans_balance: beansBalance,
        points_spent: pointsSpent,
        subtotal: sale.subtotal,
        service_charge: sale.serviceCharge,
        discount_amount: sale.discount,
        sst_amount: sale.sst,
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
            // Per-line fulfilment so the docket tags DINE-IN vs TO-GO items.
            fulfillment: (orderType === "takeaway" || l.takeaway) ? "takeaway" : "dine_in",
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
        // Legal supplier identity for the tax receipt — company name + SSM are
        // editable in backoffice Outlet settings and flow through the `outlets`
        // view (company_name / reg_no).
        companyName: outlet?.company_name ?? null,
        regNo: outlet?.reg_no ?? null,
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
    // Order type only shows once confirmed at checkout (not pre-claimed).
    // Member name/phone is NOT shown here — the member card below already
    // carries it, so repeating it in the eyebrow just reads as two names.
    orderConfirmed ? (orderType === "dine_in" ? "Dine-in" : "Takeaway") : null,
    orderConfirmed && orderType === "dine_in" && tableNumber ? `Stand #${tableNumber}` : null,
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
                {outletShort(outletId)}
              </Text>
            </View>
            {/* Order type is chosen at checkout now — no upfront toggle here. */}
          </View>
          <View className="flex-row items-center gap-2">
            {/* Offline / sync chip — only shows when disconnected or while a
                buffered sale is still draining. Sales + dockets keep working
                offline; this just tells staff their cloud sync is behind. */}
            {(!online || pendingSales > 0) && (
              <View className="flex-row items-center gap-2 px-3 py-2 rounded-xl" style={{ backgroundColor: online ? "rgba(251,191,36,0.18)" : "rgba(239,68,68,0.20)" }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: online ? "#FBBF24" : "#EF4444" }} />
                <Text className="text-cream/90 text-xs" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>
                  {!online ? (pendingSales > 0 ? `Offline · ${pendingSales} queued` : "Offline") : `Syncing ${pendingSales}…`}
                </Text>
              </View>
            )}
            {/* Open Store — the cashier shift. Green dot = store open, amber =
                closed. Scheduled staff auto-open on login; tap to open manually
                (manager / off-schedule) or to close with an end-of-shift summary. */}
            <Pressable onPress={openShiftModal} className="flex-row items-center gap-2 px-3 py-2 rounded-xl border border-cream/15 active:opacity-60">
              <Power size={16} color={shift ? "#22C55E" : "#FBBF24"} />
              <Text className="text-cream/70 text-xs" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>{shift ? "Store Open" : "Open Store"}</Text>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: shift ? "#22C55E" : "#FBBF24" }} />
            </Pressable>
            {/* Orders command center — one button opens a tabbed panel for
                every order channel: dine-in Tables, QR self-orders, and
                Pickup + Grab. Badge = live incoming orders (QR + delivery). */}
            <Pressable onPress={() => { Haptics.selectionAsync(); setHub((v) => (v ? null : "tables")); }} className={`flex-row items-center gap-2 px-3 py-2 rounded-xl border active:opacity-60 ${hub ? "border-primary bg-primary/10" : "border-cream/15"}`}>
              <ClipboardList size={16} color="rgba(245,243,240,0.7)" />
              <Text className="text-cream/70 text-xs" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>Live Orders</Text>
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
            {/* Account chip — the cashier's name lives on the sign-out control
                itself (amber-tinted so it stands out) so on a shift change the
                incoming cashier instantly sees whose account is open and taps to
                switch. Tap = sign out → login. */}
            <Pressable onPress={() => { Haptics.selectionAsync(); signOut(); router.replace("/"); }} className="flex-row items-center gap-2 px-3 py-2 rounded-xl border active:opacity-60" style={{ borderColor: "rgba(251,191,36,0.45)", backgroundColor: "rgba(251,191,36,0.10)" }}>
              <View className="h-6 w-6 rounded-full items-center justify-center" style={{ backgroundColor: "rgba(251,191,36,0.22)" }}>
                <User size={14} color="#FBBF24" />
              </View>
              <Text className="text-cream text-xs" style={{ fontFamily: "SpaceGrotesk_700Bold" }} numberOfLines={1}>{staff?.staffName ?? "Cashier"}</Text>
              <View className="flex-row items-center gap-1.5 ml-1 pl-2.5" style={{ borderLeftWidth: 1, borderLeftColor: "rgba(245,243,240,0.18)" }}>
                <LogOut size={15} color="rgba(245,243,240,0.7)" />
                <Text className="text-cream/60 text-[11px]" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>Sign out</Text>
              </View>
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
        <View className="flex-1">
          {prods.isLoading || !settings || !gridPrefsLoaded ? (
            <View className="flex-1 items-center justify-center"><ActivityIndicator color="#FBBF24" /></View>
          ) : (
            <FlatList
              key={`grid-${cols}`}
              style={{ flex: 1 }}
              data={visible}
              keyExtractor={(p) => p.id}
              numColumns={cols}
              contentContainerStyle={{ padding: GRID_PAD, paddingBottom: 32 }}
              columnWrapperStyle={{ gap: GRID_GAP, justifyContent: "flex-start" }}
              ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
              renderItem={({ item }) => <ProductTile product={item} width={tileW} imageHeight={activeCat === "all" ? allImg : null} onPress={() => onAdd(item)} onLongPress={() => promptAvailability(item)} />}
              ListEmptyComponent={<Text className="text-cream/30 text-center mt-10" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>No items here yet.</Text>}
              removeClippedSubviews
              initialNumToRender={16}
              windowSize={5}
            />
          )}

          {/* "Ask first" GATE — covers the menu so nothing can be added until the
              cashier identifies a member or chooses Guest. Membership is settled
              before the first item goes in. Resets per order (newOrder / Clear). */}
          {shift && !member && !memberAsked && (
            <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(22,8,0,0.96)" }} className="items-center justify-center px-10">
              <View className="rounded-3xl items-center" style={{ width: 540, paddingVertical: 44, paddingHorizontal: 40, backgroundColor: "rgba(245,243,240,0.045)", borderWidth: 1, borderColor: "rgba(245,243,240,0.1)" }}>
                <View className="h-20 w-20 rounded-3xl items-center justify-center" style={{ marginBottom: 22, backgroundColor: "rgba(251,191,36,0.14)", borderWidth: 1, borderColor: "rgba(251,191,36,0.4)" }}>
                  <User size={38} color="#FBBF24" />
                </View>
                <Text className="text-cream text-center w-full" style={{ fontFamily: "Peachi-Bold", fontSize: 30, lineHeight: 36 }}>Check Customer's Rewards</Text>
                <Text className="text-cream/55 text-center w-full" style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 15, lineHeight: 22, marginTop: 12, marginBottom: 32 }}>Ask before starting the order — checking earns Points and unlocks member pricing on the whole bill.</Text>
                <Pressable onPress={() => { Haptics.selectionAsync(); setPanel("customer"); }} className="w-full rounded-2xl flex-row items-center justify-center active:opacity-80" style={{ height: 64, gap: 10, backgroundColor: "#FBBF24" }}>
                  <User size={20} color="#160800" />
                  <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 18, color: "#160800" }}>Yes — enter phone</Text>
                </Pressable>
                <Pressable onPress={() => { Haptics.selectionAsync(); setMemberAsked(true); }} className="w-full rounded-2xl items-center justify-center border active:opacity-70" style={{ height: 58, marginTop: 14, borderColor: "rgba(245,243,240,0.2)", backgroundColor: "rgba(245,243,240,0.05)" }}>
                  <Text className="text-cream/80" style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 16 }}>No — guest order</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>

        {/* ── Upsell bar — pairs + redeem-Beans + claim, in a wide strip under
            the product grid (where they have room) instead of crowding the
            Current Order panel. Pairs are cart-driven; redeem + claim are
            member-driven. Mirrors what the customer sees on their display. ── */}
        {(pairs.length > 0 || (member && (shop.length > 0 || claimables.length > 0))) && (
          <View className="border-t border-border px-3 py-2.5" style={{ backgroundColor: "rgba(0,0,0,0.18)" }}>
            <View className="flex-row" style={{ gap: 16 }}>
              {pairs.length > 0 && (
                <View style={{ flex: 1.3 }}>
                  <View className="flex-row items-center pb-1.5" style={{ gap: 5 }}>
                    <Coffee size={12} color="#FBBF24" />
                    <Text className="text-cream/55 text-[10px]" style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 1.2 }}>PAIR WITH A BITE</Text>
                  </View>
                  <View className="flex-row" style={{ gap: 8 }}>
                    {pairs.slice(0, 3).map((p) => (
                      <PairChip key={p.product_id} pair={p} onAdd={() => addPair(p)} />
                    ))}
                  </View>
                </View>
              )}
              {member && redeemChips.length > 0 && !reward && (
                <View style={{ flex: 1 }}>
                  <View className="flex-row items-center pb-1.5" style={{ gap: 5 }}>
                    <Sparkles size={12} color="#FBBF24" />
                    <Text className="text-cream/55 text-[10px]" style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 1.2 }}>REDEEM YOUR REWARDS</Text>
                  </View>
                  {/* Single row, capped at 3 — the box keeps its original height so
                      it never eats into the product grid above. The full catalogue
                      stays reachable via the member card's "Redeem Rewards" button. */}
                  <View className="flex-row" style={{ gap: 8 }}>
                    {redeemChips.slice(0, 3).map((c) =>
                      c.kind === "voucher" ? (
                        <RegisterVoucherCard key={`v${c.v.id}`} voucher={c.v} onUse={() => redeemVoucher(c.v)} />
                      ) : (
                        <RegisterRedeemCard key={`s${c.s.id}`} shop={c.s} onRedeem={() => redeemBeans(c.s)} />
                      ),
                    )}
                  </View>
                </View>
              )}
              {member && claimables.length > 0 && (
                <View style={{ flex: 1 }}>
                  <View className="flex-row items-center pb-1.5" style={{ gap: 5 }}>
                    <Gift size={12} color="#FBBF24" />
                    <Text className="text-cream/55 text-[10px]" style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 1.2 }}>REWARDS TO CLAIM</Text>
                  </View>
                  <View style={{ gap: 6 }}>
                    {claimables.slice(0, 2).map((c) => (
                      <RegisterClaimCard key={c.id} memberId={member.id} claimable={c} />
                    ))}
                  </View>
                </View>
              )}
            </View>
          </View>
        )}
      </View>

      {/* ── Cart panel ──────────────────────────────── */}
      <View className="bg-surface border-l border-border" style={{ width: CART_W }}>
        <View className="px-5 pt-4 pb-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-cream text-lg" style={{ fontFamily: "Peachi-Bold" }}>Current Order</Text>
            {lines.length > 0 && (
              <Pressable onPress={() => { Haptics.selectionAsync(); clear(); setReward(null); setManualDiscount(0); setMemberAsked(false); setOrderType("takeaway"); setTableNumber(""); setOrderConfirmed(false); setCoTouched(false); }} className="active:opacity-60">
                <Text className="text-primary text-xs" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>CLEAR</Text>
              </Pressable>
            )}
          </View>
          {!!eyebrow && (
            <Text className="text-cream/40 text-[11px] mt-0.5" style={{ fontFamily: "SpaceGrotesk_500Medium" }} numberOfLines={1}>{eyebrow}</Text>
          )}
        </View>

        {/* Action bar — only the "Customer" lookup, and only before a member is
            identified (after login it does nothing; the member card below owns
            the member, and its trash icon clears them to re-identify). */}
        {!member && (
          <View className="flex-row px-4 gap-2 pb-2">
            <ActionTab icon={<User size={15} color="#F5F3F0" />} label="Customer" active={panel === "customer"} onPress={() => setPanel(panel === "customer" ? "none" : "customer")} />
          </View>
        )}

        {/* Inline panels */}
        {panel === "customer" && !member && (
          <View className="px-4 pb-3">
            {/* Pressing "Customer" pops the keypad straight away (autoOpen) and
                Done looks the member up — no separate search bar / button. */}
            <NumpadField
              value={phoneInput}
              onChangeText={(t) => { setPhoneInput(t); setLookupError(null); }}
              placeholder="Tap to enter customer phone"
              mode="integer"
              title="Customer phone"
              autoOpen
              onDone={lookup}
              onClose={() => setPanel("none")}
              className="h-11 px-3 rounded-xl border border-cream/15"
              style={{ backgroundColor: "rgba(245,243,240,0.06)" }}
            />
            {lookingUp && (
              <View className="flex-row items-center gap-2 mt-1.5">
                <ActivityIndicator color="#fff" size="small" />
                <Text className="text-cream/50 text-xs" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>Looking up…</Text>
              </View>
            )}
            {!!lookupError && <Text className="text-[#E5484D] text-xs mt-1.5" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>{lookupError}</Text>}
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
                <Text className="text-amber-400 text-xs mt-0.5" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>{member.points_balance} Points · {member.total_visits} visits</Text>
              </View>
              <View className="flex-row items-center gap-2">
                <Pressable onPress={openRewards} className="flex-row items-center gap-1.5 h-9 px-3 rounded-xl active:opacity-80" style={{ backgroundColor: BRAND }}>
                  <Gift size={15} color="#fff" />
                  <Text className="text-white text-xs" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>Redeem</Text>
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
                // Swipe the line left to reveal a quick Remove action; tap
                // anywhere on the line (except the +/- steppers) to open the
                // line editor — qty, discount, remove.
                <ReanimatedSwipeable
                  friction={1.6}
                  rightThreshold={44}
                  overshootRight={false}
                  renderRightActions={() => (
                    // Leading gap (panel-coloured) keeps the action off the price;
                    // the box is a rounded chip with a little vertical inset.
                    <View className="flex-row items-stretch" style={{ paddingLeft: 16, backgroundColor: "#1A0A02" }}>
                      <Pressable
                        onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); remove(item.key); }}
                        className="items-center justify-center active:opacity-80"
                        style={{ width: 90, backgroundColor: "#DC2626", borderRadius: 16, marginVertical: 6 }}
                      >
                        <Trash2 size={22} color="#fff" />
                        <Text className="text-white mt-1" style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10.5, letterSpacing: 0.6 }}>REMOVE</Text>
                      </Pressable>
                    </View>
                  )}
                >
                <Pressable
                  onPress={() => { Haptics.selectionAsync(); setEditLineKey(item.key); }}
                  className="flex-row items-center py-3 border-b border-border active:opacity-70"
                  style={{ backgroundColor: "#1A0A02" }}
                >
                  <View className="flex-1 pr-2">
                    <Text className="text-cream text-[13px]" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7} style={{ fontFamily: "Peachi-Medium", lineHeight: 17 }}>{item.product.name}</Text>
                    {item.modifiers.length > 0 && (
                      <Text className="text-cream/45 text-[11px]" style={{ fontFamily: "SpaceGrotesk_400Regular" }} numberOfLines={1}>{item.modifiers.map((m) => m.name).join(", ")}</Text>
                    )}
                    <View className="flex-row items-center" style={{ gap: 6 }}>
                      <Text className="text-cream/55 text-[11px] mt-0.5" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>{rm(item.unit_sen)}</Text>
                      {item.takeaway && (
                        <View className="rounded-full mt-0.5 px-2 py-0.5" style={{ backgroundColor: "rgba(249,115,22,0.16)", borderWidth: 1, borderColor: "rgba(249,115,22,0.5)" }}>
                          <Text className="text-[9.5px]" style={{ fontFamily: "SpaceGrotesk_700Bold", color: "#F97316", letterSpacing: 0.4 }}>TAKEAWAY</Text>
                        </View>
                      )}
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
                </ReanimatedSwipeable>
              );
            }}
          />
        )}

        {/* The pair / redeem-Beans / claim upsell now lives in a bottom bar
            under the product grid (see UpsellBar) so the cart panel stays clean
            — just member + order + totals. */}

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
          {effPromoDisc > 0 && autoPromotions.map((p, i) => (
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
          {sstAmount > 0 && (
            <View className="flex-row justify-between mb-1">
              <Text className="text-cream/55 text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>SST ({Math.round(sstCfg.rate * 100)}%)</Text>
              <Text className="text-cream/80 text-sm" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>{rm(sstAmount)}</Text>
            </View>
          )}
          <View className="flex-row justify-between items-baseline mb-4">
            <Text className="text-cream text-lg" style={{ fontFamily: "Peachi-Bold" }}>Total</Text>
            <Text className="text-amber-400 text-2xl" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(total)}</Text>
          </View>
          {/* Charge — opens checkout. Order type + stand are chosen there
              (compulsory) before payment. If already confirmed (re-opened after a
              back-out), go straight to payment + flip the display to Scan-to-Pay. */}
          {(() => {
            const empty = lines.length === 0;
            return (
              <Pressable
                disabled={empty}
                onPress={() => {
                  if (empty) return;
                  Haptics.selectionAsync();
                  if (orderConfirmed) {
                    useDisplay.getState().setPayTotal(total);
                    setDisplayStatus("payment");
                  } else {
                    setCoTouched(false); // force a fresh type pick this checkout
                  }
                  setShowCheckout(true);
                }}
                className={`h-14 rounded-2xl items-center justify-center ${empty ? "bg-primary/30" : "bg-primary active:opacity-80"}`}
              >
                <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
                  {empty ? "Add items" : `Charge ${rm(total)}`}
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
      {/* Non-blocking "shift ended" banner — the rostered shift's clock ran out
          but the cashier is held in to finish open orders. Tap → Close Store. */}
      {shiftEnded && (
        <View pointerEvents="box-none" style={{ position: "absolute", top: 6, left: 0, right: 0, alignItems: "center", zIndex: 60 }}>
          <Pressable onPress={openShiftModal} className="flex-row items-center gap-2 rounded-2xl px-4 py-2.5 active:opacity-80" style={{ backgroundColor: "#5b2410", borderWidth: 1, borderColor: "#FBBF24" }}>
            <AlertTriangle size={16} color="#FBBF24" />
            <Text className="text-amber-200 text-sm" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
              Shift ended — hand over {openLiveCount} open order{openLiveCount === 1 ? "" : "s"}, then Close Store
            </Text>
          </Pressable>
        </View>
      )}
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
                    ? `${tableSlots.filter((t) => t.orders.length > 0).length} of ${tableSlots.length} tables have orders · tap a table to see its order · live`
                    : hub === "history"
                    ? (historyLoading ? "Loading today's orders…" : `${historyOrders.length} order${historyOrders.length === 1 ? "" : "s"} today · all channels`)
                    : (() => {
                        const ch: "pickup" | "grab" = hub === "grab" ? "grab" : "pickup";
                        const n = kdsOrders.filter((o) => o.source === ch).length;
                        const label = ch === "grab" ? "Grab" : "pickup";
                        return n === 0 ? `No live ${label} orders` : `${n} ${label} order${n === 1 ? "" : "s"} · live`;
                      })()}
                </Text>
              </View>
              <View className="flex-row items-center gap-4">
                {hub === "tables" && (<><TableLegendDot color="#3B82F6" label="QR table" /><TableLegendDot color="#FBBF24" label="Register" /></>)}
                <Pressable onPress={() => setHub(null)} className="active:opacity-60 ml-2">
                  <X size={22} color="rgba(245,243,240,0.7)" />
                </Pressable>
              </View>
            </View>
            {/* Tab switcher — one command center for every order channel.
                Full-width, large touch targets (SUNMI counter use). */}
            <View className="flex-row gap-2.5 mb-4">
              {(() => {
                const tabs: { key: "tables" | "pickup" | "grab" | "history"; label: string; Icon: typeof Grid3x3; count: number }[] = [
                  { key: "tables", label: "QR Tables", Icon: Grid3x3, count: tableSlots.filter((t) => t.orders.length > 0).length },
                  { key: "pickup", label: "Pickup", Icon: ShoppingBag, count: kdsOrders.filter((o) => o.source === "pickup").length },
                  { key: "grab", label: "Grab", Icon: Bike, count: kdsOrders.filter((o) => o.source === "grab").length },
                  { key: "history", label: "History", Icon: ClipboardList, count: historyOrders.length },
                ];
                return tabs.map(({ key, label, Icon, count }) => (
                  <Pressable key={key} onPress={() => { Haptics.selectionAsync(); setHub(key); }}
                    className={`flex-1 flex-row items-center justify-center gap-2.5 px-4 py-4 rounded-2xl border active:opacity-70 ${hub === key ? "border-primary bg-primary/15" : "border-cream/12"}`}>
                    <Icon size={20} color={hub === key ? "#C2452D" : "rgba(245,243,240,0.6)"} />
                    <Text className={hub === key ? "text-cream text-base" : "text-cream/60 text-base"} style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{label}</Text>
                    {count > 0 && (
                      <View className="rounded-full px-2 py-0.5 min-w-[22px] items-center" style={{ backgroundColor: hub === key ? "#C2452D" : "rgba(245,243,240,0.18)" }}>
                        <Text className="text-cream text-xs" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{count}</Text>
                      </View>
                    )}
                  </Pressable>
                ));
              })()}
            </View>
            <View style={{ flex: 1 }}>
              {hub === "tables" && (() => {
                // Group the flat slots into their zones (= floors). The data
                // already carries the saved BackOffice template; we render ONE
                // floor at a time with a switcher so multi-floor outlets stay
                // navigable instead of an endless vertical scroll.
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
                const activeIdx = Math.max(0, groups.findIndex((g) => g.name === (activeFloor ?? groups[0].name)));
                // One table tile, positioned at its normalised x/y on the canvas.
                const renderTile = (slot: TableSlot) => {
                  const has = slot.orders.length > 0;
                  const sel = selectedTable?.label === slot.label && selectedTable?.zone === slot.zone;
                  const dim = tableDims(slot.seats, slot.shape, slot.orientation);
                  return (
                    <Pressable
                      key={slot.label}
                      onPress={() => { Haptics.selectionAsync(); setSelectedTable(has ? slot : null); }}
                      className="active:opacity-80 items-center justify-center"
                      style={{
                        position: "absolute",
                        left: `${slot.x * 100}%`, top: `${slot.y * 100}%`,
                        marginLeft: -dim.w / 2, marginTop: -dim.h / 2,
                        width: dim.w, height: dim.h,
                        borderRadius: slot.shape === "round" ? dim.h / 2 : 14, borderWidth: sel ? 2 : 1,
                        backgroundColor: has ? "rgba(194,69,45,0.18)" : "rgba(245,243,240,0.06)",
                        borderColor: sel ? "#FBBF24" : has ? "rgba(194,69,45,0.6)" : "rgba(245,243,240,0.14)",
                      }}
                    >
                      {slot.shape !== "round" && dim.cells > 1 && Array.from({ length: dim.cells - 1 }).map((_, i) => (
                        dim.vertical
                          ? <View key={`d${i}`} style={{ position: "absolute", left: 8, right: 8, height: 1, top: `${((i + 1) / dim.cells) * 100}%`, backgroundColor: "rgba(245,243,240,0.18)" }} />
                          : <View key={`d${i}`} style={{ position: "absolute", top: 8, bottom: 8, width: 1, left: `${((i + 1) / dim.cells) * 100}%`, backgroundColor: "rgba(245,243,240,0.18)" }} />
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
                };
                return (
                  <View style={{ flex: 1 }}>
                    {/* Floor chips — show which floor + tap to jump; swipe also
                        changes floor (kept in sync via the pager ref). */}
                    {groups.length > 1 && (
                      <View className="flex-row items-center" style={{ gap: 10, marginBottom: 10 }}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexShrink: 1 }}>
                          {groups.map((g, i) => {
                            const on = i === activeIdx;
                            const cnt = g.slots.filter((s) => s.orders.length > 0).length;
                            return (
                              <Pressable key={g.name} onPress={() => { Haptics.selectionAsync(); setActiveFloor(g.name); setSelectedTable(null); floorPagerRef.current?.scrollTo({ x: i * floorBox.w, animated: true }); }}
                                className={`flex-row items-center gap-2 px-5 py-2.5 rounded-xl border active:opacity-70 ${on ? "border-primary bg-primary/15" : "border-cream/12"}`}>
                                <Text className={on ? "text-cream text-sm" : "text-cream/60 text-sm"} style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{g.name}</Text>
                                {cnt > 0 && (<View className="rounded-full px-2 min-w-[20px] items-center" style={{ backgroundColor: on ? "#C2452D" : "rgba(245,243,240,0.18)" }}><Text className="text-cream text-[11px]" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{cnt}</Text></View>)}
                              </Pressable>
                            );
                          })}
                        </ScrollView>
                        <Text className="text-cream/35 text-[11px]" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>swipe ↔</Text>
                      </View>
                    )}
                    {/* Tapped-table detail — the consolidated QR self-order view. */}
                    {liveSelectedTable && liveSelectedTable.orders.length > 0 && (
                      <TableOrdersDetail slot={liveSelectedTable} busyId={bumpingUid} onDone={markTableOrderDone} onClose={() => setSelectedTable(null)} />
                    )}
                    {/* Floor-plan canvas — fills the rest of the panel so a floor
                        fits on one screen (no scroll). Each floor is a full-width
                        page; swipe to change floor. Sized from the measured box so
                        the normalised table positions land correctly. */}
                    <View style={{ flex: 1, minHeight: 0 }} onLayout={(e) => { const { width, height } = e.nativeEvent.layout; if (Math.abs(width - floorBox.w) > 1 || Math.abs(height - floorBox.h) > 1) setFloorBox({ w: width, h: height }); }}>
                      {floorBox.w > 0 && floorBox.h > 0 && (
                        <ScrollView
                          ref={floorPagerRef}
                          horizontal
                          pagingEnabled
                          showsHorizontalScrollIndicator={false}
                          scrollEnabled={groups.length > 1}
                          onMomentumScrollEnd={(e) => {
                            const i = Math.round(e.nativeEvent.contentOffset.x / floorBox.w);
                            const g = groups[i];
                            if (g && g.name !== (activeFloor ?? groups[0].name)) { setActiveFloor(g.name); setSelectedTable(null); }
                          }}
                        >
                          {groups.map((g) => (
                            <View key={g.name} style={{ width: floorBox.w, height: floorBox.h }}>
                              <View style={{ flex: 1, position: "relative", backgroundColor: "rgba(245,243,240,0.03)", borderRadius: 14, borderWidth: 1, borderColor: "rgba(245,243,240,0.08)", overflow: "hidden" }}>
                                {g.slots.map(renderTile)}
                              </View>
                            </View>
                          ))}
                        </ScrollView>
                      )}
                    </View>
                  </View>
                );
              })()}
              {hub !== "tables" && (
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
              {/* ── Pickup / Grab tabs — one dedicated on-register KDS per
                  channel (separate top-level tabs). Status writes go through
                  the service-role API (RLS blocks anon updates on printed rows). */}
              {(hub === "pickup" || hub === "grab") && (() => {
                const ch: "pickup" | "grab" = hub === "grab" ? "grab" : "pickup";
                const shown = kdsOrders.filter((o) => o.source === ch);
                return (
                  <View className="flex-row flex-wrap" style={{ gap: 12 }}>
                    {shown.map((order) => (
                      <KdsCard
                        key={order.uid}
                        order={order}
                        busy={bumpingUid === order.uid}
                        onAdvance={(status) => advanceOrderStatus(order, status)}
                      />
                    ))}
                    {shown.length === 0 && (
                      <View className="py-16 items-center w-full">
                        <ChefHat size={40} color="rgba(245,243,240,0.18)" />
                        <Text className="text-cream/40 text-sm mt-3" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                          {ch === "grab" ? "Grab orders will appear here as they come in." : "Pickup orders will appear here as they come in."}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })()}

              {/* ── History tab — today's orders across every channel so the
                  counter can double-check the day. Read-only review; tap a row
                  to expand the receipt. Filterable by channel. ── */}
              {hub === "history" && (() => {
                const shown = historyOrders.filter((o) => histFilter === "all" || o.channel === histFilter);
                return (
                  <View>
                    <ChannelFilter
                      value={histFilter}
                      onChange={(v) => { Haptics.selectionAsync(); setHistFilter(v as "all" | HistoryChannel); }}
                      options={[
                        { key: "all", label: "All", dot: null, count: historyOrders.length },
                        ...HIST_CHANNELS.map((c) => ({ key: c.key, label: c.label, dot: c.dot, count: historyOrders.filter((o) => o.channel === c.key).length })),
                      ]}
                    />
                    <View style={{ gap: 8 }}>
                      {shown.map((o) => <HistoryRow key={o.uid} order={o} />)}
                      {shown.length === 0 && (
                        <View className="py-16 items-center w-full">
                          <ClipboardList size={40} color="rgba(245,243,240,0.18)" />
                          <Text className="text-cream/40 text-sm mt-3" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                            {historyLoading ? "Loading today's orders…" : histFilter === "all" ? "No orders yet today." : `No ${HIST_CHANNELS.find((c) => c.key === histFilter)?.label ?? histFilter} orders today.`}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })()}
              </ScrollView>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Serving-time overdue alarm popup ────────────────────────────
          Pops on the main register when an order passes the 10-min serving
          target (pickup not Ready / table not Done), paired with the alarm
          sound. Auto-clears as orders are actioned; "Open Live Orders" jumps
          to the panel to act on them. */}
      <Modal visible={showOverduePopup} transparent animationType="fade" onRequestClose={() => setOverdueAck(true)}>
        <View style={{ flex: 1, backgroundColor: "rgba(22,8,0,0.92)" }} className="items-center justify-center px-12">
          <View className="w-full max-w-3xl rounded-3xl p-8" style={{ backgroundColor: "#2A1206", borderWidth: 2, borderColor: "#C2452D" }}>
            <View className="flex-row items-center gap-3 mb-1">
              <AlertTriangle size={30} color="#C2452D" />
              <Text className="text-cream text-2xl" style={{ fontFamily: "Peachi-Bold" }}>
                {overdueOrders.length} order{overdueOrders.length === 1 ? "" : "s"} past 15 min
              </Text>
            </View>
            <Text className="text-cream/60 text-sm mb-5" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>
              Serving target exceeded — mark Ready / Done as soon as they're served.
            </Text>
            <View className="gap-2 mb-6">
              {overdueOrders.map((o) => {
                const mins = Math.max(0, Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60000));
                return (
                  <View key={o.id} className="flex-row items-center justify-between rounded-2xl px-4 py-3" style={{ backgroundColor: "rgba(194,69,45,0.14)" }}>
                    <View className="flex-row items-center gap-3">
                      <View className="rounded-lg px-2 py-1" style={{ backgroundColor: o.channel === "table" ? "#3B82F6" : "#FBBF24" }}>
                        <Text className="text-[11px]" style={{ fontFamily: "SpaceGrotesk_700Bold", color: "#160800" }}>{o.channel === "table" ? "TABLE" : "PICKUP"}</Text>
                      </View>
                      <Text className="text-cream text-lg" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{o.label}</Text>
                    </View>
                    <Text className="text-lg" style={{ fontFamily: "SpaceGrotesk_700Bold", color: "#FF8A6B" }}>{mins} min</Text>
                  </View>
                );
              })}
            </View>
            <View className="flex-row gap-3">
              <Pressable onPress={() => { Haptics.selectionAsync(); setOverdueAck(true); }} className="flex-1 items-center justify-center rounded-2xl py-4 border border-cream/15 active:opacity-60">
                <Text className="text-cream/70 text-base" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>Dismiss</Text>
              </Pressable>
              <Pressable onPress={() => { Haptics.selectionAsync(); openOverdueHub(); }} className="flex-1 items-center justify-center rounded-2xl py-4 active:opacity-80" style={{ backgroundColor: "#C2452D" }}>
                <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>Open Live Orders</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Open Store (cashier shift) open / close ─────────────────────
          The store must be open to ring up an order or accept Grab/Pickup
          orders (the till gates on it). Scheduled staff auto-open on login;
          otherwise open it here. Closing stamps closed_at + rolls up the
          shift's sales for the Z-report. Cashless — no cash float / drawer. */}
      <Modal visible={showShift} transparent animationType="fade" onRequestClose={() => setShowShift(false)}>
        <View className="flex-1 bg-black/70 items-center justify-center px-8">
          {/* Tap the dark backdrop to close (unless a shift op is in flight). */}
          <Pressable onPress={() => { if (!shiftBusy) setShowShift(false); }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          <View className="w-[460px] rounded-3xl bg-surface border border-border p-7">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-cream text-xl" style={{ fontFamily: "Peachi-Bold" }}>
                {closedSummary ? "Store Closed" : shift ? "Close Store" : "Open Store"}
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
                  <Text className="text-cream text-base mt-2" style={{ fontFamily: "Peachi-Bold" }}>Store closed</Text>
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
                <Pressable onPress={doCloseShift} disabled={shiftBusy} className={`h-14 rounded-2xl items-center justify-center ${shiftBusy ? "bg-primary/40" : "bg-primary active:opacity-80"}`}>
                  {shiftBusy ? <ActivityIndicator color="#F5F3F0" /> : <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>Close Store</Text>}
                </Pressable>
              </View>
            ) : (
              // ── Open a new shift ──
              <View className="gap-4">
                <Text className="text-cream/50 text-[12px]" style={{ fontFamily: "SpaceGrotesk_500Medium", lineHeight: 18 }}>
                  Open the store to start taking orders. This ties the run of orders to you (cashless — QR / card only), so sales roll up correctly on the Z-Report.
                </Text>
                <Pressable onPress={doOpenShift} disabled={shiftBusy} className={`h-14 rounded-2xl items-center justify-center flex-row gap-2 ${shiftBusy ? "bg-primary/40" : "bg-primary active:opacity-80"}`}>
                  {shiftBusy ? <ActivityIndicator color="#F5F3F0" /> : <><Power size={20} color="#F5F3F0" /><Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>Open Store</Text></>}
                </Pressable>
                {recentClosed?.closed_at && (
                  // Recover an accidental / too-early close: reopen the last shift
                  // so the same service stays on one shift + Z-report.
                  <Pressable onPress={() => void doReopenShift(recentClosed)} disabled={shiftBusy}
                    className="h-12 rounded-2xl items-center justify-center flex-row gap-2 border active:opacity-70" style={{ borderColor: "rgba(251,191,36,0.5)" }}>
                    <Text className="text-amber-300 text-sm" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
                      Resume last shift · closed {Math.max(1, Math.round((Date.now() - new Date(recentClosed.closed_at).getTime()) / 60000))}m ago
                    </Text>
                  </Pressable>
                )}
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
                {!orderConfirmed ? "Order details" : payMethod === "qr" ? "Scan to Pay" : payMethod === "card" ? "Card Payment" : "Payment"}
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

            {/* Confirmed order type + stand, with a tap back to change it. */}
            {orderConfirmed && (
              <Pressable onPress={() => { Haptics.selectionAsync(); setOrderConfirmed(false); setPayMethod(null); setDisplayStatus("ordering"); }} className="flex-row items-center gap-2 -mt-2 mb-5 active:opacity-70">
                <Text className="text-cream/65 text-sm" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>
                  {orderType === "dine_in" ? `Dine-in · Stand #${tableNumber}` : "Takeaway"}
                </Text>
                <View className="px-2 py-0.5 rounded-md" style={{ backgroundColor: "rgba(245,243,240,0.08)" }}>
                  <Text className="text-cream/70 text-[10px]" style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 0.5 }}>EDIT</Text>
                </View>
              </Pressable>
            )}

            {/* ── STEP 1: ORDER DETAILS (compulsory) — Dine-in/Takeaway + stand ── */}
            {!orderConfirmed && !paying && (
              <View className="mt-1">
                <Text className="text-cream/55 text-xs uppercase tracking-widest mb-2" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>How is this order?</Text>
                <View className="flex-row gap-3">
                  {([
                    { t: "dine_in" as const, label: "Dine-in", Icon: Coffee },
                    { t: "takeaway" as const, label: "Takeaway", Icon: ShoppingBag },
                  ]).map(({ t, label, Icon }) => {
                    const on = coTouched && orderType === t;
                    return (
                      <Pressable
                        key={t}
                        onPress={() => { Haptics.selectionAsync(); setOrderType(t); setCoTouched(true); if (t === "takeaway") setTableNumber(""); }}
                        className="flex-1 rounded-2xl items-center justify-center"
                        style={{ height: 96, gap: 8, backgroundColor: on ? "rgba(251,191,36,0.12)" : "rgba(245,243,240,0.04)", borderWidth: on ? 2 : 1, borderColor: on ? "#FBBF24" : "rgba(245,243,240,0.12)" }}
                      >
                        <Icon size={26} color={on ? "#FBBF24" : "rgba(245,243,240,0.7)"} />
                        <Text className="text-base" style={{ fontFamily: "Peachi-Bold", color: on ? "#F5F3F0" : "rgba(245,243,240,0.8)" }}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                {coTouched && orderType === "dine_in" && (
                  <View className="mt-4">
                    <Text className="text-cream/50 text-[11px] mb-1.5" style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 0.8 }}>STAND NUMBER — the placard you hand the guest</Text>
                    <View className="h-12 rounded-xl mb-2 px-4 justify-center" style={{ borderWidth: 1.5, borderColor: "rgba(245,243,240,0.18)", backgroundColor: "rgba(245,243,240,0.04)" }}>
                      <Text className="text-2xl" style={{ fontFamily: "SpaceGrotesk_700Bold", color: tableNumber ? "#F5F3F0" : "rgba(245,243,240,0.3)" }}>{tableNumber ? `#${tableNumber}` : "#"}</Text>
                    </View>
                    <View className="flex-row flex-wrap" style={{ gap: 7, justifyContent: "space-between" }}>
                      {(["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "←"]).map((k) => (
                        <Pressable key={k} onPress={() => { Haptics.selectionAsync(); if (k === "C") setTableNumber(""); else if (k === "←") setTableNumber(tableNumber.slice(0, -1)); else if (tableNumber.length < 4) setTableNumber(tableNumber === "0" ? k : tableNumber + k); }}
                          className="items-center justify-center rounded-xl active:opacity-70" style={{ width: "31.5%", height: 48, backgroundColor: k === "C" || k === "←" ? "rgba(245,243,240,0.06)" : "rgba(245,243,240,0.1)" }}>
                          <Text className="text-cream" style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: k === "C" ? 15 : 20 }}>{k === "C" ? "Clear" : k}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}

                {(() => {
                  const ready = coTouched && (orderType === "takeaway" || !!tableNumber);
                  return (
                    <Pressable
                      disabled={!ready}
                      onPress={() => { Haptics.selectionAsync(); setOrderConfirmed(true); useDisplay.getState().setPayTotal(total); setDisplayStatus("payment"); }}
                      className={`h-14 rounded-2xl items-center justify-center mt-5 ${ready ? "bg-primary active:opacity-80" : "bg-primary/30"}`}
                    >
                      <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
                        {!coTouched ? "Select Dine-in or Takeaway" : orderType === "dine_in" && !tableNumber ? "Enter stand number" : "Continue to payment"}
                      </Text>
                    </Pressable>
                  );
                })()}
              </View>
            )}

            {/* ── STEP 2: METHOD PICKER ── */}
            {orderConfirmed && !payMethod && !paying && (
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
                {!!member && <Text className="text-amber-400 text-xs mt-0.5" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>{rewards?.balance ?? member.points_balance} Points available</Text>}
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
                  <RewardRow key={c.id} title={c.title} subtitle={`${discountSummary(c)} · ${c.points_required} Points`} points={c.points_required} onPress={() => applyReward(c, true)} />
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
              onToggleTakeaway={(takeaway) => { setLineTakeaway(line.key, takeaway); }}
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
            <Text className="text-amber-400 text-4xl mt-3 mb-4" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{paid ? rm(paid.total) : ""}</Text>
            {!!paid && paid.beansEarned > 0 && (
              <View className="flex-row items-center mb-6 px-4 py-2 rounded-full" style={{ gap: 8, backgroundColor: "rgba(251,191,36,0.12)", borderWidth: 1, borderColor: "rgba(251,191,36,0.35)" }}>
                <Sparkles size={16} color="#FBBF24" />
                <Text className="text-amber-300" style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 15 }}>+{paid.beansEarned} Points earned</Text>
                <Text className="text-cream/45" style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 13 }}>· {paid.beansBalance} total</Text>
              </View>
            )}
            <Pressable onPress={newOrder} className="h-13 px-8 py-3.5 rounded-2xl bg-primary active:opacity-80">
              <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>New Order</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Resume unfinished order (crash/hang recovery, lib/draft-order) ── */}
      <Modal visible={!!recoverableDraft} transparent animationType="fade" onRequestClose={discardDraft}>
        <View className="flex-1 bg-black/70 items-center justify-center px-8">
          <View className="w-[480px] rounded-3xl bg-surface border border-border p-8 items-center">
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(251,191,36,0.14)", alignItems: "center", justifyContent: "center" }}>
              <RotateCcw size={32} color="#FBBF24" />
            </View>
            <Text className="text-cream text-2xl mt-4" style={{ fontFamily: "Peachi-Bold" }}>Unfinished order</Text>
            <Text className="text-cream/60 text-center mt-2" style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 14, lineHeight: 20 }}>
              The till restarted with an order in progress. Resume it, or start fresh.
            </Text>
            {!!recoverableDraft && (
              <View className="mt-4 mb-6 w-full rounded-2xl px-4 py-3" style={{ backgroundColor: "rgba(245,243,240,0.05)", borderWidth: 1, borderColor: "rgba(245,243,240,0.12)" }}>
                <Text className="text-cream" style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 15 }}>
                  {recoverableDraft.lines.reduce((s, l) => s + l.qty, 0)} item{recoverableDraft.lines.reduce((s, l) => s + l.qty, 0) === 1 ? "" : "s"} · {rm(cartSubtotal(recoverableDraft.lines))}
                </Text>
                {!!recoverableDraft.member && (
                  <Text className="text-cream/55 mt-0.5" style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 12.5 }}>
                    {recoverableDraft.member.name} · {recoverableDraft.member.phone}
                  </Text>
                )}
              </View>
            )}
            <View className="flex-row w-full" style={{ gap: 12 }}>
              <Pressable onPress={discardDraft} className="flex-1 h-14 rounded-2xl items-center justify-center border active:opacity-70" style={{ borderColor: "rgba(245,243,240,0.2)", backgroundColor: "rgba(245,243,240,0.05)" }}>
                <Text className="text-cream/80 text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>Start fresh</Text>
              </Pressable>
              <Pressable onPress={resumeDraft} className="flex-1 h-14 rounded-2xl items-center justify-center bg-primary active:opacity-80">
                <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>Resume order</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Sleep/lock overlay — covers the till behind a PIN when the shift/idle
          timer fires, WITHOUT unmounting the register (so the online-order
          auto-printers + chime above keep running while it's asleep). */}
      {locked && <LockScreen />}
    </View>
  );
}

function discountSummary(v: { discount_type: string | null; discount_value: number | null; free_product_name: string | null }): string {
  if (v.discount_type === "percent") return `${v.discount_value ?? 0}% off`;
  if (v.discount_type === "flat") return `${rm(Math.round(v.discount_value ?? 0))} off`;
  if (v.discount_type === "free_item" || v.discount_type === "free_upgrade") return v.free_product_name ? `Free ${v.free_product_name}` : "Free item";
  return "Reward";
}

function ActionTab({ icon, label, active, onPress }: { icon: React.ReactNode; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-1 flex-row items-center justify-center gap-1.5 h-10 rounded-xl active:opacity-80" style={{ backgroundColor: active ? BRAND : "rgba(245,243,240,0.05)", borderWidth: 1, borderColor: active ? BRAND : "rgba(245,243,240,0.12)" }}>
      {icon}
      <Text className="text-cream text-xs" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>{label}</Text>
    </Pressable>
  );
}

// Reward row — single-row card anatomy mirroring the native pickup app's
// rewards list: [icon tile] EYEBROW / Title / Subline … [pill]. Espresso card
// with a gold accent + a faint brand glyph, so the register's Redeem modal
// reads as the same card family the customer sees in the pickup app.
function RewardRow({ title, subtitle, points, onPress }: { title: string; subtitle: string; points?: number; onPress: () => void }) {
  const isFree = /free/i.test(title);
  const isDiscount = /rm\s?\d|%|\boff\b/i.test(title);
  const eyebrow = isFree ? "Free Item" : isDiscount ? "Discount" : "Voucher";
  const Icon = isFree ? Coffee : isDiscount ? Tag : Gift;
  const pill = points && points > 0 ? "Redeem" : "Apply";
  return (
    <Pressable
      onPress={onPress}
      className="active:opacity-90"
      style={{ borderRadius: 18, overflow: "hidden", backgroundColor: "rgba(245,243,240,0.05)", borderWidth: 1, borderColor: "rgba(245,243,240,0.12)", marginBottom: 8 }}
    >
      {/* faint brand glyph bottom-right (mirrors the pickup card's CelsiusGift) */}
      <View style={{ position: "absolute", right: -8, bottom: -16, opacity: 0.08 }}>
        <Gift size={104} color="#FBBF24" strokeWidth={1.5} />
      </View>
      <View className="flex-row items-center" style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 14 }}>
        <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: "rgba(251,191,36,0.16)", alignItems: "center", justifyContent: "center" }}>
          <Icon size={22} color="#FBBF24" strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9.5, letterSpacing: 1.4, color: "#FBBF24", textTransform: "uppercase", marginBottom: 2 }} numberOfLines={1}>{eyebrow}</Text>
          <Text style={{ fontFamily: "Peachi-Bold", fontSize: 16, color: "#F5F3F0", lineHeight: 20 }} numberOfLines={1}>{title}</Text>
          <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 11, color: "rgba(245,243,240,0.5)", marginTop: 1 }} numberOfLines={1}>{subtitle}</Text>
        </View>
        <View style={{ backgroundColor: "#FBBF24", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 }}>
          <Text style={{ color: "#1A0A02", fontFamily: "SpaceGrotesk_700Bold", fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase" }}>{pill}</Text>
        </View>
      </View>
    </Pressable>
  );
}

/** Compact suggested-pair chip for the cashier's upsell strip — mirrors a card
 *  on the customer display. A discount badge (when the bite completes a combo),
 *  the reason it's suggested, name, price, and a + to drop it straight into the
 *  cart (tap routes through onAdd → 86 check + modifier sheet). */
function PairChip({ pair, onAdd }: { pair: SuggestedPair; onAdd: () => void }) {
  return (
    <Pressable
      onPress={() => { Haptics.selectionAsync(); onAdd(); }}
      className="flex-1 rounded-xl overflow-hidden active:opacity-80"
      style={{ backgroundColor: "rgba(245,243,240,0.05)", borderWidth: 1, borderColor: pair.discount_label ? "rgba(251,191,36,0.55)" : "rgba(245,243,240,0.12)" }}
    >
      {!!pair.discount_label && (
        <View style={{ backgroundColor: "#FBBF24", paddingVertical: 2, alignItems: "center" }}>
          <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 8.5, letterSpacing: 0.4, color: "#160800" }} numberOfLines={1}>{pair.discount_label}</Text>
        </View>
      )}
      <View className="px-2 py-2">
        <Text className="text-cream/40 text-[8px]" style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 0.5 }} numberOfLines={1}>{pair.reason.toUpperCase()}</Text>
        <Text className="text-cream text-[12px] mt-0.5" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7} style={{ fontFamily: "Peachi-Medium", lineHeight: 15 }}>{pair.name}</Text>
        <View className="flex-row items-center justify-between mt-1.5">
          <Text className="text-amber-400 text-[12px]" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(pair.price_sen)}</Text>
          <View className="h-6 w-6 items-center justify-center rounded-lg" style={{ backgroundColor: BRAND }}>
            <Plus size={13} color="#fff" />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/** Cashier-side claim card — the register mirror of the customer display's
 *  ClaimCard. Tapping opens a pending Mystery Bag (or claims a promo) on the
 *  member's behalf and reveals the real outcome inline. Single source of truth:
 *  the same drop the customer display would have revealed. */
function RegisterClaimCard({ memberId, claimable }: { memberId: string; claimable: ClaimableCard }) {
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<MysteryReveal | null>(null);
  const mystery = claimable.source_type === "mystery_pending";
  async function onPress() {
    if (busy || revealed) return;
    Haptics.selectionAsync();
    setBusy(true);
    const out = mystery ? await claimMystery(memberId, claimable.id) : null;
    setRevealed(out ?? { outcome_type: "no_bonus", multiplier_value: null, flat_beans_value: null, label: "Reward unlocked", voucher_title: null, emoji: "🎁" });
    setBusy(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
  if (revealed) {
    const rlabel =
      revealed.outcome_type === "flat_beans" ? `+${revealed.flat_beans_value ?? 0} Points`
      : revealed.outcome_type === "beans_multiplier" ? `${revealed.multiplier_value ?? 2}× Points`
      : revealed.outcome_type === "voucher" ? (revealed.voucher_title ?? revealed.label)
      : revealed.label;
    const rsub = revealed.outcome_type === "no_bonus" ? "Better luck next time" : "Added to their rewards";
    return (
      <View className="flex-row items-center rounded-xl px-3 py-2" style={{ backgroundColor: "rgba(251,191,36,0.12)", borderWidth: 1, borderColor: "rgba(251,191,36,0.45)", gap: 9 }}>
        <Text style={{ fontSize: 20 }}>{revealed.emoji}</Text>
        <View className="flex-1">
          <Text style={{ fontFamily: "Peachi-Bold", fontSize: 13, color: "#FBBF24" }} numberOfLines={1}>{rlabel}</Text>
          <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 10, color: "rgba(245,243,240,0.6)" }} numberOfLines={1}>{rsub}</Text>
        </View>
      </View>
    );
  }
  return (
    <Pressable onPress={onPress} className="flex-row items-center rounded-xl px-3 py-2 active:opacity-80" style={{ backgroundColor: "rgba(251,191,36,0.10)", borderWidth: 1, borderColor: "rgba(251,191,36,0.40)", gap: 9 }}>
      <View className="h-8 w-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#FBBF24" }}>
        {mystery ? <Sparkles size={15} color="#160800" /> : <Gift size={15} color="#160800" />}
      </View>
      <View className="flex-1">
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 13, color: "#F5F3F0" }} numberOfLines={1}>{claimable.title}</Text>
        <Text style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 10, color: "#FBBF24" }} numberOfLines={1}>
          {busy ? "Opening…" : mystery ? "Tap to open the bag" : (claimable.cta_label || "Tap to claim")}
        </Text>
      </View>
      <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: "#FBBF24" }}>
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9, letterSpacing: 0.4, color: "#160800" }}>{mystery ? "OPEN" : "CLAIM"}</Text>
      </View>
    </Pressable>
  );
}

/** Cashier-side "redeem Beans" card — a points-shop reward the member can buy
 *  with their Beans. Tapping applies it to the cart (cashier redeems on the
 *  customer's request). Dimmed + non-tappable when they can't afford it yet. */
/** Where a voucher came from → the chip eyebrow (mirrors the customer display). */
function voucherSource(s: string | null): string {
  return s === "mystery" ? "Mystery Bag" : s === "mission" ? "Challenge" : s === "birthday" ? "Birthday" : s === "referral" ? "Referral" : s === "points_redemption" ? "Points" : "Reward";
}

/** Owned voucher in the REDEEM YOUR REWARDS row — green, labelled by source
 *  (MYSTERY BAG / BIRTHDAY / …), tap to apply it to the bill (no Points spent). */
function RegisterVoucherCard({ voucher, onUse }: { voucher: VoucherCard; onUse: () => void }) {
  return (
    <Pressable
      onPress={() => { Haptics.selectionAsync(); onUse(); }}
      className="flex-1 rounded-xl active:opacity-80"
      style={{ backgroundColor: "rgba(134,239,172,0.10)", borderWidth: 1, borderColor: "rgba(134,239,172,0.4)" }}
    >
      <View className="px-2.5 py-2">
        <View className="flex-row items-center" style={{ gap: 4 }}>
          <Gift size={10} color={OK} />
          <Text className="text-[9px]" style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 0.4, color: OK }} numberOfLines={1}>{voucherSource(voucher.source_type).toUpperCase()}</Text>
        </View>
        <Text className="text-cream text-[12px] mt-1" style={{ fontFamily: "Peachi-Medium" }} numberOfLines={2}>{voucher.title}</Text>
        <View className="self-start rounded-full mt-1.5 px-2.5 py-1" style={{ backgroundColor: OK }}>
          <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9, letterSpacing: 0.4, color: "#06301B" }}>USE</Text>
        </View>
      </View>
    </Pressable>
  );
}

function RegisterRedeemCard({ shop, onRedeem }: { shop: ShopCard; onRedeem: () => void }) {
  const aff = shop.affordable;
  return (
    <Pressable
      onPress={() => { if (!aff) return; Haptics.selectionAsync(); onRedeem(); }}
      disabled={!aff}
      className="flex-1 rounded-xl active:opacity-80"
      style={{ backgroundColor: aff ? "rgba(251,191,36,0.10)" : "rgba(245,243,240,0.04)", borderWidth: 1, borderColor: aff ? "rgba(251,191,36,0.4)" : "rgba(245,243,240,0.12)", opacity: aff ? 1 : 0.55 }}
    >
      <View className="px-2.5 py-2">
        <View className="flex-row items-center" style={{ gap: 4 }}>
          <Sparkles size={10} color="#FBBF24" />
          <Text className="text-amber-400 text-[9px]" style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 0.4 }}>{shop.points_required} POINTS</Text>
        </View>
        <Text className="text-cream text-[12px] mt-1" style={{ fontFamily: "Peachi-Medium" }} numberOfLines={2}>{shop.name}</Text>
        <View className="self-start rounded-full mt-1.5 px-2.5 py-1" style={{ backgroundColor: aff ? "#FBBF24" : "rgba(245,243,240,0.12)" }}>
          <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9, letterSpacing: 0.4, color: aff ? "#160800" : "rgba(245,243,240,0.5)" }}>{aff ? "REDEEM" : "LOCKED"}</Text>
        </View>
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

// ── Orders panel: channel filter + table detail + history row ──────
/** Channel filter chips for the live (Pickup & Grab) and History tabs —
 *  lets the counter isolate a channel while defaulting to "All". */
function ChannelFilter({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { key: string; label: string; dot: string | null; count: number }[];
}) {
  return (
    <View className="flex-row mb-4" style={{ gap: 8, flexWrap: "wrap" }}>
      {options.map((o) => {
        const on = value === o.key;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)}
            className={`flex-row items-center gap-2 px-4 py-2.5 rounded-xl border active:opacity-70 ${on ? "border-primary bg-primary/15" : "border-cream/12"}`}>
            {o.dot && <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: o.dot }} />}
            <Text className={on ? "text-cream text-sm" : "text-cream/60 text-sm"} style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{o.label}</Text>
            <View className="rounded-full px-1.5 min-w-[20px] items-center" style={{ backgroundColor: on ? "#C2452D" : "rgba(245,243,240,0.14)" }}>
              <Text className="text-cream text-[11px]" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{o.count}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Statuses where a QR self-order is already finished — no Done action; we
 *  show a static "Served" marker instead. */
const TABLE_ORDER_DONE_RE = /done|complete|served|cancel|refund|void|fail/i;

/** Detail card for a tapped table — its live order(s). This is the
 *  consolidated QR self-order view: instead of a separate tab, you tap the
 *  table on the floor plan to see what guests self-ordered on it. Each live
 *  QR self-order gets a Done button to mark it served (status → completed,
 *  which also advances the guest's order-tracker to "Served"). */
function TableOrdersDetail({ slot, busyId, onDone, onClose }: { slot: TableSlot; busyId: string | null; onDone: (order: TableOrderRef) => void; onClose: () => void }) {
  return (
    <View className="rounded-2xl border p-4 mb-3" style={{ borderColor: "rgba(251,191,36,0.4)", backgroundColor: "rgba(251,191,36,0.08)" }}>
      <View className="flex-row items-center justify-between mb-2.5">
        <Text className="text-cream text-base" style={{ fontFamily: "Peachi-Bold" }}>{slot.label} · {slot.orders.length} order{slot.orders.length === 1 ? "" : "s"}</Text>
        <Pressable onPress={onClose} className="active:opacity-60"><X size={18} color="rgba(245,243,240,0.7)" /></Pressable>
      </View>
      <View style={{ gap: 8 }}>
        {slot.orders.map((o) => {
          const done = TABLE_ORDER_DONE_RE.test(o.status);
          const busy = busyId === `qr:${o.id}`;
          return (
            <View key={o.id} className="flex-row items-center rounded-xl px-3 py-2.5" style={{ gap: 8, backgroundColor: "rgba(245,243,240,0.05)" }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: o.source === "qr" ? "#3B82F6" : "#FBBF24" }} />
              <Text className="text-cream text-sm flex-1" style={{ fontFamily: "SpaceGrotesk_700Bold" }} numberOfLines={1}>{o.orderNumber}</Text>
              <Text className="text-cream/45 text-[11px]" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                {new Date(o.createdAt).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: true })}
              </Text>
              <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: "rgba(245,243,240,0.08)" }}>
                <Text className="text-cream/70 text-[10px]" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{o.status}</Text>
              </View>
              <Text className="text-cream text-sm w-[68px] text-right" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(o.total)}</Text>
              {/* Done = mark this QR self-order served. Register orders (pos)
                  are already completed at ring-up, so only QR rows get it. */}
              {o.source === "qr" ? (
                done ? (
                  <View className="flex-row items-center justify-end" style={{ width: 104, gap: 4 }}>
                    <CheckCircle2 size={15} color="#22C55E" />
                    <Text className="text-[10px]" style={{ fontFamily: "SpaceGrotesk_700Bold", color: "#22C55E", letterSpacing: 0.4 }}>SERVED</Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => onDone(o)}
                    disabled={busy}
                    className="flex-row items-center justify-center rounded-full active:opacity-80"
                    style={{ width: 104, paddingVertical: 8, gap: 5, backgroundColor: "#22C55E", opacity: busy ? 0.6 : 1 }}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color="#0A2A12" />
                    ) : (
                      <>
                        <CheckCircle2 size={15} color="#0A2A12" />
                        <Text className="text-[11px]" style={{ fontFamily: "SpaceGrotesk_700Bold", color: "#0A2A12", letterSpacing: 0.4 }}>DONE</Text>
                      </>
                    )}
                  </Pressable>
                )
              ) : (
                <View style={{ width: 104 }} />
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** History channels — label + dot colour, shared by the filter chips and the
 *  rows. Order = how they appear in the filter. */
const HIST_CHANNELS: { key: HistoryChannel; label: string; dot: string }[] = [
  { key: "dine_in", label: "Dine in", dot: "#FBBF24" },
  { key: "takeaway", label: "Takeaway", dot: "#F97316" },
  { key: "qr_table", label: "QR table", dot: "#3B82F6" },
  { key: "grab", label: "Grab", dot: "#22C55E" },
  { key: "pickup", label: "Pickup", dot: "#2DD4BF" },
];

/** One row in the History tab. Tap to expand the receipt's line items so the
 *  counter can double-check exactly what was rung up. */
function HistoryRow({ order }: { order: HistoryOrder }) {
  const [open, setOpen] = useState(false);
  const meta = HIST_CHANNELS.find((c) => c.key === order.channel);
  const dot = meta?.dot ?? "#FBBF24";
  const chan = meta?.label ?? order.channel;
  const voided = /cancel|refund|void|fail/i.test(order.status);
  return (
    <Pressable onPress={() => { Haptics.selectionAsync(); setOpen((v) => !v); }} className="rounded-2xl border border-border active:opacity-80" style={{ backgroundColor: "rgba(245,243,240,0.03)" }}>
      <View className="flex-row items-center px-4 py-3" style={{ gap: 10 }}>
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: dot }} />
        <View className="flex-1">
          <Text className="text-cream text-sm" style={{ fontFamily: "Peachi-Bold" }} numberOfLines={1}>{order.orderNumber}</Text>
          <Text className="text-cream/45 text-[11px]" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
            {chan}{order.tableNumber ? ` · Table ${order.tableNumber}` : ""} · {new Date(order.createdAt).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: true })} · {order.items.length} item{order.items.length === 1 ? "" : "s"}
          </Text>
        </View>
        {voided && (
          <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: "rgba(239,68,68,0.18)" }}>
            <Text className="text-[10px]" style={{ fontFamily: "SpaceGrotesk_700Bold", color: "#FCA5A5" }}>{order.status}</Text>
          </View>
        )}
        <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(order.total)}</Text>
      </View>
      {open && order.items.length > 0 && (
        <View className="px-4 pb-3" style={{ gap: 4, borderTopWidth: 1, borderColor: "rgba(245,243,240,0.06)", paddingTop: 8 }}>
          {order.items.map((it, i) => (
            <Text key={i} className="text-cream/70 text-xs" style={{ fontFamily: "SpaceGrotesk_500Medium" }} numberOfLines={1}>
              {it.qty}× {it.name}{it.variant ? ` · ${it.variant}` : ""}
            </Text>
          ))}
        </View>
      )}
    </Pressable>
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
  onToggleTakeaway,
}: {
  line: CartLine;
  onClose: () => void;
  onInc: () => void;
  onDec: () => void;
  onRemove: () => void;
  onSetDiscount: (sen: number) => void;
  onSetNote: (note: string) => void;
  onToggleTakeaway: (takeaway: boolean) => void;
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
            <Text className="text-cream text-xl" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7} style={{ fontFamily: "Peachi-Bold", lineHeight: 26 }}>{line.product.name}</Text>
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

        {/* Takeaway — pack this one item to-go even on a dine-in order, so a
            single bill can mix dine-in + takeaway (the to-go items get a cup +
            lid; the kitchen docket tags each line). */}
        <View className="flex-row items-center justify-between rounded-2xl px-4 py-3" style={{ backgroundColor: line.takeaway ? "rgba(249,115,22,0.12)" : "rgba(245,243,240,0.04)", borderWidth: 1, borderColor: line.takeaway ? "rgba(249,115,22,0.45)" : "rgba(245,243,240,0.10)" }}>
          <View>
            <Text className="text-cream/60 text-xs uppercase tracking-widest" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>Takeaway</Text>
            <Text className="text-cream/40 text-[11px] mt-0.5" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>Pack this item for takeaway</Text>
          </View>
          <Pressable onPress={() => { Haptics.selectionAsync(); onToggleTakeaway(!line.takeaway); }} className="rounded-full active:opacity-80" style={{ width: 58, height: 32, padding: 3, justifyContent: "center", backgroundColor: line.takeaway ? "#F97316" : "rgba(245,243,240,0.16)" }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: "#fff", transform: [{ translateX: line.takeaway ? 26 : 0 }] }} />
          </Pressable>
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
  // Single-word labels stay on ONE line (shrink to fit so "Sandwiches" never
  // breaks to "Sandwiche / s"); genuine two-word labels may wrap to two lines.
  const oneWord = !label.trim().includes(" ");
  return (
    <Pressable onPress={onPress} className="rounded-lg px-1.5 items-center justify-center active:opacity-90" style={{ width, height: 44, backgroundColor: color, opacity: active ? 1 : 0.6, borderWidth: 2, borderColor: active ? "rgba(255,255,255,0.85)" : "transparent" }}>
      <Text className="text-white text-center" numberOfLines={oneWord ? 1 : 2} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 12.5, lineHeight: 15 }}>{label}</Text>
    </Pressable>
  );
}

// imageHeight: null = square image (default for category tabs); a number sets a
// fixed image height (All-tab compact mode); 0 = no image (text-only card).
function ProductTile({ product, width, imageHeight = null, onPress, onLongPress }: { product: Product; width: number; imageHeight?: number | null; onPress: () => void; onLongPress?: () => void }) {
  const oos = product.available === false;
  const showImage = imageHeight === null || imageHeight > 0;
  // McD-style: in the compact All-tab layout, colour-code every tile by its
  // category (a top stripe, thicker when the image is off) so the dense grid
  // is scannable by colour block — like the McDonald's NCR registers.
  const accent = imageHeight === null ? null : catColor(product.category, 0);
  const compact = imageHeight !== null; // All-tab mode — name only, no price
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={350} className="rounded-2xl overflow-hidden border border-border active:opacity-70" style={{ width, backgroundColor: "rgba(245,243,240,0.04)", opacity: oos && !showImage ? 0.55 : 1 }}>
      {accent && <View style={{ height: showImage ? 9 : 16, backgroundColor: accent }} />}
      {showImage && (
        <View className={imageHeight === null ? "aspect-square w-full bg-cream/5" : "w-full bg-cream/5"} style={imageHeight === null ? undefined : { height: imageHeight }}>
          {product.image_url ? <Image source={{ uri: product.image_url }} className="w-full h-full" resizeMode="cover" style={oos ? { opacity: 0.35 } : undefined} /> : null}
          {oos && (
            <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(22,8,0,0.5)" }}>
              <View style={{ backgroundColor: "#E5484D", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10, color: "#fff", letterSpacing: 0.4 }}>OUT OF STOCK</Text>
              </View>
            </View>
          )}
        </View>
      )}
      <View className="px-2 py-2">
        {/* Reserve 2 lines for the name (non-compact) so a 1-line name and a
            2-line name leave the price at the same height across the row. */}
        <Text className="text-cream" numberOfLines={compact ? undefined : 2} adjustsFontSizeToFit minimumFontScale={0.65} style={{ fontFamily: "Peachi-Medium", fontSize: compact ? 11 : 12, lineHeight: compact ? 13.5 : 15, minHeight: compact ? undefined : 30, opacity: oos ? 0.5 : 1 }}>{product.name}{compact && oos ? "  · 86" : ""}</Text>
        {!compact && (
          <Text className="text-amber-400 text-[12px] mt-0.5" style={{ fontFamily: "SpaceGrotesk_700Bold", opacity: oos ? 0.5 : 1 }}>{rm(product.price_sen)}</Text>
        )}
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
  secure = false, maxLength, className, style, onDone, autoOpen = false, onClose,
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
  autoOpen?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Auto-pop the keypad the instant the field mounts — pressing "Stand" /
  // "Customer" opens straight onto the numpad, no extra tap on the field.
  useEffect(() => { if (autoOpen) setOpen(true); }, [autoOpen]);
  const display = value ? (secure ? "•".repeat(value.length) : `${prefix}${value}`) : "";
  function press(k: string) {
    Haptics.selectionAsync();
    if (k === "←") return onChangeText(value.slice(0, -1));
    if (k === "C") return onChangeText("");
    if (k === ".") { if (mode !== "decimal" || value.includes(".")) return; return onChangeText((value || "0") + "."); }
    if (maxLength && value.replace(".", "").length >= maxLength) return;
    // Integer mode (phone, stand) keeps leading zeros — "0123…" is a real phone
    // number. Decimal mode (amounts) still collapses a lone leading 0.
    onChangeText(mode === "integer" ? value + k : value === "0" ? k : value + k);
  }
  return (
    <>
      <Pressable onPress={() => setOpen(true)} className={className} style={[{ justifyContent: "center" }, style]}>
        <Text numberOfLines={1} style={{ color: value ? "#F5F3F0" : "rgba(245,243,240,0.35)", fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 15 }}>
          {display || placeholder || ""}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => { setOpen(false); onClose?.(); }}>
        <View className="flex-1 bg-black/70 items-center justify-center px-8">
          <Pressable onPress={() => { setOpen(false); onClose?.(); }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
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
                  <Text className="text-cream" style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: k === "C" ? 18 : 24 }}>{k === "C" ? "Clear" : k}</Text>
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
