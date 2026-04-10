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

      checks.storehubTest = {
        outlet: testOutlet.name,
        storehubId: testOutlet.storehubId,
        dateRange: `${yesterdayStr} to ${today}`,
        transactionCount: txns.length,
        channelBreakdown: channelCounts,
        // Show all fields from first 5 transactions to identify takeaway/remarks fields
        sampleTransactions: txns.slice(0, 5).map((t) => {
          // Extract all non-items keys to see what StoreHub sends
          const { items, ...rest } = t;
          return { ...rest, itemCount: items?.length ?? 0 };
        }),
        // Search ALL fields of every transaction for "take" to find takeaway marker
        takeawaySearch: (() => {
          const results: { refId: string; matchedField: string; matchedValue: string }[] = [];
          for (const t of txns) {
            for (const [key, val] of Object.entries(t)) {
              if (key === "items") continue;
              const str = typeof val === "string" ? val : Array.isArray(val) ? JSON.stringify(val) : "";
              if (/take/i.test(str)) {
                results.push({ refId: t.refId, matchedField: key, matchedValue: str.slice(0, 200) });
              }
            }
            if (results.length >= 10) break;
          }
          return results.length > 0 ? results : "No transactions with 'take' found in any field";
        })(),
        // Show ALL unique field names across transactions
        allFieldNames: [...new Set(txns.flatMap((t) => Object.keys(t)))].sort(),
        // Find a takeaway sample — dump ALL its fields
        takeawaySample: (() => {
          const ta = txns.find((t) => {
            // Search every string field for takeaway hints
            for (const [key, val] of Object.entries(t)) {
              if (key === "items") continue;
              const str = typeof val === "string" ? val : Array.isArray(val) ? JSON.stringify(val) : "";
              if (/take|tapau|dabao|bungkus/i.test(str)) return true;
            }
            return false;
          });
          if (!ta) return null;
          const { items, ...rest } = ta;
          return { ...rest, itemCount: items?.length ?? 0 };
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
