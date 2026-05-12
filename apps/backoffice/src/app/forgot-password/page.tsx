"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Request failed"); return; }
      setSent(true);
    } catch { setError("Connection error. Please try again."); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-dark px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/images/celsius-logo-sm.jpg" alt="Celsius Coffee" width={56} height={56} className="mx-auto rounded-xl" />
          <h1 className="mt-4 font-heading text-xl font-bold text-white">Forgot password</h1>
          <p className="mt-1 text-xs text-white/40">We&apos;ll email you a reset link if the account exists.</p>
        </div>

        {sent ? (
          <div className="rounded-lg bg-white/5 px-4 py-6 text-center text-sm text-white/80">
            <p>If <span className="text-white">{identifier}</span> matches a backoffice account with an email on file, a reset link is on its way.</p>
            <p className="mt-3 text-xs text-white/40">The link expires in 60 minutes. Check spam if you don&apos;t see it.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-white/70">Email or username</label>
              <Input type="text" placeholder="you@celsiuscoffee.com or username" value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                className="border-white/10 bg-white/5 text-white placeholder:text-white/30" autoFocus />
            </div>
            {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
            <Button type="submit" disabled={loading || !identifier.trim()} className="w-full bg-terracotta hover:bg-terracotta-dark disabled:opacity-50">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send reset link
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-white/40">
          <Link href="/login" className="hover:text-white">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
