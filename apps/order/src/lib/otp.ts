// Deep import (not the barrel) — barrel doesn't re-export OTP anymore
// because it would drag node:crypto into Edge Middleware bundles. See
// packages/shared/src/index.ts comment for context.
import { generateOTP, sendOTP as _sendOTP, verifyOTP as _verifyOTP } from "@celsius/shared/src/otp";
import { supabaseAdmin } from "./supabase";

export { generateOTP };

export function sendOTP(phone: string, purpose: 'login' | 'redeem' = 'login') {
  return _sendOTP(supabaseAdmin, phone, purpose);
}

export function verifyOTP(phone: string, code: string, purpose: 'login' | 'redeem' = 'login') {
  return _verifyOTP(supabaseAdmin, phone, code, purpose);
}
