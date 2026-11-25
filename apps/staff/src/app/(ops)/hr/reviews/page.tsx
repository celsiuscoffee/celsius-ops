"use client";

import { useFetch } from "@/lib/use-fetch";
import { HRPageHeader } from "@/components/hr-page-header";
import { Star, AlertTriangle, MessageCircle } from "lucide-react";

type MyReview = {
  id: string;
  outletName: string;
  rating: number;
  comment: string | null;
  reviewer: string | null;
  createdAt: string;
  isPenalty: boolean;
  penaltyStatus: string | null;
};

export default function MyReviewsPage() {
  const { data, isLoading } = useFetch<{ reviews: MyReview[]; count: number }>("/api/hr/my-reviews");
  const reviews = data?.reviews || [];

  const positiveCount = reviews.filter((r) => r.rating >= 4).length;
  const negativeCount = reviews.filter((r) => r.rating <= 3).length;

  return (
    <div className="px-4 pb-6">
      <HRPageHeader title="Customer feedback" subtitle="Reviews left during your shifts." />

      {!isLoading && reviews.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-ok/30 bg-ok-soft p-3 text-center">
            <p className="text-2xl font-bold text-ok-text">{positiveCount}</p>
            <p className="text-[10px] text-ok-text">4★ and above</p>
          </div>
          <div className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-center">
            <p className="text-2xl font-bold text-danger-text">{negativeCount}</p>
            <p className="text-[10px] text-danger-text">3★ or below</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-sm text-text-3">Loading…</div>
      ) : reviews.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-line bg-sunken/60 py-16">
          <MessageCircle className="mb-2 h-10 w-10 text-line-ctl" />
          <p className="font-semibold text-text-3">No reviews yet</p>
          <p className="text-xs text-text-3">Google reviews during your shifts will appear here</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <div key={r.id} className="rounded-2xl border border-line bg-surface p-3">
              <div className="mb-1 flex items-center gap-2">
                <div className="flex">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      className={`h-3.5 w-3.5 ${n <= r.rating ? "fill-warn text-warn" : "text-line-ctl"}`}
                    />
                  ))}
                </div>
                {r.isPenalty && (
                  <span className="flex items-center gap-1 rounded-full bg-danger-soft px-1.5 py-0.5 text-[10px] font-medium text-danger-text">
                    <AlertTriangle className="h-3 w-3" /> Penalty {r.penaltyStatus === "applied" ? "applied" : "pending"}
                  </span>
                )}
                {r.rating >= 4 && (
                  <span className="rounded-full bg-ok-soft px-1.5 py-0.5 text-[10px] font-medium text-ok-text">
                    Nice!
                  </span>
                )}
              </div>
              {r.comment && <p className="text-sm text-text-2 italic">&ldquo;{r.comment}&rdquo;</p>}
              <p className="mt-2 text-xs text-text-3">
                {r.reviewer || "Anonymous"} · {r.outletName} · {new Date(r.createdAt).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
