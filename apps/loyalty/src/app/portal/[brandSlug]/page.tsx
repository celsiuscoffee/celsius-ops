"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Coffee,
  TrendingUp,
  TrendingDown,
  Gift,
  Star,
  Clock,
  CircleDollarSign,
  Loader2,
  Zap,
  ChevronRight,
} from "lucide-react";
import { fetchMemberByPhone, fetchTransactions } from "@/lib/api";
import {
  formatPoints,
  formatPhone,
  toStoragePhone,
  getTimeAgo,
  cn,
} from "@/lib/utils";
import type { PointTransaction, MemberTierStatus } from "@/types";

const brand = {
  id: "brand-celsius",
  name: "Celsius Coffee",
  slug: "celsius",
  primary_color: "#1a1a1a",
  points_per_rm: 1,
};

export default function BrandPortalPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const phoneParam = searchParams.get("phone");

  const [phone, setPhone] = useState(phoneParam || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [member, setMember] = useState<{
    id: string;
    name: string | null;
    phone: string;
  } | null>(null);
  const [memberBrand, setMemberBrand] = useState<{
    points_balance: number;
    total_points_earned: number;
    total_points_redeemed: number;
    total_visits: number;
    total_spent: number;
  } | null>(null);
  const [tierStatus, setTierStatus] = useState<MemberTierStatus | null>(null);
  const [transactions, setTransactions] = useState<PointTransaction[]>([]);
  const [looked, setLooked] = useState(false);

  useEffect(() => {
    if (phoneParam) {
      lookupMember(phoneParam);
    }
  }, [phoneParam]);

  async function lookupMember(phoneNumber: string) {
    const cleaned = phoneNumber.replace(/\D/g, "");
    if (cleaned.length < 10) {
      setError("Please enter a valid phone number");
      return;
    }
    setError("");
    setLoading(true);
    setLooked(true);

    try {
      const fullPhone = toStoragePhone(cleaned);
      const memberData = await fetchMemberByPhone(fullPhone);

      if (memberData) {
        setMember({
          id: memberData.id,
          name: memberData.name,
          phone: memberData.phone,
        });
        const bd = memberData.brand_data;
        if (bd) {
          setMemberBrand({
            points_balance: bd.points_balance ?? 0,
            total_points_earned: bd.total_points_earned ?? 0,
            total_points_redeemed: bd.total_points_redeemed ?? 0,
            total_visits: bd.total_visits ?? 0,
            total_spent: bd.total_spent ?? 0,
          });
        }

        // Fetch transactions and tier status in parallel
        const [txns, tierRes] = await Promise.all([
          fetchTransactions(memberData.id, brand.id),
          fetch(
            `/api/member-tier?member_id=${memberData.id}&brand_id=${brand.id}`
          ).then((r) => (r.ok ? r.json() : null)),
        ]);
        setTransactions(txns);
        setTierStatus(tierRes);
      } else {
        setMember(null);
        setMemberBrand(null);
        setTransactions([]);
        setTierStatus(null);
      }
    } catch {
      setError("Failed to look up member. Please try again.");
      setMember(null);
      setMemberBrand(null);
      setTransactions([]);
      setTierStatus(null);
    } finally {
      setLoading(false);
    }
  }

  function handleCheckPoints() {
    lookupMember(phone);
  }

  function getTransactionIcon(type: PointTransaction["type"]) {
    switch (type) {
      case "earn":
        return <TrendingUp className="h-4 w-4 text-success" />;
      case "redeem":
        return <TrendingDown className="h-4 w-4 text-primary" />;
      case "bonus":
        return <Star className="h-4 w-4 text-gold" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div
        className="w-full px-4 pb-6 pt-6 text-white"
        style={{ backgroundColor: brand.primary_color }}
      >
        <div className="mx-auto max-w-md">
          <button
            onClick={() => router.push("/staff")}
            className="mb-4 flex items-center gap-1 text-sm text-white/70 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="flex items-center gap-2">
            <Coffee className="h-6 w-6" />
            <h1 className="text-xl font-bold">{brand.name}</h1>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-md px-4 py-6">
        {/* Phone lookup */}
        {!member && (
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              Check My Points
            </h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Phone Number
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    +60
                  </span>
                  <input
                    type="tel"
                    placeholder="12-345 6789"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      setError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCheckPoints();
                    }}
                    className={cn(
                      "flex h-12 w-full rounded-lg border bg-white pl-12 pr-4 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50",
                      error
                        ? "border-destructive focus:ring-destructive/50"
                        : "border-input"
                    )}
                  />
                </div>
                {error && (
                  <p className="mt-1.5 text-sm text-destructive">{error}</p>
                )}
                {looked && !member && !error && !loading && (
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    No account found for this phone number.
                  </p>
                )}
              </div>

              <button
                onClick={handleCheckPoints}
                disabled={loading}
                className="flex h-12 w-full items-center justify-center rounded-lg text-base font-semibold text-white shadow-sm transition-colors hover:opacity-90 active:scale-[0.98]"
                style={{ backgroundColor: brand.primary_color }}
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  "Check My Points"
                )}
              </button>
            </div>
          </div>
        )}

        {/* Member Dashboard */}
        {member && memberBrand && (
          <div className="space-y-4">
            {/* Welcome + Tier Badge */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Welcome back,</p>
                <h2 className="text-xl font-bold text-foreground">
                  {member.name || formatPhone(member.phone)}
                </h2>
              </div>
              {tierStatus && (
                <TierBadge
                  name={tierStatus.tier_name}
                  color={tierStatus.tier_color}
                  icon={tierStatus.tier_icon}
                />
              )}
            </div>

            {/* Post-purchase coupon banner */}
            {tierStatus?.active_post_purchase && (
              <PostPurchaseBanner coupon={tierStatus.active_post_purchase} />
            )}

            {/* Points Balance Card */}
            <div
              className="rounded-2xl p-6 text-white shadow-lg"
              style={{ backgroundColor: brand.primary_color }}
            >
              <p className="mb-1 text-sm font-medium text-white/80">
                Your Points
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold">
                  {formatPoints(memberBrand.points_balance)}
                </span>
                <span className="text-2xl">pts</span>
              </div>

              {/* Tier progress bar inside points card */}
              {tierStatus && (
                <TierProgress tierStatus={tierStatus} />
              )}

              <div className="mt-4 flex items-center gap-4 text-sm text-white/70">
                <div className="flex items-center gap-1">
                  <CircleDollarSign className="h-4 w-4" />
                  <span>
                    RM 1 ={" "}
                    {tierStatus
                      ? `${tierStatus.tier_multiplier}×`
                      : brand.points_per_rm}{" "}
                    {tierStatus && tierStatus.tier_multiplier !== 1
                      ? "Points"
                      : "Point"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Star className="h-4 w-4" />
                  <span>{memberBrand.total_visits} visits</span>
                </div>
              </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border bg-white p-3 text-center shadow-sm">
                <p className="text-xs text-muted-foreground">Earned</p>
                <p className="text-lg font-bold text-foreground">
                  {formatPoints(memberBrand.total_points_earned)}
                </p>
              </div>
              <div className="rounded-xl border bg-white p-3 text-center shadow-sm">
                <p className="text-xs text-muted-foreground">Redeemed</p>
                <p className="text-lg font-bold text-foreground">
                  {formatPoints(memberBrand.total_points_redeemed)}
                </p>
              </div>
              <div className="rounded-xl border bg-white p-3 text-center shadow-sm">
                <p className="text-xs text-muted-foreground">Spent</p>
                <p className="text-lg font-bold text-foreground">
                  RM {memberBrand.total_spent.toFixed(0)}
                </p>
              </div>
            </div>

            {/* Rewards link */}
            <button
              onClick={() =>
                router.push(
                  `/portal/${brand.slug}/rewards?phone=${encodeURIComponent(phone || member.phone)}`
                )
              }
              className="flex w-full items-center justify-between rounded-xl border bg-white px-4 py-3.5 shadow-sm hover:bg-gray-50 active:scale-[0.99]"
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${brand.primary_color}15` }}
                >
                  <Gift className="h-5 w-5" style={{ color: brand.primary_color }} />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-foreground">
                    View Rewards
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatPoints(memberBrand.points_balance)} pts available
                  </p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>

            {/* Recent Transactions */}
            <div className="rounded-xl border bg-white shadow-sm">
              <div className="border-b px-4 py-3">
                <h3 className="font-semibold text-foreground">
                  Recent Activity
                </h3>
              </div>
              {transactions.length > 0 ? (
                <div className="divide-y">
                  {transactions.map((txn) => (
                    <div
                      key={txn.id}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100">
                        {getTransactionIcon(txn.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {txn.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {getTimeAgo(txn.created_at)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span
                          className={cn(
                            "text-sm font-semibold",
                            txn.points > 0 ? "text-success" : "text-primary"
                          )}
                        >
                          {txn.points > 0 ? "+" : ""}
                          {txn.points}
                        </span>
                        {txn.multiplier > 1 && (
                          <p className="text-xs text-muted-foreground">
                            {txn.multiplier}×
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No transactions yet
                </div>
              )}
            </div>

            {/* Check another number */}
            <button
              onClick={() => {
                setMember(null);
                setMemberBrand(null);
                setTransactions([]);
                setTierStatus(null);
                setPhone("");
                setLooked(false);
              }}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
            >
              Check another phone number
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-muted-foreground">
            Powered by Celsius Rewards
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────

function TierBadge({
  name,
  color,
  icon,
}: {
  name: string;
  color: string;
  icon: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-white shadow-sm"
      style={{ backgroundColor: color }}
    >
      <span className="text-base leading-none">{icon}</span>
      <span>{name}</span>
    </div>
  );
}

function TierProgress({
  tierStatus,
}: {
  tierStatus: MemberTierStatus;
}) {
  const { next_tier_name, next_tier_min_visits, visits_this_period, visits_to_next_tier, period_days } =
    tierStatus;

  if (!next_tier_name || !next_tier_min_visits) {
    // Already at the top tier
    return (
      <div className="mt-4">
        <p className="text-xs text-white/70">
          {visits_this_period} visits this {period_days}-day period · Top tier reached 👑
        </p>
      </div>
    );
  }

  const progress = Math.min(
    100,
    Math.round((visits_this_period / next_tier_min_visits) * 100)
  );

  return (
    <div className="mt-4 space-y-1.5">
      <div className="flex items-center justify-between text-xs text-white/80">
        <span>
          {visits_to_next_tier === 1
            ? `1 more visit to ${next_tier_name}`
            : `${visits_to_next_tier} more visits to ${next_tier_name}`}
        </span>
        <span>
          {visits_this_period}/{next_tier_min_visits}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
        <div
          className="h-full rounded-full bg-white transition-all duration-700"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="text-xs text-white/50">
        {period_days}-day rolling window
      </p>
    </div>
  );
}

function PostPurchaseBanner({
  coupon,
}: {
  coupon: NonNullable<MemberTierStatus["active_post_purchase"]>;
}) {
  const daysLeft = Math.ceil(coupon.hours_remaining / 24);
  const urgency = coupon.hours_remaining <= 24;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 shadow-sm",
        urgency
          ? "border-orange-200 bg-orange-50"
          : "border-emerald-200 bg-emerald-50"
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          urgency ? "bg-orange-100" : "bg-emerald-100"
        )}
      >
        <Zap
          className={cn(
            "h-5 w-5",
            urgency ? "text-orange-600" : "text-emerald-600"
          )}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm font-semibold",
            urgency ? "text-orange-800" : "text-emerald-800"
          )}
        >
          {coupon.multiplier}× Points Active!
        </p>
        <p
          className={cn(
            "mt-0.5 text-xs",
            urgency ? "text-orange-700" : "text-emerald-700"
          )}
        >
          {urgency
            ? `Expires in ${coupon.hours_remaining}h — visit today to earn ${coupon.multiplier}× points`
            : `Earn ${coupon.multiplier}× points on your next visit · Valid for ${daysLeft} more day${daysLeft !== 1 ? "s" : ""}`}
        </p>
      </div>
    </div>
  );
}
