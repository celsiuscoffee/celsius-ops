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
} from "lucide-react";
import { fetchMemberByPhone, fetchTransactions } from "@/lib/api";
import { formatPoints, formatPhone, toStoragePhone, getTimeAgo, cn } from "@/lib/utils";
import type { PointTransaction } from "@/types";

const brand = { id: "brand-celsius", name: "Celsius Coffee", slug: "celsius", primary_color: "#1a1a1a", points_per_rm: 1 };

export default function BrandPortalPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const phoneParam = searchParams.get("phone");

  const [phone, setPhone] = useState(phoneParam || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [member, setMember] = useState<{ name: string | null; phone: string } | null>(null);
  const [memberBrand, setMemberBrand] = useState<{
    points_balance: number;
    total_points_earned: number;
    total_points_redeemed: number;
    total_visits: number;
    total_spent: number;
  } | null>(null);
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
        setMember({ name: memberData.name, phone: memberData.phone });
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

        // Fetch transactions
        const txns = await fetchTransactions(memberData.id, brand.id);
        setTransactions(txns);
      } else {
        setMember(null);
        setMemberBrand(null);
        setTransactions([]);
      }
    } catch {
      setError("Failed to look up member. Please try again.");
      setMember(null);
      setMemberBrand(null);
      setTransactions([]);
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
            onClick={() => router.push("/portal")}
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
        {/* Phone lookup (if no member found yet) */}
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
            {/* Welcome */}
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Welcome back,</p>
              <h2 className="text-xl font-bold text-foreground">
                {member.name || formatPhone(member.phone)}
              </h2>
            </div>

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
              <div className="mt-4 flex items-center gap-4 text-sm text-white/70">
                <div className="flex items-center gap-1">
                  <CircleDollarSign className="h-4 w-4" />
                  <span>RM 1 = {brand.points_per_rm} Point</span>
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
                  RM {memberBrand.total_spent}
                </p>
              </div>
            </div>

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
                      <span
                        className={cn(
                          "shrink-0 text-sm font-semibold",
                          txn.points > 0 ? "text-success" : "text-primary"
                        )}
                      >
                        {txn.points > 0 ? "+" : ""}
                        {txn.points}
                      </span>
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
            Powered by Celsius Loyalty
          </p>
        </div>
      </div>
    </div>
  );
}
