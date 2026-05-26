"use client";

import { formatRM } from "@celsius/shared";

import * as React from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import QRCode from "qrcode";
import {
  listenToCustomerDisplay,
  sendToRegister,
  type CustomerDisplayData,
} from "@/lib/customer-display-channel";
import type { LoyaltySnapshot, UsualItem, MissionCard, ActivePromo, ShopCard, BiteItem } from "@/lib/loyalty-snapshot";
import { PosterCarousel, type DisplayPoster } from "@/components/customer-display/PosterCarousel";
import {
  BeansHero,
  VoucherRow,
  ClaimableRow,
  CatalogRow,
  ChallengeRow,
  SectionLabel,
  UsualStrip,
  MysteryBox,
  type MysteryOutcome,
} from "@/components/customer-display/brand";
// BeansHero + UsualStrip live at the top of the right panel — that
// panel IS the customer card now (identity + usuals + rewards + pay).
// Cart-side owns "Pair with a bite" (food upsell from cart context);
// the right-card Usuals are the drink reorder shortcut.
import { useNfcScanner, type NfcResult } from "@/lib/nfc-scanner";

const PAGE_BG = "#160800"; // espresso — shared with TicketShell punches

/**
 * Maybank DuitNow QR merchant IDs per outlet. Static QR — amount shown on screen.
 */
const MAYBANK_MERCHANT_IDS: Record<string, string> = {
  "outlet-sa": "MBBQR1671618",
  "outlet-con": "MBBQR2449289",
  "outlet-tam": "MBBQR2430878",
};

const formatSen = (sen: number) => formatRM(sen / 100);

export default function CustomerDisplayPage() {
  const [data, setData] = useState<CustomerDisplayData | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ── Member-page state ──────────────────────────────────────
  const [phoneInput, setPhoneInput] = useState("");
  const [snapshot, setSnapshot] = useState<LoyaltySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [posters, setPosters] = useState<DisplayPoster[]>([]);

  // ── Post-order mystery reveal ─────────────────────────────
  // When an order completes for an identified member, we re-fetch their
  // snapshot to surface any newly-awarded mystery_drops. The first
  // drop is rendered as a "Tap to reveal" mystery box on the Thank
  // You screen; tapping calls /api/loyalty/claim and animates the
  // outcome in place. Held in state so the Thank You screen can
  // render even after the register clears the cart.
  const [pendingMystery, setPendingMystery] = useState<{
    memberId: string;
    claimableId: string;
  } | null>(null);
  const [mysteryStatus, setMysteryStatus] = useState<"closed" | "revealing" | "revealed">("closed");
  const [mysteryOutcome, setMysteryOutcome] = useState<MysteryOutcome | null>(null);

  // Fetch posters once on mount; refresh every 5 min so backoffice
  // edits land on the screen without a page reload.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/posters");
        if (!res.ok) return;
        const { posters: list } = (await res.json()) as { posters: DisplayPoster[] };
        if (!cancelled) setPosters(list ?? []);
      } catch {
        /* keep last good list */
      }
    };
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // Auto-clear member view after extended inactivity (privacy + next
  // customer). Previously a flat 90s timer that ONLY reset on second-
  // screen taps — but the customer-display is the customer's view; the
  // cashier is the one driving the order on the register side. Net
  // result was the member getting wiped mid-order whenever the
  // customer wasn't actively poking the screen, even though the cart
  // was actively being built.
  //
  // The fix:
  //   - Extend the timer to 10 minutes (still privacy-safe — counter
  //     stays open long enough for the customer to finish + the next
  //     to walk up). 90s was tuned for one customer's session, not
  //     real-world "I'm standing at the counter ordering" pace.
  //   - Reset the timer on EVERY broadcast from the register too —
  //     cart additions, member identification, status changes all
  //     count as "this session is active." See the listener effect
  //     below.
  //   - When status is "ordering"/"payment", suspend the timer
  //     entirely (an active cart is implicit activity).
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      setSnapshot(null);
      setPhoneInput("");
      setErrorMsg(null);
      setActionMsg(null);
    }, 10 * 60 * 1000);
  }, []);

  // Listen for register broadcasts. Each broadcast resets the idle
  // timer so an actively-driven cart never auto-signs-out the
  // member — and pauses the timer outright while a cart is open
  // ("ordering"/"payment" states), since that's an active session
  // regardless of what the customer is touching.
  useEffect(() => {
    return listenToCustomerDisplay((d) => {
      setData(d);
      if (d.status === "ordering" || d.status === "payment") {
        // Active cart → cancel any pending logout. Re-armed below
        // when status flips to idle/complete.
        if (idleTimerRef.current) {
          clearTimeout(idleTimerRef.current);
          idleTimerRef.current = null;
        }
      } else {
        resetIdleTimer();
      }
    });
  }, [resetIdleTimer]);

  // When register completes an order, snapshot any newly-awarded
  // mystery_drops so we can surface a "tap to reveal" box on the
  // Thank You screen. The earn flow on the server side awards drops
  // synchronously inside POST /api/loyalty/earn — by the time the
  // register flips status to "complete", a refetch will see them.
  // We hold the member identity for ~12s while the customer enjoys
  // the reveal, then drop everything.
  useEffect(() => {
    if (data?.status !== "complete") return;
    const memberId = snapshot?.member.id;
    if (!memberId) {
      // No member on this order — clear immediately, no reveal possible.
      setPhoneInput("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/loyalty/snapshot?member_id=${encodeURIComponent(memberId)}`);
        if (!res.ok) return;
        const fresh = (await res.json()) as LoyaltySnapshot;
        if (cancelled) return;
        const firstMystery = fresh.claimables.find((c) => c.source_type === "mystery_pending");
        if (firstMystery) {
          setPendingMystery({ memberId, claimableId: firstMystery.id });
          setMysteryStatus("closed");
          setMysteryOutcome(null);
        }
      } catch {
        /* network blip — Thank You still shows, just no mystery box */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data?.status, snapshot?.member.id]);

  // When status leaves "complete" (next order begins), drop the
  // mystery state + member view.
  // Mystery-state cleanup only — don't touch snapshot here. Earlier
  // we used to clear snapshot on every "ordering"/"idle" broadcast,
  // which wiped member identity whenever the cashier added an item
  // (register re-broadcasts on every cart change). The register
  // `memberCleared` message handles intentional sign-out, and the
  // 90s idle timer handles abandoned sessions.
  useEffect(() => {
    if (data?.status && data.status !== "complete") {
      if (mysteryStatus !== "closed" || pendingMystery) {
        setPendingMystery(null);
        setMysteryStatus("closed");
        setMysteryOutcome(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.status]);

  // ── Register → Display member mirror ──────────────────────
  // The cashier can identify a member from the register side via
  // /api/loyalty/lookup (phone or "redeem reward" picker). When that
  // happens, the register broadcasts data.member; we mirror by
  // fetching the full snapshot so the second screen shows the same
  // BeansHero / vouchers / missions / usual the customer would see
  // if they'd entered their phone on the numpad themselves.
  //
  // Only re-fetches when the member id actually changes — a heartbeat
  // re-broadcast with the same member is a no-op. We intentionally do
  // NOT auto-clear snapshot when data.member becomes null: the
  // register's broadcast effect fires on every cart keystroke and
  // there are transient frames where loyaltyMember is briefly null
  // (e.g. between Customer Lookup field typing and the lookup call
  // resolving). Auto-clearing on those frames was wiping the snapshot
  // mid-fetch and leaving "Loading your rewards…" stuck. Clearing
  // now only happens on the explicit handleExit() or 90s idle timer.
  useEffect(() => {
    const incomingId = data?.member?.id ?? null;
    const currentId = snapshot?.member.id ?? null;
    if (!incomingId) return;
    if (incomingId === currentId) return;
    void fetchSnapshot({ memberId: incomingId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.member?.id]);

  // Retry safety net — if we're showing the pending skeleton but
  // snapshot hasn't arrived within 2.5s, fire another fetch. Covers
  // dropped fetches, transient network blips, and the rare case
  // where a stale React state update masked the original setSnapshot.
  // Stops after the snapshot lands (the effect early-returns when
  // snapshot is set) or when the member is cleared.
  useEffect(() => {
    const memberId = data?.member?.id ?? null;
    if (!memberId || snapshot?.member.id === memberId) return;
    const t = setTimeout(() => {
      // Recheck before firing — could have arrived in the meantime.
      if (!snapshot || snapshot.member.id !== memberId) {
        void fetchSnapshot({ memberId });
      }
    }, 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.member?.id, snapshot?.member.id]);

  async function handleRevealMystery() {
    if (!pendingMystery) return;
    setMysteryStatus("revealing");
    try {
      const res = await fetch("/api/loyalty/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_id: pendingMystery.memberId,
          claimable_id: pendingMystery.claimableId,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMysteryStatus("closed");
        setActionMsg(body.error ?? "Could not reveal");
        return;
      }
      // Merge voucher details into the outcome for the reveal copy.
      const mystery = body.mystery ?? {};
      setMysteryOutcome({
        outcome_type: mystery.outcome_type,
        multiplier_value: mystery.multiplier_value,
        flat_beans_value: mystery.flat_beans_value,
        label: mystery.label,
        reveal_emoji: mystery.reveal_emoji,
        voucher_title: body.voucher?.title ?? null,
        voucher_description: body.voucher?.description ?? null,
      });
      setMysteryStatus("revealed");
    } catch (e) {
      console.error("[CD] reveal mystery:", e);
      setMysteryStatus("closed");
      setActionMsg("Network error");
    }
  }

  // Render Maybank QR for active order
  const merchantId = data ? MAYBANK_MERCHANT_IDS[data.outletId] : null;
  useEffect(() => {
    if (!canvasRef.current || !merchantId) return;
    // 240px native render, sized down to 120px via CSS in the inline
    // block. 2x density keeps the QR crisp on retina + handles the
    // 5"-away scanning distance of a phone camera at the counter.
    QRCode.toCanvas(canvasRef.current, merchantId, {
      width: 240,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });
  }, [merchantId]);

  // ── Real co-purchase suggestions ──────────────────────────
  // "What do customers actually buy alongside what's in this cart?"
  // — backed by the product_co_purchase_scores materialized view
  // via /api/loyalty/co-purchase, fed by 12 months of StoreHub POS
  // baskets. Fetches whenever the set of cart product ids changes
  // (debounced 300ms so the cashier can ring up multiple items in
  // a row without spamming the endpoint).
  //
  // Empty array on no signal — PairWithABite gracefully falls back
  // to the category-diversified popular_bites pool in that case so
  // the strip is never dead.
  const [coPurchase, setCoPurchase] = useState<BiteItem[]>([]);
  const cartProductIds = (data?.items ?? [])
    .map((i) => i.productId)
    .filter((id): id is string => !!id);
  const cartIdsKey = cartProductIds.slice().sort().join(",");
  useEffect(() => {
    if (!cartIdsKey) {
      setCoPurchase([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/loyalty/co-purchase?ids=${encodeURIComponent(cartIdsKey)}&limit=6`,
        );
        if (!res.ok) {
          if (!cancelled) setCoPurchase([]);
          return;
        }
        const body = (await res.json()) as { items: BiteItem[] };
        if (!cancelled) setCoPurchase(body.items ?? []);
      } catch {
        if (!cancelled) setCoPurchase([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [cartIdsKey]);

  // ── Loyalty actions ───────────────────────────────────────
  async function fetchSnapshot(by: { phone?: string; memberId?: string }) {
    setLoading(true);
    setErrorMsg(null);
    try {
      const qs = by.memberId
        ? `member_id=${encodeURIComponent(by.memberId)}`
        : `phone=${encodeURIComponent(by.phone ?? "")}`;
      const res = await fetch(`/api/loyalty/snapshot?${qs}`);
      if (res.status === 404) {
        setErrorMsg("No member found. Please sign up at the counter.");
        setSnapshot(null);
        return;
      }
      if (!res.ok) {
        setErrorMsg("Could not load member. Try again.");
        return;
      }
      const snap = (await res.json()) as LoyaltySnapshot;
      setSnapshot(snap);
      sendToRegister({
        type: "memberSelected",
        member: {
          id: snap.member.id,
          name: snap.member.name,
          phone: snap.member.phone,
          tags: snap.member.tags,
          points_balance: snap.balance,
          total_spent: snap.member.total_spent,
          total_visits: snap.member.total_visits,
          last_visit_at: null,
          tier: snap.tier.current,
        },
      });
      resetIdleTimer();
    } catch (e) {
      console.error("[CD] fetchSnapshot:", e);
      setErrorMsg("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshSnapshot() {
    if (snapshot) await fetchSnapshot({ memberId: snapshot.member.id });
  }

  // ── NFC tap-to-identify ───────────────────────────────────
  // Active whenever no member is currently in session. The SUNMI D3
  // second display has an NFC reader under the glass — a customer tap
  // surfaces a Text record (phone) or URL with /m/<id> in the NDEF
  // payload, which we route into the same fetchSnapshot path the
  // numpad uses. Numpad stays as fallback for non-NFC phones.
  const handleNfcRead = useCallback((r: NfcResult) => {
    if (r.kind === "phone") {
      void fetchSnapshot({ phone: r.value });
    } else if (r.kind === "memberId") {
      void fetchSnapshot({ memberId: r.value });
    } else {
      setErrorMsg("Card not recognized. Tap again or enter phone.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const nfc = useNfcScanner({
    enabled: !snapshot,
    onRead: handleNfcRead,
  });

  async function handleApplyVoucher(voucherId: string, voucherName: string) {
    if (!snapshot) return;
    resetIdleTimer();
    setActionMsg(null);
    try {
      const res = await fetch("/api/loyalty/apply-voucher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: snapshot.member.id, voucher_id: voucherId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setActionMsg(body.error ?? "Could not apply voucher");
        return;
      }
      sendToRegister({
        type: "applyVoucher",
        memberId: snapshot.member.id,
        voucherId,
        voucherName: body.voucher_name ?? voucherName,
        discount: body.discount,
      });
      setActionMsg(`Applied: ${body.voucher_name ?? voucherName}`);
    } catch (e) {
      console.error("[CD] applyVoucher:", e);
      setActionMsg("Network error");
    }
  }

  async function handleClaim(claimableId: string, title: string) {
    if (!snapshot) return;
    resetIdleTimer();
    setActionMsg(null);
    try {
      const res = await fetch("/api/loyalty/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: snapshot.member.id, claimable_id: claimableId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setActionMsg(body.error ?? "Could not claim");
        return;
      }
      setActionMsg(`Claimed: ${title}`);
      await refreshSnapshot();
    } catch (e) {
      console.error("[CD] claim:", e);
      setActionMsg("Network error");
    }
  }

  // ── Tap-to-add usual ─────────────────────────────────────
  // Customer (or cashier, depending on who's in front of the screen)
  // taps a tile in the "Your usual" strip → broadcast addToCart so the
  // register pushes the product into cart. Toast the customer-display
  // so they know it landed.
  function handleAddUsual(item: UsualItem) {
    resetIdleTimer();
    try {
      sendToRegister({
        type: "addToCart",
        productId: item.id,
        productName: item.name,
      });
      setActionMsg(`Added: ${item.name}`);
    } catch (e) {
      console.error("[CD] addToCart:", e);
      setActionMsg("Could not add. Tell the cashier.");
    }
  }

  // Tap a Spend Beans tile — defer the burn to checkout commit.
  //
  // Two modes:
  //   1) Active cart → broadcast applyShopReward to register. Register
  //      reserves the discount on the cart; Beans burn only when
  //      handleCheckoutComplete fires /api/loyalty/redeem.
  //   2) No active cart → fall back to mint-voucher (burns Beans now,
  //      puts the voucher in the wallet for a future visit).
  //
  // Either way the customer sees a confirmation chip before the burn:
  // mode 1 says "Pending — Beans burn at checkout", mode 2 says
  // "Added to wallet".
  async function handleMint(rewardId: string, name: string) {
    if (!snapshot) return;
    resetIdleTimer();
    setActionMsg(null);

    const reward = snapshot.shop.find((s) => s.id === rewardId);
    if (!reward) {
      setActionMsg("Reward not found");
      return;
    }

    const hasCart = !!data && data.items.length > 0;

    if (hasCart) {
      // Reserved-redemption path — register applies discount now,
      // Beans burn on order completion. No API call here.
      sendToRegister({
        type: "applyShopReward",
        memberId:    snapshot.member.id,
        rewardId:    reward.id,
        rewardName:  reward.name,
        pointsCost:  reward.points_required,
        discount: {
          type:  reward.discount_type ?? "fixed_amount",
          value: reward.discount_value ?? 0,
          max_discount:          reward.max_discount_value,
          min_order:             null,
          applicable_products:   reward.applicable_products,
          applicable_categories: reward.applicable_categories,
          free_product_ids:      reward.free_product_ids,
          free_product_name:     reward.free_product_name,
        },
      });
      setActionMsg(`Applied: ${name} — ${reward.points_required} Beans on checkout`);
      return;
    }

    // No active cart → mint immediately to wallet (legacy behavior).
    try {
      const res = await fetch("/api/loyalty/mint-voucher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_id: snapshot.member.id,
          reward_id: rewardId,
          outlet_id: data?.outletId,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setActionMsg(body.error === "insufficient_beans" ? "Not enough Beans" : (body.error ?? "Mint failed"));
        return;
      }
      setActionMsg(`Added to wallet: ${name}`);
      await refreshSnapshot();
    } catch (e) {
      console.error("[CD] mint:", e);
      setActionMsg("Network error");
    }
  }

  function handleExit() {
    setSnapshot(null);
    setPhoneInput("");
    setErrorMsg(null);
    setActionMsg(null);
    sendToRegister({ type: "memberCleared" });
  }

  // ── Render logic ──────────────────────────────────────────
  // Payment takes over the whole screen — when the cashier hits
  // Charge, the customer needs to pull out their phone and scan.
  // Going full-screen makes the QR + amount unmissable across the
  // counter, way more legible than the old pinned-bottom block.
  if (data?.status === "payment") {
    return (
      <PaymentScreen
        canvasRef={canvasRef}
        merchantId={merchantId}
        total={data?.total ?? 0}
        orderNumber={data?.orderNumber}
      />
    );
  }

  // Order complete takes precedence over everything else.
  if (data?.status === "complete") {
    return (
      <div
        className="cd-fade-in flex h-screen flex-col items-center justify-center px-8"
        style={{ backgroundColor: PAGE_BG, color: "#F5F3F0" }}
      >
        <div
          className="mb-6 flex h-20 w-20 items-center justify-center rounded-full"
          style={{ backgroundColor: "rgba(34,197,94,0.18)" }}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#86efac" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 className="text-4xl" style={{ fontFamily: "Peachi", fontWeight: 700, color: "#F5F3F0" }}>
          Thank You
        </h1>
        {data.orderNumber && (
          <p
            className="mt-3 text-base font-bold uppercase tracking-[0.18em]"
            style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.55)" }}
          >
            Order #{data.orderNumber}
          </p>
        )}
        <p
          className="mt-4 text-lg"
          style={{ fontFamily: "Peachi", fontWeight: 500, color: "rgba(245,243,240,0.7)" }}
        >
          Your order is being prepared
        </p>

        {/* Mystery Bean reveal — only shown when the just-completed
            order awarded the member a mystery_drop. Sits below the
            confirmation copy so it doesn't compete with the primary
            "thank you" message. */}
        {pendingMystery && (
          <div className="mt-8 w-full max-w-sm">
            <MysteryBox
              status={mysteryStatus}
              outcome={mysteryOutcome}
              onOpen={handleRevealMystery}
            />
          </div>
        )}
      </div>
    );
  }

  // Whenever there's a cart OR an identified member, render the
  // split-screen layout — cart on the left always visible, narrow
  // rewards/pay panel on the right. Idle (no cart, no member) → the
  // welcome carousel + phone entry.
  //
  // `hasPendingMember` covers the brief window between register
  // identifying a member (we've received data.member) and our local
  // snapshot fetch completing. Without it, the second screen would
  // flash the numpad even though the cashier just looked the customer
  // up — confusing UX. We render OrderingScreen and the right panel
  // shows a "Loading rewards…" state until snapshot arrives.
  const hasCart = !!data && data.items.length > 0;
  const hasPendingMember = !!data?.member && !snapshot;
  if (hasCart || snapshot || hasPendingMember) {
    return (
      <OrderingScreen
        data={data}
        canvasRef={canvasRef}
        merchantId={merchantId}
        snapshot={snapshot}
        posters={posters}
        phoneInput={phoneInput}
        setPhoneInput={setPhoneInput}
        phoneLoading={loading}
        phoneError={errorMsg}
        actionMsg={actionMsg}
        coPurchase={coPurchase}
        onFetchPhone={() => fetchSnapshot({ phone: phoneInput })}
        nfcAvailable={nfc.available}
        onApplyVoucher={handleApplyVoucher}
        onClaim={handleClaim}
        onMint={handleMint}
        onAddUsual={handleAddUsual}
        onExitMember={handleExit}
      />
    );
  }

  // Fully idle — no cart, no member. Welcome carousel + phone entry.
  return (
    <PhoneEntryScreen
      phoneInput={phoneInput}
      setPhoneInput={setPhoneInput}
      loading={loading}
      errorMsg={errorMsg}
      posters={posters}
      nfcAvailable={nfc.available}
      onSubmit={() => fetchSnapshot({ phone: phoneInput })}
    />
  );
}

// ─── Phone entry numpad ────────────────────────────────────────
function PhoneEntryScreen({
  phoneInput,
  setPhoneInput,
  loading,
  errorMsg,
  posters,
  nfcAvailable,
  onSubmit,
}: {
  phoneInput: string;
  setPhoneInput: (v: string) => void;
  loading: boolean;
  errorMsg: string | null;
  posters: DisplayPoster[];
  nfcAvailable: boolean;
  onSubmit: () => void;
}) {
  const hasPosters = posters.length > 0;

  return (
    <div
      className="cd-fade-in flex h-screen"
      style={{ backgroundColor: PAGE_BG, color: "#F5F3F0" }}
    >
      {hasPosters && (
        <div className="flex flex-1 flex-col justify-center p-8">
          <PosterCarousel posters={posters} />
          <p
            className="mt-4 text-center text-[11px] font-bold uppercase tracking-[0.18em]"
            style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.45)" }}
          >
            Today at Celsius Coffee
          </p>
        </div>
      )}

      <div
        className={`flex flex-col items-center justify-center p-8 ${
          hasPosters ? "w-[440px] border-l" : "flex-1"
        }`}
        style={hasPosters ? { borderColor: "rgba(245,243,240,0.08)", backgroundColor: "#0F0500" } : undefined}
      >
        <img src="/images/celsius-logo-sm.jpg" alt="Celsius" className="mb-4 h-16 w-16 rounded-2xl" />
        <h1
          className="text-3xl"
          style={{ fontFamily: "Peachi", fontWeight: 700, color: "#F5F3F0" }}
        >
          Welcome back
        </h1>
        <p
          className="mt-2 text-[11px] font-bold uppercase tracking-[0.18em]"
          style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.55)" }}
        >
          {nfcAvailable ? "Tap your phone here, or enter number" : "Enter your phone for rewards"}
        </p>

        {nfcAvailable && <NfcPulseIndicator />}

        <NumpadPanel
          phoneInput={phoneInput}
          setPhoneInput={setPhoneInput}
          loading={loading}
          errorMsg={errorMsg}
          onSubmit={onSubmit}
        />
      </div>
    </div>
  );
}

// (Full-screen MemberDashboard removed — split-screen OrderingScreen
//  handles both "cart + member" and "member only" states now.)

// ─── Split-screen: cart left, narrow rewards/pay panel right ───
// Renders whenever there's a cart OR a member identified. Cart pane
// shows an empty-state hint when items haven't been rung up yet so
// the customer-facing screen still reads as "your order".
function OrderingScreen({
  data,
  canvasRef,
  merchantId,
  snapshot,
  posters,
  phoneInput,
  setPhoneInput,
  phoneLoading,
  phoneError,
  actionMsg,
  coPurchase,
  nfcAvailable,
  onFetchPhone,
  onApplyVoucher,
  onClaim,
  onMint,
  onAddUsual,
  onExitMember,
}: {
  data: CustomerDisplayData | null;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  merchantId: string | null;
  snapshot: LoyaltySnapshot | null;
  posters: DisplayPoster[];
  phoneInput: string;
  setPhoneInput: (v: string) => void;
  phoneLoading: boolean;
  phoneError: string | null;
  actionMsg: string | null;
  /** Real co-purchase suggestions keyed to current cart productIds —
   *  hydrated tile rows ready to render in PairWithABite. Empty when
   *  no items in cart or no historical signal yet. */
  coPurchase: BiteItem[];
  nfcAvailable: boolean;
  onFetchPhone: () => void;
  onApplyVoucher: (id: string, name: string) => void;
  onClaim: (id: string, title: string) => void;
  onMint: (id: string, name: string) => void;
  onAddUsual: (item: UsualItem) => void;
  onExitMember: () => void;
}) {
  const hasCart = !!data && data.items.length > 0;
  const hasMember = !!snapshot;

  // Null-safe shorthands so the cart section can render even when
  // the cashier hasn't rung anything up yet.
  const outletName = data?.outletName ?? "Celsius Coffee";
  const items = data?.items ?? [];
  const subtotal = data?.subtotal ?? 0;
  const serviceCharge = data?.serviceCharge ?? 0;
  const discountSen = data?.discount ?? 0;
  const total = data?.total ?? 0;
  const appliedVoucher = data?.appliedVoucher;
  const autoPromotions = data?.autoPromotions ?? [];
  // The voucher + named auto-promos already account for some of the
  // discount; anything left in `discount` is a cashier-applied manual
  // discount that doesn't have a label. Show that as a single
  // "Discount" line below the named savings.
  const namedDiscountSen =
    (appliedVoucher?.discount_sen ?? 0) +
    autoPromotions.reduce((s, p) => s + p.discount_sen, 0);
  const unnamedDiscountSen = Math.max(0, discountSen - namedDiscountSen);

  return (
    <div className="cd-fade-in flex h-screen" style={{ backgroundColor: PAGE_BG, color: "#F5F3F0" }}>
      {/* LEFT — Order summary (always visible) */}
      <div className="flex flex-1 flex-col p-8">
        {/* Header: outlet identity only. The member greeting +
            tier + Beans + perks all live in the Visit Dashboard
            below — no need for a duplicate pill up here. */}
        <div className="mb-4 flex items-center gap-3">
          <img src="/images/celsius-logo-sm.jpg" alt="Celsius" className="h-10 w-10 rounded-xl" />
          <div>
            <h2
              className="text-lg"
              style={{ fontFamily: "Peachi", fontWeight: 700, color: "#F5F3F0" }}
            >
              {outletName}
            </h2>
            <p
              className="text-[10px] font-bold uppercase tracking-[0.18em]"
              style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.5)" }}
            >
              Your Order
            </p>
          </div>
        </div>

        {/* Items — or empty-state when no cart yet */}
        <div className="flex-1 overflow-y-auto">
          {hasCart ? (
            items.map((item, i) => (
              <div
                key={i}
                className="flex items-start justify-between border-b py-3"
                style={{ borderColor: "rgba(245,243,240,0.08)" }}
              >
                <div className="flex-1">
                  <p className="text-sm" style={{ fontFamily: "Peachi", fontWeight: 500, color: "#F5F3F0" }}>
                    <span className="mr-2" style={{ color: "rgba(245,243,240,0.4)" }}>{item.qty}x</span>
                    {item.name}
                  </p>
                  {item.modifiers && (
                    <p className="mt-0.5 text-xs" style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.45)" }}>
                      {item.modifiers}
                    </p>
                  )}
                </div>
                <p className="ml-4 text-sm" style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.75)" }}>
                  {formatSen(item.amount)}
                </p>
              </div>
            ))
          ) : (
            // Cart is empty — the customer-display owns this moment.
            // Show splash posters at the top + current promotions
            // grid below. No engagement-dashboard noise (usual /
            // featured challenge / tier perks are on the customer
            // card on the right when a member is identified). The
            // posters drive brand awareness + new-product trial;
            // the promotions drive "save more if you order X" AOV
            // intent before the cashier even rings the first item.
            <EmptyCartEngagement
              posters={posters}
              activePromos={snapshot?.active_promos ?? []}
            />
          )}
        </div>

        {/* Cart-only suggestions — once the cashier has rung in
            the first item, surface two distinct AOV nudges below
            the cart list:
              • Pair with a bite — suggest a complementary
                food/pastry item to attach to a drink-led cart
                (drives basket size; "Make it a meal" pattern).
              • Combo offers — currently-live combo promotions
                that can save the customer money on this exact
                cart with one more item.
            Both hidden when there are no items yet. */}
        {hasCart && snapshot && (
          <>
            <PairWithABite snapshot={snapshot} items={items} coPurchase={coPurchase} />
            <CurrentPromotions activePromos={snapshot.active_promos} />
          </>
        )}

        {/* Applied voucher badge */}
        {appliedVoucher && (
          <div
            className="mt-3 rounded-xl border px-3 py-2"
            style={{
              borderColor: "rgba(34,197,94,0.35)",
              backgroundColor: "rgba(34,197,94,0.10)",
            }}
          >
            <p style={{ fontFamily: "Peachi", fontWeight: 700, color: "#86efac" }}>
              ✓ {appliedVoucher.name}
            </p>
            <p className="text-xs" style={{ fontFamily: "Space Grotesk", color: "rgba(134,239,172,0.8)" }}>
              Saves {formatSen(appliedVoucher.discount_sen)}
            </p>
          </div>
        )}

        {/* Totals — only shown once there's something in the cart */}
        {hasCart && (
          <div
            className="mt-4 space-y-2 border-t pt-4"
            style={{ borderColor: "rgba(245,243,240,0.12)" }}
          >
            <div className="flex justify-between text-sm" style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.55)" }}>
              <span>Subtotal</span>
              <span>{formatSen(subtotal)}</span>
            </div>
            {serviceCharge > 0 && (
              <div className="flex justify-between text-sm" style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.55)" }}>
                <span>Service Charge</span>
                <span>{formatSen(serviceCharge)}</span>
              </div>
            )}
            {/* Itemized auto-promo savings — each tier perk + happy
                hour / auto-promo gets its own line so the customer
                sees exactly what saved them what. The applied
                voucher has its own green "✓" badge above totals so
                we don't repeat it here. Cashier-applied manual
                discounts (no name) collapse into one "Discount"
                line below. */}
            {autoPromotions.map((p) => (
              <div
                key={p.id}
                className="flex justify-between text-sm"
                style={{ fontFamily: "Space Grotesk", color: "#86efac" }}
              >
                <span>{p.name}</span>
                <span>-{formatSen(p.discount_sen)}</span>
              </div>
            ))}
            {unnamedDiscountSen > 0 && (
              <div className="flex justify-between text-sm" style={{ fontFamily: "Space Grotesk", color: "#86efac" }}>
                <span>Discount</span>
                <span>-{formatSen(unnamedDiscountSen)}</span>
              </div>
            )}
            <div
              className="flex justify-between border-t pt-3 text-2xl"
              style={{ borderColor: "rgba(245,243,240,0.12)", fontFamily: "Peachi", fontWeight: 700 }}
            >
              <span style={{ color: "#F5F3F0" }}>Total</span>
              <span style={{ color: "#FBBF24" }}>{formatSen(total)}</span>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT — single unified panel. No tabs anymore: rewards
          content streams from the top, Scan-to-Pay block pins to the
          bottom whenever the cart has something to charge. Customer
          and cashier never need to flip a tab to see either. */}
      <div
        className="flex w-[380px] flex-col border-l"
        style={{ borderColor: "rgba(245,243,240,0.08)", backgroundColor: "#0F0500" }}
      >
        {actionMsg && (
          <div
            className="border-b px-4 py-2 text-xs"
            style={{
              fontFamily: "Space Grotesk",
              borderColor: "rgba(251,191,36,0.18)",
              backgroundColor: "rgba(251,191,36,0.10)",
              color: "#FBBF24",
            }}
          >
            {actionMsg}
          </div>
        )}

        {/* Top: rewards / phone entry / pending skeleton — whichever
            applies. Shrinks-fits-grows so the QR pin gets its space. */}
        <div className="flex min-h-0 flex-1 flex-col">
          {hasMember ? (
            <CompactRewardsPanel
              snapshot={snapshot!}
              onApply={onApplyVoucher}
              onClaim={onClaim}
              onMint={onMint}
              onAddUsual={onAddUsual}
              onExit={onExitMember}
            />
          ) : data?.member ? (
            <PendingMemberPanel
              memberName={data.member.name}
              pointsBalance={data.member.points_balance}
              onSignOut={onExitMember}
            />
          ) : (
            <CompactPhoneEntry
              phoneInput={phoneInput}
              setPhoneInput={setPhoneInput}
              loading={phoneLoading}
              errorMsg={phoneError}
              nfcAvailable={nfcAvailable}
              onSubmit={onFetchPhone}
            />
          )}
        </div>

        {/* QR / Scan-to-Pay was previously pinned here whenever
            the cart had items. Cashier feedback was that the
            always-on QR competed visually with the rewards list
            and the customer-card identity. Moved to a dedicated
            full-screen Payment view that takes over only when
            status === "payment" (register fires this when the
            Charge button opens the CheckoutModal). */}
      </div>
    </div>
  );
}

// TabButton + PayPanel removed — the right panel no longer has a
// Rewards/Pay tab toggle. Everything streams in one column: rewards
// at the top, Scan-to-Pay pinned at the bottom whenever the cart has
// items to charge. See InlinePayBlock below for the new compact QR
// presentation.

// ─── Rewards panel (narrow right column) ───────────────────────
// Single-column scroll of horizontal rows, mirroring the native
// app's /rewards layout: BeansHero → continuous list of Claimables,
// Vouchers, and Catalog (Spend Beans) — no section headers between
// types, every card reads as "a reward I can use".
function CompactRewardsPanel({
  snapshot,
  onApply,
  onClaim,
  onMint,
  onAddUsual,
  onExit,
}: {
  snapshot: LoyaltySnapshot;
  onApply: (id: string, name: string) => void;
  onClaim: (id: string, title: string) => void;
  onMint: (id: string, name: string) => void;
  onAddUsual: (item: UsualItem) => void;
  onExit: () => void;
}) {
  // Right panel = THE CUSTOMER CARD. Identity (BeansHero), one-tap
  // reorder strip (Usual), then actionable rewards (vouchers,
  // claimables, Spend Beans), then a sliver of challenge progress.
  // Pay QR pins below this panel when the cart is non-empty.
  const { member, balance, tier, vouchers, claimables, missions, shop, usual } = snapshot;
  const isEmpty = claimables.length === 0 && vouchers.length === 0 && shop.length === 0;

  return (
    <div
      className="cd-fade-in flex-1 overflow-y-auto px-3.5 pt-3.5 pb-4"
      style={{ backgroundColor: PAGE_BG }}
    >
      <BeansHero
        tier={tier.current}
        nextTier={tier.next}
        progress={tier.progress}
        balance={balance}
        memberName={member.name}
      />

      {/* Your Usual — sits between identity and rewards so the
          customer's drink reorder shortcut is the first actionable
          thing under their name. UsualStrip's horizontal scroll
          handles the narrow 380px panel cleanly. Cashier or
          customer taps a tile → broadcasts addToCart to register. */}
      {usual.length > 0 && (
        <div className="mt-4">
          <UsualStrip items={usual} onAdd={onAddUsual} />
        </div>
      )}

      <p
        className="mb-2 mt-4 px-1 text-[10px] font-bold uppercase tracking-[0.22em]"
        style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.45)" }}
      >
        Available Rewards
      </p>

      <div className="space-y-2">
        {/* Claimables (mystery + admin push) — these are time-sensitive
            so they stay near the top. */}
        {claimables.map((c) => (
          <ClaimableRow key={`c-${c.id}`} claimable={c} onClaim={() => onClaim(c.id, c.title)} />
        ))}

        {/* Wallet vouchers — free to USE. The most actionable
            rewards on the panel. */}
        {vouchers.map((v) => (
          <VoucherRow key={`v-${v.id}`} voucher={v} onApply={() => onApply(v.id, v.title)} />
        ))}

        {/* Spend-Beans catalog — points-shop redemption. Comes after
            free vouchers so customers don't burn Beans they didn't
            need to. */}
        {shop.map((s) => (
          <CatalogRow
            key={`s-${s.id}`}
            shop={s}
            onMint={() => s.affordable && onMint(s.id, s.name)}
          />
        ))}

        {/* Active mission progress — compact row, complements (not
            duplicates) the featured challenge on the dashboard.
            Trimmed to first 2 to keep the panel scannable. */}
        {missions.slice(0, 2).map((m) => (
          <ChallengeRow key={`m-${m.id}`} mission={m} />
        ))}

        {isEmpty && (
          <p
            className="rounded-xl p-4 text-center text-xs"
            style={{
              fontFamily: "Space Grotesk",
              backgroundColor: "rgba(245,243,240,0.04)",
              color: "rgba(245,243,240,0.5)",
            }}
          >
            No rewards available yet. Place an order to earn Beans!
          </p>
        )}
      </div>

      <button
        onClick={onExit}
        className="mt-5 w-full rounded-xl border py-2 text-[10px] font-bold uppercase tracking-[0.16em] transition"
        style={{
          fontFamily: "Space Grotesk",
          borderColor: "rgba(245,243,240,0.12)",
          color: "rgba(245,243,240,0.45)",
        }}
      >
        Sign out
      </button>
    </div>
  );
}

// ─── Empty-cart engagement dashboard ──────────────────────────
// Fills the left panel of OrderingScreen when a member is identified
// but the cashier hasn't rung anything in yet. The customer is at
// peak attention here — staring at the screen waiting — so we use it
// to drive the two business goals the second screen owns:
//
//   1. AOV          — Big tap-to-add Usual tiles in a 3-col grid.
//                     The customer (or cashier) can one-tap reorder
//                     their regulars without having to call out items.
//   2. Repeat visit — Featured challenge (the one closest to
//                     completion) with progress + bonus Beans copy,
//                     plus a tier-perks list so members SEE the value
//                     of being identified and coming back.
//
// Data is whatever's already on snapshot — no extra fetches.
function VisitDashboard({
  snapshot,
  onAddUsual,
}: {
  snapshot: LoyaltySnapshot;
  onAddUsual: (item: UsualItem) => void;
}) {
  const { member, balance, tier, usual, missions } = snapshot;
  const firstName = member.name?.split(" ")[0] ?? "there";
  const tierName = tier.current?.name ?? "Member";
  const tierColor = tier.current?.color ?? "#FBBF24";
  const tierPerks = tier.current?.benefits ?? [];

  // Featured challenge — highest completion ratio first so the
  // customer sees the one they're closest to finishing. Skips
  // already-completed ones.
  const featured = [...missions]
    .filter((m) => m.status === "active" && m.progress_current < m.progress_target)
    .sort(
      (a, b) =>
        b.progress_current / Math.max(b.progress_target, 1) -
        a.progress_current / Math.max(a.progress_target, 1),
    )[0];

  return (
    <div className="cd-fade-in flex h-full flex-col gap-5 overflow-y-auto pr-2">
      {/* Welcome strip — single consolidated identity block. Name +
          tier + Beans + top 2 perks all here so this is the ONE
          place the customer reads "who am I to this brand". No
          duplicate pill in the panel header, no BeansHero on the
          right rewards panel, no separate Your Perks section
          below. One source of truth. */}
      <div className="border-b pb-4" style={{ borderColor: "rgba(245,243,240,0.08)" }}>
        <p
          className="text-[11px] font-bold uppercase tracking-[0.22em]"
          style={{ fontFamily: "Space Grotesk", color: "rgba(251,191,36,0.85)" }}
        >
          Welcome back
        </p>
        <div className="mt-1 flex items-baseline gap-3">
          <h1
            className="text-3xl"
            style={{ fontFamily: "Peachi", fontWeight: 700, color: "#F5F3F0" }}
          >
            Hi, {firstName}
          </h1>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-white"
            style={{ backgroundColor: tierColor, fontFamily: "Space Grotesk" }}
          >
            {tierName}
          </span>
        </div>
        <p
          className="mt-1 text-base"
          style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.65)" }}
        >
          <span style={{ color: "#FBBF24", fontWeight: 700 }}>
            {balance.toLocaleString()}
          </span>{" "}
          Beans available
        </p>
        {/* Inline perks — top 2 only. Keeps the header dense without
            needing a separate Your Perks section further down. */}
        {tierPerks.length > 0 && (
          <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
            {tierPerks.slice(0, 2).map((p, i) => (
              <li
                key={i}
                className="flex items-center gap-1.5 text-[12px]"
                style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.7)" }}
              >
                <span
                  className="inline-block h-1 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: tierColor }}
                />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Next-reward progress strip — Starbucks Stars pattern.
          Goal-gradient effect: customers accelerate purchases as
          the gap closes. We surface the cheapest UNLOCKED catalog
          reward as the "next" target. When they can afford the
          cheapest catalog item, switch to a "tap to redeem" callout
          since there's no progress arc left. */}
      <NextRewardProgress
        balance={balance}
        shop={snapshot.shop}
        accent={tierColor}
      />

      {/* Your Usual — big tap-to-add grid. Primary AOV move: the
          regular orders their go-to with one tap and the cashier just
          confirms. Hidden when there's no history (new member). */}
      {usual.length > 0 && (
        <section>
          <SectionHeading>Get your usual</SectionHeading>
          <div className="mt-2 grid grid-cols-3 gap-2.5">
            {usual.slice(0, 6).map((it) => (
              <UsualBigTile key={it.id} item={it} onAdd={onAddUsual} />
            ))}
          </div>
        </section>
      )}

      {/* Today's offers — every active auto-promo that matches now
          (day-of-week + time-window gates already filtered in the
          snapshot endpoint). Pure AOV: surface "Save RM2 if you add
          a Sandwich" so the customer asks for the missing combo
          item. Each card shows the saving + the urgency window. */}
      {snapshot.active_promos.length > 0 && (
        <section>
          <SectionHeading>Today&rsquo;s offers</SectionHeading>
          <div className="mt-2 grid grid-cols-2 gap-2.5">
            {snapshot.active_promos.slice(0, 6).map((p) => (
              <PromoTile key={p.id} promo={p} />
            ))}
          </div>
        </section>
      )}

      {/* Featured challenge — drives return. Showing the one closest
          to completion taps loss-aversion: "I'm so close, I'll come
          back next week to finish it." */}
      {featured && (
        <section>
          <SectionHeading>Almost there</SectionHeading>
          <FeaturedChallenge mission={featured} />
        </section>
      )}

      {/* Tier perks moved inline into the welcome block above —
          single source of identity, no duplicate "Your Perks"
          section here. */}
    </div>
  );
}

/** Next-reward progress strip — Starbucks Stars "180/200" pattern.
 *  Goal-gradient effect: customers accelerate purchases as the gap
 *  narrows. Surfaces the cheapest catalog reward the member CAN'T
 *  yet afford so they can see exactly how close they are. When
 *  they can afford the cheapest catalog item, we flip to a celebratory
 *  "Tap to redeem" callout (no progress bar needed). */
function NextRewardProgress({
  balance,
  shop,
  accent,
}: {
  balance: number;
  shop: ShopCard[];
  accent: string;
}) {
  // No catalog → nothing to chase.
  if (shop.length === 0) return null;

  // Affordable rewards first — if any, the member has something they
  // can claim NOW.
  const affordable = shop.filter((s) => s.affordable);
  const unaffordable = shop
    .filter((s) => !s.affordable)
    .sort((a, b) => a.points_required - b.points_required);

  // Celebratory state: they already have enough for the cheapest
  // reward. Bias toward action — tell them to claim.
  if (affordable.length > 0 && unaffordable.length === 0) {
    const top = affordable[0];
    return (
      <div
        className="flex items-center gap-3 rounded-2xl border p-3"
        style={{
          backgroundColor: `${accent}14`,
          borderColor: `${accent}44`,
        }}
      >
        <div className="text-2xl" aria-hidden>🎁</div>
        <div className="flex-1">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.18em]"
            style={{ fontFamily: "Space Grotesk", color: accent }}
          >
            You&rsquo;ve earned it
          </p>
          <p
            className="mt-0.5 text-sm"
            style={{ fontFamily: "Peachi", fontWeight: 700, color: "#F5F3F0" }}
          >
            Tap any reward to redeem
          </p>
        </div>
        <span
          className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em]"
          style={{ fontFamily: "Space Grotesk", backgroundColor: accent, color: "#1A0200" }}
        >
          {top.points_required.toLocaleString()} ›
        </span>
      </div>
    );
  }

  // Progress state — show the nearest unaffordable reward as
  // the "next goal" and the gap as motivation.
  const next = unaffordable[0];
  if (!next) return null;
  const remaining = next.points_required - balance;
  const pct = Math.min(100, Math.max(0, Math.round((balance / next.points_required) * 100)));

  return (
    <div
      className="rounded-2xl border p-3"
      style={{
        backgroundColor: "rgba(245,243,240,0.04)",
        borderColor: "rgba(245,243,240,0.10)",
      }}
    >
      <div className="flex items-baseline justify-between">
        <p
          className="text-[10px] font-bold uppercase tracking-[0.18em]"
          style={{ fontFamily: "Space Grotesk", color: "#FBBF24" }}
        >
          Next reward
        </p>
        <p
          className="text-[10px] font-bold uppercase tracking-[0.14em]"
          style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.5)" }}
        >
          {balance.toLocaleString()} / {next.points_required.toLocaleString()}
        </p>
      </div>
      <p
        className="mt-1 text-sm"
        style={{ fontFamily: "Peachi", fontWeight: 700, color: "#F5F3F0" }}
      >
        {remaining.toLocaleString()} more Beans → {next.name}
      </p>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full"
        style={{ backgroundColor: "rgba(251,191,36,0.15)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: "#FBBF24" }}
        />
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[11px] font-bold uppercase tracking-[0.22em]"
      style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.55)" }}
    >
      {children}
    </p>
  );
}

/** Big version of UsualStrip's tile — squarer, more tappable, with a
 *  big yellow + ADD pill that doubles as the affordance and the call
 *  to action. Flashes green on tap so the customer sees their tap
 *  registered before the cart echoes back. */
function UsualBigTile({
  item,
  onAdd,
}: {
  item: UsualItem;
  onAdd: (item: UsualItem) => void;
}) {
  const [tapped, setTapped] = useState(false);
  const handle = () => {
    setTapped(true);
    onAdd(item);
    setTimeout(() => setTapped(false), 600);
  };
  return (
    <button
      type="button"
      onClick={handle}
      className="flex flex-col rounded-xl border p-2 text-left transition active:scale-[0.97]"
      style={{
        borderColor: tapped ? "rgba(134,239,172,0.55)" : "rgba(245,243,240,0.10)",
        backgroundColor: tapped ? "rgba(34,197,94,0.14)" : "rgba(255,255,255,0.05)",
      }}
    >
      <div className="relative">
        <div
          className="aspect-square w-full rounded-lg bg-cover bg-center"
          style={{
            backgroundImage: item.image_url ? `url(${item.image_url})` : undefined,
            backgroundColor: "rgba(245,243,240,0.06)",
          }}
        />
        <span
          className="absolute right-1 top-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
          style={{
            fontFamily: "Space Grotesk",
            backgroundColor: "rgba(26,2,0,0.78)",
            color: "#FBBF24",
          }}
        >
          ×{item.times_ordered}
        </span>
      </div>
      <p
        className="mt-2 line-clamp-2 text-sm"
        style={{ fontFamily: "Peachi", fontWeight: 500, color: "#F5F3F0", lineHeight: 1.2 }}
      >
        {item.name}
      </p>
      <div className="mt-1 flex items-center justify-between">
        <span
          className="text-[11px]"
          style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.6)" }}
        >
          RM {(item.price_sen / 100).toFixed(2)}
        </span>
        <span
          className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
          style={{
            fontFamily: "Space Grotesk",
            backgroundColor: tapped ? "#86efac" : "#FBBF24",
            color: "#1A0200",
          }}
        >
          {tapped ? "✓ Added" : "+ Add"}
        </span>
      </div>
    </button>
  );
}

// ─── Empty-cart engagement (left panel, before cashier rings) ─
// Splash posters at the top, currently-live promotion grid below.
// Mirrors the home-rail patterns from Sweetgreen / Cava — passive
// content the customer scans while they're waiting to be served.
// Brand awareness + AOV intent BEFORE the first item is rung in.
function EmptyCartEngagement({
  posters,
  activePromos,
}: {
  posters: DisplayPoster[];
  activePromos: ActivePromo[];
}) {
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto pr-2">
      {posters.length > 0 && (
        <div>
          <PosterCarousel posters={posters} />
          <p
            className="mt-3 text-center text-[11px] font-bold uppercase tracking-[0.22em]"
            style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.45)" }}
          >
            Today at Celsius Coffee
          </p>
        </div>
      )}

      {(() => {
        // Empty-cart "Current promotions" only shows promos that
        // are claimable right now — no point teasing a customer
        // with an 8am combo at 3pm when they're standing there
        // about to order. Uses the same compact ComboRow shape the
        // cart-side renders so the section reads consistently
        // whether the cart is empty or filling.
        const live = activePromos.filter((p) => p.live);
        if (live.length === 0) return null;
        return (
          <section>
            <p
              className="mb-2 text-[11px] font-bold uppercase tracking-[0.22em]"
              style={{ fontFamily: "Space Grotesk", color: "rgba(251,191,36,0.85)" }}
            >
              Current promotions
            </p>
            <div className="space-y-1">
              {live.slice(0, 6).map((p) => (
                <ComboRow key={p.id} promo={p} />
              ))}
            </div>
          </section>
        );
      })()}

      {posters.length === 0 && activePromos.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center">
          <p
            className="text-xl"
            style={{ fontFamily: "Peachi", fontWeight: 700, color: "rgba(245,243,240,0.55)" }}
          >
            Your order will appear here
          </p>
          <p
            className="mt-2 text-[11px] font-bold uppercase tracking-[0.18em]"
            style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.35)" }}
          >
            Tap your phone or enter your number to earn Beans
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Pair with a bite (cart has items) ───────────────────────
// "Make it a meal" pattern from McDonald's: cart is drink-heavy
// → surface a horizontal strip of bite-sized food items the
// customer can attach. Uses snapshot.usual filtered to known
// food/bakery categories so it's personalized when possible. If
// the member already has food in their cart, hides — no point
// repeating the suggestion. Cashier verbal pitch: "Add a
// croissant?" — the chip is the visual proof.
const BITE_CATEGORIES = new Set([
  "croissant",
  "cookies",
  "cakes",
  "sandwiches",
  "roti-bakar",
  "nasi-lemak",
  "fries",
]);
function PairWithABite({
  snapshot,
  items,
  coPurchase,
}: {
  snapshot: LoyaltySnapshot;
  items: { name: string; qty: number; amount: number; modifiers?: string }[];
  /** Real co-purchase suggestions from /api/loyalty/co-purchase —
   *  what other customers actually bought alongside the items
   *  currently in this cart. Already filtered to non-drink
   *  categories + cart exclusion + availability. Empty array when
   *  no historical signal exists; component falls back to
   *  category-diversified popular bites in that case. */
  coPurchase: BiteItem[];
}) {
  const cartItemNames = new Set(items.map((it) => it.name.toLowerCase()));

  // 1. Member's usual bites — personalized hits convert better than
  //    generic catalog suggestions (Starbucks "Usuals" pattern). We
  //    pattern-match by name since usual doesn't carry category.
  const usualBites: BiteItem[] = snapshot.usual
    .filter((u) => /croissant|cookie|cake|sandwich|roti|nasi|fries|toast|brownie|muffin|donut|pastry|chip/.test(u.name.toLowerCase()))
    .map((u) => ({
      id: u.id,
      name: u.name,
      category: "usual",
      price_sen: u.price_sen,
      image_url: u.image_url,
    }));

  // 2. Real co-purchase signal — what other customers actually
  //    bought alongside the items currently in this cart, scored
  //    against 12 months of StoreHub POS baskets. This is the
  //    highest-quality signal we have once the cart has items in
  //    it: it's behaviourally validated rather than category-
  //    guessed, and it adapts as the cashier rings up each new
  //    drink (Latte → croissant; Mocha → brownie; etc.). Already
  //    ordered server-side by basketBoost desc then co_count desc.
  const realPairs: BiteItem[] = coPurchase;

  // 3. Brand-wide popular bites pool — diversified + shuffled so the
  //    customer sees a fresh mix each visit instead of three cakes
  //    in a row (the side-effect when popular_bites is sorted by
  //    created_at and recent uploads cluster in one category).
  //    Used as a fallback for fresh products that don't have a
  //    co-purchase score yet (or when the RPC fetch is in-flight).
  //
  //    Diversification algorithm (mirrors pickup-native's pair-with
  //    intent of "one from each kind"):
  //      a. Group fallback bites by category.
  //      b. Shuffle each category's items independently.
  //      c. Round-robin one item per category, then loop again to
  //         fill remaining slots. This guarantees variety when
  //         multiple categories have stock and gracefully falls
  //         back to whatever category dominates when others are bare.
  const grouped = new Map<string, BiteItem[]>();
  for (const b of snapshot.popular_bites) {
    if (!grouped.has(b.category)) grouped.set(b.category, []);
    grouped.get(b.category)!.push(b);
  }
  const shuffled = (arr: BiteItem[]): BiteItem[] => {
    // Fisher-Yates — same RNG quality as Math.random() but does the
    // swap in place. Stable across React renders is NOT a goal here:
    // we want the order to change so the strip feels fresh.
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const byCategory = Array.from(grouped.entries()).map(
    ([cat, list]) => ({ cat, list: shuffled(list) }),
  );
  // Round-robin across categories until each is empty.
  const diversified: BiteItem[] = [];
  let cursor = 0;
  while (byCategory.some((g) => g.list.length > 0)) {
    const group = byCategory[cursor % byCategory.length];
    if (group.list.length > 0) diversified.push(group.list.shift()!);
    cursor++;
  }

  // 4. Merge in confidence order: usuals (member-personal) → real
  //    co-purchase (behaviourally validated) → diversified popular
  //    bites (catalog fallback). De-dupe by id, drop anything
  //    already in cart by name, cap at 4 tiles.
  const seen = new Set<string>();
  const merged: BiteItem[] = [];
  for (const b of [...usualBites, ...realPairs, ...diversified]) {
    if (seen.has(b.id)) continue;
    if (cartItemNames.has(b.name.toLowerCase())) continue;
    seen.add(b.id);
    merged.push(b);
    if (merged.length >= 4) break;
  }

  if (merged.length === 0) return null;

  return (
    <div className="mt-3">
      <p
        className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.22em]"
        style={{ fontFamily: "Space Grotesk", color: "rgba(251,191,36,0.85)" }}
      >
        Pair with a bite
      </p>
      {/* Full-width 4-up grid — tiles flex to fill the available
          row instead of leaving empty space on the right when only
          3 or 4 items returned. grid-cols-N (where N = actual
          merged count) means 1 item spans full width, 2 split it,
          etc. — never the dead "tiles bunched left, blank right"
          look of a horizontal-scroll strip at 3 items.
          aspect-[4/3] (was aspect-square) — the square shape made
          each tile ~210px tall in the 4-up layout, which dominated
          the cart panel; the 4:3 landscape ratio drops tile height
          by ~25% so the section reads as a supporting strip
          instead of a hero block, but the food imagery still
          sells the upsell at a glance. */}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${merged.length}, minmax(0, 1fr))` }}
      >
        {merged.map((b) => (
          <div
            key={b.id}
            className="flex flex-col rounded-xl border p-1.5"
            style={{
              borderColor: "rgba(245,243,240,0.10)",
              backgroundColor: "rgba(255,255,255,0.04)",
            }}
          >
            <div
              className="aspect-[4/3] w-full rounded-lg bg-cover bg-center"
              style={{
                backgroundImage: b.image_url ? `url(${b.image_url})` : undefined,
                backgroundColor: "rgba(245,243,240,0.06)",
              }}
            />
            <p
              className="mt-1 truncate text-[11px] leading-tight"
              style={{ fontFamily: "Peachi", fontWeight: 500, color: "#F5F3F0" }}
            >
              {b.name}
            </p>
            <p
              className="text-[10px]"
              style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.6)" }}
            >
              RM {(b.price_sen / 100).toFixed(2)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Combo offers (cart has items) ───────────────────────────
// "Suggest combo with offers" — surfaces ALL currently-live
// time-window combo promos so the customer can see what
// pairings would save them money on this order. Same data the
// empty-cart Current Promotions section uses, just framed
// differently because the customer is now mid-order.
function CurrentPromotions({ activePromos }: { activePromos: ActivePromo[] }) {
  // Every currently-claimable promotion — not just combo-named
  // ones. Previously this section filtered to promos with "+" /
  // "&" / "and" in the name, which hid live offers like
  // "Mocktails 20% off (test)" that customers can still save on.
  // Cashier feedback: "current promotions isn't visible in cart"
  // because those non-combo promos never made it through. Now we
  // show anything live, capped at 4.
  const promos = activePromos.filter((p) => p.live).slice(0, 4);

  if (promos.length === 0) return null;

  return (
    <div className="mt-3">
      <p
        className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.22em]"
        style={{ fontFamily: "Space Grotesk", color: "rgba(251,191,36,0.85)" }}
      >
        Current promotions
      </p>
      {/* Compact single-column list: savings pill leads, promo
          name flexes in the middle, time-window pinned right.
          Same ComboRow shape — neutral enough for any flavour. */}
      <div className="space-y-1">
        {promos.map((p) => (
          <ComboRow key={p.id} promo={p} />
        ))}
      </div>
    </div>
  );
}

/** Single-line combo row — savings chip on the left, combo name
 *  in the middle, time-window on the right. Only ever rendered for
 *  currently-live combos (parent filters). Urgent orange tint on the
 *  window label when <60min remaining. */
function ComboRow({ promo }: { promo: ActivePromo }) {
  const accent = promo.flavour === "time_window" ? "#FBBF24" : "#A2492C";
  const isUrgent = /left\)/.test(promo.window_label);
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5"
      style={{
        backgroundColor: `${accent}10`,
        borderColor: `${accent}33`,
      }}
    >
      <span
        className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em]"
        style={{
          fontFamily: "Space Grotesk",
          backgroundColor: accent,
          color: "#1A0200",
        }}
      >
        {promo.discount_label.replace(/^save\s+/i, "")}
      </span>
      <p
        className="min-w-0 flex-1 truncate text-[12px]"
        style={{ fontFamily: "Peachi", fontWeight: 500, color: "#F5F3F0" }}
      >
        {promo.name}
      </p>
      <span
        className="shrink-0 text-[9.5px] font-bold uppercase tracking-[0.1em]"
        style={{
          fontFamily: "Space Grotesk",
          color: isUrgent ? "#FFB070" : "rgba(245,243,240,0.55)",
        }}
      >
        {promo.window_label.replace(/^.*·\s*/, "")}
      </span>
    </div>
  );
}

// ─── Cart-aware suggestion (single hero card) ────────────────
// McDonald's "Make it a meal" pattern: ONE focused upsell, not a
// list. Research shows >40% take rate when there's one strong
// pairing prompt vs. choice-paralysis from multiple. Cashier reads
// it aloud while customer sees it — double exposure.
//
// Picks the highest-value nudge in priority order:
//   1. Threshold nudge — cart is past 50% of a spend mission and
//      "X more" closes the gap (concrete + earns bonus Beans).
//   2. Combo pair — an active time-window combo whose name
//      signals a pairing (Classic + Sandwich, Pasta + Mocktail).
// Only one card renders, sized big with the savings dollar prominent
// so the value lands at a glance.
function CartSuggestions({
  snapshot,
  items: _items,
  subtotalSen,
}: {
  snapshot: LoyaltySnapshot;
  items: { name: string; qty: number; amount: number; modifiers?: string }[];
  subtotalSen: number;
}) {
  // ─── Threshold nudge (winning candidate first) ────────────
  const nearestThreshold = snapshot.missions
    .filter((m) => m.unit === "sen" && m.status === "active")
    .map((m) => ({
      m,
      live: subtotalSen,
      target: m.progress_target,
    }))
    .filter((x) => x.live > 0 && x.live < x.target)
    .map((x) => ({ ...x, remaining: x.target - x.live }))
    .filter((x) => x.remaining <= x.target * 0.5)
    .sort((a, b) => a.remaining - b.remaining)[0];

  if (nearestThreshold) {
    const remRm = Math.ceil(nearestThreshold.remaining / 100);
    const bonusBeans = nearestThreshold.m.reward_bonus_beans;
    return (
      <HeroSuggestion
        savings={`RM ${remRm}`}
        savingsCaption="more to unlock"
        title={nearestThreshold.m.title}
        sub={
          bonusBeans > 0
            ? `Earn +${bonusBeans} bonus Beans on this order`
            : (nearestThreshold.m.description || "Complete this challenge")
        }
        cta="Almost there"
        accent="#FBBF24"
      />
    );
  }

  // ─── Combo pair nudge (fallback) ──────────────────────────
  const pair = snapshot.active_promos
    .filter((p) => p.flavour === "time_window")
    .find((p) => {
      const n = p.name.toLowerCase();
      return n.includes("+") || n.includes("&") || /\band\b/.test(n);
    });

  if (pair) {
    // Pull the "Save RM X" or "X% off" out into the giant
    // savings slot. The promo name + window go in the body.
    return (
      <HeroSuggestion
        savings={pair.discount_label.replace(/^save\s+/i, "").toUpperCase()}
        savingsCaption="if you add a combo"
        title={pair.name}
        sub={pair.window_label}
        cta="Add to cart"
        accent="#A2492C"
      />
    );
  }

  return null;
}

/** McDonald's-style single hero pairing card. Savings number is
 *  the visual centerpiece — biggest text on the card — so the
 *  value reads in <1s. Title + sub give context for the cashier's
 *  verbal pitch. CTA pill on the right signals tappability. */
function HeroSuggestion({
  savings,
  savingsCaption,
  title,
  sub,
  cta,
  accent,
}: {
  savings: string;
  savingsCaption: string;
  title: string;
  sub: string;
  cta: string;
  accent: string;
}) {
  return (
    <div className="mt-3">
      <p
        className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.22em]"
        style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.5)" }}
      >
        Save more on this order
      </p>
      <div
        className="flex items-center gap-4 rounded-2xl border p-4"
        style={{
          backgroundColor: `${accent}14`,
          borderColor: `${accent}55`,
        }}
      >
        {/* Big savings tile — anchors the eye. */}
        <div className="shrink-0 text-center">
          <p
            className="text-3xl leading-none"
            style={{ fontFamily: "Peachi", fontWeight: 700, color: accent }}
          >
            {savings}
          </p>
          <p
            className="mt-1 text-[9px] font-bold uppercase tracking-[0.16em]"
            style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.5)" }}
          >
            {savingsCaption}
          </p>
        </div>
        {/* Title + sub */}
        <div className="min-w-0 flex-1 border-l pl-4" style={{ borderColor: `${accent}40` }}>
          <p
            className="text-base leading-tight"
            style={{ fontFamily: "Peachi", fontWeight: 700, color: "#F5F3F0" }}
          >
            {title}
          </p>
          <p
            className="mt-1 text-[12px]"
            style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.7)" }}
          >
            {sub}
          </p>
        </div>
        {/* CTA pill — affordance for cashier-side tap. */}
        <span
          className="shrink-0 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em]"
          style={{
            fontFamily: "Space Grotesk",
            backgroundColor: accent,
            color: "#1A0200",
          }}
        >
          {cta} ›
        </span>
      </div>
    </div>
  );
}

/** Today's-offer tile — surfaces a live auto-promo. Research from
 *  Clover/QSR kiosks: making the savings the BIGGEST element on the
 *  card is the single highest-leverage visual change for combo
 *  conversion. So we lead with the dollar value (huge Peachi), then
 *  the combo name, then the window (small caps with urgency
 *  highlight when <60min left).
 *
 *  Non-live combos (e.g. an 8am combo viewed at 3pm) render dimmed
 *  with an "Available {window}" label so the customer reads them as
 *  forward-looking AOV intent, not a current claim. */
function PromoTile({ promo }: { promo: ActivePromo }) {
  const accent = promo.flavour === "time_window" ? "#FBBF24" : "#A2492C";
  const bg =
    promo.flavour === "time_window"
      ? "rgba(251,191,36,0.10)"
      : "rgba(162,73,44,0.12)";
  const border =
    promo.flavour === "time_window"
      ? "rgba(251,191,36,0.32)"
      : "rgba(162,73,44,0.32)";
  // Urgency window highlight — when the window_label says "Xm left"
  // (only set for <60 min remaining in snapshot), pulse the text.
  const isUrgent = /left\)/.test(promo.window_label);
  const dimmed = !promo.live;
  return (
    <div
      className="flex flex-col rounded-xl border p-3 transition"
      style={{
        backgroundColor: dimmed ? "rgba(255,255,255,0.03)" : bg,
        borderColor: dimmed ? "rgba(245,243,240,0.10)" : border,
        opacity: dimmed ? 0.7 : 1,
      }}
    >
      {/* Big savings amount — leads the eye. Strip "Save " prefix
          since the heading already implies it; "RM 2" alone hits
          harder than "Save RM 2" in small text. */}
      <p
        className="text-2xl leading-none"
        style={{
          fontFamily: "Peachi",
          fontWeight: 700,
          color: dimmed ? "rgba(245,243,240,0.55)" : accent,
        }}
      >
        {promo.discount_label.replace(/^save\s+/i, "")}
      </p>
      <p
        className="mt-1 text-[9px] font-bold uppercase tracking-[0.18em]"
        style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.5)" }}
      >
        off this combo
      </p>
      <p
        className="mt-2 line-clamp-2 text-[13px] leading-tight"
        style={{ fontFamily: "Peachi", fontWeight: 700, color: "#F5F3F0" }}
      >
        {promo.name}
      </p>
      <p
        className="mt-auto pt-1.5 text-[10px] font-bold uppercase tracking-[0.14em]"
        style={{
          fontFamily: "Space Grotesk",
          color: isUrgent
            ? "#FFB070"
            : dimmed
              ? "rgba(245,243,240,0.4)"
              : "rgba(245,243,240,0.45)",
        }}
      >
        {dimmed ? `Available ${promo.window_label}` : promo.window_label}
      </p>
    </div>
  );
}

/** Featured-challenge card — bigger than the right-panel ChallengeRow
 *  version because here it's the hero "come back for this" message.
 *  Shows progress bar + bonus Beans copy + remaining-to-go. */
function FeaturedChallenge({ mission }: { mission: MissionCard }) {
  const pct = Math.min(
    100,
    Math.round((mission.progress_current / Math.max(mission.progress_target, 1)) * 100),
  );
  const isSpend = mission.unit === "sen";
  const current = isSpend
    ? Math.floor(mission.progress_current / 100)
    : mission.progress_current;
  const target = isSpend
    ? Math.floor(mission.progress_target / 100)
    : mission.progress_target;
  const remaining = Math.max(0, target - current);
  const remainingLabel = isSpend ? `RM ${remaining} more` : `${remaining} more`;
  return (
    <div
      className="mt-2 rounded-2xl border p-4"
      style={{
        borderColor: "rgba(251,191,36,0.32)",
        backgroundColor: "rgba(251,191,36,0.08)",
      }}
    >
      <p
        className="text-[10px] font-bold uppercase tracking-[0.2em]"
        style={{ fontFamily: "Space Grotesk", color: "#FBBF24" }}
      >
        Challenge
        {mission.reward_bonus_beans > 0 && (
          <span style={{ color: "rgba(245,243,240,0.6)" }}>
            {" "}· +{mission.reward_bonus_beans} Beans
          </span>
        )}
      </p>
      <p
        className="mt-1 text-xl"
        style={{ fontFamily: "Peachi", fontWeight: 700, color: "#F5F3F0", lineHeight: 1.2 }}
      >
        {mission.title}
      </p>
      {mission.description && (
        <p
          className="mt-1 text-sm"
          style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.6)" }}
        >
          {mission.description}
        </p>
      )}
      <div className="mt-3">
        <div
          className="h-2 overflow-hidden rounded-full"
          style={{ backgroundColor: "rgba(251,191,36,0.15)" }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: "#FBBF24" }}
          />
        </div>
        <p
          className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.14em]"
          style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.55)" }}
        >
          {isSpend ? `RM ${current}` : current} / {isSpend ? `RM ${target}` : target}
          {remaining > 0 && (
            <span style={{ color: "#FBBF24" }}> · {remainingLabel} to go</span>
          )}
        </p>
      </div>
    </div>
  );
}

// ─── Pending-member skeleton ──────────────────────────────────
// Shown for the brief window between the register identifying a
// member (via Customer Lookup) and the customer-display fetching the
// full snapshot. We have minimal data from the broadcast (name +
// beans balance); the rest fills in once snapshot arrives.
function PendingMemberPanel({
  memberName,
  pointsBalance,
  onSignOut,
}: {
  memberName: string | null;
  pointsBalance: number;
  onSignOut: () => void;
}) {
  const firstName = memberName?.split(" ")[0] ?? "there";
  // If the snapshot fetch hasn't landed within 8s the customer is
  // staring at a spinner with no recourse — surface a Sign Out
  // option so they can recover the screen for the next customer.
  // The retry safety net (above) is already firing every 2.5s; this
  // is just the human escape hatch when retries don't help.
  const [showEscape, setShowEscape] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setShowEscape(true), 8000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="cd-fade-in flex flex-1 flex-col items-center justify-center p-6 text-center">
      <p
        className="text-[11px] font-bold uppercase tracking-[0.22em]"
        style={{ fontFamily: "Space Grotesk", color: "rgba(251,191,36,0.85)" }}
      >
        Welcome back
      </p>
      <p
        className="mt-2 text-2xl"
        style={{ fontFamily: "Peachi", fontWeight: 700, color: "#F5F3F0" }}
      >
        Hi, {firstName}
      </p>
      <p
        className="mt-3 text-3xl"
        style={{ fontFamily: "Peachi", fontWeight: 700, color: "#FBBF24" }}
      >
        {pointsBalance.toLocaleString()}
      </p>
      <p
        className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em]"
        style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.55)" }}
      >
        Beans
      </p>
      {/* Subtle pulsing dot — signals snapshot in flight without
          competing with the welcome copy. */}
      <div className="mt-6 flex items-center gap-2">
        <span
          className="nfc-pulse h-2 w-2 rounded-full"
          style={{ backgroundColor: "#FBBF24", opacity: 0.6 }}
        />
        <span
          className="text-[10px] font-bold uppercase tracking-[0.16em]"
          style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.45)" }}
        >
          Loading your rewards…
        </span>
      </div>
      {showEscape && (
        <button
          onClick={onSignOut}
          className="mt-6 rounded-xl border px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] transition"
          style={{
            fontFamily: "Space Grotesk",
            borderColor: "rgba(245,243,240,0.18)",
            color: "rgba(245,243,240,0.55)",
          }}
        >
          Sign out
        </button>
      )}
    </div>
  );
}

// ─── Compact phone entry (in OrderingScreen right column) ──────
function CompactPhoneEntry({
  phoneInput,
  setPhoneInput,
  loading,
  errorMsg,
  nfcAvailable,
  onSubmit,
}: {
  phoneInput: string;
  setPhoneInput: (v: string) => void;
  loading: boolean;
  errorMsg: string | null;
  nfcAvailable: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="cd-fade-in flex flex-1 flex-col items-center justify-center p-5">
      <p
        className="text-center text-xl"
        style={{ fontFamily: "Peachi", fontWeight: 700, color: "#F5F3F0" }}
      >
        Earn Beans on this order
      </p>
      <p
        className="mt-1 text-center text-[11px] font-bold uppercase tracking-[0.18em]"
        style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.55)" }}
      >
        {nfcAvailable ? "Tap your phone here, or enter number" : "Enter your phone to use rewards"}
      </p>

      {nfcAvailable && <NfcPulseIndicator />}

      <NumpadPanel
        phoneInput={phoneInput}
        setPhoneInput={setPhoneInput}
        loading={loading}
        errorMsg={errorMsg}
        onSubmit={onSubmit}
      />
    </div>
  );
}

// ─── Shared numpad — used by both the full-screen welcome and the
// side-panel compact view, so the customer sees the SAME phone box
// + buttons in either context. 340px wide is the natural width that
// fits the side panel (380px with 20px padding) AND looks centered
// on the larger welcome surface. ────────────────────────────────
function NumpadPanel({
  phoneInput,
  setPhoneInput,
  loading,
  errorMsg,
  onSubmit,
}: {
  phoneInput: string;
  setPhoneInput: (v: string) => void;
  loading: boolean;
  errorMsg: string | null;
  onSubmit: () => void;
}) {
  const press = (d: string) => {
    if (phoneInput.length >= 13) return;
    setPhoneInput(phoneInput + d);
  };
  const back = () => setPhoneInput(phoneInput.slice(0, -1));
  const clear = () => setPhoneInput("");
  const canSubmit = phoneInput.replace(/\D/g, "").length >= 9 && !loading;

  const numpadBtn = {
    backgroundColor: "rgba(245,243,240,0.04)",
    border: "1px solid rgba(245,243,240,0.10)",
    color: "#F5F3F0",
  } as const;

  return (
    <div className="mt-6 w-[340px]">
      <div
        className="flex h-14 items-center justify-center rounded-2xl text-2xl tracking-wider"
        style={{
          // Space Grotesk — NOT Peachi. The licensed Peachi font we
          // ship is a display face that's missing several glyphs we
          // use here (`+`, `/`, `…`, and even the `4` digit), and
          // when a glyph is missing the font shows a "demo"
          // watermark fallback. Numerals + symbols always go through
          // Space Grotesk which has full coverage.
          fontFamily: "Space Grotesk",
          fontWeight: 500,
          border: "1.5px solid rgba(245,243,240,0.18)",
          backgroundColor: "rgba(245,243,240,0.04)",
        }}
      >
        {phoneInput || (
          <span style={{ color: "rgba(245,243,240,0.30)" }}>+60 / 01x…</span>
        )}
      </div>
      {errorMsg && (
        <p
          className="mt-3 text-center text-sm"
          style={{ fontFamily: "Space Grotesk", color: "#FCA5A5" }}
        >
          {errorMsg}
        </p>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            onClick={() => press(d)}
            className="h-16 rounded-2xl text-2xl transition active:scale-95"
            // Same Peachi-coverage issue as the input above — the
            // "4" digit renders as the demo watermark in Peachi.
            // Space Grotesk has all digits clean.
            style={{ ...numpadBtn, fontFamily: "Space Grotesk", fontWeight: 700 }}
          >
            {d}
          </button>
        ))}
        <button
          onClick={clear}
          className="h-16 rounded-2xl text-[11px] font-bold uppercase tracking-[0.14em]"
          style={{ ...numpadBtn, fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.55)" }}
        >
          Clear
        </button>
        <button
          onClick={() => press("0")}
          className="h-16 rounded-2xl text-2xl transition active:scale-95"
          style={{ ...numpadBtn, fontFamily: "Space Grotesk", fontWeight: 700 }}
        >
          0
        </button>
        <button
          onClick={back}
          className="h-16 rounded-2xl text-xl"
          style={{ ...numpadBtn, color: "rgba(245,243,240,0.55)" }}
        >
          ⌫
        </button>
      </div>

      <button
        onClick={onSubmit}
        disabled={!canSubmit}
        className="mt-4 h-12 w-full rounded-2xl text-[12px] font-bold uppercase tracking-[0.18em] transition active:scale-95 disabled:cursor-not-allowed"
        style={{
          fontFamily: "Space Grotesk",
          backgroundColor: canSubmit ? "#FBBF24" : "rgba(245,243,240,0.08)",
          color: canSubmit ? "#1A0200" : "rgba(245,243,240,0.35)",
        }}
      >
        {loading ? "Loading…" : "View My Rewards"}
      </button>
    </div>
  );
}

// ─── Inline Pay block (pinned to bottom of right panel) ───────
// Compact horizontal layout: amount + Maybank pill on the left,
// QR code on the right. Lives below the rewards content so it's
// always visible the moment the cart has something to charge —
// the customer can scan while still browsing rewards above. No
// modal flip, no Pay tab.
// ─── Full-screen payment view ────────────────────────────────
// Replaces the old inline pinned-bottom QR block. Activated when
// register broadcasts status="payment" (cashier hit Charge →
// CheckoutModal opened). Takes over the whole second screen with
// the amount + QR enormous so the customer can scan from across
// the counter. Reverts to OrderingScreen when status flips back
// to "ordering" (modal closed) or "complete" (paid).
function PaymentScreen({
  canvasRef,
  merchantId,
  total,
  orderNumber,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  merchantId: string | null;
  total: number;
  orderNumber?: string;
}) {
  return (
    <div
      className="cd-fade-in flex h-screen flex-col items-center justify-center px-8"
      style={{ backgroundColor: PAGE_BG, color: "#F5F3F0" }}
    >
      <p
        className="text-[11px] font-bold uppercase tracking-[0.22em]"
        style={{ fontFamily: "Space Grotesk", color: "rgba(251,191,36,0.85)" }}
      >
        Scan to Pay
      </p>
      <p
        className="mt-4 text-7xl"
        style={{ fontFamily: "Peachi", fontWeight: 700, color: "#FBBF24" }}
      >
        {formatSen(total)}
      </p>
      {/* QR or a clearly-visible fallback. Previously `merchantId`
          gated only the QRCode draw effect; if a new outlet wasn't
          in MAYBANK_MERCHANT_IDS (added later, typo, etc), the
          payment screen rendered with a blank white square and no
          one noticed — customer stood there with nothing to scan,
          cashier saw no error, transaction quietly stalled.
          Now: when merchantId is missing, show an explicit "Pay
          at counter" prompt so the cashier knows to fall back to
          terminal/cash. */}
      {merchantId ? (
        <>
          <div className="mt-8 rounded-3xl bg-white p-5">
            <canvas ref={canvasRef} className="h-[280px] w-[280px]" />
          </div>
          <div className="mt-5 flex items-center gap-2">
            <span
              className="text-lg"
              style={{ fontFamily: "Peachi", fontWeight: 700, color: "#FBBF24" }}
            >
              Maybank
            </span>
            <span
              className="text-[11px] font-bold uppercase tracking-[0.18em]"
              style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.55)" }}
            >
              DuitNow QR
            </span>
          </div>
          <p
            className="mt-2 text-[11px]"
            style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.4)" }}
          >
            {merchantId}
          </p>
        </>
      ) : (
        <div
          className="mt-8 rounded-3xl border px-8 py-10 text-center"
          style={{ borderColor: "rgba(251,191,36,0.35)", backgroundColor: "rgba(251,191,36,0.08)" }}
        >
          <p
            className="text-2xl"
            style={{ fontFamily: "Peachi", fontWeight: 700, color: "#FBBF24" }}
          >
            Pay at the counter
          </p>
          <p
            className="mt-2 text-sm"
            style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.7)" }}
          >
            DuitNow QR not configured for this outlet.<br />
            Cashier: use card or cash.
          </p>
        </div>
      )}
      {orderNumber && (
        <p
          className="mt-6 text-[10px] font-bold uppercase tracking-[0.22em]"
          style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.45)" }}
        >
          Order #{orderNumber}
        </p>
      )}
    </div>
  );
}

function InlinePayBlock({
  canvasRef,
  merchantId,
  total,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  merchantId: string | null;
  total: number;
}) {
  return (
    <div className="flex items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p
          className="text-[9px] font-bold uppercase tracking-[0.22em]"
          style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.55)" }}
        >
          Scan to Pay
        </p>
        <p
          className="mt-1 text-2xl leading-none"
          style={{ fontFamily: "Peachi", fontWeight: 700, color: "#FBBF24" }}
        >
          {formatSen(total)}
        </p>
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className="text-[10px] font-bold uppercase tracking-[0.12em]"
            style={{ fontFamily: "Space Grotesk", color: "#FBBF24" }}
          >
            Maybank
          </span>
          <span
            className="text-[9px] uppercase tracking-[0.14em]"
            style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.45)" }}
          >
            DuitNow QR
          </span>
        </div>
        {merchantId && (
          <p
            className="mt-0.5 text-[9px]"
            style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.35)" }}
          >
            {merchantId}
          </p>
        )}
      </div>
      <div className="shrink-0 rounded-xl bg-white p-2">
        <canvas ref={canvasRef} className="h-[120px] w-[120px]" />
      </div>
    </div>
  );
}

// ─── NFC pulse indicator ─────────────────────────────────────
// Animated tap-here cue shown beneath the welcome copy whenever the
// second-display NFC reader is active. Uses the `nfc-pulse` keyframe
// in globals.css. The compact variant tightens spacing for the
// in-OrderingScreen side panel.
function NfcPulseIndicator({ compact }: { compact?: boolean }) {
  const size = compact ? 56 : 80;
  return (
    <div
      className={compact ? "mt-2 flex flex-col items-center" : "mt-5 flex flex-col items-center"}
    >
      <div
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: size,
          height: size,
        }}
      >
        <span
          className="nfc-pulse absolute inset-0 rounded-full"
          style={{
            backgroundColor: "#FBBF24",
            opacity: 0.4,
          }}
        />
        <span
          className="nfc-pulse absolute inset-0 rounded-full"
          style={{
            backgroundColor: "#FBBF24",
            opacity: 0.25,
            animationDelay: "0.7s",
          }}
        />
        <div
          className="relative flex items-center justify-center rounded-full"
          style={{
            width: size * 0.55,
            height: size * 0.55,
            backgroundColor: "#FBBF24",
            color: "#1A0200",
          }}
        >
          {/* NFC-ish glyph: three radio arcs over a base */}
          <svg width={size * 0.34} height={size * 0.34} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12a7 7 0 0114 0" />
            <path d="M8.5 12a3.5 3.5 0 017 0" />
            <circle cx="12" cy="12" r="1" />
          </svg>
        </div>
      </div>
      <p
        className={compact ? "mt-2 text-[9px]" : "mt-2 text-[10px]"}
        style={{
          fontFamily: "Space Grotesk",
          fontWeight: 700,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "rgba(251,191,36,0.85)",
        }}
      >
        Tap to identify
      </p>
    </div>
  );
}
