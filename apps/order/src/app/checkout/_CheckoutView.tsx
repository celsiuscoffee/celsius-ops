"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, Check, Gift } from "lucide-react";
import { StripePaymentForm } from "@/components/stripe-payment-form";
import { PaymentBrandIcon } from "./_PaymentBrandIcon";
import { calcRewardDiscount, type AppliedReward } from "@/lib/reward-discount";
import {
  clearDineInCart, setPendingOrder, getPendingOrder, clearPendingOrder, getDineInContext,
} from "@/lib/checkout-session";

type CartItem = {
  cartId: string;
  productId: string;
  name: string;
  basePrice: number;
  quantity: number;
  totalPrice: number;
  modifiers: Array<{ groupId: string; groupName: string; optionId: string; label: string; priceDelta: number }>;
  specialInstructions?: string;
};

type Persisted = {
  state?: {
    cart?: CartItem[];
    outletId?: string | null;
    outletName?: string | null;
    phone?: string | null;
    loyaltyId?: string | null;
    appliedReward?: AppliedReward | null;
    orderType?: "pickup" | "dine_in" | null;
    tableNumber?: string | null;
  };
};

type Tier = {
  tier_id: string;
  tier_name: string;
  tier_multiplier: number;
  tier_color?: string | null;
};

type GatewayMethodRow = {
  method_id: string;
  enabled: boolean;
  provider: "stripe" | "revenue_monster";
};
type GatewayConfig = { paymentsEnabled: boolean; methods: GatewayMethodRow[] };

// Display labels per method_id. WHICH methods are shown + their gateway
// routing come from /api/payments/gateway-config (the same source the native
// pickup app reads). Brand icons are rendered by <PaymentBrandIcon> (a port
// of the native component) so web + native show identical chips. The grouped
// layout (Card · Apple/Google Pay · E-Wallet · Online Banking) mirrors
// apps/pickup-native/app/checkout.tsx.
const METHOD_DISPLAY: Record<string, { label: string; subtitle?: string }> = {
  fpx:        { label: "Online Banking", subtitle: "FPX" },
  tng:        { label: "Touch 'n Go" },
  boost:      { label: "Boost" },
  shopeepay:  { label: "ShopeePay" },
  grabpay:    { label: "GrabPay" },
  duitnow:    { label: "DuitNow" },
  card:       { label: "Credit / Debit Card" },
  apple_pay:  { label: "Apple Pay" },
  google_pay: { label: "Google Pay" },
};

// Wallet method ids collapsed under the single "E-Wallet" category row —
// same grouping native uses. Display order follows the gateway config.
const WALLET_IDS = ["tng", "boost", "shopeepay", "grabpay", "duitnow"];

// One row of the grouped payment picker — radio · title/subtitle · brand
// chip · optional chevron for the expandable E-Wallet category. Port of the
// native CategoryRow (apps/pickup-native/app/checkout.tsx).
function MethodRow({
  selected,
  onClick,
  title,
  subtitle,
  iconMethodId,
  expandable = false,
  expanded = false,
  hasDivider = false,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
  iconMethodId: string;
  expandable?: boolean;
  expanded?: boolean;
  hasDivider?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center text-left active:opacity-80"
      style={{
        backgroundColor: "#FFFFFF",
        gap: 12,
        padding: 16,
        borderTop: hasDivider ? "1px solid rgba(26,2,0,0.08)" : undefined,
      }}
    >
      <span
        className="flex-shrink-0 flex items-center justify-center"
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          borderWidth: 2,
          borderStyle: "solid",
          borderColor: selected ? "#A2492C" : "#D6CCC2",
          backgroundColor: selected ? "#A2492C" : "transparent",
        }}
      >
        {selected ? (
          <span style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFFFFF" }} />
        ) : null}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block truncate" style={{ color: "#1A0200", fontSize: 15, fontWeight: 700 }}>
          {title}
        </span>
        {subtitle ? (
          <span
            className="block truncate"
            style={{ color: "#6B6B6B", fontSize: 12, marginTop: 2, fontWeight: 500 }}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
      <PaymentBrandIcon methodId={iconMethodId} size={36} />
      <span style={{ width: 16, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        {expandable ? (
          <ChevronDown
            size={16}
            color="#8E8E93"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 150ms" }}
          />
        ) : null}
      </span>
    </button>
  );
}

function readState(): Persisted["state"] {
  try {
    const raw = window.localStorage.getItem("celsius-pickup");
    if (!raw) return {};
    return (JSON.parse(raw) as Persisted).state ?? {};
  } catch {
    return {};
  }
}

export function CheckoutView() {
  const router = useRouter();
  const [state, setState] = useState<NonNullable<Persisted["state"]> | null>(null);
  const [method, setMethod] = useState("card");
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stripeContext, setStripeContext] = useState<{ orderId: string; clientSecret: string } | null>(null);
  const [confirmFn, setConfirmFn] = useState<(() => Promise<{ error?: { message?: string } }>) | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [tier, setTier] = useState<Tier | null>(null);
  const [gateway, setGateway] = useState<GatewayConfig | null>(null);
  // Whether the E-Wallet category row is expanded into its sub-picker.
  const [ewalletExpanded, setEwalletExpanded] = useState(false);
  // A still-`pending` order from a prior attempt → offer "Resume payment"
  // instead of silently letting them re-submit (set by the reconcile effect).
  const [resumeOrderId, setResumeOrderId] = useState<string | null>(null);

  // Bring the inline payment sheet into view once it renders — the wallet/card
  // form appears below the fold after "Place order", so without this it can
  // look like nothing happened (the "press pay, nothing" confusion).
  useEffect(() => {
    if (!stripeContext) return;
    const t = setTimeout(() => {
      document.getElementById("stripe-pay-section")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => clearTimeout(t);
  }, [stripeContext]);

  useEffect(() => {
    const s = readState() ?? {};
    // Table-QR only. Dine-in is sourced from its OWN key, not the shared
    // "celsius-pickup" blob — the blob's orderType/tableNumber get stripped
    // between the table-QR landing and here (multiple writers + the Expo
    // store's partialize), which is why scanned table orders were arriving as
    // pickup. A fresh dine-in context for THIS outlet is REQUIRED: without one
    // the visitor reached checkout without scanning a table (the retired
    // pickup path), so funnel to the scan wall instead of rendering a pickup
    // checkout that only dead-ends at the server guard.
    const dine = getDineInContext();
    if (!dine || dine.outletId !== s.outletId) {
      router.replace("/scan");
      return;
    }
    s.orderType = "dine_in";
    s.tableNumber = dine.tableNumber;
    setState(s);
  }, [router]);

  // Reconcile a leftover pending order on entry. If we came back to checkout
  // with an order that ALREADY went through (paid on the gateway, then tapped
  // back), clear the cart so the same basket can't be charged twice. A
  // failed/cancelled one just frees the breadcrumb — the cart stays so "place
  // again" works. A still-pending one surfaces a Resume link.
  useEffect(() => {
    const pending = getPendingOrder();
    if (!pending) return;
    if (Date.now() - pending.ts > 30 * 60 * 1000) { clearPendingOrder(); return; }
    let cancelled = false;
    fetch(`/api/orders/${pending.orderId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const o = (d.order ?? d) as { status?: string } | null;
        const st = String(o?.status ?? "").toLowerCase();
        if (["preparing", "paid", "ready", "completed", "collected"].includes(st)) {
          clearDineInCart();          // succeeded → don't re-order this basket
          setState(readState() ?? {}); // reflect the now-empty cart
        } else if (st === "failed" || st === "cancelled") {
          clearPendingOrder();         // free it; keep the cart for a retry
        } else {
          setResumeOrderId(pending.orderId); // still pending → offer resume
        }
      })
      .catch(() => { /* leave as-is; a stale breadcrumb is harmless */ });
    return () => { cancelled = true; };
  }, []);

  // Same earn-preview line as apps/pickup-native/app/checkout.tsx —
  // pull tier so we can show "{tier_name} · earning {multiplier}× = +{X} pts".
  useEffect(() => {
    const loyaltyId = state?.loyaltyId;
    if (!loyaltyId) {
      setTier(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/loyalty/member-tier?member_id=${encodeURIComponent(loyaltyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data && data.tier_id) setTier(data as Tier);
        else setTier(null);
      })
      .catch(() => !cancelled && setTier(null));
    return () => {
      cancelled = true;
    };
  }, [state?.loyaltyId]);

  // Fetch the same gateway-config the native pickup app uses, so the web
  // PWA shows + routes the identical set of payment methods.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/payments/gateway-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setGateway(d as GatewayConfig);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const subtotal = useMemo(
    () => (state?.cart ?? []).reduce((s, i) => s + i.totalPrice, 0),
    [state],
  );

  const reward = state?.appliedReward ?? null;
  const rewardDiscount = useMemo(
    () =>
      Math.min(
        calcRewardDiscount(
          reward,
          (state?.cart ?? []).map((i) => ({
            productId: i.productId,
            basePrice: i.basePrice,
            totalPrice: i.totalPrice,
            quantity: i.quantity,
          })),
          subtotal,
        ),
        subtotal,
      ),
    [reward, state, subtotal],
  );
  const rewardDiscountSen = Math.round(rewardDiscount * 100);

  // Server price preview — promo-engine discounts + SST + final total,
  // computed by /api/checkout/quote with the SAME math the order is
  // created with, so the breakdown matches the amount charged.
  const [quote, setQuote] = useState<{
    promoLines: Array<{ name: string; amountSen: number }>;
    promoDiscountSen: number;
    rewardDiscountSen: number;
    firstOrderDiscountSen: number;
    sstSen: number;
    totalSen: number;
    pointsToEarn: number;
  } | null>(null);

  useEffect(() => {
    const cartItems = state?.cart ?? [];
    if (cartItems.length === 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    fetch("/api/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: cartItems.map((i) => ({ product: { id: i.productId }, quantity: i.quantity })),
        storeId: state?.outletId ?? null,
        loyaltyPhone: state?.phone ?? null,
        loyaltyId: state?.loyaltyId ?? null,
        // Channel (dine_in → qr_table etc.) so channel-scoped promos preview
        // the same way they'll apply at checkout.
        orderType: state?.orderType ?? null,
        // Send the reward ids so the server resolves the discount
        // authoritatively (the client can't compute free_item/category
        // rewards — its cart lines have no category). rewardDiscountSen is a
        // fallback for legacy/unresolvable cases.
        rewardId: reward?.id ?? null,
        walletVoucherId: reward?.voucher_id ?? null,
        rewardDiscountSen,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setQuote(d);
      })
      .catch(() => !cancelled && setQuote(null));
    return () => {
      cancelled = true;
    };
  }, [state, rewardDiscountSen, reward?.id, reward?.voucher_id]);

  // Use the server quote's total when present; fall back to the
  // client subtotal-minus-reward while it loads.
  const grandTotal = quote ? quote.totalSen / 100 : Math.max(0, subtotal - rewardDiscount);
  // The reward deduction shown is the server quote's authoritative value (it
  // resolves free_item / category-filtered rewards the client can't preview);
  // fall back to the client estimate only while the quote is in flight.
  const rewardDiscountShown = quote ? quote.rewardDiscountSen / 100 : rewardDiscount;

  // Payment tiles + routing follow /api/payments/gateway-config — the same
  // source the native pickup app uses — so web and native offer/route the
  // identical method set. Falls back to card/FPX/GrabPay until it loads so
  // checkout is never empty. Apple Pay shows only where the device supports
  // it; on Apple devices we prefer Apple Pay over Google Pay (like native).
  const visibleMethods = useMemo(() => {
    const supportsApplePay =
      typeof window !== "undefined" &&
      !!(window as unknown as { ApplePaySession?: unknown }).ApplePaySession;
    const ids =
      gateway && gateway.methods.length > 0
        ? gateway.methods.filter((m) => m.enabled).map((m) => m.method_id)
        : ["card", "fpx", "grabpay"];
    return ids
      .filter((id) =>
        id === "apple_pay" ? supportsApplePay : id === "google_pay" ? !supportsApplePay : true,
      )
      .map((id) => {
        const d = METHOD_DISPLAY[id] ?? { label: id };
        return { id, label: d.label, subtitle: d.subtitle };
      });
  }, [gateway]);

  const paymentsOff = gateway != null && gateway.paymentsEnabled === false;

  // Keep the selected method valid as the available set resolves.
  useEffect(() => {
    if (visibleMethods.length === 0) return;
    if (!visibleMethods.some((m) => m.id === method)) setMethod(visibleMethods[0].id);
  }, [visibleMethods, method]);

  if (!state) {
    return <div className="p-8 text-center text-[#8E8E93]">Loading…</div>;
  }

  const cart = state.cart ?? [];
  if (cart.length === 0) {
    // Keep a dine-in customer in their table session — /menu carries the
    // dine-in context forward, so don't word it as "pickup".
    const dineCtx = getDineInContext();
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-[#8E8E93]">Your cart is empty.</p>
        <Link
          href="/menu"
          className="mt-4 inline-block rounded-full bg-[#A2492C] text-white px-5 py-3 font-bold active:opacity-80"
        >
          {dineCtx ? `Back to Table ${dineCtx.tableNumber} menu →` : "Browse menu →"}
        </Link>
      </div>
    );
  }

  const placeOrder = async () => {
    setError(null);
    setPlacing(true);
    try {
      const res = await fetch("/api/checkout/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((i) => ({
            product:   { id: i.productId, name: i.name },
            modifiers: { selections: i.modifiers ?? [], specialInstructions: i.specialInstructions },
            quantity:  i.quantity,
            totalPrice: i.totalPrice,
          })),
          // The route requires `selectedStore` (with .id) — sending a
          // bare `storeId` string 400s with "Invalid order data".
          // `total` is the pre-discount subtotal in RM; the server
          // applies the reward discount + SST itself.
          selectedStore: { id: state.outletId, name: state.outletName ?? undefined },
          total: subtotal,
          paymentMethod: method,
          loyaltyPhone: state.phone ?? null,
          loyaltyId:    state.loyaltyId ?? null,
          // Table-QR only — the load guard redirects anyone without a fresh
          // dine-in context to /scan, so every order from here is dine-in.
          orderType:    "dine_in",
          tableNumber:  state.tableNumber ?? null,
          // Forward the applied reward so the server actually discounts
          // the order (otherwise the customer is charged full price).
          rewardId:          reward?.id ?? null,
          rewardName:        reward?.name ?? null,
          rewardPointsCost:  reward?.points_required ?? 0,
          rewardDiscountSen: Math.round(rewardDiscount * 100),
          voucherId:         reward?.voucher_id ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to start payment");
      }
      // Order now exists server-side but is only `pending` — payment hasn't
      // happened. DON'T clear the cart here: a customer who bails on the
      // gateway page and taps back would otherwise land on an empty checkout
      // and couldn't "place the order again" (the order page's retry path).
      // Instead remember the order id; the cart is cleared only once payment is
      // CONFIRMED (order page, inline-Stripe success, or free order). A
      // duplicate submit is guarded on mount — a still-paid pending order
      // clears the cart there.
      setPendingOrder(data.orderId);
      // RM / hosted-page path → full redirect to the gateway.
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
        return;
      }
      if (data.clientSecret) {
        // Stripe path — render Stripe Elements inline so the customer can
        // confirm without leaving the PWA. The inline form calls
        // /api/orders/[id]/confirm-stripe on success then redirects to the
        // order page (where the cart is cleared). Reset `placing` so the UI
        // isn't stuck on "Placing order…" behind the payment sheet.
        setPlacing(false);
        setStripeContext({ orderId: data.orderId, clientSecret: data.clientSecret });
        return;
      }
      if (data.freeOrder) {
        // RM0 order is already `preparing` (paid by reward) — safe to clear.
        clearDineInCart();
        window.location.href = `/order/${data.orderId}`;
        return;
      }
      throw new Error("Unknown payment response");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPlacing(false);
    }
  };

  // Group the available methods into the native-style categories: Card ·
  // device wallets · E-Wallet (expandable sub-picker) · Online Banking.
  // Availability + order follow /api/payments/gateway-config.
  const cardMethod = visibleMethods.find((m) => m.id === "card");
  const applePayMethod = visibleMethods.find((m) => m.id === "apple_pay");
  const googlePayMethod = visibleMethods.find((m) => m.id === "google_pay");
  const walletMethods = visibleMethods.filter((m) => WALLET_IDS.includes(m.id));
  const fpxMethod = visibleMethods.find((m) => m.id === "fpx");
  const selectedWallet = walletMethods.find((w) => w.id === method) ?? null;

  return (
    <>
      <header
        className="bg-[#160800] text-white px-4 pb-3 flex items-center gap-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link href="/cart" className="-ml-1 p-1 active:opacity-60" aria-label="Back to cart">
          <ArrowLeft size={20} color="#FFFFFF" />
        </Link>
        <h1 className="font-peachi font-bold text-[22px]">Checkout</h1>
      </header>

      {resumeOrderId ? (
        <Link
          href={`/order/${resumeOrderId}`}
          className="mx-4 mt-3 flex items-center justify-between rounded-2xl px-4 py-3 active:opacity-80"
          style={{ backgroundColor: "#FFF7ED", border: "1px solid rgba(162,73,44,0.30)" }}
        >
          <span className="text-[13px] font-semibold" style={{ color: "#A2492C" }}>
            You have a payment in progress — finish it
          </span>
          <span className="text-[13px] font-bold" style={{ color: "#A2492C" }}>Resume →</span>
        </Link>
      ) : null}

      <section className="px-4 pt-4">
        <div
          className="bg-white"
          style={{
            border: "1px solid rgba(26,2,0,0.10)",
            borderRadius: 16,
            padding: 16,
          }}
        >
          <p
            className="uppercase"
            style={{ color: "#6B6B6B", fontSize: 10, fontWeight: 700, letterSpacing: 1.4 }}
          >
            Dine-in
          </p>
          <p
            className="font-peachi font-bold truncate"
            style={{ color: "#1A0200", fontSize: 15, marginTop: 4 }}
          >
            {`Table ${state.tableNumber ?? ""} · ${state.outletName ?? ""}`.trim()}
          </p>
        </div>
      </section>

      <section className="px-4 pt-3">
        <div
          className="bg-white"
          style={{
            border: "1px solid rgba(26,2,0,0.10)",
            borderRadius: 16,
            padding: 16,
          }}
        >
          <p
            className="uppercase"
            style={{ color: "#6B6B6B", fontSize: 10, fontWeight: 700, letterSpacing: 1.4 }}
          >
            Order
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {cart.map((i) => (
              <li key={i.cartId} className="flex items-baseline gap-3 text-sm">
                <span className="font-peachi font-bold w-6" style={{ color: "#1A0200" }}>
                  {i.quantity}×
                </span>
                <span className="flex-1 truncate" style={{ color: "#1A0200" }}>
                  {i.name}
                </span>
                <span className="font-peachi font-bold" style={{ color: "#1A0200" }}>
                  RM{i.totalPrice.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-4 pt-5">
        <p
          className="uppercase"
          style={{ color: "#6B6B6B", fontSize: 10, fontWeight: 700, letterSpacing: 1.4, marginBottom: 8 }}
        >
          Payment method
        </p>
        <div
          className="bg-white"
          style={{ border: "1px solid rgba(26,2,0,0.10)", borderRadius: 16, overflow: "hidden" }}
        >
          {cardMethod ? (
            <MethodRow
              selected={method === "card"}
              onClick={() => {
                setMethod("card");
                setEwalletExpanded(false);
              }}
              title="Credit / Debit Card"
              iconMethodId="card"
            />
          ) : null}

          {applePayMethod ? (
            <MethodRow
              selected={method === "apple_pay"}
              onClick={() => {
                setMethod("apple_pay");
                setEwalletExpanded(false);
              }}
              title="Apple Pay"
              iconMethodId="apple_pay"
              hasDivider={!!cardMethod}
            />
          ) : null}

          {googlePayMethod ? (
            <MethodRow
              selected={method === "google_pay"}
              onClick={() => {
                setMethod("google_pay");
                setEwalletExpanded(false);
              }}
              title="Google Pay"
              iconMethodId="google_pay"
              hasDivider={!!(cardMethod || applePayMethod)}
            />
          ) : null}

          {walletMethods.length > 0 ? (
            <>
              {/* E-Wallet — one category row that expands an inline dropdown
                  sub-picker (TnG / Boost / ShopeePay / GrabPay). Native opens a
                  bottom sheet; on web the dropdown reads the same and keeps the
                  PWA on a single surface. The group row shows the chosen
                  wallet's icon + name once one is picked. */}
              <MethodRow
                selected={!!selectedWallet}
                onClick={() => setEwalletExpanded((v) => !v)}
                title="E-Wallet"
                subtitle={selectedWallet?.label}
                iconMethodId={selectedWallet ? selectedWallet.id : "ewallet"}
                expandable
                expanded={ewalletExpanded}
                hasDivider={!!(cardMethod || applePayMethod || googlePayMethod)}
              />
              {ewalletExpanded ? (
                <div style={{ backgroundColor: "#FBFAF8", borderTop: "1px solid rgba(26,2,0,0.06)" }}>
                  {walletMethods.map((w, i) => {
                    const picked = method === w.id;
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => {
                          setMethod(w.id);
                          setEwalletExpanded(false);
                        }}
                        className="w-full flex items-center text-left active:opacity-80"
                        style={{
                          gap: 12,
                          paddingLeft: 48,
                          paddingRight: 16,
                          paddingTop: 12,
                          paddingBottom: 12,
                          borderTop: i > 0 ? "1px solid rgba(26,2,0,0.05)" : undefined,
                          backgroundColor: "transparent",
                        }}
                      >
                        <PaymentBrandIcon methodId={w.id} size={32} />
                        <span
                          className="flex-1 min-w-0 truncate"
                          style={{ color: "#1A0200", fontSize: 14, fontWeight: 700 }}
                        >
                          {w.label}
                        </span>
                        {picked ? <Check size={18} color="#A2492C" strokeWidth={2.5} /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : null}

          {fpxMethod ? (
            <MethodRow
              selected={method === "fpx"}
              onClick={() => {
                setMethod("fpx");
                setEwalletExpanded(false);
              }}
              title="Online Banking"
              subtitle="FPX"
              iconMethodId="fpx"
              hasDivider={!!(cardMethod || applePayMethod || googlePayMethod || walletMethods.length > 0)}
            />
          ) : null}
        </div>
      </section>

      <section className="px-4 pt-4">
        <div
          className="bg-white"
          style={{
            border: "1px solid rgba(26,2,0,0.10)",
            borderRadius: 16,
            padding: 16,
          }}
        >
        <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
          <span className="text-[13px]" style={{ color: "#6B6B6B" }}>Subtotal</span>
          <span className="text-[14px]" style={{ color: "#1A0200", fontWeight: 500 }}>
            RM{subtotal.toFixed(2)}
          </span>
        </div>
        {!reward ? (
          <Link
            href="/rewards?next=checkout"
            className="flex items-center gap-2 active:opacity-70"
            style={{ marginBottom: 6 }}
          >
            <Gift size={15} color="#A2492C" strokeWidth={1.9} />
            <span className="text-[13px]" style={{ color: "#A2492C", fontWeight: 600 }}>
              Add a reward
            </span>
          </Link>
        ) : null}
        {rewardDiscountShown > 0 ? (
          <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <span className="text-[13px] truncate" style={{ color: "#A2492C" }}>
              Reward{reward?.name ? ` · ${reward.name}` : ""}
            </span>
            <span className="text-[14px]" style={{ color: "#A2492C", fontWeight: 500 }}>
              −RM{rewardDiscountShown.toFixed(2)}
            </span>
          </div>
        ) : null}
        {(quote?.promoLines ?? []).map((p, i) => (
          <div key={i} className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <span className="text-[13px] truncate pr-2" style={{ color: "#A2492C" }}>
              {p.name}
            </span>
            <span className="text-[14px]" style={{ color: "#A2492C", fontWeight: 500 }}>
              −RM{(p.amountSen / 100).toFixed(2)}
            </span>
          </div>
        ))}
        {quote && quote.firstOrderDiscountSen > 0 ? (
          <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <span className="text-[13px]" style={{ color: "#A2492C" }}>First-order discount</span>
            <span className="text-[14px]" style={{ color: "#A2492C", fontWeight: 500 }}>
              −RM{(quote.firstOrderDiscountSen / 100).toFixed(2)}
            </span>
          </div>
        ) : null}
        {quote && quote.sstSen > 0 ? (
          <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <span className="text-[13px]" style={{ color: "#6B6B6B" }}>SST</span>
            <span className="text-[14px]" style={{ color: "#1A0200", fontWeight: 500 }}>
              RM{(quote.sstSen / 100).toFixed(2)}
            </span>
          </div>
        ) : null}
        <div className="flex items-center justify-between pt-3 border-t border-[rgba(26,2,0,0.10)]">
          <span className="font-peachi font-bold" style={{ color: "#1A0200", fontSize: 15 }}>
            Total
          </span>
          <span className="font-peachi font-bold" style={{ color: "#1A0200", fontSize: 18 }}>
            RM{grandTotal.toFixed(2)}
          </span>
        </div>
        {tier ? (
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[12px] truncate" style={{ color: "#6B6B6B" }}>
              {tier.tier_name}{(tier.tier_multiplier ?? 1) > 1 ? ` · earning ${tier.tier_multiplier}×` : ""}
            </span>
            <span
              className="text-[12px] font-bold"
              style={{ color: tier.tier_color ?? "#92400e" }}
            >
              +{quote ? quote.pointsToEarn : Math.round(grandTotal * (tier.tier_multiplier ?? 1))} pts
            </span>
          </div>
        ) : null}
        </div>
      </section>

      {stripeContext ? (
        <section id="stripe-pay-section" className="mt-4 px-4">
          <h2 className="font-peachi font-bold text-[16px] mb-3">Payment details</h2>
          <StripePaymentForm
            clientSecret={stripeContext.clientSecret}
            paymentMethod={method}
            orderId={stripeContext.orderId}
            onReady={(fn) => setConfirmFn(() => fn)}
          />
        </section>
      ) : null}

      {error ? (
        <p className="px-4 pt-3 text-[12px] text-red-600">{error}</p>
      ) : null}

      <div className="mt-5 px-4">
        {stripeContext ? (
          <button
            type="button"
            disabled={!confirmFn || confirming}
            onClick={async () => {
              if (!confirmFn) return;
              setConfirming(true);
              setError(null);
              const r = await confirmFn();
              if (r.error) {
                setError(r.error.message ?? "Payment failed");
                setConfirming(false);
                return;
              }
              // Payment confirmed → now it's safe to clear the cart.
              clearDineInCart();
              window.location.href = `/order/${stripeContext.orderId}?payment=done`;
            }}
            className={`block w-full rounded-full text-white text-center py-4 font-bold active:opacity-80 ${
              !confirmFn || confirming ? "bg-[#A2492C]/40" : "bg-[#A2492C]"
            }`}
          >
            {confirming ? "Confirming payment…" : `Pay RM${grandTotal.toFixed(2)}`}
          </button>
        ) : (
        <button
          type="button"
          disabled={placing || !state.outletId || paymentsOff}
          onClick={placeOrder}
          className={`block w-full rounded-full text-white text-center py-4 font-bold active:opacity-80 ${
            placing || !state.outletId || paymentsOff ? "bg-[#A2492C]/40" : "bg-[#A2492C]"
          }`}
        >
          {placing ? "Placing order…" : paymentsOff ? "Payment unavailable" : !state.outletId ? "Select an outlet first" : "Place order"}
        </button>
        )}
      </div>
    </>
  );
}
