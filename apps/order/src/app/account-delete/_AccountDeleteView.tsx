"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";

/**
 * Account delete flow. Wired to POST /api/members/delete with member
 * id + phone, mirrors the SPA's deletion path. Confirmation step
 * requires the customer to type 'delete' to avoid taps.
 */
export function AccountDeleteView() {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const deleteAccount = async () => {
    setError(null);
    setBusy(true);
    try {
      let memberId: string | null = null;
      let phone: string | null = null;
      try {
        const raw = window.localStorage.getItem("celsius-pickup");
        if (raw) {
          const s = (JSON.parse(raw) as { state?: { loyaltyId?: string | null; phone?: string | null } }).state;
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
        throw new Error(data.error ?? "Failed to delete account");
      }
      // Wipe local state.
      try {
        window.localStorage.removeItem("celsius-pickup");
      } catch {
        /* ignore */
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <>
        <Header />
        <section className="px-5 pt-8">
          <p className="font-peachi font-bold text-2xl">Account deleted.</p>
          <p className="text-[13px] text-[#6E6E73] mt-2 leading-snug">
            Your member-scoped data has been purged. Payment receipts are kept for 7 years for
            tax compliance, anonymised after the retention window.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-full bg-[#A2492C] text-white px-5 py-3 font-bold active:opacity-80"
          >
            Back to home
          </Link>
        </section>
      </>
    );
  }

  return (
    <>
      <Header />

      <section className="px-5 pt-6">
        <div
          className="flex items-start gap-2 rounded-2xl p-3"
          style={{ backgroundColor: "rgba(185,28,28,0.10)" }}
        >
          <AlertTriangle size={18} color="#B91C1C" className="flex-shrink-0 mt-0.5" />
          <p className="text-[12px] leading-snug" style={{ color: "#B91C1C" }}>
            This deletes your account, beans balance, wallet vouchers, and order history. It
            can&apos;t be undone.
          </p>
        </div>

        <p className="mt-5 text-sm">
          Type <span className="font-bold">delete</span> below to confirm.
        </p>
        <input
          type="text"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mt-2 w-full rounded-2xl border border-[#EBE5DE] px-3 py-3 outline-none text-base"
        />

        {error ? <p className="mt-3 text-[12px] text-red-600">{error}</p> : null}

        <button
          type="button"
          onClick={deleteAccount}
          disabled={busy || confirm.trim().toLowerCase() !== "delete"}
          className={`mt-5 w-full rounded-full text-white py-4 font-bold active:opacity-80 ${
            busy || confirm.trim().toLowerCase() !== "delete" ? "bg-[#B91C1C]/40" : "bg-[#B91C1C]"
          }`}
        >
          {busy ? "Deleting…" : "Delete my account"}
        </button>
        <Link
          href="/settings"
          className="mt-3 block w-full text-center text-sm text-[#8E8E93] active:opacity-60 py-2"
        >
          Cancel
        </Link>
      </section>
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
