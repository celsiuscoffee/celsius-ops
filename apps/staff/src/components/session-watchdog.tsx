"use client";

import { useEffect } from "react";
import {
  installForegroundSessionCheck,
  installSessionExpiryInterceptor,
} from "@/lib/session-expiry";

/**
 * Mounted once for the whole signed-in app. Installs the 401 → /login
 * interceptor and the foreground liveness check, so an expired session shows
 * up as the login screen instead of an "Unauthorized" alert on whatever the
 * staffer happened to be saving. See lib/session-expiry.ts.
 */
export function SessionWatchdog() {
  useEffect(() => {
    installSessionExpiryInterceptor();
    return installForegroundSessionCheck();
  }, []);

  return null;
}
