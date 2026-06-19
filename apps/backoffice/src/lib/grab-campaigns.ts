/**
 * Sync GrabFood campaigns (promotions) into `grab_campaigns`.
 *
 * Read-only mirror of GET /partner/v1/campaigns, per linked outlet. Shared by
 * the BackOffice "sync now" button (/api/ads/grab/campaigns POST) and the daily
 * cron (/api/cron/grab-campaigns-sync). Raw SQL via Prisma (grab_campaigns isn't
 * a Prisma model) — same pattern as /api/integrations/grab.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { isGrabConfigured, listCampaigns, type GrabCampaign } from "@/lib/grab";
import { randomUUID } from "crypto";

/** Best-effort human label from a campaign's discount block (shape varies). */
export function summarizeDiscount(c: GrabCampaign): string | null {
  const d = c.discount;
  if (!d || typeof d !== "object") return null;
  const type = String(d.type ?? "").toUpperCase();
  const value = typeof d.value === "number" ? d.value : undefined;
  const cap = typeof d.cap === "number" ? d.cap : undefined;
  if (type.includes("PERCENT") && value != null) {
    return `${value}% off${cap != null ? `, cap RM${(cap / 100).toFixed(2)}` : ""}`;
  }
  if ((type.includes("AMOUNT") || type.includes("FIXED") || type.includes("FLAT")) && value != null) {
    return `RM${(value / 100).toFixed(2)} off`;
  }
  if (type.includes("DELIVERY")) return "Free / discounted delivery";
  return type || null;
}

export async function syncGrabCampaigns(): Promise<{ outlets: number; upserted: number; errors: string[] }> {
  if (!isGrabConfigured()) return { outlets: 0, upserted: 0, errors: ["Grab not configured (GRAB_CLIENT_ID/SECRET/MERCHANT_ID)"] };

  const outlets = await prisma.$queryRaw<{ id: string; grab_merchant_id: string }[]>(Prisma.sql`
    SELECT id, grab_merchant_id FROM outlets WHERE grab_merchant_id IS NOT NULL
  `);

  let upserted = 0;
  const errors: string[] = [];
  for (const o of outlets) {
    try {
      const campaigns = await listCampaigns(o.grab_merchant_id);
      for (const c of campaigns) {
        const gid = String(c.id ?? c.campaignID ?? "").trim();
        if (!gid) continue;
        await prisma.$executeRaw(Prisma.sql`
          INSERT INTO grab_campaigns
            (id, outlet_id, grab_campaign_id, name, created_by, status, discount_summary, raw, synced_at)
          VALUES (${randomUUID()}, ${o.id}, ${gid}, ${c.name ?? null}, ${c.createdBy ?? null},
                  ${c.status ?? null}, ${summarizeDiscount(c)}, ${JSON.stringify(c)}::jsonb, now())
          ON CONFLICT (outlet_id, grab_campaign_id) DO UPDATE SET
            name = EXCLUDED.name, created_by = EXCLUDED.created_by, status = EXCLUDED.status,
            discount_summary = EXCLUDED.discount_summary, raw = EXCLUDED.raw, synced_at = now()
        `);
        upserted++;
      }
    } catch (e) {
      errors.push(`${o.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { outlets: outlets.length, upserted, errors };
}
