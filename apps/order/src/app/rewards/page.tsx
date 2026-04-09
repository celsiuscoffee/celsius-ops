"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Star, Gift, Loader2, Lock } from "lucide-react";
import { useCartStore } from "@/store/cart";
import { BottomNav } from "@/components/bottom-nav";

interface LoyaltyReward {
  id: string;
  name: string;
  description: string | null;
  points_required: number;
  category: string;
  image_url: string | null;
  stock: number | null;
  is_active: boolean;
  reward_type: string;
  validity_days: number | null;
  max_redemptions_per_member: number | null;
  auto_issue: boolean;
  min_order_value: number | null;
  fulfillment_type: string | null;
}

interface RewardsData {
  memberId: string | null;
  pointsBalance: number | null;
  rewards: LoyaltyReward[];
}

export default function RewardsPage() {
  const loyaltyMember    = useCartStore((s) => s.loyaltyMember);
  const setLoyaltyMember = useCartStore((s) => s.setLoyaltyMember);
  const hasHydrated      = useCartStore((s) => s._hasHydrated);

  const [data, setData]       = useState<RewardsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!hasHydrated) return;

    setLoading(true);
    const url = loyaltyMember?.phone
      ? `/api/loyalty/rewards?phone=${encodeURIComponent(loyaltyMember.phone)}`
      : `/api/loyalty/rewards`;

    fetch(url)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setData(json);
        // Sync fresh balance back to store so account page stays in sync
        if (loyaltyMember && json.pointsBalance != null) {
          setLoyaltyMember({ ...loyaltyMember, pointsBalance: json.pointsBalance });
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [hasHydrated, loyaltyMember?.phone, setLoyaltyMember]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasHydrated) {
    return <div className="flex flex-col min-h-dvh bg-[#f5f5f5]" />;
  }

  const isLoggedIn     = !!loyaltyMember;
  const pointsBalance  = data?.pointsBalance ?? loyaltyMember?.pointsBalance ?? 0;
  const rewards        = data?.rewards ?? [];

  return (
    <div className="flex flex-col min-h-dvh bg-[#f5f5f5]">
      <header className="bg-white px-4 pt-12 pb-3 border-b">
        <h1 className="text-base font-semibold text-center">Rewards</h1>
      </header>

      <main className="flex-1 overflow-y-auto pb-24 space-y-4 pt-4 px-4">

        {/* Points balance card — members only */}
        {isLoggedIn && (
          <div className="bg-[#160800] rounded-3xl px-5 py-6 text-white">
            <p className="text-white/60 text-xs font-medium uppercase tracking-wide mb-1">
              Points Balance
            </p>
            <div className="flex items-end gap-2 mb-1">
              <span className="text-4xl font-bold">
                {loading ? "—" : pointsBalance.toLocaleString()}
              </span>
              <span className="text-white/60 text-sm mb-1">pts</span>
            </div>
            <p className="text-white/50 text-xs mt-2">
              Earn 1 pt for every RM1 spent
            </p>
          </div>
        )}

        {/* Join banner — non-members */}
        {!isLoggedIn && (
          <div className="bg-[#160800] rounded-3xl px-5 py-6 text-white">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
                <Star className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="font-bold text-base">Join Celsius Rewards</p>
                <p className="text-white/60 text-xs mt-0.5">Earn 1 pt for every RM1 spent</p>
              </div>
            </div>
            <Link
              href="/account/login"
              className="block w-full text-center bg-white text-[#160800] rounded-full py-3 text-sm font-bold"
            >
              Sign Up / Sign In
            </Link>
          </div>
        )}

        {/* Rewards list */}
        <section>
          <h2 className="text-lg font-bold text-[#160800] mb-2">
            {isLoggedIn ? "Available Rewards" : "Rewards Catalogue"}
          </h2>

          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {!loading && !error && rewards.length === 0 && (
            <div className="bg-white rounded-2xl px-5 py-10 text-center">
              <Gift className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No rewards available yet</p>
              <p className="text-xs text-muted-foreground mt-1">Check back soon</p>
            </div>
          )}

          {!loading && !error && rewards.length > 0 && (
            <div className="space-y-2">
              {rewards.map((reward) => {
                const outOfStock = reward.stock === 0;
                const canAfford  = isLoggedIn && !outOfStock && pointsBalance >= reward.points_required;
                const ptsNeeded  = isLoggedIn ? reward.points_required - pointsBalance : null;

                return (
                  <div
                    key={reward.id}
                    className={`bg-white rounded-2xl px-4 py-4 flex items-center gap-3 ${
                      !isLoggedIn ? "opacity-75" : outOfStock ? "opacity-50" : ""
                    }`}
                  >
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                      canAfford ? "bg-purple-100" : "bg-gray-100"
                    }`}>
                      {!isLoggedIn ? (
                        <Lock className="h-5 w-5 text-gray-400" />
                      ) : (
                        <Gift className={`h-6 w-6 ${canAfford ? "text-purple-600" : "text-gray-400"}`} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-[#160800]">{reward.name}</p>
                      {reward.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {reward.description}
                        </p>
                      )}
                      {reward.validity_days != null && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Valid for {reward.validity_days} days after redemption
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <p className={`text-xs font-semibold ${canAfford ? "text-purple-700" : "text-muted-foreground"}`}>
                          {reward.points_required} pts
                        </p>
                        {reward.max_redemptions_per_member != null && (
                          <span className="text-[10px] font-medium bg-gray-100 text-muted-foreground px-1.5 py-0.5 rounded-full">
                            Limit: {reward.max_redemptions_per_member} per member
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {outOfStock ? (
                        <span className="text-xs text-red-500 font-semibold bg-red-50 px-2.5 py-1 rounded-full whitespace-nowrap">
                          Out of stock
                        </span>
                      ) : !isLoggedIn ? (
                        <span className="text-xs text-muted-foreground font-medium bg-gray-100 px-2.5 py-1 rounded-full">
                          Sign in
                        </span>
                      ) : canAfford ? (
                        <span className="text-xs text-emerald-600 font-semibold bg-emerald-50 px-2.5 py-1 rounded-full">
                          Redeemable
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground font-medium bg-gray-100 px-2.5 py-1 rounded-full whitespace-nowrap">
                          {ptsNeeded! > 0 ? `+${ptsNeeded} pts` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!loading && !error && rewards.length > 0 && isLoggedIn && (
            <p className="text-xs text-center text-muted-foreground mt-3">
              Apply rewards at checkout when placing your order
            </p>
          )}

          {!loading && !error && rewards.length > 0 && !isLoggedIn && (
            <p className="text-xs text-center text-muted-foreground mt-3">
              Sign in to redeem rewards at checkout
            </p>
          )}
        </section>

      </main>
      <BottomNav />
    </div>
  );
}
