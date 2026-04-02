"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";

export default function AdminLoginPage() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user) {
      router.replace("/admin/dashboard");
    }
  }, [user, router]);

  // The login UI is handled by the admin layout when not authenticated.
  // This page exists as a route target but the layout renders the login form.
  return null;
}
