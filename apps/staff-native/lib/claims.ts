import { API_BASE_URL } from "./env";
import { api } from "./api";
import { loadSession } from "./session";

export type ClaimStatus =
  | "DRAFT"
  | "INITIATED"
  | "PENDING"
  | "APPROVED"
  | "PAID"
  | "REJECTED"
  | "CANCELLED";

export type Claim = {
  id: string;
  invoiceNumber: string;
  orderNumber: string | null;
  amount: number;
  status: ClaimStatus | string;
  supplierName: string | null;
  issueDate: string;
  paidAt: string | null;
  photos: string[];
  notes: string | null;
};

export type Supplier = {
  id: string;
  name: string;
  products: { id: string; name: string; sku: string; uom: string }[];
};

export type ExtractedItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  uom: string | null;
};

export type ExtractedReceipt = {
  invoiceNumber: string | null;
  issueDate: string | null;
  amount: number | null;
  supplierName: string | null;
  items: ExtractedItem[];
  confidence: "high" | "medium" | "low" | null;
  notes: string | null;
};

export type CreateClaimInput = {
  outletId: string;
  supplierId?: string;
  supplierName?: string | null;
  // Optional in REQUEST flow (no claimant, finance pays the vendor).
  claimedById?: string;
  amount: number;
  purchaseDate: string;
  photos: string[];
  notes?: string | null;
  // CLAIM = reimburse me (legacy default). REQUEST = pay this vendor
  // directly (vendorName required).
  flow?: "CLAIM" | "REQUEST";
  vendorName?: string;
};

export type CreateClaimResult = {
  order: { id: string; orderNumber: string };
  invoice: { id: string; invoiceNumber: string };
};

export function listClaims(limit = 50) {
  return api<{ claims: Claim[] }>(`/api/claims?limit=${limit}`);
}

export function listSuppliers() {
  return api<Supplier[]>("/api/suppliers");
}

export function createClaim(input: CreateClaimInput) {
  return api<CreateClaimResult>("/api/claims", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function extractFromUrls(urls: string[]) {
  return api<ExtractedReceipt>("/api/claims/extract", {
    method: "POST",
    body: JSON.stringify({ urls }),
  });
}

export async function uploadReceiptPhoto(
  photo: { uri: string; base64?: string },
): Promise<string> {
  const session = await loadSession();
  const form = new FormData();
  const filename = `receipt-${Date.now()}.jpg`;
  form.append("file", {
    uri: photo.uri,
    name: filename,
    type: "image/jpeg",
  } as unknown as Blob);

  const res = await fetch(`${API_BASE_URL}/api/upload`, {
    method: "POST",
    body: form,
    headers: session?.token
      ? { Authorization: `Bearer ${session.token}` }
      : undefined,
  });

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Upload failed: ${res.status}`;
    throw new Error(msg);
  }

  const url =
    body && typeof body === "object" && "url" in body
      ? String((body as { url: unknown }).url)
      : "";
  if (!url) throw new Error("Upload returned no URL");
  return url;
}
