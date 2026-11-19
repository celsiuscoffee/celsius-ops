"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { formatTime } from "@/lib/format-time";

// Self-editable profile fields. Mirrors the SELF_EDITABLE_FIELDS allowlist
// in /api/hr/profile/route.ts — keep them in sync.
type Profile = {
  date_of_birth: string | null;
  gender: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postcode: string | null;
  marital_status: string | null;
  spouse_name: string | null;
  spouse_working: boolean | null;
  num_children: number | null;
  race: string | null;
  religion: string | null;
  personal_email: string | null;
  secondary_phone: string | null;
  education_level: string | null;
  t_shirt_size: string | null;
  dietary_restrictions: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  profile_completed_at: string | null;
};

const MY_STATES = [
  "Johor", "Kedah", "Kelantan", "Kuala Lumpur", "Labuan", "Melaka",
  "Negeri Sembilan", "Pahang", "Penang", "Perak", "Perlis", "Putrajaya",
  "Sabah", "Sarawak", "Selangor", "Terengganu",
];

export default function PersonalProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Partial<Profile>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completeness, setCompleteness] = useState({ filled: 0, total: 0, percent: 0, complete: false });
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/hr/profile")
      .then((r) => r.json())
      .then((d) => {
        if (d.profile) setProfile(d.profile);
        if (d.completeness) setCompleteness(d.completeness);
      })
      .finally(() => setLoading(false));
  }, []);

  const update = <K extends keyof Profile>(k: K, v: Profile[K]) => {
    setProfile((p) => ({ ...p, [k]: v }));
  };

  const save = async (markComplete = false) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/hr/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: profile, mark_complete: markComplete }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Failed to save");
        return;
      }
      const d = await res.json();
      if (d.profile) setProfile(d.profile);
      setSavedAt(new Date());
      // Refresh completeness gauge
      const r = await fetch("/api/hr/profile").then((x) => x.json());
      if (r.completeness) setCompleteness(r.completeness);
      if (markComplete) {
        // Send them back to the profile root with a thank-you
        router.push("/profile?completed=1");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand-text" />
      </div>
    );
  }

  return (
    <div className="px-4 pb-32">
      {/* Top bar with back link + completeness gauge */}
      <PageHeader
        title="Personal info"
        description="For payslips, government filings and emergencies. HR looks after your salary and sign-in."
        backHref="/profile"
      />

      {/* Completeness bar */}
      <div className="mb-4 rounded-xl border bg-card p-3">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="font-medium text-text-2">
            Profile {completeness.percent}% complete
          </span>
          <span className="text-text-3">{completeness.filled} of {completeness.total} required</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-sunken">
          <div
            className={`h-full transition-all ${
              completeness.percent === 100 ? "bg-ok" : "bg-ink"
            }`}
            style={{ width: `${completeness.percent}%` }}
          />
        </div>
        {completeness.complete && (
          <p className="mt-2 flex items-center gap-1 text-[11px] text-ok-text">
            <CheckCircle2 className="h-3 w-3" />
            Marked complete — thank you!
          </p>
        )}
      </div>

      <div className="space-y-4">
        {/* Identity */}
        <Section title="Identity">
          <Row label="Date of birth">
            <input
              type="date"
              value={profile.date_of_birth || ""}
              onChange={(e) => update("date_of_birth", e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            />
          </Row>
          <Row label="Gender">
            <select
              value={profile.gender || ""}
              onChange={(e) => update("gender", e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
            </select>
          </Row>
          <Row label="Race">
            <select
              value={profile.race || ""}
              onChange={(e) => update("race", e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              <option value="malay">Malay</option>
              <option value="chinese">Chinese</option>
              <option value="indian">Indian</option>
              <option value="bumiputra_other">Bumiputra (other)</option>
              <option value="other">Other</option>
            </select>
          </Row>
          <Row label="Religion">
            <select
              value={profile.religion || ""}
              onChange={(e) => update("religion", e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              <option value="islam">Islam</option>
              <option value="buddhism">Buddhism</option>
              <option value="christianity">Christianity</option>
              <option value="hinduism">Hinduism</option>
              <option value="sikhism">Sikhism</option>
              <option value="other">Other</option>
              <option value="none">None</option>
            </select>
          </Row>
        </Section>

        {/* Address */}
        <Section title="Home address">
          <Row label="Address line 1">
            <input
              type="text"
              value={profile.address_line1 || ""}
              onChange={(e) => update("address_line1", e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              placeholder="Street + house no."
            />
          </Row>
          <Row label="Address line 2 (optional)">
            <input
              type="text"
              value={profile.address_line2 || ""}
              onChange={(e) => update("address_line2", e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              placeholder="Taman / area"
            />
          </Row>
          <Row label="City">
            <input
              type="text"
              value={profile.address_city || ""}
              onChange={(e) => update("address_city", e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            />
          </Row>
          <Row label="State">
            <select
              value={profile.address_state || ""}
              onChange={(e) => update("address_state", e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              {MY_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Row>
          <Row label="Postcode">
            <input
              type="text"
              inputMode="numeric"
              maxLength={5}
              value={profile.address_postcode || ""}
              onChange={(e) => update("address_postcode", e.target.value.replace(/\D/g, ""))}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              placeholder="5 digits"
            />
          </Row>
        </Section>

        {/* Family — for tax relief */}
        <Section
          title="Family (for tax relief)"
          subtitle="LHDN gives spouse and child reliefs based on this. Only you and HR see it."
        >
          <Row label="Marital status">
            <select
              value={profile.marital_status || ""}
              onChange={(e) => update("marital_status", e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              <option value="single">Single</option>
              <option value="married">Married</option>
              <option value="divorced">Divorced</option>
              <option value="widowed">Widowed</option>
            </select>
          </Row>
          {profile.marital_status === "married" && (
            <>
              <Row label="Spouse name">
                <input
                  type="text"
                  value={profile.spouse_name || ""}
                  onChange={(e) => update("spouse_name", e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                />
              </Row>
              <Row label="Is your spouse working?">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => update("spouse_working", true)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm ${profile.spouse_working === true ? "border-ink bg-brand-soft text-brand-text" : "bg-background"}`}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => update("spouse_working", false)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm ${profile.spouse_working === false ? "border-ink bg-brand-soft text-brand-text" : "bg-background"}`}
                  >
                    No
                  </button>
                </div>
              </Row>
            </>
          )}
          <Row label="Number of children">
            <input
              type="number"
              min={0}
              max={20}
              value={profile.num_children ?? ""}
              onChange={(e) => update("num_children", e.target.value ? Number(e.target.value) : null)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              placeholder="0"
            />
          </Row>
        </Section>

        {/* Contact */}
        <Section title="Contact">
          <Row label="Personal email">
            <input
              type="email"
              value={profile.personal_email || ""}
              onChange={(e) => update("personal_email", e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              placeholder="me@example.com"
            />
          </Row>
          <Row label="Secondary phone (optional)">
            <input
              type="tel"
              value={profile.secondary_phone || ""}
              onChange={(e) => update("secondary_phone", e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              placeholder="+60…"
            />
          </Row>
        </Section>

        {/* Emergency */}
        <Section title="Emergency contact" subtitle="Someone we can call if you have an accident at work.">
          <Row label="Name">
            <input
              type="text"
              value={profile.emergency_contact_name || ""}
              onChange={(e) => update("emergency_contact_name", e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            />
          </Row>
          <Row label="Phone">
            <input
              type="tel"
              value={profile.emergency_contact_phone || ""}
              onChange={(e) => update("emergency_contact_phone", e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              placeholder="+60…"
            />
          </Row>
        </Section>

        {/* Operational */}
        <Section title="Operational" subtitle="For uniforms and office events.">
          <Row label="Highest education">
            <select
              value={profile.education_level || ""}
              onChange={(e) => update("education_level", e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              <option value="spm">SPM</option>
              <option value="stpm">STPM</option>
              <option value="diploma">Diploma</option>
              <option value="degree">Degree</option>
              <option value="masters">Master&apos;s</option>
              <option value="phd">PhD</option>
              <option value="other">Other</option>
            </select>
          </Row>
          <Row label="T-shirt size">
            <select
              value={profile.t_shirt_size || ""}
              onChange={(e) => update("t_shirt_size", e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              {["XS", "S", "M", "L", "XL", "XXL", "XXXL"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Row>
          <Row label="Dietary notes (optional)">
            <input
              type="text"
              value={profile.dietary_restrictions || ""}
              onChange={(e) => update("dietary_restrictions", e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              placeholder="e.g. halal, vegetarian, no nuts"
            />
          </Row>
        </Section>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-text">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {/* Save buttons — placed inline at the end of the form rather than
            fixed-positioned so they don't sit behind the staff app's
            bottom tab bar (which is z-50 fixed). The page wrapper has
            pb-32 to give breathing room above the tab bar. */}
        <div className="space-y-2 pt-2">
          <button
            onClick={() => save(true)}
            disabled={saving || completeness.percent < 100}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-3 text-sm font-medium text-on-ink disabled:opacity-50"
            title={completeness.percent < 100 ? "Fill all required fields first" : "Mark profile as complete"}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Save &amp; mark complete
          </button>
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-line-2 bg-surface px-4 py-3 text-sm font-medium text-text-2 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save without marking complete"}
          </button>
          {savedAt && (
            <p className="text-center text-[11px] text-text-3">
              Last saved {formatTime(savedAt)}
            </p>
          )}
          {completeness.percent < 100 && (
            <p className="text-center text-[11px] text-text-3">
              Fill all {completeness.total} required fields to enable &ldquo;Save &amp; mark complete&rdquo;.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h2 className="font-semibold text-text">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-text-3">{subtitle}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-text-2">{label}</span>
      {children}
    </label>
  );
}
