import { NextRequest, NextResponse } from "next/server";
import {
  fetchRecentTransactions,
  getTransactionAmount,
  isTransactionMatched,
  markTransactionMatched,
} from "@/lib/storehub";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * POST /api/storehub/match
 *
 * After a customer pays at StoreHub POS and enters their phone
 * on the loyalty tablet, this endpoint finds the most recent
 * unmatched transaction at that outlet and returns the amount
 * for auto-awarding points.
 *
 * Requires staff/admin auth.
 * Body: { outlet_id: string }
 * Returns: { success, amount, points, transaction_id, items_summary }
 */
export async function POST(request: NextRequest) {
  try {
    // Require staff/admin authentication
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { outlet_id } = body;

    if (!outlet_id) {
      return NextResponse.json(
        { success: false, message: "outlet_id is required" },
        { status: 400 }
      );
    }

    // Look up outlet from database (not demo data)
    const { data: outlet, error: outletError } = await supabaseAdmin
      .from("outlets")
      .select("id, name, storehub_store_id, brand_id")
      .eq("id", outlet_id)
      .single();

    if (outletError || !outlet || !outlet.storehub_store_id) {
      return NextResponse.json(
        {
          success: false,
          message: "Outlet not found or not linked to StoreHub",
        },
        { status: 404 }
      );
    }

    // Get the brand's points_per_rm setting
    const { data: brand } = await supabaseAdmin
      .from("brands")
      .select("points_per_rm")
      .eq("id", outlet.brand_id)
      .single();

    const pointsPerRm = brand?.points_per_rm ?? 1;

    // Fetch recent transactions (last 10 minutes)
    const transactions = await fetchRecentTransactions(
      outlet.storehub_store_id,
      10
    );

    if (transactions.length === 0) {
      return NextResponse.json({
        success: false,
        message: "No recent purchases found at this outlet",
      });
    }

    // Sort by time descending — most recent first
    const sorted = transactions.sort(
      (a, b) =>
        new Date(b.transactionTime).getTime() -
        new Date(a.transactionTime).getTime()
    );

    // Find the most recent unmatched transaction
    let unmatched = null;
    for (const txn of sorted) {
      if (!(await isTransactionMatched(txn._id))) {
        unmatched = txn;
        break;
      }
    }

    if (!unmatched) {
      return NextResponse.json({
        success: false,
        message: "All recent purchases have already been claimed",
      });
    }

    // Get the amount and calculate points
    const amount = getTransactionAmount(unmatched);
    const points = Math.floor(amount * pointsPerRm);

    // StoreHub items only contain productId (not product names)
    // So we show item count instead of names
    const totalItems = unmatched.items?.reduce(
      (sum: number, item: Record<string, unknown>) => sum + (Number(item.quantity) || 1),
      0
    ) || 0;
    const itemsSummary = totalItems > 0 ? `${totalItems} item${totalItems > 1 ? "s" : ""}` : "Purchase";

    // Mark as matched so it can't be claimed again
    markTransactionMatched(unmatched._id);

    return NextResponse.json({
      success: true,
      amount: Math.round(amount * 100) / 100,
      points,
      transaction_id: unmatched._id,
      transaction_time: unmatched.transactionTime,
      items_summary: itemsSummary,
      outlet_name: outlet.name,
    });
  } catch (error) {
    console.error("StoreHub match error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to connect to StoreHub" },
      { status: 500 }
    );
  }
}
