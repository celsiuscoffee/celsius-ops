/**
 * Shared filename helpers for POPs and invoices.
 *
 * Produces human-readable names for both:
 *  - Supabase Storage paths (visible in storage browser / DB)
 *  - Content-Disposition on shortlink downloads (what users see in their
 *    file manager after clicking a payment.celsiuscoffee.com/r/:id link)
 *
 * Storage example: `pop/2026-04-21_26-0374_BLANCOZ_RM240.00.pdf`
 * Download example: `POP_26-0374_BLANCOZ_RM240.00.pdf`
 */

function sanitize(s: string): string {
  return s
    .trim()
    .replace(/[\/\\:*?"<>|#]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

type InvoiceForNaming = {
  invoiceNumber: string;
  amount: number | string | { toFixed: (n: number) => string };
  paidAt?: Date | string | null;
  supplier?: { name: string } | null;
  vendorName?: string | null;
  order?: { claimedBy?: { name: string } | null } | null;
};

function getPayee(inv: InvoiceForNaming): string {
  return (
    inv.supplier?.name ||
    inv.vendorName ||
    inv.order?.claimedBy?.name ||
    "Unknown"
  );
}

function getAmount(inv: InvoiceForNaming): string {
  const n = typeof inv.amount === "object" && inv.amount && "toFixed" in inv.amount
    ? Number((inv.amount as any).toString())
    : Number(inv.amount);
  return n.toFixed(2);
}

function getDate(d: Date | string | null | undefined): string {
  if (!d) return new Date().toISOString().slice(0, 10);
  return new Date(d).toISOString().slice(0, 10);
}

/** Storage path (Supabase) for a POP PDF. */
export function popStoragePath(inv: InvoiceForNaming, ext: "pdf" | "jpg" = "pdf"): string {
  const date = getDate(inv.paidAt);
  const payee = sanitize(getPayee(inv)).slice(0, 40);
  const invNum = sanitize(inv.invoiceNumber).slice(0, 40);
  const amt = getAmount(inv);
  return `pop/${date}_${invNum}_${payee}_RM${amt}.${ext}`;
}

/** Download filename (Content-Disposition) for a POP. */
export function popDownloadName(inv: InvoiceForNaming, ext: "pdf" | "jpg" = "pdf"): string {
  const payee = sanitize(getPayee(inv)).slice(0, 40);
  const invNum = sanitize(inv.invoiceNumber).slice(0, 40);
  const amt = getAmount(inv);
  return `POP_${invNum}_${payee}_RM${amt}.${ext}`;
}

/** Storage path (Supabase) for an INVOICE PDF. */
export function invoiceStoragePath(inv: InvoiceForNaming, ext: "pdf" | "jpg" = "pdf"): string {
  const payee = sanitize(getPayee(inv)).slice(0, 40);
  const invNum = sanitize(inv.invoiceNumber).slice(0, 40);
  const amt = getAmount(inv);
  return `invoices/${invNum}_${payee}_RM${amt}.${ext}`;
}

/** Download filename (Content-Disposition) for an INVOICE. */
export function invoiceDownloadName(inv: InvoiceForNaming, ext: "pdf" | "jpg" = "pdf"): string {
  const payee = sanitize(getPayee(inv)).slice(0, 40);
  const invNum = sanitize(inv.invoiceNumber).slice(0, 40);
  const amt = getAmount(inv);
  return `INV_${invNum}_${payee}_RM${amt}.${ext}`;
}

/** Detect whether a stored shortlink URL corresponds to the POP or INVOICE document. */
export function classifyDocKind(
  url: string,
  invoice: { popShortLink?: string | null; photos?: string[] },
): "pop" | "invoice" {
  // The payment short-link points at the POP
  if (invoice.popShortLink && invoice.popShortLink.includes(url.split("/").pop() ?? "_")) return "pop";
  return "invoice";
}

export { sanitize };
