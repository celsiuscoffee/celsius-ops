"use client";

/**
 * Public QR review page — the rating gate customers land on.
 *
 * ≥ threshold → straight to the outlet's Google review page (auto-redirect +
 * manual fallback button). < threshold → private feedback form so we catch it
 * before it becomes a public review.
 *
 * Celsius brand system, self-contained: espresso #160800 / terracotta #C2452D /
 * offwhite #f5f3f0, Peachi headings. All colors are explicit hex so the admin
 * app's light/dark theme overrides can never repaint a customer's phone.
 */

import { useState, useEffect, use } from "react";
import { Star, Loader2, Check, ArrowUpRight } from "lucide-react";

type FeedbackField = { question: string; type: string; required: boolean; active: boolean };
type PublicSettings = {
  outletName: string;
  ratingThreshold: number;
  googleReviewUrl: string | null;
  heading: string | null;
  description: string | null;
  logoUrl: string | null;
  feedbackFields: FeedbackField[];
};

type Step = "rating" | "feedback" | "thanks" | "redirect";

const RATING_LABELS = ["", "Terrible", "Poor", "Average", "Good", "Great"];

// Brand tokens (explicit — see header comment)
const C = {
  espresso: "#160800",
  surface: "#241309",
  surfaceEdge: "#3a2415",
  terracotta: "#C2452D",
  terracottaDark: "#A33822",
  offwhite: "#f5f3f0",
  muted: "rgba(245,243,240,0.55)",
  faint: "rgba(245,243,240,0.28)",
};

export default function PublicReviewPage({ params }: { params: Promise<{ outletId: string }> }) {
  const { outletId } = use(params);
  const [step, setStep] = useState<Step>("rating");
  const [rating, setRating] = useState(0);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/reviews/public-settings?outletId=${outletId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setSettings(s))
      .catch(() => setSettings(null))
      .finally(() => setLoading(false));
  }, [outletId]);

  const pick = (r: number) => {
    setRating(r);
    const threshold = settings?.ratingThreshold ?? 4;
    if (r >= threshold && settings?.googleReviewUrl) {
      // Straight to Google — no interstitial. The "redirect" state stays
      // visible only while the browser navigates (and carries a manual
      // button in case navigation is slow or blocked).
      setStep("redirect");
      window.location.href = settings.googleReviewUrl;
    } else if (r >= threshold) {
      setStep("thanks"); // no Google URL configured — thank and stop
    } else {
      setStep("feedback");
    }
  };

  const activeFields = (settings?.feedbackFields ?? []).filter((f) => f.active);
  const missingRequired = activeFields.filter((f) => f.required && !(formData[f.question] || "").trim());

  const submitFeedback = async () => {
    if (missingRequired.length > 0) {
      setSubmitError(`Please fill in: ${missingRequired.map((f) => f.question).join(", ")}`);
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch("/api/reviews/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletId,
          rating,
          name: formData["Name"] || null,
          phone: formData["Phone"] || null,
          feedback: formData["Feedback"] || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setSubmitError(d.error || "Something went wrong — please try again.");
        return;
      }
      setStep("thanks");
    } catch {
      setSubmitError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    "mt-1.5 w-full rounded-xl border px-4 py-3 text-[15px] outline-none transition-colors placeholder:opacity-40";
  const inputStyle = {
    backgroundColor: C.surface,
    borderColor: C.surfaceEdge,
    color: C.offwhite,
  } as const;

  return (
    <div
      className="flex min-h-dvh flex-col items-center px-5 pb-10 pt-14"
      style={{ backgroundColor: C.espresso, color: C.offwhite }}
    >
      <div className="flex w-full max-w-sm flex-1 flex-col">
        {/* Logo — outlet override, else the Celsius °C mark on terracotta */}
        {settings?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={settings.logoUrl} alt="Celsius Coffee" className="mx-auto h-16 w-16 rounded-2xl object-cover" />
        ) : (
          <div
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ backgroundColor: C.terracotta }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/celsius-degc.png" alt="Celsius Coffee" className="h-9 w-9 object-contain" />
          </div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin" style={{ color: C.terracotta }} />
          </div>
        ) : (
          <>
            {/* ── Rating ── */}
            {step === "rating" && (
              <div className="mt-8 text-center">
                <h1 className="text-[28px] leading-tight" style={{ fontFamily: "var(--font-heading)" }}>
                  {settings?.heading || "How was your coffee today?"}
                </h1>
                <p className="mt-2 text-sm" style={{ color: C.muted }}>
                  {settings?.description || "Tap a star — it takes five seconds and means the world to us."}
                </p>
                {settings?.outletName && (
                  <p className="mt-4 text-xs uppercase tracking-[0.18em]" style={{ color: C.faint }}>
                    {settings.outletName}
                  </p>
                )}

                {/* One-tap star row — big targets */}
                <div className="mt-10 flex justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => pick(r)}
                      aria-label={`${r} star${r > 1 ? "s" : ""} — ${RATING_LABELS[r]}`}
                      className="flex h-14 w-14 items-center justify-center rounded-2xl border transition-transform active:scale-90"
                      style={{
                        backgroundColor: r <= rating ? C.terracotta : C.surface,
                        borderColor: r <= rating ? C.terracotta : C.surfaceEdge,
                      }}
                    >
                      <Star
                        className="h-7 w-7"
                        style={{
                          color: r <= rating ? C.offwhite : C.faint,
                          fill: r <= rating ? C.offwhite : "transparent",
                        }}
                      />
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex justify-center gap-2 text-[11px]" style={{ color: C.faint }}>
                  <span>Terrible</span>
                  <span className="flex-1 max-w-40" />
                  <span>Great</span>
                </div>
              </div>
            )}

            {/* ── In-flight to Google (visible only while the browser navigates) ── */}
            {step === "redirect" && (
              <div className="mt-20 text-center">
                <Loader2 className="mx-auto h-7 w-7 animate-spin" style={{ color: C.terracotta }} />
                <p className="mt-4 text-sm" style={{ color: C.muted }}>
                  Opening Google reviews…
                </p>
                {/* Fallback if navigation is blocked or slow */}
                <a
                  href={settings?.googleReviewUrl ?? "#"}
                  className="mt-8 inline-flex items-center gap-1.5 rounded-xl px-5 py-3 text-sm font-semibold"
                  style={{ backgroundColor: C.terracotta, color: C.offwhite }}
                >
                  Continue to Google <ArrowUpRight className="h-4 w-4" />
                </a>
              </div>
            )}

            {/* ── Private feedback ── */}
            {step === "feedback" && (
              <div className="mt-8">
                <h2 className="text-center text-2xl leading-tight" style={{ fontFamily: "var(--font-heading)" }}>
                  We&apos;re sorry we missed the mark
                </h2>
                <p className="mt-2 text-center text-sm" style={{ color: C.muted }}>
                  Tell us what happened — the team reads every message.
                </p>

                <div className="mt-4 flex justify-center gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star
                      key={i}
                      className="h-5 w-5"
                      style={{
                        color: i <= rating ? C.terracotta : C.faint,
                        fill: i <= rating ? C.terracotta : "transparent",
                      }}
                    />
                  ))}
                </div>

                <div className="mt-7 space-y-4">
                  {activeFields.map((field) => (
                    <div key={field.question}>
                      <label className="text-[13px] font-medium" style={{ color: C.muted }}>
                        {field.question}
                        {field.required && <span style={{ color: C.terracotta }}> *</span>}
                      </label>
                      {field.type === "paragraph" ? (
                        <textarea
                          value={formData[field.question] || ""}
                          onChange={(e) => setFormData({ ...formData, [field.question]: e.target.value })}
                          placeholder="What could we have done better?"
                          rows={4}
                          className={`${inputCls} resize-none`}
                          style={inputStyle}
                        />
                      ) : (
                        <input
                          type={field.type === "phone" ? "tel" : "text"}
                          value={formData[field.question] || ""}
                          onChange={(e) => setFormData({ ...formData, [field.question]: e.target.value })}
                          placeholder={field.type === "phone" ? "01X-XXX XXXX" : field.question}
                          className={inputCls}
                          style={inputStyle}
                        />
                      )}
                    </div>
                  ))}
                </div>

                {submitError && (
                  <p className="mt-4 rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: "rgba(194,69,45,0.15)", color: "#E8907E" }}>
                    {submitError}
                  </p>
                )}

                <button
                  onClick={submitFeedback}
                  disabled={submitting}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-[15px] font-semibold transition-opacity disabled:opacity-60"
                  style={{ backgroundColor: C.terracotta, color: C.offwhite }}
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Send feedback
                </button>
              </div>
            )}

            {/* ── Thanks ── */}
            {step === "thanks" && (
              <div className="mt-16 text-center">
                <div
                  className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
                  style={{ backgroundColor: C.terracotta }}
                >
                  <Check className="h-8 w-8" style={{ color: C.offwhite }} />
                </div>
                <h2 className="mt-6 text-2xl" style={{ fontFamily: "var(--font-heading)" }}>
                  Thank you
                </h2>
                <p className="mx-auto mt-2 max-w-[260px] text-sm" style={{ color: C.muted }}>
                  We appreciate you taking a moment. See you at the counter soon.
                </p>
              </div>
            )}
          </>
        )}

        <p className="mt-auto pt-10 text-center text-[11px] uppercase tracking-[0.22em]" style={{ color: C.faint }}>
          Celsius Coffee
        </p>
      </div>
    </div>
  );
}
