"use client";

import { useState } from "react";
import {
  Star,
  Search,
  Filter,
  MessageSquare,
  Loader2,
  ExternalLink,
  ChevronRight,
  Settings,
  BarChart3,
  TrendingUp,
  Store,
  Calendar,
} from "lucide-react";
import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";

// ─── Types ─────────────────────────────────────────────────

type Outlet = { id: string; name: string };

type GoogleReview = {
  id: string;
  reviewer: { name: string; photoUrl?: string };
  rating: number;
  comment?: string;
  createdAt: string;
  reply?: { comment: string; updatedAt: string };
};

type ReviewsResponse = {
  reviews: GoogleReview[];
  averageRating: number;
  totalReviewCount: number;
  connected: boolean;
  nextPageToken?: string;
};

type Feedback = {
  id: string;
  rating: number;
  name: string | null;
  phone: string | null;
  feedback: string | null;
  source: string;
  createdAt: string;
};

type FeedbackResponse = {
  feedbacks: Feedback[];
  stats: { total: number; star5: number; star4: number; star3: number; star2: number; star1: number };
};

type DashboardGoogleReview = GoogleReview & { outletName: string; outletId: string };
type DashboardFeedback = Feedback & { outletName: string };

type OutletSummary = {
  outletId: string;
  outletName: string;
  google: {
    connected: boolean;
    reviews: GoogleReview[];
    averageRating: number;
    totalReviewCount: number;
    periodCount: number;
  };
  internal: {
    feedbacks: Feedback[];
    stats: { total: number; star5: number; star4: number; star3: number; star2: number; star1: number };
  };
};

type DashboardResponse = {
  period: string;
  since: string;
  overallAvgRating: number;
  totalGoogleReviews: number;
  totalFeedbacks: number;
  outlets: OutletSummary[];
  allGoogleReviews: DashboardGoogleReview[];
  allFeedbacks: DashboardFeedback[];
};

// ─── Helpers ───────────────────────────────────────────────

function StarRating({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={i <= rating ? "fill-amber-400 text-amber-400" : "text-gray-300"}
          style={{ width: size, height: size }}
        />
      ))}
    </div>
  );
}

function timeAgo(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return d.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

// ─── Review Card ───────────────────────────────────────────

function ReviewCard({
  review,
  outletId,
  outletName,
  onReplied,
}: {
  review: GoogleReview;
  outletId: string;
  outletName?: string;
  onReplied: () => void;
}) {
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [saving, setSaving] = useState(false);

  const handleReply = async () => {
    if (!replyText.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reviews/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outletId, reviewId: review.id, comment: replyText }),
      });
      if (res.ok) {
        setShowReply(false);
        setReplyText("");
        onReplied();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-white p-5">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-terracotta/10 text-sm font-bold text-terracotta">
          {review.reviewer.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{review.reviewer.name}</span>
            {outletName && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {outletName}
              </span>
            )}
            <span className="text-xs text-muted-foreground">{timeAgo(review.createdAt)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <svg className="h-4 w-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            <StarRating rating={review.rating} size={14} />
          </div>
          {review.comment && (
            <p className="mt-2 text-sm text-foreground leading-relaxed">{review.comment}</p>
          )}

          {/* Existing reply */}
          {review.reply && (
            <div className="mt-3 rounded-lg bg-muted/50 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">Your reply</p>
              <p className="text-sm">{review.reply.comment}</p>
            </div>
          )}

          {/* Actions */}
          <div className="mt-3 flex items-center gap-2">
            {!review.reply && (
              <button
                onClick={() => setShowReply(!showReply)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Reply review
              </button>
            )}
          </div>

          {/* Reply form */}
          {showReply && (
            <div className="mt-3">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Your response"
                className="w-full rounded-lg border border-border bg-transparent p-3 text-sm outline-none focus:ring-2 focus:ring-ring/50 resize-none"
                rows={3}
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => { setShowReply(false); setReplyText(""); }}
                  className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReply}
                  disabled={saving || !replyText.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-brand-dark px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-dark/90 disabled:opacity-50 transition-colors"
                >
                  {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Feedback Card ─────────────────────────────────────────

function FeedbackCard({ fb, showOutlet }: { fb: Feedback & { outletName?: string }; showOutlet?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-600">
          {fb.name?.slice(0, 1).toUpperCase() || "?"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{fb.name || "Anonymous"}</span>
            {showOutlet && (fb as DashboardFeedback).outletName && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {(fb as DashboardFeedback).outletName}
              </span>
            )}
            <span className="text-xs text-muted-foreground">{timeAgo(fb.createdAt)}</span>
          </div>
          <div className="mt-1">
            <StarRating rating={fb.rating} size={14} />
          </div>
          {fb.phone && <p className="mt-1 text-xs text-muted-foreground">{fb.phone}</p>}
          {fb.feedback && (
            <p className="mt-2 text-sm text-foreground leading-relaxed">{fb.feedback}</p>
          )}
          <span className="mt-2 inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
            {fb.source}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard View ────────────────────────────────────────

function DashboardView() {
  const [period, setPeriod] = useState<"day" | "week" | "month">("month");
  const [dashTab, setDashTab] = useState<"google" | "internal">("google");
  const [search, setSearch] = useState("");
  const [filterRating, setFilterRating] = useState<number | null>(null);
  const [showFilter, setShowFilter] = useState(false);

  const { data, isLoading } = useFetch<DashboardResponse>(
    `/api/reviews/dashboard?period=${period}`,
  );

  const periodLabel = period === "day" ? "Today" : period === "week" ? "Last 7 days" : "Last 30 days";

  // Filter all reviews
  const filteredGoogleReviews = (data?.allGoogleReviews ?? []).filter((r) => {
    if (search && !r.reviewer.name.toLowerCase().includes(search.toLowerCase()) && !r.comment?.toLowerCase().includes(search.toLowerCase()) && !r.outletName.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterRating && r.rating !== filterRating) return false;
    return true;
  });

  const filteredFeedbacks = (data?.allFeedbacks ?? []).filter((f) => {
    if (search && !f.name?.toLowerCase().includes(search.toLowerCase()) && !f.feedback?.toLowerCase().includes(search.toLowerCase()) && !(f as DashboardFeedback).outletName?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterRating && f.rating !== filterRating) return false;
    return true;
  });

  return (
    <>
      {/* Period filter */}
      <div className="mt-6 flex items-center gap-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground mr-1">Period:</span>
        {(["day", "week", "month"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              period === p
                ? "bg-brand-dark text-white"
                : "border border-border bg-white text-muted-foreground hover:bg-muted"
            }`}
          >
            {p === "day" ? "Today" : p === "week" ? "7 Days" : "30 Days"}
          </button>
        ))}
      </div>

      {/* Aggregated stats */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-white p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            <span className="text-xs font-medium">Avg Rating</span>
          </div>
          <div className="mt-2 flex items-center gap-1">
            <span className="text-2xl font-bold">{data?.overallAvgRating?.toFixed(1) ?? "–"}</span>
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{periodLabel}</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <svg className="h-4 w-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            <span className="text-xs font-medium">Google Reviews</span>
          </div>
          <span className="mt-2 block text-2xl font-bold">{data?.totalGoogleReviews ?? 0}</span>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{periodLabel}</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <MessageSquare className="h-4 w-4" />
            <span className="text-xs font-medium">Internal Feedback</span>
          </div>
          <span className="mt-2 block text-2xl font-bold">{data?.totalFeedbacks ?? 0}</span>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{periodLabel}</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Store className="h-4 w-4" />
            <span className="text-xs font-medium">Outlets</span>
          </div>
          <span className="mt-2 block text-2xl font-bold">{data?.outlets?.length ?? 0}</span>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Connected</p>
        </div>
      </div>

      {/* Per-outlet breakdown */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(data?.outlets ?? []).map((outlet) => (
          <div key={outlet.outletId} className="rounded-xl border border-border bg-white p-4">
            <h3 className="text-sm font-semibold truncate">{outlet.outletName}</h3>
            <div className="mt-2 flex items-center gap-3 text-sm">
              <div>
                <span className="font-bold">{outlet.google.averageRating?.toFixed(1) || "–"}</span>
                <Star className="ml-0.5 inline h-3 w-3 fill-amber-400 text-amber-400" />
              </div>
              <div className="text-xs text-muted-foreground">
                {outlet.google.periodCount} Google &middot; {outlet.internal.stats.total} Internal
              </div>
            </div>
            {!outlet.google.connected && (
              <p className="mt-1 text-[10px] text-amber-600">GBP not connected</p>
            )}
          </div>
        ))}
      </div>

      {/* Sub-tabs + toolbar */}
      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-1 border-b border-border">
          <button
            onClick={() => setDashTab("google")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              dashTab === "google" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Google Reviews ({data?.totalGoogleReviews ?? 0})
          </button>
          <button
            onClick={() => setDashTab("internal")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              dashTab === "internal" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Internal Feedback ({data?.totalFeedbacks ?? 0})
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-48 rounded-lg border border-border bg-white py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/50"
            />
          </div>
          <div className="relative">
            <button
              onClick={() => setShowFilter(!showFilter)}
              className={`rounded-lg border p-2 transition-colors ${filterRating ? "border-terracotta bg-terracotta/10 text-terracotta" : "border-border bg-white text-muted-foreground hover:bg-muted"}`}
            >
              <Filter className="h-4 w-4" />
            </button>
            {showFilter && (
              <div className="absolute right-0 top-10 z-20 w-48 rounded-xl border border-border bg-white p-3 shadow-lg">
                <p className="text-xs font-semibold text-muted-foreground mb-2">Filter by rating</p>
                <div className="space-y-1">
                  <button
                    onClick={() => { setFilterRating(null); setShowFilter(false); }}
                    className={`w-full rounded-md px-3 py-1.5 text-left text-sm ${!filterRating ? "bg-muted font-medium" : "hover:bg-muted"}`}
                  >
                    All ratings
                  </button>
                  {[5, 4, 3, 2, 1].map((r) => (
                    <button
                      key={r}
                      onClick={() => { setFilterRating(r); setShowFilter(false); }}
                      className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm ${filterRating === r ? "bg-muted font-medium" : "hover:bg-muted"}`}
                    >
                      <StarRating rating={r} size={12} />
                      <span>{r} star</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Review list */}
      <div className="mt-4 space-y-3">
        {isLoading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {!isLoading && dashTab === "google" && (
          <>
            {filteredGoogleReviews.length === 0 ? (
              <div className="rounded-xl border border-border bg-white p-10 text-center">
                <Star className="mx-auto h-10 w-10 text-muted-foreground/30" />
                <p className="mt-3 text-sm text-muted-foreground">No Google reviews in this period</p>
              </div>
            ) : (
              filteredGoogleReviews.map((r) => (
                <ReviewCard
                  key={`${r.outletId}-${r.id}`}
                  review={r}
                  outletId={r.outletId}
                  outletName={r.outletName}
                  onReplied={() => {}}
                />
              ))
            )}
          </>
        )}
        {!isLoading && dashTab === "internal" && (
          <>
            {filteredFeedbacks.length === 0 ? (
              <div className="rounded-xl border border-border bg-white p-10 text-center">
                <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground/30" />
                <p className="mt-3 text-sm text-muted-foreground">No internal feedback in this period</p>
              </div>
            ) : (
              filteredFeedbacks.map((f) => (
                <FeedbackCard key={f.id} fb={f} showOutlet />
              ))
            )}
          </>
        )}
      </div>
    </>
  );
}

// ─── Outlet sort: Putrajaya first, Nilai last ─────────────

const OUTLET_ORDER: Record<string, number> = {
  putrajaya: 0,
  "shah alam": 1,
  tamarind: 2,
  nilai: 99,
};

function outletSortKey(name: string): number {
  const lower = name.toLowerCase();
  for (const [key, order] of Object.entries(OUTLET_ORDER)) {
    if (lower.includes(key)) return order;
  }
  return 50;
}

function sortOutlets(list: Outlet[]): Outlet[] {
  return [...list].sort((a, b) => outletSortKey(a.name) - outletSortKey(b.name));
}

// ─── Per-Outlet View (original) ────────────────────────────

function OutletView() {
  const [tab, setTab] = useState<"google" | "internal">("google");
  const [outletId, setOutletId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [filterRating, setFilterRating] = useState<number | null>(null);
  const [showFilter, setShowFilter] = useState(false);

  const { data: rawOutlets } = useFetch<Outlet[]>("/api/settings/outlets?status=ACTIVE");
  const outlets = rawOutlets ? sortOutlets(rawOutlets) : undefined;
  const selectedOutletId = outletId || (outlets?.[0]?.id ?? "");
  const selectedOutlet = outlets?.find((o) => o.id === selectedOutletId);

  const { data: reviewsData, mutate: mutateReviews } = useFetch<ReviewsResponse>(
    selectedOutletId ? `/api/reviews?outletId=${selectedOutletId}` : null,
  );
  const { data: feedbackData } = useFetch<FeedbackResponse>(
    selectedOutletId ? `/api/reviews/feedback?outletId=${selectedOutletId}` : null,
  );

  const filteredReviews = (reviewsData?.reviews ?? []).filter((r) => {
    if (search && !r.reviewer.name.toLowerCase().includes(search.toLowerCase()) && !r.comment?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterRating && r.rating !== filterRating) return false;
    return true;
  });

  const filteredFeedbacks = (feedbackData?.feedbacks ?? []).filter((f) => {
    if (search && !f.name?.toLowerCase().includes(search.toLowerCase()) && !f.feedback?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterRating && f.rating !== filterRating) return false;
    return true;
  });

  const stats = feedbackData?.stats;
  const fiveStarPct = reviewsData?.totalReviewCount
    ? Math.round(((reviewsData.reviews.filter((r) => r.rating === 5).length) / reviewsData.reviews.length) * 100)
    : 0;

  return (
    <>
      {/* Outlet selector */}
      <div className="mt-6 flex items-center gap-3">
        {outlets && outlets.length > 1 && (
          <select
            value={selectedOutletId}
            onChange={(e) => setOutletId(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
          >
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Stats header */}
      <div className="mt-4 rounded-xl border border-border bg-white p-5">
        <h2 className="text-lg font-semibold">{selectedOutlet?.name ?? "Select outlet"}</h2>
        {tab === "google" ? (
          <div className="mt-2 flex items-center gap-6 text-sm">
            <div>
              <span className="text-2xl font-bold">{reviewsData?.averageRating?.toFixed(1) ?? "–"}</span>
              <Star className="ml-1 inline h-4 w-4 fill-amber-400 text-amber-400" />
              <p className="text-xs text-muted-foreground">Google review</p>
            </div>
            <div>
              <span className="text-2xl font-bold">{reviewsData?.totalReviewCount ?? 0}</span>
              <p className="text-xs text-muted-foreground">Total review</p>
            </div>
            <div>
              <span className="text-2xl font-bold">{fiveStarPct}%</span>
              <p className="text-xs text-muted-foreground">5-star review</p>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-4 text-sm flex-wrap">
            <div>
              <span className="text-2xl font-bold">{stats?.total ?? 0}</span>
              <p className="text-xs text-muted-foreground">Total feedback</p>
            </div>
            {[5, 4, 3, 2, 1].map((s) => (
              <div key={s}>
                <span className="text-2xl font-bold">{stats?.[`star${s}` as keyof typeof stats] ?? 0}</span>
                <p className="text-xs text-muted-foreground">{s}-star</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tabs + toolbar */}
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-1 border-b border-border">
          <button
            onClick={() => setTab("google")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === "google" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Google Review
          </button>
          <button
            onClick={() => setTab("internal")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === "internal" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Internal Feedback
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-48 rounded-lg border border-border bg-white py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/50"
            />
          </div>
          <div className="relative">
            <button
              onClick={() => setShowFilter(!showFilter)}
              className={`rounded-lg border p-2 transition-colors ${filterRating ? "border-terracotta bg-terracotta/10 text-terracotta" : "border-border bg-white text-muted-foreground hover:bg-muted"}`}
            >
              <Filter className="h-4 w-4" />
            </button>
            {showFilter && (
              <div className="absolute right-0 top-10 z-20 w-48 rounded-xl border border-border bg-white p-3 shadow-lg">
                <p className="text-xs font-semibold text-muted-foreground mb-2">Filter by rating</p>
                <div className="space-y-1">
                  <button
                    onClick={() => { setFilterRating(null); setShowFilter(false); }}
                    className={`w-full rounded-md px-3 py-1.5 text-left text-sm ${!filterRating ? "bg-muted font-medium" : "hover:bg-muted"}`}
                  >
                    All ratings
                  </button>
                  {[5, 4, 3, 2, 1].map((r) => (
                    <button
                      key={r}
                      onClick={() => { setFilterRating(r); setShowFilter(false); }}
                      className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm ${filterRating === r ? "bg-muted font-medium" : "hover:bg-muted"}`}
                    >
                      <StarRating rating={r} size={12} />
                      <span>{r} star</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mt-4 space-y-3">
        {tab === "google" ? (
          <>
            {!reviewsData?.connected && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-center">
                <p className="text-sm font-medium text-amber-800">Google Business Profile not connected</p>
                <p className="mt-1 text-xs text-amber-600">
                  Go to{" "}
                  <Link href="/reviews/settings" className="underline">Review settings</Link>
                  {" "}to connect your Google Business page.
                </p>
              </div>
            )}
            {filteredReviews.length === 0 && reviewsData?.connected && (
              <div className="rounded-xl border border-border bg-white p-10 text-center">
                <Star className="mx-auto h-10 w-10 text-muted-foreground/30" />
                <p className="mt-3 text-sm text-muted-foreground">No reviews found</p>
              </div>
            )}
            {filteredReviews.map((r) => (
              <ReviewCard
                key={r.id}
                review={r}
                outletId={selectedOutletId}
                onReplied={() => mutateReviews()}
              />
            ))}
          </>
        ) : (
          <>
            {filteredFeedbacks.length === 0 ? (
              <div className="rounded-xl border border-border bg-white p-10 text-center">
                <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground/30" />
                <p className="mt-3 text-sm text-muted-foreground">No internal feedback yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Share the QR code to start collecting feedback
                </p>
              </div>
            ) : (
              filteredFeedbacks.map((f) => <FeedbackCard key={f.id} fb={f} />)
            )}
          </>
        )}
      </div>
    </>
  );
}

// ─── Main Page ─────────────────────────────────────────────

export default function ReviewsPage() {
  const [view, setView] = useState<"dashboard" | "outlet">("dashboard");

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">Reviews</h1>
          <p className="text-sm text-muted-foreground">Manage Google reviews & internal feedback</p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex rounded-lg border border-border bg-white">
            <button
              onClick={() => setView("dashboard")}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors rounded-l-lg ${
                view === "dashboard" ? "bg-brand-dark text-white" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <BarChart3 className="h-4 w-4" />
              Dashboard
            </button>
            <button
              onClick={() => setView("outlet")}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors rounded-r-lg ${
                view === "outlet" ? "bg-brand-dark text-white" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <Store className="h-4 w-4" />
              Per Outlet
            </button>
          </div>
          <Link
            href="/reviews/settings"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            <Settings className="h-4 w-4" />
            Review settings
          </Link>
        </div>
      </div>

      {view === "dashboard" ? <DashboardView /> : <OutletView />}
    </div>
  );
}
