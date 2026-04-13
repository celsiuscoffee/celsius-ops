"use client";

import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Copy,
  Check,
  QrCode,
  Star,
  ExternalLink,
  Loader2,
  Download,
} from "lucide-react";
import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";

// ─── Types ─────────────────────────────────────────────────

type Outlet = { id: string; name: string };

type ReviewSettingsData = {
  id: string;
  outletId: string;
  gbpPlaceId: string | null;
  gbpAccountId: string | null;
  gbpLocationName: string | null;
  googleReviewUrl: string | null;
  ratingThreshold: number;
  heading: string | null;
  description: string | null;
  logoUrl: string | null;
  feedbackFields: FeedbackField[];
};

type FeedbackField = {
  question: string;
  type: "short_text" | "phone" | "paragraph";
  required: boolean;
  active: boolean;
};

type QrData = {
  url: string;
  outletName: string;
  ratingThreshold: number;
  googleReviewUrl: string | null;
  hasGoogleUrl: boolean;
};

type SettingsTab = "general" | "qr" | "feedback";

// ─── Main Page ─────────────────────────────────────────────

export default function ReviewSettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [outletId, setOutletId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Form state
  const [googleReviewUrl, setGoogleReviewUrl] = useState("");
  const [gbpAccountId, setGbpAccountId] = useState("");
  const [gbpLocationName, setGbpLocationName] = useState("");
  const [ratingThreshold, setRatingThreshold] = useState(4);
  const [heading, setHeading] = useState("");
  const [description, setDescription] = useState("");
  const [feedbackFields, setFeedbackFields] = useState<FeedbackField[]>([]);

  // Fetch
  const { data: outlets } = useFetch<Outlet[]>("/api/settings/outlets?status=ACTIVE");
  const selectedOutletId = outletId || (outlets?.[0]?.id ?? "");

  const { data: settings, mutate: mutateSettings } = useFetch<ReviewSettingsData>(
    selectedOutletId ? `/api/reviews/settings?outletId=${selectedOutletId}` : null,
  );
  const { data: qrData } = useFetch<QrData>(
    selectedOutletId ? `/api/reviews/qr?outletId=${selectedOutletId}` : null,
  );

  // Sync form state when settings load
  useEffect(() => {
    if (settings) {
      setGoogleReviewUrl(settings.googleReviewUrl ?? "");
      setGbpAccountId(settings.gbpAccountId ?? "");
      setGbpLocationName(settings.gbpLocationName ?? "");
      setRatingThreshold(settings.ratingThreshold);
      setHeading(settings.heading ?? "");
      setDescription(settings.description ?? "");
      setFeedbackFields(settings.feedbackFields ?? []);
    }
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/reviews/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletId: selectedOutletId,
          googleReviewUrl: googleReviewUrl || null,
          gbpAccountId: gbpAccountId || null,
          gbpLocationName: gbpLocationName || null,
          ratingThreshold,
          heading: heading || null,
          description: description || null,
          feedbackFields,
        }),
      });
      setSaved(true);
      mutateSettings();
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = () => {
    if (qrData?.url) {
      navigator.clipboard.writeText(qrData.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const downloadQr = () => {
    if (!qrData?.url) return;
    // Use a QR code API to generate downloadable image
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(qrData.url)}`;
    const a = document.createElement("a");
    a.href = qrImageUrl;
    a.download = `review-qr-${selectedOutletId}.png`;
    a.click();
  };

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: "general", label: "Review settings" },
    { key: "qr", label: "QR code & link" },
    { key: "feedback", label: "Feedback form" },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/reviews" className="rounded-lg p-1.5 hover:bg-muted transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-heading text-xl font-bold">Review settings</h1>
      </div>

      {/* Outlet selector */}
      {outlets && outlets.length > 1 && (
        <div className="mt-4">
          <select
            value={selectedOutletId}
            onChange={(e) => setOutletId(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
          >
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-6 flex gap-6">
        {/* Sidebar tabs */}
        <div className="hidden sm:block w-48 shrink-0">
          <nav className="space-y-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${
                  activeTab === t.key
                    ? "bg-muted font-medium text-foreground border-l-2 border-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Mobile tabs */}
        <div className="sm:hidden w-full mb-4">
          <div className="flex border-b border-border">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex-1 py-2 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === t.key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* General Settings */}
          {activeTab === "general" && (
            <div className="space-y-6">
              {/* Google Review URL */}
              <div className="rounded-xl border border-border bg-white p-5">
                <h3 className="font-semibold text-sm">Google Review URL</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Paste your Google Maps review link. Customers with high ratings will be redirected here.
                </p>
                <input
                  value={googleReviewUrl}
                  onChange={(e) => setGoogleReviewUrl(e.target.value)}
                  placeholder="https://search.google.com/local/writereview?placeid=..."
                  className="mt-3 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                />
              </div>

              {/* GBP API (optional advanced) */}
              <div className="rounded-xl border border-border bg-white p-5">
                <h3 className="font-semibold text-sm">GBP API Connection (Advanced)</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Connect to Google Business Profile API to fetch reviews and reply directly.
                </p>
                <div className="mt-3 space-y-3">
                  <input
                    value={gbpAccountId}
                    onChange={(e) => setGbpAccountId(e.target.value)}
                    placeholder="Account ID (e.g. accounts/123456)"
                    className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                  />
                  <input
                    value={gbpLocationName}
                    onChange={(e) => setGbpLocationName(e.target.value)}
                    placeholder="Location name (e.g. locations/789)"
                    className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                  />
                </div>
              </div>

              {/* Rating threshold */}
              <div className="rounded-xl border border-border bg-white p-5">
                <h3 className="font-semibold text-sm">Rating Threshold</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Customers who rate this number of stars or higher will be redirected to Google Reviews.
                  Lower ratings are captured as internal feedback.
                </p>
                <div className="mt-3 flex items-center gap-3">
                  {[3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setRatingThreshold(n)}
                      className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium border transition-colors ${
                        ratingThreshold === n
                          ? "border-terracotta bg-terracotta/10 text-terracotta"
                          : "border-border bg-white text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <Star className={`h-4 w-4 ${ratingThreshold === n ? "fill-terracotta text-terracotta" : ""}`} />
                      {n}+ stars
                    </button>
                  ))}
                </div>
              </div>

              {/* Review page branding */}
              <div className="rounded-xl border border-border bg-white p-5">
                <h3 className="font-semibold text-sm">Review Page Branding</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Customize the page customers see when they scan the QR code.
                </p>
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Heading</label>
                    <input
                      value={heading}
                      onChange={(e) => setHeading(e.target.value)}
                      placeholder="How was your experience?"
                      className="mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Description</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Thank you for visiting! We'd love your feedback."
                      rows={3}
                      className="mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/50 resize-none"
                    />
                  </div>
                </div>
              </div>

              {/* Save button */}
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-brand-dark px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-50 transition-colors"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : saved ? (
                  <Check className="h-4 w-4" />
                ) : null}
                {saved ? "Saved" : "Save"}
              </button>
            </div>
          )}

          {/* QR Code & Link */}
          {activeTab === "qr" && (
            <div className="space-y-6">
              <div className="rounded-xl border border-border bg-white p-6">
                <h3 className="font-semibold text-sm">Your Review QR Code</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Print this QR code and place it at your outlet. Customers scan it, rate their experience,
                  and get redirected based on their rating.
                </p>

                {qrData?.url && (
                  <div className="mt-5 flex flex-col items-center">
                    {/* QR Code image */}
                    <div className="rounded-xl border border-border p-4 bg-white">
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData.url)}`}
                        alt="Review QR Code"
                        className="h-[200px] w-[200px]"
                      />
                    </div>

                    <p className="mt-3 text-sm font-medium">{qrData.outletName}</p>

                    {/* URL display */}
                    <div className="mt-3 flex items-center gap-2 w-full max-w-sm">
                      <input
                        value={qrData.url}
                        readOnly
                        className="flex-1 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs outline-none"
                      />
                      <button
                        onClick={copyUrl}
                        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted transition-colors"
                      >
                        {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>

                    <button
                      onClick={downloadQr}
                      className="mt-3 flex items-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2 text-xs font-medium text-white hover:bg-brand-dark/90 transition-colors"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download QR
                    </button>
                  </div>
                )}
              </div>

              {/* How it works */}
              <div className="rounded-xl border border-border bg-white p-5">
                <h3 className="font-semibold text-sm">How the QR flow works</h3>
                <div className="mt-3 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">1</div>
                    <div>
                      <p className="text-sm font-medium">Customer scans QR</p>
                      <p className="text-xs text-muted-foreground">Opens the review page on their phone</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">2</div>
                    <div>
                      <p className="text-sm font-medium">Picks a star rating</p>
                      <p className="text-xs text-muted-foreground">Selects how they'd rate their experience</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">{ratingThreshold}+</div>
                    <div>
                      <p className="text-sm font-medium">High rating → Google Review</p>
                      <p className="text-xs text-muted-foreground">Redirected to your Google review page to leave a public review</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">&lt;{ratingThreshold}</div>
                    <div>
                      <p className="text-sm font-medium">Low rating → Internal feedback</p>
                      <p className="text-xs text-muted-foreground">Shows a feedback form. Saved privately for your team to review</p>
                    </div>
                  </div>
                </div>
              </div>

              {!qrData?.hasGoogleUrl && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-medium text-amber-800">Google Review URL not set</p>
                  <p className="mt-1 text-xs text-amber-600">
                    Go to the &quot;Review settings&quot; tab to add your Google Review URL. Without it, high-rating
                    customers won&apos;t be redirected.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Feedback Form Builder */}
          {activeTab === "feedback" && (
            <div className="space-y-6">
              <div className="rounded-xl border border-border bg-white p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-sm">Feedback form</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Customize the fields shown when customers leave internal feedback
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setFeedbackFields([
                        ...feedbackFields,
                        { question: "New question", type: "short_text", required: false, active: true },
                      ]);
                    }}
                    className="rounded-lg bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark/90 transition-colors"
                  >
                    Add question
                  </button>
                </div>

                {/* Table */}
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="pb-2 text-xs font-semibold text-muted-foreground uppercase">Question</th>
                        <th className="pb-2 text-xs font-semibold text-muted-foreground uppercase">Type</th>
                        <th className="pb-2 text-xs font-semibold text-muted-foreground uppercase">Required</th>
                        <th className="pb-2 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                        <th className="pb-2 text-xs font-semibold text-muted-foreground uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {feedbackFields.map((field, idx) => (
                        <tr key={idx}>
                          <td className="py-2.5">
                            <input
                              value={field.question}
                              onChange={(e) => {
                                const updated = [...feedbackFields];
                                updated[idx] = { ...field, question: e.target.value };
                                setFeedbackFields(updated);
                              }}
                              className="rounded border border-transparent px-2 py-1 text-sm hover:border-border focus:border-border outline-none"
                            />
                          </td>
                          <td className="py-2.5">
                            <select
                              value={field.type}
                              onChange={(e) => {
                                const updated = [...feedbackFields];
                                updated[idx] = { ...field, type: e.target.value as FeedbackField["type"] };
                                setFeedbackFields(updated);
                              }}
                              className="rounded border border-border px-2 py-1 text-xs"
                            >
                              <option value="short_text">Short text</option>
                              <option value="phone">Phone</option>
                              <option value="paragraph">Paragraph</option>
                            </select>
                          </td>
                          <td className="py-2.5">
                            <button
                              onClick={() => {
                                const updated = [...feedbackFields];
                                updated[idx] = { ...field, required: !field.required };
                                setFeedbackFields(updated);
                              }}
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                field.required ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                              }`}
                            >
                              {field.required ? "On" : "Off"}
                            </button>
                          </td>
                          <td className="py-2.5">
                            <button
                              onClick={() => {
                                const updated = [...feedbackFields];
                                updated[idx] = { ...field, active: !field.active };
                                setFeedbackFields(updated);
                              }}
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                field.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                              }`}
                            >
                              {field.active ? "Active" : "Inactive"}
                            </button>
                          </td>
                          <td className="py-2.5">
                            <button
                              onClick={() => {
                                setFeedbackFields(feedbackFields.filter((_, i) => i !== idx));
                              }}
                              className="text-xs text-red-500 hover:text-red-700"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Save */}
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-brand-dark px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-50 transition-colors"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : saved ? (
                  <Check className="h-4 w-4" />
                ) : null}
                {saved ? "Saved" : "Save"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
