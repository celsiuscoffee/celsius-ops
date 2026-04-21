"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFetch } from "@/lib/use-fetch";
import { hasAccess, moduleKeyForPath } from "@/lib/access";

type UserProfile = { id: string; role: string; moduleAccess?: Record<string, unknown> };

/**
 * Client-side route guard. If the current pathname maps to a moduleKey
 * the user lacks, redirect them to /home with a flash message.
 * Server endpoints still validate independently — this is the UX layer
 * so an unauthorized URL doesn't render a misleading page.
 */
export function RouteAccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: me, isLoading } = useFetch<UserProfile>("/api/auth/me");

  useEffect(() => {
    if (isLoading || !me) return;
    const required = moduleKeyForPath(pathname);
    if (!required) return;
    if (!hasAccess(me.role, me.moduleAccess, required)) {
      router.replace("/home?denied=1");
    }
  }, [pathname, me, isLoading, router]);

  return <>{children}</>;
}
