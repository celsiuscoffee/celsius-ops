// Proper outlet DISPLAY name from a pickup store slug.
//
// The slug itself (conezion / shah-alam / tamarind / nilai) stays the DB key,
// the table-QR URL segment, and the Revenue Monster settlement id — only what
// we SHOW to staff changes. e.g. "conezion" → "Putrajaya" (the outlet's proper
// name; Conezion is just the mall it sits in).
const STORE_LABEL: Record<string, string> = {
  "conezion": "Putrajaya",
  "shah-alam": "Shah Alam",
  "tamarind": "Tamarind",
  "nilai": "Nilai",
};

export function storeLabel(slug: string | null | undefined): string {
  if (!slug) return "";
  return STORE_LABEL[slug] ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
