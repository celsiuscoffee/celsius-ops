import { generateOTP, sendOTP as _sendOTP, verifyOTP as _verifyOTP } from "@celsius/shared";
import { supabaseAdmin } from "./supabase";

export { generateOTP };

export function sendOTP(phone: string, purpose: 'login' | 'redeem' = 'login') {
  return _sendOTP(supabaseAdmin, phone, purpose);
}

export function verifyOTP(phone: string, code: string, purpose: 'login' | 'redeem' = 'login') {
  return _verifyOTP(supabaseAdmin, phone, code, purpose);
}
