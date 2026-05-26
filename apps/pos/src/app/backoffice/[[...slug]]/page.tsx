import { redirect, permanentRedirect } from "next/navigation";

/**
 * POS-local /backoffice was retired 2026-05-24 — all admin surfaces
 * moved to the main ops backoffice. This catch-all route redirects any
 * old bookmark (e.g. /backoffice/settings, /backoffice/reports) to the
 * equivalent surface in the unified backoffice.
 */

const MAIN_BO = "https://backoffice.celsiuscoffee.com";

// Map old POS-local paths to their new home in main BO.
const PATH_MAP: Record<string, string> = {
  "":             "/pos",
  "settings":     "/pos/settings",
  "reports":      "/pos/reports",
  "table-qr":     "/pos/table-qr",
  "staff":        "/settings/staff",
  "products":     "/pickup/menu",
  "categories":   "/pickup/menu",
  "promotions":   "/loyalty/rewards",
};

export default async function BackofficeRedirect({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const segments = slug ?? [];
  const head = segments[0] ?? "";
  const mapped = PATH_MAP[head] ?? "/pos";
  // permanentRedirect (308) for known paths; the redirect throws so the
  // function never returns. Use redirect() for safety on the catch-all
  // so the import stays compatible with future Next.js versions.
  if (PATH_MAP[head] !== undefined) {
    permanentRedirect(`${MAIN_BO}${mapped}`);
  }
  redirect(`${MAIN_BO}${mapped}`);
}
