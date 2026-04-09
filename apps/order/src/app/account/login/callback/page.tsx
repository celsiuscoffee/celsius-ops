"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useCartStore } from "@/store/cart";

export default function LoginCallbackPage() {
  const router = useRouter();
  const setLoyaltyMember = useCartStore((s) => s.setLoyaltyMember);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Completing sign in…");

  useEffect(() => {
    async function handleCallback() {
      try {
        const supabase = getSupabaseClient();

        // Exchange the code / hash fragment for a session
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        const session = data.session;
        if (!session) {
          // Sometimes the session is in the URL hash — wait for onAuthStateChange
          await new Promise<void>((resolve, reject) => {
            const { data: listener } = supabase.auth.onAuthStateChange((event, sess) => {
              listener.subscription.unsubscribe();
              if (sess) resolve();
              else reject(new Error("No session after OAuth callback"));
            });
            // Timeout after 5 s
            setTimeout(() => reject(new Error("Auth timeout")), 5000);
          });
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const user = sessionData.session?.user;

        if (!user) throw new Error("No user found after sign-in");

        setMessage("Looking up your loyalty account…");

        // Try to find loyalty member by email
        const email = user.email;
        if (email) {
          try {
            const res = await fetch(
              `/api/loyalty/member?email=${encodeURIComponent(email)}`
            );
            if (res.ok) {
              const json = await res.json();
              if (json.member) {
                setLoyaltyMember(json.member);
              }
            }
          } catch {
            // Non-fatal — loyalty lookup failure shouldn't block sign-in
          }
        }

        setStatus("success");
        setMessage(`Welcome${user.user_metadata?.full_name ? `, ${user.user_metadata.full_name.split(" ")[0]}` : ""}!`);

        setTimeout(() => router.push("/account"), 1500);
      } catch (err) {
        console.error("OAuth callback error:", err);
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
      }
    }

    handleCallback();
  }, [router, setLoyaltyMember]);

  return (
    <div className="flex flex-col min-h-dvh bg-[#f5f5f5] items-center justify-center px-6 gap-5">
      {status === "loading" && (
        <>
          <Loader2 className="h-10 w-10 animate-spin text-[#160800]" />
          <p className="text-sm font-medium text-[#160800]">{message}</p>
        </>
      )}

      {status === "success" && (
        <>
          <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center">
            <CheckCircle className="h-10 w-10 text-emerald-600" />
          </div>
          <p className="text-xl font-black text-[#160800]">{message}</p>
          <p className="text-sm text-muted-foreground">Redirecting to your account…</p>
        </>
      )}

      {status === "error" && (
        <>
          <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center">
            <AlertCircle className="h-10 w-10 text-red-500" />
          </div>
          <p className="text-sm font-medium text-red-600 text-center">{message}</p>
          <button
            onClick={() => router.push("/account/login")}
            className="bg-[#160800] text-white rounded-full px-6 py-3 text-sm font-semibold"
          >
            Try Again
          </button>
        </>
      )}
    </div>
  );
}
