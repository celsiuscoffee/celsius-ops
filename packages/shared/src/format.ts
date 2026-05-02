// ─── Formatting utilities shared across Celsius apps ────────

export function formatPoints(points: number): string {
  return points.toLocaleString("en-MY");
}

export function formatCurrency(amount: number, currency = "MYR"): string {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * Malaysian Ringgit display format with thousand separators.
 * formatRM(9500)      → "RM 9,500.00"
 * formatRM(1234567.5) → "RM 1,234,567.50"
 * formatRM(0.5)       → "RM 0.50"
 *
 * Always 2 decimals, comma thousand sep, "RM " prefix with a space.
 * Use everywhere RM amounts are rendered — replaces ad-hoc
 * `RM ${x.toFixed(2)}` which had no thousand separator.
 *
 * Pass `decimals: 0` for whole-ringgit displays (e.g. dashboards).
 */
export function formatRM(amount: number, opts: { decimals?: number; signed?: boolean } = {}): string {
  const { decimals = 2, signed = false } = opts;
  const safe = Number.isFinite(amount) ? amount : 0;
  const sign = signed && safe > 0 ? "+ " : signed && safe < 0 ? "− " : "";
  const abs = Math.abs(safe);
  const body = abs.toLocaleString("en-MY", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${sign}RM ${body}`;
}

// ─── Phone number utilities ──────────────────────────────
// Database/CRM stores: +60123456789 (for SMS delivery)
// Customer display:    012-3456 789 (local Malaysian format)

/** Format phone for display: +60123456789 -> 012-345 6789 */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const local = digits.startsWith("60") ? "0" + digits.slice(2) : digits;
  if (local.length === 11) {
    // 011 numbers: 011-234 56789
    return `${local.slice(0, 3)}-${local.slice(3, 6)} ${local.slice(6)}`;
  }
  if (local.length === 10) {
    // Standard: 012-345 6789
    return `${local.slice(0, 3)}-${local.slice(3, 6)} ${local.slice(6)}`;
  }
  if (local.length >= 4) {
    return `${local.slice(0, 3)}-${local.slice(3)}`;
  }
  return local;
}

/** Alias for formatPhone */
export const formatPhoneLocal = formatPhone;

/** Convert customer input (0123456789) to storage format (+60123456789) */
export function toStoragePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("60")) return `+${digits}`;
  if (digits.startsWith("0")) return `+6${digits}`;
  return `+60${digits}`;
}

/** Convert storage format (+60123456789) to local input (0123456789) */
export function toLocalPhone(stored: string): string {
  const digits = stored.replace(/\D/g, "");
  if (digits.startsWith("60")) return "0" + digits.slice(2);
  return digits;
}

export function generateRedemptionCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const randomBytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(randomBytes);
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(randomBytes[i] % chars.length);
  }
  return code;
}

export function getProgressPercentage(current: number, target: number): number {
  if (target <= 0) return 100;
  return Math.min(Math.round((current / target) * 100), 100);
}

export function getTimeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
  const months = Math.floor(seconds / 2592000);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
