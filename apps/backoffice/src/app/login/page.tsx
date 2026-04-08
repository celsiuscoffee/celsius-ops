"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Login failed"); return; }
      window.location.href = "/dashboard";
    } catch { setError("Connection error. Please try again."); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-dark px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Image src="/images/celsius-logo-sm.jpg" alt="Celsius Coffee" width={56} height={56} className="mx-auto rounded-xl" />
          <h1 className="mt-4 font-heading text-xl font-bold text-white">Celsius Ops</h1>
          <p className="mt-1 text-sm text-white/50">Backoffice</p>
          <p className="mt-1 text-xs text-white/30">Sign in with your credentials</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-white/70">Username</label>
            <Input type="text" placeholder="Enter username" value={username} onChange={(e) => setUsername(e.target.value)}
              className="border-white/10 bg-white/5 text-white placeholder:text-white/30" autoFocus autoComplete="username" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-white/70">Password</label>
            <Input type="password" placeholder="Enter password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="border-white/10 bg-white/5 text-white placeholder:text-white/30" autoComplete="current-password" />
          </div>
          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
          <Button type="submit" disabled={loading || !username.trim() || !password} className="w-full bg-terracotta hover:bg-terracotta-dark disabled:opacity-50">
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sign In
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-white/30">
          Contact admin if you don&apos;t have access
        </p>
      </div>
    </div>
  );
}
