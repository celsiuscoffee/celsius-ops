// Company resolution helpers. Every ledger mutation must carry a company_id;
// these helpers keep that boilerplate out of the agents.
//
// Two paths to resolve:
//   1. From an outlet  → fin_outlet_companies mapping
//   2. From a cookie   → user picked a company in the UI switcher
//
// Falls back to the default company (is_default=true) when neither
// signal is present.

import { cookies } from "next/headers";
import { getFinanceClient } from "./supabase";

export const COMPANY_COOKIE = "celsius-finance-company";

export type Company = {
  id: string;
  name: string;
  brn: string | null;
  tin: string | null;
  isDefault: boolean;
  isActive: boolean;
};

let cachedDefault: string | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

export async function getDefaultCompanyId(): Promise<string> {
  if (cachedDefault && Date.now() - cachedAt < CACHE_TTL_MS) return cachedDefault;
  const client = getFinanceClient();
  const { data } = await client
    .from("fin_companies")
    .select("id")
    .eq("is_default", true)
    .eq("is_active", true)
    .maybeSingle();
  cachedDefault = (data?.id as string) ?? "celsius";
  cachedAt = Date.now();
  return cachedDefault;
}

export async function listCompanies(): Promise<Company[]> {
  const client = getFinanceClient();
  const { data } = await client
    .from("fin_companies")
    .select("id, name, brn, tin, is_default, is_active")
    .order("is_default", { ascending: false })
    .order("name");
  return (data ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    brn: (c.brn as string) ?? null,
    tin: (c.tin as string) ?? null,
    isDefault: !!c.is_default,
    isActive: !!c.is_active,
  }));
}

// Resolve an outlet → company. Returns null if the outlet has no mapping
// yet (rare — the seed maps every outlet to "celsius" by default).
export async function resolveCompanyFromOutlet(outletId: string): Promise<string | null> {
  const client = getFinanceClient();
  const { data } = await client
    .from("fin_outlet_companies")
    .select("company_id")
    .eq("outlet_id", outletId)
    .maybeSingle();
  return (data?.company_id as string) ?? null;
}

// Read the user's currently-selected company from the cookie, falling back
// to default. Validated against the active companies list — a stale cookie
// pointing at a removed company is ignored.
export async function getActiveCompanyId(): Promise<string> {
  const ck = await cookies();
  const fromCookie = ck.get(COMPANY_COOKIE)?.value;
  if (fromCookie) {
    const client = getFinanceClient();
    const { data } = await client
      .from("fin_companies")
      .select("id")
      .eq("id", fromCookie)
      .eq("is_active", true)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }
  return getDefaultCompanyId();
}
