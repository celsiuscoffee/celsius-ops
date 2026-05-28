"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Trash2, AlertTriangle } from "lucide-react";

/**
 * Account & data deletion — ports apps/pickup-native/app
 * /account-delete.tsx: a PDPA data-deletion policy page (espresso /
 * primary, not destructive-red) with "What gets deleted" + "Important
 * note" sections, a trigger card that opens a typed-DELETE confirm
 * modal, and a privacy footnote. Wired to POST /api/members/delete.
 */
type Persisted = { state?: { loyaltyId?: string | null; phone?: string | null } };

export function AccountDeleteView() {
  const [signedIn] = useState(() => {
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (!raw) return false;
      const s = (JSON.parse(raw) as Persisted).state;
      return !!(s?.phone && s?.loyaltyId);
    } catch {
      return false;
    }
  });
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onDelete = async () => {
    if (confirmText.trim().toUpperCase() !== "DELETE") return;
    setError(null);
    setDeleting(true);
    try {
      let memberId: string | null = null;
      let phone: string | null = null;
      try {
        const raw = window.localStorage.getItem("celsius-pickup");
        if (raw) {
          const s = (JSON.parse(raw) as Persisted).state;
          memberId = s?.loyaltyId ?? null;
          phone = s?.phone ?? null;
        }
      } catch {
        /* ignore */
      }
      const res = await fetch("/api/members/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, phone }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not delete the account.");
      }
      try {
        window.localStorage.removeItem("celsius-pickup");
      } catch {
        /* ignore */
      }
      setConfirming(false);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  if (done) {
    return (
      <>
        <Header />
        <div className="px-5 py-8">
          <p className="font-peachi font-bold text-2xl" style={{ color: "#1A0200" }}>
            Account deleted
          </p>
          <p className="text-[13px] mt-2" style={{ color: "#6B6B6B", lineHeight: "20px" }}>
            Your account and data have been removed.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-full bg-[#A2492C] text-white px-5 py-3 font-bold active:opacity-80"
          >
            Back to home
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <Header />

      <div className="px-5 py-5 flex flex-col" style={{ gap: 24 }}>
        <div>
          <p className="font-peachi font-bold text-xl" style={{ color: "#1A0200" }}>
            Delete your account
          </p>
          <p className="text-xs mt-1" style={{ color: "#6B6B6B" }}>
            Celsius Coffee account &amp; data deletion
          </p>
        </div>

        <Section title="What gets deleted">
          <Bullet>Your name, email, phone number, and birthday</Bullet>
          <Bullet>Your points balance and rewards history</Bullet>
          <Bullet>Your full transaction and visit history</Bullet>
          <Bullet>Push notification tokens linked to your devices</Bullet>
          <Bullet>SMS opt-in records and marketing preferences</Bullet>
          <p className="text-[12px] mt-2" style={{ color: "#6B6B6B", lineHeight: "18px" }}>
            Anonymised aggregate analytics that cannot be linked back to you may be retained.
          </p>
        </Section>

        <Section title="Important note">
          <p className="text-[14px]" style={{ color: "#1A0200", lineHeight: "22px" }}>
            Deletion is permanent and cannot be reversed. Unredeemed points will be forfeited at the
            time of deletion. If you simply want to stop promotional SMS, reply STOP to any
            promotional message instead.
          </p>
        </Section>

        {signedIn ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex items-center text-left active:opacity-70"
            style={{
              border: "1px solid rgba(162,73,44,0.40)",
              backgroundColor: "rgba(162,73,44,0.05)",
              borderRadius: 16,
              padding: 16,
              gap: 12,
            }}
          >
            <span
              className="flex items-center justify-center flex-shrink-0"
              style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: "rgba(162,73,44,0.15)" }}
            >
              <Trash2 size={18} color="#A2492C" strokeWidth={1.75} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-peachi font-bold text-[15px]" style={{ color: "#A2492C" }}>
                Delete my account
              </span>
              <span className="block text-[12px] mt-0.5" style={{ color: "#6B6B6B" }}>
                Permanent · cannot be undone
              </span>
            </span>
          </button>
        ) : (
          <div
            style={{
              border: "1px solid rgba(26,2,0,0.10)",
              backgroundColor: "#FFFFFF",
              borderRadius: 16,
              padding: 16,
            }}
          >
            <p className="text-[14px]" style={{ color: "#1A0200", lineHeight: "22px" }}>
              Sign in first to delete your account.
            </p>
          </div>
        )}

        <p className="text-[11px]" style={{ color: "#6B6B6B", lineHeight: "16px" }}>
          See our{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>{" "}
          for full details on how we handle your personal data under the Personal Data Protection Act
          2010 (Act 709) of Malaysia.
        </p>
      </div>

      {confirming ? (
        <div
          className="fixed inset-0 flex items-center justify-center px-6 z-50"
          style={{ backgroundColor: "rgba(0,0,0,0.60)" }}
        >
          <div className="w-full" style={{ backgroundColor: "#FFFFFF", borderRadius: 16, padding: 20, maxWidth: 400 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
              <AlertTriangle size={18} color="#A2492C" />
              <p className="font-peachi font-bold text-[16px]" style={{ color: "#1A0200" }}>
                Delete account?
              </p>
            </div>
            <p className="text-[13px]" style={{ color: "#1A0200", lineHeight: "20px" }}>
              This will permanently delete your account and all data. To confirm, type{" "}
              <span className="font-peachi font-bold">DELETE</span> below.
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoCapitalize="characters"
              autoCorrect="off"
              placeholder="Type DELETE"
              disabled={deleting}
              className="mt-3 w-full outline-none"
              style={{
                border: "1px solid rgba(26,2,0,0.10)",
                backgroundColor: "#FFFFFF",
                borderRadius: 8,
                paddingLeft: 12,
                paddingRight: 12,
                paddingTop: 8,
                paddingBottom: 8,
                fontSize: 14,
                color: "#1A0200",
              }}
            />
            {error ? <p className="mt-2 text-[12px] text-red-600">{error}</p> : null}
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setConfirmText("");
                  setError(null);
                }}
                disabled={deleting}
                className="flex-1 active:opacity-70"
                style={{ border: "1px solid rgba(26,2,0,0.10)", borderRadius: 8, paddingTop: 10, paddingBottom: 10 }}
              >
                <span className="font-peachi font-bold text-[14px]" style={{ color: "#1A0200" }}>
                  Cancel
                </span>
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting || confirmText.trim().toUpperCase() !== "DELETE"}
                className="flex-1"
                style={{
                  borderRadius: 8,
                  paddingTop: 10,
                  paddingBottom: 10,
                  backgroundColor:
                    confirmText.trim().toUpperCase() === "DELETE" && !deleting
                      ? "#A2492C"
                      : "rgba(162,73,44,0.40)",
                }}
              >
                <span className="font-peachi font-bold text-[14px]" style={{ color: "#FFFFFF" }}>
                  {deleting ? "Deleting…" : "Delete"}
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Header() {
  return (
    <header
      className="bg-[#160800] text-white px-4 pb-3 flex items-center gap-3"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
    >
      <Link href="/settings" className="-ml-1 p-1 active:opacity-60" aria-label="Back">
        <ArrowLeft size={20} color="#FFFFFF" />
      </Link>
      <h1 className="font-peachi font-bold text-[22px]">Delete account</h1>
    </header>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-peachi font-bold text-[15px] mb-2" style={{ color: "#1A0200" }}>
        {title}
      </p>
      {children}
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2" style={{ marginBottom: 4 }}>
      <span style={{ color: "#A2492C", fontSize: 14 }}>•</span>
      <span className="flex-1 text-[14px]" style={{ color: "#1A0200", lineHeight: "22px" }}>
        {children}
      </span>
    </div>
  );
}
