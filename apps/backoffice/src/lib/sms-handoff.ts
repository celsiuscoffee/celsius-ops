// One SMS tool (restructure step 5, 17 Nov 2026): Customers › Members no longer
// sends SMS itself. "Send SMS" hands the picked members' phones to Marketing ›
// Messages (/loyalty/engage?tab=sms&audience=picked), whose composer applies the
// PDPA opt-out filter, the credit check, the sender name and the confirm step
// that the old Members sender skipped. The hand-off lives in sessionStorage for
// this tab only and expires after 30 minutes.

const KEY = "celsius:sms-picked";
const TTL_MS = 30 * 60_000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function store(): Store | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}

export function savePickedPhones(phones: string[], s: Store | null = store(), now = Date.now()): number {
  const unique = [...new Set(phones.map((p) => p.trim()).filter(Boolean))];
  try { s?.setItem(KEY, JSON.stringify({ phones: unique, at: now })); } catch { /* storage full or blocked */ }
  return unique.length;
}

/** The phones handed over from Members, or [] if none (or older than 30 min). */
export function readPickedPhones(s: Store | null = store(), now = Date.now()): string[] {
  try {
    const raw = s?.getItem(KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as { phones?: unknown; at?: unknown };
    if (typeof v.at !== "number" || now - v.at > TTL_MS || !Array.isArray(v.phones)) { s?.removeItem(KEY); return []; }
    return v.phones.filter((p): p is string => typeof p === "string");
  } catch { return []; }
}

export function clearPickedPhones(s: Store | null = store()): void {
  try { s?.removeItem(KEY); } catch { /* ignore */ }
}
