"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Coffee,
  Gift,
  Percent,
  ShoppingBag,
  UtensilsCrossed,
  Loader2,
} from "lucide-react";
import { fetchMemberByPhone, fetchRewards } from "@/lib/api";
import { formatPoints, toStoragePhone, formatPhone, getProgressPercentage, cn } from "@/lib/utils";
import type { Reward } from "@/types";

const categoryIcons: Record<string, React.ReactNode> = {
  drink: <Coffee className="h-6 w-6 text-white" />,
  food: <UtensilsCrossed className="h-6 w-6 text-white" />,
  voucher: <Percent className="h-6 w-6 text-white" />,
  merch: <ShoppingBag className="h-6 w-6 text-white" />,
};

const categoryColors: Record<string, string> = {
  drink: "#dc2626",
  food: "#ea580c",
  voucher: "#7c3aed",
  merch: "#0891b2",
};

const brand = { id: "brand-celsius", name: "Celsius Coffee", slug: "celsius", primary_color: "#1a1a1a", points_per_rm: 1 };

export default function RewardsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const phoneParam = searchParams.get("phone") || "";

  const [loading, setLoading] = useState(true);
  const [memberName, setMemberName] = useState<string | null>(null);
  const [memberPoints, setMemberPoints] = useState(0);
  const [found, setFound] = useState(false);
  const [rewards, setRewards] = useState<Reward[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        if (phoneParam) {
          const fullPhone = toStoragePhone(phoneParam.replace(/\D/g, ""));
          const [memberData, rewardsData] = await Promise.all([
            fetchMemberByPhone(fullPhone),
            fetchRewards(),
          ]);
          if (memberData) {
            setFound(true);
            setMemberName(memberData.name || formatPhone(memberData.phone));
            setMemberPoints(memberData.brand_data?.points_balance ?? 0);
          }
          setRewards(rewardsData);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [phoneParam]);

  function getRewardProgress(reward: Reward) {
    const progress = getProgressPercentage(memberPoints, reward.points_required);
    const remaining = Math.max(0, reward.points_required - memberPoints);
    const canRedeem = memberPoints >= reward.points_required;
    return { progress, remaining, canRedeem };
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
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
            onClick={() =>
              router.push(
                `/portal/${brand.slug}${phoneParam ? `?phone=${phoneParam}` : ""}`
              )
            }
            className="mb-4 flex items-center gap-1 text-sm text-white/70 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">Redeem Rewards</h1>
              <p className="text-sm text-white/80">{brand.name}</p>
            </div>
            {found && (
              <div className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-semibold">
                {formatPoints(memberPoints)} pts
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-md px-4 py-6">
        {!found ? (
          <div className="rounded-xl border bg-white p-8 text-center shadow-sm">
            <Gift className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="font-medium text-foreground">Member not found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Please go back and enter your phone number to view rewards.
            </p>
            <button
              onClick={() => router.push(`/portal/${brand.slug}`)}
              className="mt-4 rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: brand.primary_color }}
            >
              Go Back
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {rewards.map((reward) => {
              const { progress, remaining, canRedeem } =
                getRewardProgress(reward);
              const bgColor =
                categoryColors[reward.category] || brand.primary_color;

              return (
                <div
                  key={reward.id}
                  className="overflow-hidden rounded-xl border bg-white shadow-sm"
                >
                  {/* Reward Image Placeholder */}
                  <div
                    className="flex h-28 items-center justify-center"
                    style={{ backgroundColor: bgColor }}
                  >
                    {categoryIcons[reward.category] || (
                      <Gift className="h-6 w-6 text-white" />
                    )}
                  </div>

                  {/* Reward Details */}
                  <div className="p-4">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-foreground">
                        {reward.name}
                      </h3>
                      <span
                        className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold text-white"
                        style={{ backgroundColor: bgColor }}
                      >
                        {formatPoints(reward.points_required)} pts
                      </span>
                    </div>

                    {reward.description && (
                      <p className="mb-3 text-sm text-muted-foreground">
                        {reward.description}
                      </p>
                    )}

                    {/* Progress */}
                    <div className="mb-3">
                      <div className="mb-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${progress}%`,
                            backgroundColor: canRedeem
                              ? "#22c55e"
                              : brand.primary_color,
                          }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {canRedeem ? (
                          <span className="font-medium text-success">
                            Ready to redeem!
                          </span>
                        ) : (
                          <>
                            <span className="font-medium">
                              {formatPoints(remaining)}
                            </span>{" "}
                            points to go!
                          </>
                        )}
                      </p>
                    </div>

                    {/* Redeem info */}
                    <div className="flex h-10 w-full items-center justify-center rounded-lg bg-gray-100 text-sm font-medium text-gray-500">
                      {canRedeem ? "Visit store to redeem" : "Not Enough Points"}
                    </div>

                    {/* Stock info */}
                    {reward.stock !== null && (
                      <p className="mt-2 text-center text-xs text-muted-foreground">
                        {reward.stock} remaining
                      </p>
                    )}
                  </div>
                </div>
              );
            })}

            {rewards.length === 0 && (
              <div className="rounded-xl border bg-white p-8 text-center shadow-sm">
                <Gift className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <p className="text-muted-foreground">
                  No rewards available at the moment.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-muted-foreground">
            Powered by Celsius Loyalty
          </p>
        </div>
      </div>
    </div>
  );
}
