"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { BACKOFFICE_URL } from "@/lib/backoffice-url";
import {
  LogOut,
  ChevronRight,
  Shield,
  Loader2,
  CheckCircle2,
  Key,
  X,
  UserCircle2,
  AlertCircle,
} from "lucide-react";

type User = {
  id: string;
  name: string;
  role: string;
  outletId: string | null;
  outletName?: string | null;
};

export default function ProfilePage() {
  const params = useSearchParams();
  const justCompleted = params.get("completed") === "1";
  const [user, setUser] = useState<User | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [profileCompleteness, setProfileCompleteness] = useState<{ percent: number; complete: boolean } | null>(null);

  useEffect(() => {
    // Today's checklist count used to sit here too; it lives on Today and
    // Checklists now (docs/design/staff-app-structure.md).
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => { if (data.id) setUser(data); })
      .catch(() => {});

    // Profile completeness — small payload, drives the reminder card.
    fetch("/api/hr/profile")
      .then((r) => r.json())
      .then((d) => {
        if (d.completeness) {
          setProfileCompleteness({
            percent: d.completeness.percent,
            complete: d.completeness.complete,
          });
        }
      })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  // Change PIN state + handler
  const [showPinModal, setShowPinModal] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSaving, setPinSaving] = useState(false);
  const [pinSuccess, setPinSuccess] = useState(false);

  const openPinModal = () => {
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    setPinError(null);
    setPinSuccess(false);
    setShowPinModal(true);
  };

  const handleChangePin = async () => {
    setPinError(null);
    if (!/^\d{6}$/.test(newPin)) {
      setPinError("New PIN must be exactly 6 digits");
      return;
    }
    if (newPin !== confirmPin) {
      setPinError("New PIN and confirmation don't match");
      return;
    }
    setPinSaving(true);
    try {
      const res = await fetch("/api/auth/change-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_pin: currentPin, new_pin: newPin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPinError(data.error || "Failed to change PIN");
        return;
      }
      setPinSuccess(true);
      setTimeout(() => setShowPinModal(false), 1500);
    } finally {
      setPinSaving(false);
    }
  };

  const initial = user?.name?.charAt(0)?.toUpperCase() ?? "?";
  const roleLabel =
    user?.role === "OWNER" ? "Owner" :
    user?.role === "ADMIN" ? "Admin" :
    user?.role === "MANAGER" ? "Manager" : "Staff";
  const isManager = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "OWNER";

  return (
    <div className="px-4 pb-6">
      <PageHeader title="Me" description="Your details, your PIN, and signing out." backHref="/home" />
      <div className="space-y-4">
        {/* Who you are */}
        <div className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sunken text-lg font-semibold text-text-2">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-text">{user?.name ?? "Loading…"}</p>
            <p className="text-[13px] text-text-3">
              {roleLabel}{user?.outletName && <> · {user.outletName}</>}
            </p>
          </div>
        </div>

        {/* Just-completed thank-you ribbon — only after redirect from
            /profile/personal?completed=1. */}
        {justCompleted && (
          <div className="flex items-center gap-2 rounded-card border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ok-text">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Profile saved. Thank you.</span>
          </div>
        )}

        <div className="overflow-hidden rounded-card border border-line bg-surface">
          {/* Personal info: also the completeness reminder while the bar isn't full */}
          <Link href="/profile/personal" className="flex min-h-[60px] items-center gap-3 px-4 py-2.5 active:bg-sunken">
            {profileCompleteness && !profileCompleteness.complete ? (
              <AlertCircle className="h-5 w-5 shrink-0 text-warn-text" />
            ) : (
              <UserCircle2 className="h-5 w-5 shrink-0 text-text-3" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium text-text">
                {profileCompleteness && !profileCompleteness.complete ? "Finish your personal info" : "Personal info"}
              </p>
              <p className="text-[13px] text-text-3">Address, emergency contact and more, for payslips and tax</p>
              {profileCompleteness && !profileCompleteness.complete && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-warn-soft">
                  <div className="h-full bg-warn transition-all" style={{ width: `${profileCompleteness.percent}%` }} />
                </div>
              )}
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-text-3" />
          </Link>
          <button
            onClick={openPinModal}
            className="flex min-h-[52px] w-full items-center gap-3 border-t border-line px-4 py-2.5 text-left active:bg-sunken"
          >
            <Key className="h-5 w-5 shrink-0 text-text-3" />
            <span className="flex-1 font-medium text-text">Change PIN</span>
            <ChevronRight className="h-5 w-5 shrink-0 text-text-3" />
          </button>
          {isManager && (
            <a
              href={BACKOFFICE_URL}
              className="flex min-h-[52px] w-full items-center gap-3 border-t border-line px-4 py-2.5 text-left active:bg-sunken"
            >
              <Shield className="h-5 w-5 shrink-0 text-text-3" />
              <span className="flex-1 font-medium text-text">Open the back office</span>
              <ChevronRight className="h-5 w-5 shrink-0 text-text-3" />
            </a>
          )}
        </div>

        {/* Change PIN modal */}
        {showPinModal && (
          <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 sm:items-center" onClick={() => setShowPinModal(false)}>
            <div
              className="w-full max-w-md rounded-t-2xl bg-surface p-5 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:rounded-2xl sm:pb-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold">Change PIN</h2>
                <button onClick={() => setShowPinModal(false)} aria-label="Close" className="-mr-2 flex h-11 w-11 items-center justify-center text-text-3">
                  <X className="h-5 w-5" />
                </button>
              </div>
              {pinSuccess ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <CheckCircle2 className="h-12 w-12 text-ok" />
                  <p className="font-semibold text-text">PIN updated</p>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-text-2">Current PIN</label>
                      <input
                        type="password"
                        inputMode="numeric"
                        pattern="\d*"
                        maxLength={6}
                        value={currentPin}
                        onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))}
                        className="w-full rounded-ctl border border-line-2 bg-bg px-3 py-2.5 text-lg tracking-widest text-text"
                        placeholder="••••••"
                        autoComplete="current-password"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-text-2">New PIN (6 digits)</label>
                      <input
                        type="password"
                        inputMode="numeric"
                        pattern="\d*"
                        maxLength={6}
                        value={newPin}
                        onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                        className="w-full rounded-ctl border border-line-2 bg-bg px-3 py-2.5 text-lg tracking-widest text-text"
                        placeholder="••••••"
                        autoComplete="new-password"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-text-2">Confirm new PIN</label>
                      <input
                        type="password"
                        inputMode="numeric"
                        pattern="\d*"
                        maxLength={6}
                        value={confirmPin}
                        onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                        className="w-full rounded-ctl border border-line-2 bg-bg px-3 py-2.5 text-lg tracking-widest text-text"
                        placeholder="••••••"
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                  {pinError && (
                    <p className="mt-3 text-sm text-danger-text">{pinError}</p>
                  )}
                  <button
                    onClick={handleChangePin}
                    disabled={pinSaving || !currentPin || !newPin || !confirmPin}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-3 font-medium text-on-ink disabled:opacity-50"
                  >
                    {pinSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Update PIN
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Logout */}
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-card border border-line bg-surface px-4 text-danger-text active:bg-danger-soft disabled:opacity-50"
        >
          {loggingOut ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogOut className="h-5 w-5" />}
          <span className="font-medium">Sign out</span>
        </button>
      </div>
    </div>
  );
}
