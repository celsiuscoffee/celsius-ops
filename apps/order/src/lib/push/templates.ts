import { sendExpoPush, type SendResult } from "./send";
import { tokensForPhone, tokensForMember, tokensForOrder, tokensForBroadcast } from "./tokens";

/**
 * Push notification templates — one function per customer-facing
 * flow. Each function knows:
 *   - who to deliver to (calls into tokens.ts)
 *   - what the title / body / data payload should look like
 *   - which channel / category to land in
 *
 * Senders are fire-and-forget by convention: callers don't await,
 * and the function swallows its own errors so a push miss never
 * fails a checkout / status update / etc.
 *
 * Add a new flow → add a new exported function here. Don't call
 * `sendExpoPush` directly from any other route.
 */

const CH_ORDER   = "order-status";
const CH_LOYALTY = "loyalty";
const CH_PROMO   = "promotions";

/* ────────────────────────────────────────────────────────────────────────── */
/* Order lifecycle                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

/** Order has been placed and we're waiting on payment / starting prep.
 *  Suppressed for instant-pay flows where the next state is preparing —
 *  the customer doesn't need two pings 5 seconds apart. */
export async function notifyOrderPlaced(args: {
  orderId:     string;
  orderNumber: string;
  customerPhone: string | null;
  etaMinutes?: number;
}): Promise<SendResult> {
  if (!args.customerPhone) return zero();
  const tokens = await tokensForPhone(args.customerPhone);
  if (tokens.length === 0) return zero();
  const eta = args.etaMinutes ? ` · ready in ~${args.etaMinutes} min` : "";
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: `Order #${args.orderNumber} received`,
      body:  `We've got your order${eta}`,
      sound: "default",
      channelId:  CH_ORDER,
      categoryId: `order-${args.orderId}`,
      data: { type: "order_placed", orderId: args.orderId, orderNumber: args.orderNumber },
    })),
  );
}

/** Payment confirmed — only fired when there's a real gap between
 *  /api/orders and the payment webhook (e.g. FPX, Stripe redirect). */
export async function notifyOrderPaid(args: {
  orderId:     string;
  orderNumber: string;
  customerPhone: string | null;
}): Promise<SendResult> {
  if (!args.customerPhone) return zero();
  const tokens = await tokensForPhone(args.customerPhone);
  if (tokens.length === 0) return zero();
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: "Payment confirmed",
      body:  `Order #${args.orderNumber} — we're starting on it now`,
      sound: "default",
      channelId:  CH_ORDER,
      categoryId: `order-${args.orderId}`,
      data: { type: "order_paid", orderId: args.orderId, orderNumber: args.orderNumber },
    })),
  );
}

/** Barista has started the order. Optional — many shops skip this
 *  to avoid notification fatigue between Paid and Ready. */
export async function notifyOrderPreparing(args: {
  orderId:     string;
  orderNumber: string;
  customerPhone: string | null;
}): Promise<SendResult> {
  if (!args.customerPhone) return zero();
  const tokens = await tokensForPhone(args.customerPhone);
  if (tokens.length === 0) return zero();
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: "Brewing now ☕",
      body:  `Order #${args.orderNumber} is being prepared`,
      sound: "default",
      channelId:  CH_ORDER,
      categoryId: `order-${args.orderId}`,
      data: { type: "order_preparing", orderId: args.orderId, orderNumber: args.orderNumber },
    })),
  );
}

/** Order is ready at the counter. THE critical push. requireInteraction
 *  via Android high priority so the lock screen stays lit until
 *  customer acknowledges. */
export async function notifyOrderReady(args: {
  orderId:     string;
  orderNumber: string;
  customerPhone: string | null;
}): Promise<SendResult> {
  if (!args.customerPhone) return zero();
  const tokens = await tokensForPhone(args.customerPhone);
  if (tokens.length === 0) return zero();
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: "🎉 Order Ready!",
      body:  `Your order #${args.orderNumber} is ready for pickup`,
      sound: "default",
      priority:   "high",
      channelId:  CH_ORDER,
      categoryId: `order-${args.orderId}`,
      data: { type: "order_ready", orderId: args.orderId, orderNumber: args.orderNumber },
    })),
  );
}

/** Customer collected the drink. Used to nudge for points balance
 *  visibility ("you earned X points"). */
export async function notifyOrderCompleted(args: {
  orderId:     string;
  orderNumber: string;
  customerPhone: string | null;
  pointsEarned?: number;
}): Promise<SendResult> {
  if (!args.customerPhone) return zero();
  const tokens = await tokensForPhone(args.customerPhone);
  if (tokens.length === 0) return zero();
  const pts = args.pointsEarned && args.pointsEarned > 0
    ? `You earned ${args.pointsEarned} points · `
    : "";
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: "Enjoy your drink ☕",
      body:  `${pts}Thanks for choosing Celsius Coffee`,
      sound: "default",
      channelId:  CH_ORDER,
      categoryId: `order-${args.orderId}`,
      data: { type: "order_completed", orderId: args.orderId, orderNumber: args.orderNumber, pointsEarned: args.pointsEarned },
    })),
  );
}

/** Cancelled or failed payment. Surfaces a refund timeline if a
 *  charge was captured. */
export async function notifyOrderCancelled(args: {
  orderId:     string;
  orderNumber: string;
  customerPhone: string | null;
  refundExpected?: boolean;
  reason?:     string;
}): Promise<SendResult> {
  if (!args.customerPhone) return zero();
  const tokens = await tokensForPhone(args.customerPhone);
  if (tokens.length === 0) return zero();
  const tail = args.refundExpected
    ? "Your refund will land in 3-5 business days"
    : args.reason ?? "Please try again or contact support";
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: "Order cancelled",
      body:  `Order #${args.orderNumber} — ${tail}`,
      sound: "default",
      channelId:  CH_ORDER,
      categoryId: `order-${args.orderId}`,
      data: { type: "order_cancelled", orderId: args.orderId, orderNumber: args.orderNumber, reason: args.reason },
    })),
  );
}

/** Refund processed (Stripe webhook). */
export async function notifyOrderRefunded(args: {
  orderId:       string;
  orderNumber:   string;
  customerPhone: string | null;
  amountRm:      number;
}): Promise<SendResult> {
  if (!args.customerPhone) return zero();
  const tokens = await tokensForPhone(args.customerPhone);
  if (tokens.length === 0) return zero();
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: "Refund processed",
      body:  `RM${args.amountRm.toFixed(2)} for order #${args.orderNumber} is on its way back`,
      sound: "default",
      channelId:  CH_ORDER,
      data: { type: "order_refunded", orderId: args.orderId, amountRm: args.amountRm },
    })),
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Loyalty / rewards                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

/** Customer just earned points (post-purchase). Optional — many
 *  brands skip this because the order_completed push already
 *  surfaces the number. Wire only if you want a distinct ping
 *  separate from the order flow (e.g. for non-app earn paths). */
export async function notifyPointsEarned(args: {
  memberId: string;
  points:   number;
  balance:  number;
}): Promise<SendResult> {
  if (args.points <= 0) return zero();
  const tokens = await tokensForMember(args.memberId);
  if (tokens.length === 0) return zero();
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: `+${args.points} points`,
      body:  `You now have ${args.balance.toLocaleString()} points to redeem`,
      sound: "default",
      channelId: CH_LOYALTY,
      data: { type: "points_earned", points: args.points, balance: args.balance },
    })),
  );
}

/** Tier promotion (Member → Silver, Silver → Gold, etc.). */
export async function notifyTierUpgrade(args: {
  memberId:    string;
  newTierName: string;
  multiplier:  number;
}): Promise<SendResult> {
  const tokens = await tokensForMember(args.memberId);
  if (tokens.length === 0) return zero();
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: `🎉 You're now ${args.newTierName}!`,
      body:  `Enjoy ${formatMul(args.multiplier)}× points on every purchase + new perks`,
      sound: "default",
      priority: "high",
      channelId: CH_LOYALTY,
      data: { type: "tier_upgrade", tier: args.newTierName, multiplier: args.multiplier },
    })),
  );
}

/** Soft warning that the customer is about to lose their current
 *  tier (oldest qualifying transactions about to roll out of the
 *  90-day window). Driven by a daily cron — see notes below. */
export async function notifyTierAtRisk(args: {
  memberId:     string;
  currentTier:  string;
  cupsShort:    number;
  daysLeft:     number;
}): Promise<SendResult> {
  const tokens = await tokensForMember(args.memberId);
  if (tokens.length === 0) return zero();
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: `Keep your ${args.currentTier} status`,
      body:  `${args.cupsShort} cup${args.cupsShort === 1 ? "" : "s"} in the next ${args.daysLeft} days keeps you ${args.currentTier}`,
      sound: "default",
      channelId: CH_LOYALTY,
      data: { type: "tier_at_risk", tier: args.currentTier, cupsShort: args.cupsShort, daysLeft: args.daysLeft },
    })),
  );
}

/** Birthday — fired on the customer's birthday with the birthday
 *  drink voucher attached. The voucher itself is issued by a
 *  separate cron / RPC; this just notifies. */
export async function notifyBirthdayReward(args: {
  memberId:    string;
  firstName?:  string;
  rewardName?: string;
}): Promise<SendResult> {
  const tokens = await tokensForMember(args.memberId);
  if (tokens.length === 0) return zero();
  const who = args.firstName ? `${args.firstName}, ` : "";
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: `🎂 Happy birthday${args.firstName ? ", " + args.firstName : ""}!`,
      body:  `${who}your free ${args.rewardName ?? "birthday drink"} is in the app — pick it up any day this month`,
      sound: "default",
      priority: "high",
      channelId: CH_LOYALTY,
      data: { type: "birthday", memberId: args.memberId },
    })),
  );
}

/** Welcome flow — fired after a customer's first paid order, when
 *  the auto-issued welcome BOGO voucher lands in their account. */
export async function notifyWelcomeBonus(args: {
  memberId:    string;
  rewardName?: string;
}): Promise<SendResult> {
  const tokens = await tokensForMember(args.memberId);
  if (tokens.length === 0) return zero();
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: "Welcome to Celsius ☕",
      body:  `Your ${args.rewardName ?? "Buy 1 Free 1"} voucher is waiting in the app`,
      sound: "default",
      priority: "high",
      channelId: CH_LOYALTY,
      data: { type: "welcome_bonus", memberId: args.memberId },
    })),
  );
}

/** Reward / voucher about to expire — daily cron sweeps issued_rewards
 *  where expires_at is in (today, today+3) days. */
export async function notifyRewardExpiring(args: {
  memberId:    string;
  rewardName:  string;
  daysLeft:    number;
}): Promise<SendResult> {
  const tokens = await tokensForMember(args.memberId);
  if (tokens.length === 0) return zero();
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: "Don't let this slip away",
      body:  `Your ${args.rewardName} expires in ${args.daysLeft} day${args.daysLeft === 1 ? "" : "s"}`,
      sound: "default",
      channelId: CH_LOYALTY,
      data: { type: "reward_expiring", rewardName: args.rewardName, daysLeft: args.daysLeft },
    })),
  );
}

/** A reward has been gifted to a member (admin / promo / referral). */
export async function notifyVoucherGifted(args: {
  memberId:    string;
  rewardName:  string;
}): Promise<SendResult> {
  const tokens = await tokensForMember(args.memberId);
  if (tokens.length === 0) return zero();
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: "A gift from Celsius 🎁",
      body:  `A ${args.rewardName} just landed in your app — open to redeem`,
      sound: "default",
      priority: "high",
      channelId: CH_LOYALTY,
      data: { type: "voucher_gifted", rewardName: args.rewardName },
    })),
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Engagement / re-engagement                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

/** Soft re-engagement nudge — "haven't seen you in a while". Driven
 *  by a weekly cron that targets customers whose last_visit_at is
 *  > 14 days ago. Suppress if they have an active order. */
export async function notifyMissYou(args: {
  memberId:    string;
  firstName?:  string;
}): Promise<SendResult> {
  const tokens = await tokensForMember(args.memberId);
  if (tokens.length === 0) return zero();
  const who = args.firstName ? `${args.firstName}, w` : "W";
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: "We've been saving your spot",
      body:  `${who}e brewed something new — see what's on the menu`,
      sound: "default",
      channelId: CH_PROMO,
      data: { type: "miss_you", memberId: args.memberId },
    })),
  );
}

/** "Your usual?" — fired in the morning to customers whose top
 *  product is a regular drink (driven by a 7am cron that reads
 *  recent_items per member). Soft promo channel so it can be muted. */
export async function notifyUsualNudge(args: {
  memberId:        string;
  usualDrinkName:  string;
}): Promise<SendResult> {
  const tokens = await tokensForMember(args.memberId);
  if (tokens.length === 0) return zero();
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: `${args.usualDrinkName} morning?`,
      body:  "Skip the queue — order ahead in the app",
      sound: "default",
      channelId: CH_PROMO,
      data: { type: "usual_nudge", drink: args.usualDrinkName },
    })),
  );
}

/** Broadcast — new product launch / promo poster. Admin-gated via
 *  the backoffice `/api/push/expo-blast` route. */
export async function notifyBroadcast(args: {
  title:    string;
  body:     string;
  deeplink?: string;
}): Promise<SendResult> {
  const tokens = await tokensForBroadcast();
  if (tokens.length === 0) return zero();
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: args.title,
      body:  args.body,
      sound: "default",
      channelId: CH_PROMO,
      data: { type: "broadcast", deeplink: args.deeplink ?? null },
    })),
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Account                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/** Profile change confirmation (email change, etc.). Low priority —
 *  in-app banner usually preferred. Wire only if the change is
 *  security-sensitive (e.g. phone number swap once supported). */
export async function notifyProfileChanged(args: {
  memberId: string;
  field:    string;
}): Promise<SendResult> {
  const tokens = await tokensForMember(args.memberId);
  if (tokens.length === 0) return zero();
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: "Profile updated",
      body:  `Your ${args.field} has been updated`,
      sound: null,
      channelId: CH_LOYALTY,
      data: { type: "profile_changed", field: args.field },
    })),
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Rewards v2 — missions, vouchers, claimables                                */
/* ────────────────────────────────────────────────────────────────────────── */

/** Mission completion. Fires right after applyOrderToMission flips the
 *  assignment to 'completed' and issues the configured vouchers. */
export async function notifyMissionCompleted(args: {
  memberId: string;
  missionTitle: string;
  voucherCount: number;
}): Promise<SendResult> {
  const tokens = await tokensForMember(args.memberId);
  if (tokens.length === 0) return zero();
  const body = args.voucherCount > 0
    ? `${args.voucherCount} voucher${args.voucherCount === 1 ? "" : "s"} added to your wallet`
    : `Tap to see your reward`;
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: `🎯 ${args.missionTitle} — done!`,
      body,
      sound: "default",
      priority: "high",
      channelId: CH_LOYALTY,
      data: { type: "mission_completed", deeplink: "rewards" },
    })),
  );
}

/** Voucher expiring soon. Fired by the voucher-expiry cron 2 days out
 *  so customers have time to redeem. Suppressed for voucher categories
 *  that are time-irrelevant (e.g. lifetime unlocks). */
export async function notifyVoucherExpiringSoon(args: {
  memberId: string;
  voucherTitle: string;
  daysLeft: number;
}): Promise<SendResult> {
  const tokens = await tokensForMember(args.memberId);
  if (tokens.length === 0) return zero();
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: `${args.voucherTitle} expires in ${args.daysLeft} day${args.daysLeft === 1 ? "" : "s"}`,
      body:  `Tap to use it on your next order`,
      sound: "default",
      channelId: CH_LOYALTY,
      data: { type: "voucher_expiring", deeplink: "rewards/vouchers" },
    })),
  );
}

/** Admin claimable available — pushed when a team-side promo is created.
 *  Fired on demand by the backoffice (not by a cron). */
export async function notifyClaimableReady(args: {
  memberId: string;
  title: string;
}): Promise<SendResult> {
  const tokens = await tokensForMember(args.memberId);
  if (tokens.length === 0) return zero();
  return sendExpoPush(
    tokens.map((to) => ({
      to,
      title: "🎁 Reward waiting",
      body:  `${args.title} — tap to claim`,
      sound: "default",
      priority: "high",
      channelId: CH_LOYALTY,
      data: { type: "claimable_ready", deeplink: "rewards/vouchers" },
    })),
  );
}

/** Referral reward landed — both sides ping at the same moment. */
export async function notifyReferralRewarded(args: {
  memberId: string;
  isReferrer: boolean;
}): Promise<SendResult> {
  const tokens = await tokensForMember(args.memberId);
  if (tokens.length === 0) return zero();
  const title = args.isReferrer
    ? "Your referral paid off 🎉"
    : "Welcome — your gift is here 🎉";
  const body  = "A free drink voucher is in your wallet";
  return sendExpoPush(
    tokens.map((to) => ({
      to, title, body,
      sound: "default",
      priority: "high",
      channelId: CH_LOYALTY,
      data: { type: "referral_rewarded", deeplink: "rewards/vouchers" },
    })),
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function zero(): SendResult {
  return { sent: 0, failed: 0, pruned: 0 };
}

function formatMul(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
