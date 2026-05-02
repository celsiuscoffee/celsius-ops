// MyInvois (LHDN e-invoice) client.
//
// LHDN runs two environments:
//   - sandbox  → preprod.myinvois.hasil.gov.my  / api.preprod.myinvois.hasil.gov.my
//   - prod     → myinvois.hasil.gov.my          / api.myinvois.hasil.gov.my
//
// Auth is OAuth client_credentials. Each business gets a Client ID and
// Client Secret on the MyInvois portal. Production also requires a digital
// signing certificate from MDEC; v1 of this client supports unsigned
// submissions which is enough for sandbox + B2C consolidated flows.
//
// We deliberately fail soft when env vars are missing — the rest of the
// finance module must keep running while LHDN credentials are pending.
//
// Reference docs: https://sdk.myinvois.hasil.gov.my/

const PROD_BASE = "https://api.myinvois.hasil.gov.my";
const SANDBOX_BASE = "https://api.preprod.myinvois.hasil.gov.my";

type Env = "sandbox" | "prod" | "disabled";

function getEnv(): Env {
  const v = (process.env.MYINVOIS_ENV ?? "disabled").toLowerCase();
  if (v === "prod" || v === "production") return "prod";
  if (v === "sandbox" || v === "preprod" || v === "test") return "sandbox";
  return "disabled";
}

function getCredentials(): { clientId: string; clientSecret: string; tin: string; brn: string } | null {
  const clientId = process.env.MYINVOIS_CLIENT_ID;
  const clientSecret = process.env.MYINVOIS_CLIENT_SECRET;
  const tin = process.env.MYINVOIS_TIN;        // Celsius Coffee Sdn Bhd TIN
  const brn = process.env.MYINVOIS_BRN;        // Business Registration Number
  if (!clientId || !clientSecret || !tin || !brn) return null;
  return { clientId, clientSecret, tin, brn };
}

export class MyInvoisDisabledError extends Error {
  constructor() {
    super("MyInvois is disabled. Set MYINVOIS_ENV + MYINVOIS_CLIENT_ID/SECRET/TIN/BRN.");
    this.name = "MyInvoisDisabledError";
  }
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const env = getEnv();
  if (env === "disabled") throw new MyInvoisDisabledError();
  const creds = getCredentials();
  if (!creds) throw new MyInvoisDisabledError();

  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }

  const base = env === "prod" ? PROD_BASE : SANDBOX_BASE;
  const res = await fetch(`${base}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: "InvoicingAPI",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MyInvois token endpoint failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.token;
}

// LHDN UBL JSON document shape. Simplified to the fields LHDN requires for
// a B2C consolidated invoice. The Compliance agent builds these from
// fin_invoices + outlet metadata.
export type EinvoiceDocument = {
  documentType: "01" | "02" | "03" | "04";   // 01=Invoice, 02=Credit Note, 03=Debit Note, 04=Refund
  documentVersion: "1.0" | "1.1";
  issueDate: string;                          // ISO datetime
  invoiceNumber: string;                      // our internal invoice number
  currency: "MYR";
  supplier: {
    tin: string;
    brn: string;
    name: string;
    address: string;
    city: string;
    state: string;
    country: "MYS";
    msicCode: string;                         // industry classification
    contactNumber: string;
    sstRegistration?: string;
  };
  buyer: {
    // For B2C consolidated, LHDN allows generic buyer = "General Public"
    tin: string;                              // "EI00000000010" for general public
    name: string;
    address: string;
    contactNumber: string;
  };
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    classification: string;                    // PCI / CSCD code
    subtotal: number;
    sstRate: number;                           // 0.06 for 6%
    sstAmount: number;
  }>;
  legalMonetaryTotal: {
    lineExtensionAmount: number;               // sum of line subtotals
    taxExclusiveAmount: number;
    taxInclusiveAmount: number;
    payableAmount: number;
  };
  taxTotal: { taxAmount: number };
};

export type SubmissionResult = {
  ok: boolean;
  uuid?: string;             // LHDN-issued UUID
  submissionId?: string;
  status?: "Submitted" | "Valid" | "Invalid";
  rejectionReasons?: Array<{ code: string; description: string }>;
  raw?: unknown;
};

export async function submitDocuments(documents: EinvoiceDocument[]): Promise<SubmissionResult[]> {
  const env = getEnv();
  if (env === "disabled") throw new MyInvoisDisabledError();
  const token = await getAccessToken();
  const base = env === "prod" ? PROD_BASE : SANDBOX_BASE;

  const payload = {
    documents: documents.map((d) => ({
      format: "JSON",
      documentHash: hashDocument(d),
      codeNumber: d.invoiceNumber,
      document: encodeBase64Json(d),
    })),
  };

  const res = await fetch(`${base}/api/v1.0/documentsubmissions/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MyInvois submission failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    submissionUid: string;
    acceptedDocuments?: Array<{ uuid: string; invoiceCodeNumber: string }>;
    rejectedDocuments?: Array<{ invoiceCodeNumber: string; error: { code: string; message: string } }>;
  };

  const results: SubmissionResult[] = [];
  for (const d of documents) {
    const accepted = json.acceptedDocuments?.find((a) => a.invoiceCodeNumber === d.invoiceNumber);
    const rejected = json.rejectedDocuments?.find((r) => r.invoiceCodeNumber === d.invoiceNumber);
    if (accepted) {
      results.push({
        ok: true,
        uuid: accepted.uuid,
        submissionId: json.submissionUid,
        status: "Submitted",
        raw: accepted,
      });
    } else if (rejected) {
      results.push({
        ok: false,
        rejectionReasons: [{ code: rejected.error.code, description: rejected.error.message }],
        raw: rejected,
      });
    } else {
      results.push({ ok: false, raw: json });
    }
  }
  return results;
}

export async function getDocumentStatus(uuid: string): Promise<SubmissionResult> {
  const env = getEnv();
  if (env === "disabled") throw new MyInvoisDisabledError();
  const token = await getAccessToken();
  const base = env === "prod" ? PROD_BASE : SANDBOX_BASE;

  const res = await fetch(`${base}/api/v1.0/documents/${uuid}/details`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MyInvois status check failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    uuid: string;
    status: "Submitted" | "Valid" | "Invalid";
    invalidReasons?: Array<{ code: string; description: string }>;
  };
  return {
    ok: json.status !== "Invalid",
    uuid: json.uuid,
    status: json.status,
    rejectionReasons: json.invalidReasons,
    raw: json,
  };
}

export function isEnabled(): boolean {
  return getEnv() !== "disabled" && getCredentials() !== null;
}

// Tiny helpers — we don't actually compute SHA256 here for the hash. LHDN
// accepts an empty string for unsigned JSON documents in sandbox; v2 of
// this client will sign properly with the MDEC certificate.
function hashDocument(_doc: EinvoiceDocument): string {
  return "";
}

function encodeBase64Json(doc: EinvoiceDocument): string {
  return Buffer.from(JSON.stringify(doc)).toString("base64");
}
