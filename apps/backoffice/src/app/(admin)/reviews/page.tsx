"use client";

import { useState } from "react";
import {
  Star,
  Search,
  Filter,
  MessageSquare,
  Loader2,
  ExternalLink,
  Settings,
  TrendingUp,
  Store,
  Calendar,
  Sparkles,
  Check,
  X,
  Send,
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

type Feedback = {
  id: string;
  rating: number;
  name: string | null;
  phone: string | null;
  feedback: string | null;
  source: string;
  createdAt: string;
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
  badge,
}: {
  review: GoogleReview;
  outletId: string;
  outletName?: string;
  onReplied: () => void;
  badge?: string;
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
            {badge && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                {badge}
              </span>
            )}
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

function FeedbackCard({ fb, showOutlet, badge }: { fb: Feedback & { outletName?: string }; showOutlet?: boolean; badge?: string }) {
  return (
    <div className="rounded-xl border border-border bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-600">
          {fb.name?.slice(0, 1).toUpperCase() || "?"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{fb.name || "Anonymous"}</span>
            {badge && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                {badge}
              </span>
            )}
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

// ─── GBP Post Modal ───────────────────────────────────────

const POST_TYPE_LABELS: Record<string, string> = {
  menu_highlight: "Menu Highlight",
  ambiance: "Ambiance & Vibe",
  promo: "Promo / Update",
  behind_scenes: "Behind the Scenes",
  community: "Community",
  seasonal: "Seasonal",
  tip: "Coffee Tip",
};

function GbpPostModal({
  outletId,
  outletName,
  onClose,
}: {
  outletId: string;
  outletName: string;
  onClose: () => void;
}) {
  const [postType, setPostType] = useState("");
  const [generatedText, setGeneratedText] = useState("");
  const [editedText, setEditedText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);

  const generate = async (type?: string) => {
    setGenerating(true);
    setPosted(false);
    try {
      const res = await fetch("/api/reviews/auto-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outletId, postType: type || postType || undefined, mode: "preview" }),
      });
      const data = await res.json();
      setGeneratedText(data.text);
      setEditedText(data.text);
      if (data.postType) setPostType(data.postType);
    } finally {
      setGenerating(false);
    }
  };

  const publish = async () => {
    setPosting(true);
    try {
      const res = await fetch("/api/reviews/auto-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outletId, customText: editedText, mode: "post" }),
      });
      if (res.ok) setPosted(true);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">GBP Update Post</h2>
            <p className="text-sm text-muted-foreground">{outletName}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Post type selector */}
        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Post type (optional)</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(POST_TYPE_LABELS).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setPostType(key)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  postType === key
                    ? "bg-brand-dark text-white"
                    : "border border-border bg-white text-muted-foreground hover:bg-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Generate button */}
        {!generatedText && !generating && (
          <button
            onClick={() => generate()}
            className="mt-4 w-full flex items-center justify-center gap-2 rounded-lg bg-terracotta px-4 py-2.5 text-sm font-medium text-white hover:bg-terracotta/90 transition-colors"
          >
            <Sparkles className="h-4 w-4" />
            Generate Post
          </button>
        )}

        {generating && (
          <div className="mt-4 flex items-center justify-center gap-2 py-6">
            <Loader2 className="h-5 w-5 animate-spin text-terracotta" />
            <span className="text-sm text-muted-foreground">Generating...</span>
          </div>
        )}

        {/* Generated text editor */}
        {generatedText && !generating && (
          <div className="mt-4">
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              className="w-full rounded-lg border border-border bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-ring/50 resize-none"
              rows={5}
              maxLength={1500}
            />
            <p className="mt-1 text-right text-[10px] text-muted-foreground">{editedText.length}/1500</p>

            {posted ? (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3">
                <Check className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-700">Posted to Google Business Profile</span>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={publish}
                  disabled={posting || !editedText.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-50 transition-colors"
                >
                  {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Post to GBP
                </button>
                <button
                  onClick={() => generate()}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                >
                  <Sparkles className="h-4 w-4" />
                  Regenerate
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Auto-Reply Modal ──────────────────────────────────────

type AutoReplyResult = {
  reviewId: string;
  reviewer: string;
  rating: number;
  comment?: string;
  reply: string;
  posted: boolean;
  needsApproval: boolean;
  error?: string;
};

function AutoReplyModal({
  outletId,
  outletName,
  onClose,
  onDone,
}: {
  outletId: string;
  outletName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<AutoReplyResult[] | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [posting, setPosting] = useState<Record<string, boolean>>({});
  const [postedIds, setPostedIds] = useState<Set<string>>(new Set());

  const runAutoReply = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/reviews/auto-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outletId, mode: "post" }),
      });
      const data = await res.json();
      setResults(data.results ?? []);
      // Mark auto-posted ones
      const posted = new Set<string>();
      for (const r of data.results ?? []) {
        if (r.posted) posted.add(r.reviewId);
      }
      setPostedIds(posted);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const approveReply = async (result: AutoReplyResult, customReply?: string) => {
    setPosting((p) => ({ ...p, [result.reviewId]: true }));
    try {
      await fetch("/api/reviews/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outletId, reviewId: result.reviewId, comment: customReply || result.reply }),
      });
      setPostedIds((prev) => new Set(prev).add(result.reviewId));
      if (editingIdx !== null) {
        // Update the reply text in results
        setResults((prev) =>
          prev?.map((r) => r.reviewId === result.reviewId ? { ...r, reply: customReply || r.reply } : r) ?? null,
        );
        setEditingIdx(null);
      }
    } finally {
      setPosting((p) => ({ ...p, [result.reviewId]: false }));
    }
  };

  const pendingApproval = results?.filter((r) => r.needsApproval && !postedIds.has(r.reviewId)) ?? [];
  const autoPosted = results?.filter((r) => r.posted || (postedIds.has(r.reviewId) && !r.needsApproval)) ?? [];
  const approvedByUser = results?.filter((r) => r.needsApproval && postedIds.has(r.reviewId)) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Auto-Reply Reviews</h2>
            <p className="text-sm text-muted-foreground">{outletName}</p>
          </div>
          <button onClick={() => { onDone(); onClose(); }} className="rounded-lg p-2 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!results && !loading && (
          <div className="mt-6 text-center">
            <Sparkles className="mx-auto h-10 w-10 text-terracotta" />
            <p className="mt-3 text-sm text-foreground font-medium">AI will reply to all unreplied Google reviews</p>
            <ul className="mt-2 text-xs text-muted-foreground space-y-1">
              <li>4-5 star reviews: auto-posted immediately</li>
              <li>1-3 star reviews: drafted for your approval</li>
            </ul>
            <button
              onClick={runAutoReply}
              className="mt-4 rounded-lg bg-brand-dark px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-dark/90 transition-colors"
            >
              Run Auto-Reply
            </button>
          </div>
        )}

        {loading && (
          <div className="mt-6 flex flex-col items-center gap-3 py-10">
            <Loader2 className="h-8 w-8 animate-spin text-terracotta" />
            <p className="text-sm text-muted-foreground">Generating replies with AI...</p>
          </div>
        )}

        {results && !loading && (
          <div className="mt-4 space-y-4">
            {results.length === 0 && (
              <div className="rounded-xl border border-border bg-muted/30 p-6 text-center">
                <Check className="mx-auto h-8 w-8 text-green-500" />
                <p className="mt-2 text-sm font-medium">All reviews already replied!</p>
              </div>
            )}

            {/* Auto-posted good reviews */}
            {autoPosted.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-2">
                  Auto-posted ({autoPosted.length})
                </p>
                <div className="space-y-2">
                  {autoPosted.map((r) => (
                    <div key={r.reviewId} className="rounded-lg border border-green-200 bg-green-50 p-3">
                      <div className="flex items-center gap-2">
                        <StarRating rating={r.rating} size={12} />
                        <span className="text-sm font-medium">{r.reviewer}</span>
                        <Check className="ml-auto h-4 w-4 text-green-600" />
                      </div>
                      {r.comment && <p className="mt-1 text-xs text-muted-foreground">{r.comment}</p>}
                      <p className="mt-2 text-xs text-green-800 bg-green-100 rounded p-2">{r.reply}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Approved by user */}
            {approvedByUser.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-2">
                  Approved & posted ({approvedByUser.length})
                </p>
                <div className="space-y-2">
                  {approvedByUser.map((r) => (
                    <div key={r.reviewId} className="rounded-lg border border-green-200 bg-green-50 p-3">
                      <div className="flex items-center gap-2">
                        <StarRating rating={r.rating} size={12} />
                        <span className="text-sm font-medium">{r.reviewer}</span>
                        <Check className="ml-auto h-4 w-4 text-green-600" />
                      </div>
                      {r.comment && <p className="mt-1 text-xs text-muted-foreground">{r.comment}</p>}
                      <p className="mt-2 text-xs text-green-800 bg-green-100 rounded p-2">{r.reply}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pending approval (bad reviews) */}
            {pendingApproval.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">
                  Needs approval ({pendingApproval.length})
                </p>
                <div className="space-y-2">
                  {pendingApproval.map((r, i) => (
                    <div key={r.reviewId} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="flex items-center gap-2">
                        <StarRating rating={r.rating} size={12} />
                        <span className="text-sm font-medium">{r.reviewer}</span>
                      </div>
                      {r.comment && <p className="mt-1 text-xs text-muted-foreground">{r.comment}</p>}

                      {editingIdx === i ? (
                        <div className="mt-2">
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full rounded-lg border border-border bg-white p-2 text-xs outline-none focus:ring-2 focus:ring-ring/50 resize-none"
                            rows={4}
                          />
                          <div className="mt-1.5 flex items-center gap-2">
                            <button
                              onClick={() => setEditingIdx(null)}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => approveReply(r, editText)}
                              disabled={posting[r.reviewId]}
                              className="flex items-center gap-1 rounded-lg bg-brand-dark px-3 py-1 text-xs font-medium text-white hover:bg-brand-dark/90 disabled:opacity-50"
                            >
                              {posting[r.reviewId] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                              Post edited reply
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="mt-2 text-xs text-amber-800 bg-amber-100 rounded p-2">{r.reply}</p>
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              onClick={() => approveReply(r)}
                              disabled={posting[r.reviewId]}
                              className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                            >
                              {posting[r.reviewId] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              Approve & post
                            </button>
                            <button
                              onClick={() => { setEditingIdx(i); setEditText(r.reply); }}
                              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                            >
                              Edit
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Batch Auto-Reply Modal ────────────────────────────────

type BatchOutletResult = {
  outletId: string;
  outletName: string;
  total: number;
  results: AutoReplyResult[];
  error?: string;
};

type BatchResponse = {
  batch: true;
  outlets: BatchOutletResult[];
  totalPosted: number;
  totalPending: number;
  totalOutlets: number;
};

function BatchAutoReplyModal({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BatchResponse | null>(null);
  const [posting, setPosting] = useState<Record<string, boolean>>({});
  const [postedIds, setPostedIds] = useState<Set<string>>(new Set());

  const runBatch = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/reviews/auto-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch: true, mode: "post" }),
      });
      const json = await res.json();
      setData(json);
      const posted = new Set<string>();
      for (const outlet of json.outlets ?? []) {
        for (const r of outlet.results ?? []) {
          if (r.posted) posted.add(r.reviewId);
        }
      }
      setPostedIds(posted);
    } finally {
      setLoading(false);
    }
  };

  const approveReply = async (outletId: string, result: AutoReplyResult, customReply?: string) => {
    setPosting((p) => ({ ...p, [result.reviewId]: true }));
    try {
      await fetch("/api/reviews/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outletId, reviewId: result.reviewId, comment: customReply || result.reply }),
      });
      setPostedIds((prev) => new Set(prev).add(result.reviewId));
    } finally {
      setPosting((p) => ({ ...p, [result.reviewId]: false }));
    }
  };

  const totalUnreplied = data?.outlets.reduce((sum, o) => sum + o.total, 0) ?? 0;
  const allPending = data?.outlets.flatMap((o) =>
    (o.results ?? []).filter((r) => r.needsApproval && !postedIds.has(r.reviewId)).map((r) => ({ ...r, outletId: o.outletId, outletName: o.outletName })),
  ) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Batch Auto-Reply</h2>
            <p className="text-sm text-muted-foreground">All outlets at once</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!data && !loading && (
          <div className="mt-6 text-center">
            <Sparkles className="mx-auto h-10 w-10 text-terracotta" />
            <p className="mt-3 text-sm font-medium">Reply to all unreplied reviews across all outlets</p>
            <ul className="mt-2 text-xs text-muted-foreground space-y-1">
              <li>4-5 star: auto-posted immediately</li>
              <li>1-3 star: drafted for your approval</li>
            </ul>
            <button
              onClick={runBatch}
              className="mt-4 rounded-lg bg-brand-dark px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-dark/90 transition-colors"
            >
              Run Batch Auto-Reply
            </button>
          </div>
        )}

        {loading && (
          <div className="mt-6 flex flex-col items-center gap-3 py-10">
            <Loader2 className="h-8 w-8 animate-spin text-terracotta" />
            <p className="text-sm text-muted-foreground">Processing all outlets...</p>
          </div>
        )}

        {data && !loading && (
          <div className="mt-4 space-y-4">
            {/* Summary */}
            <div className="flex items-center gap-4 rounded-xl bg-muted/30 p-4">
              <div className="text-center">
                <span className="text-2xl font-bold">{data.totalOutlets}</span>
                <p className="text-[10px] text-muted-foreground">Outlets</p>
              </div>
              <div className="text-center">
                <span className="text-2xl font-bold">{totalUnreplied}</span>
                <p className="text-[10px] text-muted-foreground">Unreplied</p>
              </div>
              <div className="text-center">
                <span className="text-2xl font-bold text-green-600">{data.totalPosted}</span>
                <p className="text-[10px] text-muted-foreground">Auto-posted</p>
              </div>
              <div className="text-center">
                <span className="text-2xl font-bold text-amber-600">{allPending.length}</span>
                <p className="text-[10px] text-muted-foreground">Pending</p>
              </div>
            </div>

            {totalUnreplied === 0 && (
              <div className="rounded-xl border border-border bg-muted/30 p-6 text-center">
                <Check className="mx-auto h-8 w-8 text-green-500" />
                <p className="mt-2 text-sm font-medium">All reviews across all outlets already replied!</p>
              </div>
            )}

            {/* Per-outlet auto-posted summary */}
            {data.outlets.filter((o) => o.results.some((r) => r.posted || (postedIds.has(r.reviewId) && !r.needsApproval))).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-2">Auto-posted</p>
                {data.outlets.map((outlet) => {
                  const posted = outlet.results.filter((r) => r.posted);
                  if (posted.length === 0) return null;
                  return (
                    <div key={outlet.outletId} className="mb-2 rounded-lg border border-green-200 bg-green-50 p-3">
                      <p className="text-xs font-semibold text-green-700">{outlet.outletName} — {posted.length} replied</p>
                      {posted.map((r) => (
                        <div key={r.reviewId} className="mt-2 border-t border-green-200 pt-2">
                          <div className="flex items-center gap-2">
                            <StarRating rating={r.rating} size={10} />
                            <span className="text-xs font-medium">{r.reviewer}</span>
                          </div>
                          {r.comment && <p className="text-[10px] text-muted-foreground mt-0.5">{r.comment}</p>}
                          <p className="text-[10px] text-green-800 bg-green-100 rounded p-1.5 mt-1">{r.reply}</p>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pending approval */}
            {allPending.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">
                  Needs approval ({allPending.length})
                </p>
                {allPending.map((r) => (
                  <div key={r.reviewId} className="mb-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="flex items-center gap-2">
                      <StarRating rating={r.rating} size={12} />
                      <span className="text-sm font-medium">{r.reviewer}</span>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        {r.outletName}
                      </span>
                    </div>
                    {r.comment && <p className="mt-1 text-xs text-muted-foreground">{r.comment}</p>}
                    <p className="mt-2 text-xs text-amber-800 bg-amber-100 rounded p-2">{r.reply}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => approveReply(r.outletId, r)}
                        disabled={posting[r.reviewId]}
                        className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        {posting[r.reviewId] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Approve & post
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard View ────────────────────────────────────────

function DashboardView() {
  const [period, setPeriod] = useState<"day" | "week" | "month" | "custom">("month");
  const [dashTab, setDashTab] = useState<"google" | "internal">("google");
  const [search, setSearch] = useState("");
  const [filterRating, setFilterRating] = useState<number | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showBatchReply, setShowBatchReply] = useState(false);
  const [filterOutletId, setFilterOutletId] = useState<string | null>(null);

  const fetchUrl = period === "custom" && customFrom
    ? `/api/reviews/dashboard?period=custom&from=${customFrom}${customTo ? `&to=${customTo}` : ""}`
    : period !== "custom"
      ? `/api/reviews/dashboard?period=${period}`
      : null;

  const { data, isLoading } = useFetch<DashboardResponse>(fetchUrl);

  const periodLabel = period === "day" ? "Today" : period === "week" ? "Last 7 days" : period === "month" ? "Last 30 days" : customFrom ? `${customFrom} to ${customTo || "now"}` : "Custom";

  // Reviews tab: only 4-5 star Google reviews
  const filteredGoogleReviews = (data?.allGoogleReviews ?? []).filter((r) => {
    if (r.rating < 4) return false;
    if (filterOutletId && r.outletId !== filterOutletId) return false;
    if (search && !r.reviewer.name.toLowerCase().includes(search.toLowerCase()) && !r.comment?.toLowerCase().includes(search.toLowerCase()) && !r.outletName.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterRating && r.rating !== filterRating) return false;
    return true;
  });

  // Feedback tab: 1-3 star Google reviews + internal QR feedback
  const lowStarGoogleReviews = (data?.allGoogleReviews ?? []).filter((r) => r.rating <= 3 && (!filterOutletId || r.outletId === filterOutletId));
  const internalFeedbacks = (data?.allFeedbacks ?? []).filter((f) => !filterOutletId || f.outletName === data?.outlets?.find((o) => o.outletId === filterOutletId)?.outletName);

  type FeedbackItem = { type: "google"; data: DashboardGoogleReview } | { type: "internal"; data: DashboardFeedback };
  const combinedFeedback: FeedbackItem[] = [
    ...lowStarGoogleReviews.map((r) => ({ type: "google" as const, data: r })),
    ...internalFeedbacks.map((f) => ({ type: "internal" as const, data: f })),
  ].sort((a, b) => new Date(b.data.createdAt).getTime() - new Date(a.data.createdAt).getTime());

  const filteredFeedback = combinedFeedback.filter((item) => {
    const s = search.toLowerCase();
    if (item.type === "google") {
      const r = item.data;
      if (search && !r.reviewer.name.toLowerCase().includes(s) && !r.comment?.toLowerCase().includes(s) && !r.outletName.toLowerCase().includes(s)) return false;
      if (filterRating && r.rating !== filterRating) return false;
    } else {
      const f = item.data;
      if (search && !f.name?.toLowerCase().includes(s) && !f.feedback?.toLowerCase().includes(s) && !f.outletName?.toLowerCase().includes(s)) return false;
      if (filterRating && f.rating !== filterRating) return false;
    }
    return true;
  });

  return (
    <>
      {/* Period filter */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground mr-1">Period:</span>
        {(["day", "week", "month", "custom"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              period === p
                ? "bg-brand-dark text-white"
                : "border border-border bg-white text-muted-foreground hover:bg-muted"
            }`}
          >
            {p === "day" ? "Today" : p === "week" ? "7 Days" : p === "month" ? "30 Days" : "Custom"}
          </button>
        ))}
        {period === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
            />
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => setShowBatchReply(true)}
          className="flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white hover:bg-terracotta/90 transition-colors"
        >
          <Sparkles className="h-4 w-4" />
          Auto-Reply All Outlets
        </button>
      </div>

      {/* Batch auto-reply modal */}
      {showBatchReply && (
        <BatchAutoReplyModal onClose={() => setShowBatchReply(false)} />
      )}

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
            <span className="text-xs font-medium">Feedback</span>
          </div>
          <span className="mt-2 block text-2xl font-bold">
            {((data?.allGoogleReviews ?? []).filter((r) => r.rating <= 3).length + (data?.allFeedbacks ?? []).length)}
          </span>
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

      {/* Per-outlet breakdown — clickable to filter */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(data?.outlets ?? []).map((outlet) => (
          <button
            key={outlet.outletId}
            onClick={() => setFilterOutletId(filterOutletId === outlet.outletId ? null : outlet.outletId)}
            className={`rounded-xl border p-4 text-left transition-colors ${
              filterOutletId === outlet.outletId
                ? "border-terracotta bg-terracotta/5 ring-1 ring-terracotta"
                : "border-border bg-white hover:border-terracotta/40"
            }`}
          >
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
          </button>
        ))}
      </div>
      {filterOutletId && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Filtered: <span className="font-medium text-foreground">{data?.outlets?.find((o) => o.outletId === filterOutletId)?.outletName}</span>
          </span>
          <button
            onClick={() => setFilterOutletId(null)}
            className="rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Sub-tabs + toolbar */}
      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-1 border-b border-border">
          <button
            onClick={() => setDashTab("google")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              dashTab === "google" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Reviews ({filteredGoogleReviews.length})
          </button>
          <button
            onClick={() => setDashTab("internal")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              dashTab === "internal" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Feedback ({combinedFeedback.length})
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
                <p className="mt-3 text-sm text-muted-foreground">No 4-5 star reviews in this period</p>
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
            {filteredFeedback.length === 0 ? (
              <div className="rounded-xl border border-border bg-white p-10 text-center">
                <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground/30" />
                <p className="mt-3 text-sm text-muted-foreground">No feedback in this period</p>
              </div>
            ) : (
              filteredFeedback.map((item, idx) =>
                item.type === "google" ? (
                  <ReviewCard
                    key={`g-${item.data.outletId}-${item.data.id}`}
                    review={item.data}
                    outletId={item.data.outletId}
                    outletName={item.data.outletName}
                    onReplied={() => {}}
                    badge="Google"
                  />
                ) : (
                  <FeedbackCard key={`f-${item.data.id}`} fb={item.data} showOutlet badge="QR" />
                ),
              )
            )}
          </>
        )}
      </div>
    </>
  );
}


// ─── Main Page ─────────────────────────────────────────────

export default function ReviewsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">Reviews</h1>
          <p className="text-sm text-muted-foreground">Manage Google reviews & internal feedback</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/reviews/settings"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            <Settings className="h-4 w-4" />
            Review settings
          </Link>
        </div>
      </div>

      <DashboardView />
    </div>
  );
}
