"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

function ResetPasswordInner() {
  const search = useSearchParams();
  const token = search.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const validToken = token.length > 0;
  const passwordsMatch = password.length >= 8 && password === confirm;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordsMatch) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Reset failed"); return; }
      setDone(true);
    } catch { setError("Connection error. Please try again."); }
    finally { setLoading(false); }
  };

  if (!validToken) {
    return (
      <div className="rounded-lg bg-red-500/10 px-4 py-6 text-center text-sm text-red-300">
        <p>This reset link is missing a token. Request a new one from the forgot-password page.</p>
        <p className="mt-3"><Link href="/forgot-password" className="text-white underline">Request a new link</Link></p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="rounded-lg bg-emerald-500/10 px-4 py-6 text-center text-sm text-emerald-200">
        <p>Password updated.</p>
        <p className="mt-3"><Link href="/login" className="text-white underline">Sign in</Link></p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-white/70">New password</label>
        <Input type="password" placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)}
          className="border-white/10 bg-white/5 text-white placeholder:text-white/30" autoFocus autoComplete="new-password" />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-white/70">Confirm password</label>
        <Input type="password" placeholder="Re-enter password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
          className="border-white/10 bg-white/5 text-white placeholder:text-white/30" autoComplete="new-password" />
        {confirm.length > 0 && password !== confirm && (
          <p className="mt-1 text-xs text-red-400">Passwords don&apos;t match</p>
        )}
      </div>
      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
      <Button type="submit" disabled={loading || !passwordsMatch} className="w-full bg-terracotta hover:bg-terracotta-dark disabled:opacity-50">
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Set new password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-dark px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/images/celsius-logo-sm.jpg" alt="Celsius Coffee" width={56} height={56} className="mx-auto rounded-xl" />
          <h1 className="mt-4 font-heading text-xl font-bold text-white">Reset password</h1>
          <p className="mt-1 text-xs text-white/40">Choose a new password for your account.</p>
        </div>
        <Suspense fallback={<div className="text-center text-xs text-white/40">Loading…</div>}>
          <ResetPasswordInner />
        </Suspense>
        <p className="mt-6 text-center text-xs text-white/40">
          <Link href="/login" className="hover:text-white">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
