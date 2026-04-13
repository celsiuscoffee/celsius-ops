import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTransactions } from "@/lib/storehub";

// ─── GET /api/sales/debug ──────────────────────────────────────────────
// Diagnostic endpoint to check StoreHub connectivity and data flow.

export async function GET() {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const checks: Record<string, unknown> = {};

    // 1. Check env vars
    checks.envVars = {
      STOREHUB_ACCOUNT_ID: process.env.STOREHUB_ACCOUNT_ID ? `set (${process.env.STOREHUB_ACCOUNT_ID.length} chars)` : "MISSING",
      STOREHUB_API_KEY: process.env.STOREHUB_API_KEY ? `set (${process.env.STOREHUB_API_KEY.length} chars)` : "MISSING",
    };

    // 2. Check outlets with storehubId
    const outlets = await prisma.outlet.findMany({
      where: { storehubId: { not: null }, status: "ACTIVE" },
      select: { id: true, name: true, storehubId: true },
    });
    checks.outlets = outlets.map((o) => ({ name: o.name, storehubId: o.storehubId }));
    checks.outletCount = outlets.length;

    if (outlets.length === 0) {
      checks.diagnosis = "No active outlets with storehubId configured. Dashboard will show 404.";
      return NextResponse.json(checks);
    }

    // 3. Test StoreHub API with first outlet (small date range)
    const testOutlet = outlets[0];
    const now = new Date();
    const mytNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const today = mytNow.toISOString().split("T")[0];
    const yesterday = new Date(mytNow);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    try {
      const from = new Date(yesterdayStr + "T00:00:00+08:00");
      const to = new Date(today + "T23:59:59+08:00");
      const txns = await getTransactions(testOutlet.storehubId!, from, to);

      // Channel breakdown audit
      const channelCounts: Record<string, { count: number; revenue: number }> = {};
      for (const txn of txns) {
        const ch = txn.channel || "(empty/null)";
        if (!channelCounts[ch]) channelCounts[ch] = { count: 0, revenue: 0 };
        channelCounts[ch].count++;
        channelCounts[ch].revenue = Math.round((channelCounts[ch].revenue + txn.total) * 100) / 100;
      }

      // Build a map of ALL unique values per field across transactions
      const fieldValues: Record<string, Set<string>> = {};
      for (const t of txns) {
        for (const [key, val] of Object.entries(t)) {
          if (key === "items") continue;
          if (!fieldValues[key]) fieldValues[key] = new Set();
          const str = typeof val === "string" ? val
            : typeof val === "number" ? `(number: ${val})`
            : typeof val === "boolean" ? `(bool: ${val})`
            : Array.isArray(val) ? `(array: ${JSON.stringify(val).slice(0, 100)})`
            : val === null ? "(null)"
            : `(${typeof val})`;
          if (fieldValues[key].size < 20) fieldValues[key].add(str);
        }
      }
      const fieldSummary: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(fieldValues)) {
        fieldSummary[k] = [...v];
      }

      // Revenue audit — check for duplicates, total vs subTotal, refunds
      const refIdMap = new Map<string, number>();
      let totalSum = 0;
      let subTotalSum = 0;
      let negativeTotal: { refId: string; total: number; channel?: string }[] = [];
      let zeroTotal: { refId: string; channel?: string }[] = [];
      let totalVsSubTotalDiff = 0;
      for (const txn of txns) {
        const count = (refIdMap.get(txn.refId) || 0) + 1;
        refIdMap.set(txn.refId, count);
        totalSum += txn.total;
        subTotalSum += txn.subTotal || 0;
        totalVsSubTotalDiff += txn.total - (txn.subTotal || txn.total);
        if (txn.total < 0) negativeTotal.push({ refId: txn.refId, total: txn.total, channel: txn.channel });
        if (txn.total === 0) zeroTotal.push({ refId: txn.refId, channel: txn.channel });
      }
      const duplicateRefIds = [...refIdMap.entries()].filter(([, c]) => c > 1).map(([id, c]) => ({ refId: id, count: c }));

      checks.revenueAudit = {
        totalRevenue: Math.round(totalSum * 100) / 100,
        subTotalRevenue: Math.round(subTotalSum * 100) / 100,
        difference: Math.round(totalVsSubTotalDiff * 100) / 100,
        differenceLabel: "total - subTotal (could be rounding/service charge)",
        uniqueTransactions: refIdMap.size,
        totalTransactions: txns.length,
        duplicateRefIds: duplicateRefIds.length > 0 ? duplicateRefIds : "none",
        negativeAmounts: negativeTotal.length > 0 ? negativeTotal : "none",
        zeroAmounts: zeroTotal.length > 0 ? `${zeroTotal.length} transactions` : "none",
        hasSubTotal: txns.length > 0 ? txns[0].subTotal !== undefined : "no txns",
      };

      checks.storehubTest = {
        outlet: testOutlet.name,
        storehubId: testOutlet.storehubId,
        dateRange: `${yesterdayStr} to ${today}`,
        transactionCount: txns.length,
        channelBreakdown: channelCounts,
        // ALL field names and their unique values
        fieldSummary,
        // Show all fields from first 3 transactions (full dump)
        sampleTransactions: txns.slice(0, 3).map((t) => {
          const { items, ...rest } = t;
          return { ...rest, itemCount: items?.length ?? 0 };
        }),
        // Search ALL fields of every transaction for "take" or "dine"
        orderTypeSearch: (() => {
          const results: { refId: string; matchedField: string; matchedValue: string }[] = [];
          for (const t of txns) {
            for (const [key, val] of Object.entries(t)) {
              if (key === "items") continue;
              const str = typeof val === "string" ? val : Array.isArray(val) ? JSON.stringify(val) : "";
              if (/take|dine/i.test(str)) {
                results.push({ refId: t.refId, matchedField: key, matchedValue: str.slice(0, 200) });
              }
            }
            if (results.length >= 10) break;
          }
          return results.length > 0 ? results : "No 'take' or 'dine' found in any field — StoreHub API may not include Order Type";
        })(),
      };
      if (txns.length > 0) {
        checks.diagnosis = `StoreHub API working. Got ${txns.length} transactions. Dashboard should show data.`;
      } else {
        checks.diagnosis = `StoreHub API connected but returned 0 transactions for ${yesterdayStr}-${today}. Could be no sales in this period.`;
      }
    } catch (err) {
      checks.storehubTest = {
        error: err instanceof Error ? err.message : String(err),
        outlet: testOutlet.name,
        storehubId: testOutlet.storehubId,
      };
      checks.diagnosis = `StoreHub API FAILED: ${err instanceof Error ? err.message : String(err)}. This is why the dashboard shows RM 0.00.`;
    }

    return NextResponse.json(checks);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
