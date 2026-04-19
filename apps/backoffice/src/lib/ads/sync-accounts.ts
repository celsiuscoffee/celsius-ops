/**
 * Sync accessible Ads accounts from the MCC into ads_account.
 *
 * Uses the MCC's customer_client view to discover every linked account,
 * then upserts each row. Run manually from /ads/settings or via the
 * daily cron as the first step before metric sync.
 */

import { prisma } from "@/lib/prisma";
import { getMccCustomer } from "./client";
import { randomUUID } from "crypto";

export async function syncAccounts(): Promise<{ inserted: number; updated: number }> {
  const mcc = getMccCustomer();

  // GAQL: list every customer_client visible from the MCC
  const rows = await mcc.query(`
    SELECT
      customer_client.id,
      customer_client.descriptive_name,
      customer_client.currency_code,
      customer_client.time_zone,
      customer_client.manager,
      customer_client.test_account,
      customer_client.status
    FROM customer_client
    WHERE customer_client.status = 'ENABLED'
  `);

  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const cc = row.customer_client;
    if (!cc?.id) continue;
    const customerId = String(cc.id);

    const existing = await prisma.adsAccount.findUnique({ where: { customerId } });
    const data = {
      descriptiveName: cc.descriptive_name ?? `Customer ${customerId}`,
      currencyCode: cc.currency_code ?? "MYR",
      timeZone: cc.time_zone ?? "Asia/Kuala_Lumpur",
      isManager: Boolean(cc.manager),
      isTestAccount: Boolean(cc.test_account),
      // CustomerStatus enum: 2=ENABLED, 3=CANCELED, 4=SUSPENDED, 5=CLOSED
      status: ((): string => {
        const s = cc.status;
        if (s == null) return "ENABLED";
        if (typeof s === "string") return s;
        const map: Record<number, string> = { 0: "UNSPECIFIED", 1: "UNKNOWN", 2: "ENABLED", 3: "CANCELED", 4: "SUSPENDED", 5: "CLOSED" };
        return map[Number(s)] ?? "UNKNOWN";
      })(),
    };

    if (existing) {
      await prisma.adsAccount.update({
        where: { id: existing.id },
        data,
      });
      updated++;
    } else {
      await prisma.adsAccount.create({
        data: {
          id: randomUUID(),
          customerId,
          ...data,
        },
      });
      inserted++;
    }
  }

  return { inserted, updated };
}
