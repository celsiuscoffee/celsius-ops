/**
 * Celsius Coffee AI Agent — Overview Scanner.
 *
 * Pulls a 7-day snapshot of the business (ops checklists, inventory,
 * wastage, cash/invoices), asks Claude to identify the decisions and
 * improvements the owner needs to act on, and pushes each one as a
 * Telegram message to the owner chat. Claude itself decides what is
 * worth interrupting the owner with — silent runs are normal.
 */

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/telegram";
import { supabaseAdmin } from "@/lib/loyalty/supabase";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type AgentRecommendation = {
  area: "sales" | "loyalty" | "ops" | "inventory" | "wastage" | "cash" | "people" | "other";
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  why: string;
  action: string;
};

export type AgentResult = {
  generatedAt: string;
  snapshot: OverviewSnapshot;
  recommendations: AgentRecommendation[];
  delivered: { chatId: number; messages: number } | null;
};

type OverviewSnapshot = {
  windowDays: number;
  outlets: { id: string; name: string; code: string }[];
  ops: {
    totalChecklists: number;
    completedChecklists: number;
    completionRate: number;
    photoRate: number;
    staffLagging: { name: string; role: string; completionRate: number; itemsCompleted: number }[];
    outletLagging: { name: string; completionRate: number }[];
    incompleteCount: number;
  };
  inventory: {
    pendingPoApprovals: number;
    criticalReorders: number;
    transfersRecommended: number;
    weeklySpending: number;
    inventoryValue: number;
    cogsThisMonth: number;
    invoicesPendingAmount: number;
    invoicesOverdueAmount: number;
    topReorders: { outlet: string; supplier: string; total: number; urgency: string }[];
  };
  wastage: {
    weeklyCost: number;
    topOffenders: { product: string; outlet: string; cost: number; type: string }[];
  };
  sales: {
    weeklyRevenue: number;
    priorWeekRevenue: number;
    wowChangePct: number;
    weeklyOrders: number;
    avgOrderValue: number;
    byOutlet: { outlet: string; revenue: number; orders: number }[];
    topMenus: { menu: string; units: number; revenue: number }[];
  };
  loyalty: {
    totalMembers: number;
    newMembers7d: number;
    priorWeekNewMembers: number;
    activeMembers7d: number;
    redemptions7d: number;
    priorWeekRedemptions: number;
    topOutletsByRedemption: { outlet: string; redemptions: number }[];
  };
};

// ────────────────────────────────────────────────────────────
// Snapshot collection (DB-driven, no HTTP loops)
// ────────────────────────────────────────────────────────────

async function buildSnapshot(): Promise<OverviewSnapshot> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    outlets, checklists, orders, parLevels, stockBalances, wastage, invoices,
    salesThisWeek, salesPriorWeek,
    loyaltyMembersTotal, loyaltyNewThisWeek, loyaltyNewPriorWeek, loyaltyActive7d,
    redemptionsThisWeek, redemptionsPriorWeek,
  ] = await Promise.all([
      prisma.outlet.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, name: true, code: true },
      }),
      prisma.checklist.findMany({
        where: { date: { gte: weekAgo, lte: now } },
        include: {
          outlet: { select: { id: true, name: true, code: true } },
          assignedTo: { select: { id: true, name: true, role: true } },
          items: {
            select: {
              isCompleted: true,
              photoUrl: true,
              completedBy: { select: { id: true, name: true, role: true } },
            },
          },
        },
      }),
      prisma.order.findMany({
        where: { createdAt: { gte: weekAgo } },
        select: {
          id: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          orderType: true,
          outlet: { select: { name: true } },
          supplier: { select: { name: true } },
        },
      }),
      prisma.parLevel.findMany({
        select: {
          productId: true,
          outletId: true,
          parLevel: true,
          reorderPoint: true,
          avgDailyUsage: true,
        },
      }),
      prisma.stockBalance.findMany({
        select: { productId: true, outletId: true, quantity: true },
      }),
      prisma.stockAdjustment.findMany({
        where: {
          createdAt: { gte: weekAgo },
          adjustmentType: { in: ["WASTAGE", "BREAKAGE", "EXPIRED", "SPILLAGE"] },
        },
        include: {
          product: { select: { name: true } },
          outlet: { select: { name: true } },
        },
      }),
      prisma.invoice.findMany({
        where: { status: { in: ["PENDING", "INITIATED", "OVERDUE"] } },
        select: { amount: true, status: true, dueDate: true },
      }),
      // Sales — this week
      prisma.salesTransaction.findMany({
        where: { transactedAt: { gte: weekAgo } },
        select: {
          menuName: true,
          quantity: true,
          grossAmount: true,
          outlet: { select: { name: true } },
        },
      }),
      // Sales — prior week (for WoW trend)
      prisma.salesTransaction.aggregate({
        where: { transactedAt: { gte: twoWeeksAgo, lt: weekAgo } },
        _sum: { grossAmount: true },
      }),
      // Loyalty — total members + new/active/redemption counts (Supabase)
      supabaseAdmin.from("member_brands").select("id", { count: "exact", head: true }).eq("brand_id", "brand-celsius"),
      supabaseAdmin.from("member_brands").select("id", { count: "exact", head: true }).eq("brand_id", "brand-celsius").gte("joined_at", weekAgo.toISOString()),
      supabaseAdmin.from("member_brands").select("id", { count: "exact", head: true }).eq("brand_id", "brand-celsius").gte("joined_at", twoWeeksAgo.toISOString()).lt("joined_at", weekAgo.toISOString()),
      supabaseAdmin.from("member_brands").select("id", { count: "exact", head: true }).eq("brand_id", "brand-celsius").gte("last_visit_at", weekAgo.toISOString()),
      supabaseAdmin.from("redemptions").select("outlet_id").eq("brand_id", "brand-celsius").gte("created_at", weekAgo.toISOString()),
      supabaseAdmin.from("redemptions").select("id", { count: "exact", head: true }).eq("brand_id", "brand-celsius").gte("created_at", twoWeeksAgo.toISOString()).lt("created_at", weekAgo.toISOString()),
    ]);

  // Ops — completion + photo rate + laggards
  const totalChecklists = checklists.length;
  const completedChecklists = checklists.filter((c) => c.status === "COMPLETED").length;
  const totalItems = checklists.reduce((s, c) => s + c.items.length, 0);
  const itemsWithPhotos = checklists.reduce(
    (s, c) => s + c.items.filter((i) => i.photoUrl).length,
    0,
  );

  const staffMap = new Map<string, {
    name: string; role: string;
    claimed: number; completed: number; itemsCompleted: number;
  }>();
  const outletStatsMap = new Map<string, { name: string; total: number; completed: number }>();

  for (const cl of checklists) {
    if (cl.assignedTo) {
      const ex = staffMap.get(cl.assignedTo.id) ?? {
        name: cl.assignedTo.name, role: cl.assignedTo.role,
        claimed: 0, completed: 0, itemsCompleted: 0,
      };
      ex.claimed++;
      if (cl.status === "COMPLETED") ex.completed++;
      staffMap.set(cl.assignedTo.id, ex);
    }
    for (const item of cl.items) {
      if (item.isCompleted && item.completedBy) {
        const ex = staffMap.get(item.completedBy.id) ?? {
          name: item.completedBy.name,
          role: (item.completedBy as { role?: string }).role ?? "STAFF",
          claimed: 0, completed: 0, itemsCompleted: 0,
        };
        ex.itemsCompleted++;
        staffMap.set(item.completedBy.id, ex);
      }
    }
    const oEx = outletStatsMap.get(cl.outlet.id) ?? {
      name: cl.outlet.name, total: 0, completed: 0,
    };
    oEx.total++;
    if (cl.status === "COMPLETED") oEx.completed++;
    outletStatsMap.set(cl.outlet.id, oEx);
  }

  const staffLagging = [...staffMap.values()]
    .filter((s) => s.claimed >= 3)
    .map((s) => ({
      name: s.name,
      role: s.role,
      completionRate: s.claimed > 0 ? Math.round((s.completed / s.claimed) * 100) : 0,
      itemsCompleted: s.itemsCompleted,
    }))
    .filter((s) => s.completionRate < 80)
    .sort((a, b) => a.completionRate - b.completionRate)
    .slice(0, 5);

  const outletLagging = [...outletStatsMap.values()]
    .map((o) => ({
      name: o.name,
      completionRate: o.total > 0 ? Math.round((o.completed / o.total) * 100) : 0,
    }))
    .filter((o) => o.completionRate < 80)
    .sort((a, b) => a.completionRate - b.completionRate);

  // Inventory — pending POs + reorder + spending + COGS approximation
  const pendingPoApprovals = orders.filter(
    (o) => o.orderType === "PURCHASE_ORDER" && o.status === "PENDING_APPROVAL",
  ).length;
  const weeklySpending = orders
    .filter((o) => o.orderType === "PURCHASE_ORDER" && o.status !== "CANCELLED" && o.status !== "DRAFT")
    .reduce((s, o) => s + Number(o.totalAmount ?? 0), 0);

  const stockMap = new Map(
    stockBalances.map((s) => [`${s.productId}_${s.outletId}`, Number(s.quantity)]),
  );
  let criticalReorders = 0;
  for (const par of parLevels) {
    const qty = stockMap.get(`${par.productId}_${par.outletId}`) ?? 0;
    if (qty <= 0 && Number(par.parLevel) > 0) criticalReorders++;
  }

  const inventoryValue = stockBalances.reduce((s, b) => s + Number(b.quantity ?? 0), 0);
  const cogsThisMonth = orders
    .filter((o) => o.orderType === "PURCHASE_ORDER" && new Date(o.createdAt) >= monthAgo)
    .reduce((s, o) => s + Number(o.totalAmount ?? 0), 0);

  const invoicesPendingAmount = invoices
    .filter((i) => i.status === "PENDING" || i.status === "INITIATED")
    .reduce((s, i) => s + Number(i.amount ?? 0), 0);
  const invoicesOverdueAmount = invoices
    .filter((i) => i.status === "OVERDUE" || (i.dueDate && new Date(i.dueDate) < now))
    .reduce((s, i) => s + Number(i.amount ?? 0), 0);

  // Wastage — top offenders by cost
  type WasteAgg = { product: string; outlet: string; cost: number; type: string };
  const wasteAggMap = new Map<string, WasteAgg>();
  for (const w of wastage) {
    if (!w.product || !w.outlet) continue;
    const key = `${w.product.name}__${w.outlet.name}`;
    const ex = wasteAggMap.get(key) ?? {
      product: w.product.name,
      outlet: w.outlet.name,
      cost: 0,
      type: w.adjustmentType,
    };
    ex.cost += Math.abs(Number(w.costAmount ?? 0));
    wasteAggMap.set(key, ex);
  }
  const topOffenders = [...wasteAggMap.values()]
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5);
  const weeklyWasteCost = [...wasteAggMap.values()].reduce((s, w) => s + w.cost, 0);

  // Pull in AI-generated reorder summary (top 5)
  const topReorders: { outlet: string; supplier: string; total: number; urgency: string }[] = [];
  // Reuse the rules-based decisions endpoint logic inline would duplicate code;
  // instead derive a simple urgency view from orders pending/draft.
  const draftOrSent = orders
    .filter((o) => o.orderType === "PURCHASE_ORDER" && (o.status === "DRAFT" || o.status === "PENDING_APPROVAL"))
    .sort((a, b) => Number(b.totalAmount ?? 0) - Number(a.totalAmount ?? 0))
    .slice(0, 5);
  for (const o of draftOrSent) {
    topReorders.push({
      outlet: o.outlet?.name ?? "—",
      supplier: o.supplier?.name ?? "—",
      total: Number(o.totalAmount ?? 0),
      urgency: o.status === "PENDING_APPROVAL" ? "needs approval" : "draft",
    });
  }

  // Sales — aggregate weekly + prior week
  const salesWeeklyRevenue = salesThisWeek.reduce((s, t) => s + Number(t.grossAmount ?? 0), 0);
  const salesPriorWeekRevenue = Number(salesPriorWeek._sum.grossAmount ?? 0);
  const salesWeeklyOrders = salesThisWeek.length;
  const salesByOutletMap = new Map<string, { revenue: number; orders: number }>();
  const salesTopMenuMap = new Map<string, { units: number; revenue: number }>();
  for (const t of salesThisWeek) {
    const outletName = t.outlet?.name ?? "—";
    const o = salesByOutletMap.get(outletName) ?? { revenue: 0, orders: 0 };
    o.revenue += Number(t.grossAmount ?? 0);
    o.orders += 1;
    salesByOutletMap.set(outletName, o);
    const m = salesTopMenuMap.get(t.menuName) ?? { units: 0, revenue: 0 };
    m.units += t.quantity;
    m.revenue += Number(t.grossAmount ?? 0);
    salesTopMenuMap.set(t.menuName, m);
  }
  const wowChangePct = salesPriorWeekRevenue > 0
    ? Math.round(((salesWeeklyRevenue - salesPriorWeekRevenue) / salesPriorWeekRevenue) * 100)
    : 0;

  // Loyalty — aggregate redemption-by-outlet
  const redemptionsData = (redemptionsThisWeek.data ?? []) as { outlet_id: string | null }[];
  const outletNameById = new Map(outlets.map((o) => [o.id, o.name]));
  const redemptionOutletMap = new Map<string, number>();
  for (const r of redemptionsData) {
    if (!r.outlet_id) continue;
    const name = outletNameById.get(r.outlet_id) ?? "—";
    redemptionOutletMap.set(name, (redemptionOutletMap.get(name) ?? 0) + 1);
  }

  return {
    windowDays: 7,
    outlets: outlets.map((o) => ({ id: o.id, name: o.name, code: o.code })),
    ops: {
      totalChecklists,
      completedChecklists,
      completionRate: totalChecklists > 0 ? Math.round((completedChecklists / totalChecklists) * 100) : 0,
      photoRate: totalItems > 0 ? Math.round((itemsWithPhotos / totalItems) * 100) : 0,
      staffLagging,
      outletLagging,
      incompleteCount: totalChecklists - completedChecklists,
    },
    inventory: {
      pendingPoApprovals,
      criticalReorders,
      transfersRecommended: 0,
      weeklySpending: Math.round(weeklySpending),
      inventoryValue: Math.round(inventoryValue),
      cogsThisMonth: Math.round(cogsThisMonth),
      invoicesPendingAmount: Math.round(invoicesPendingAmount),
      invoicesOverdueAmount: Math.round(invoicesOverdueAmount),
      topReorders,
    },
    wastage: {
      weeklyCost: Math.round(weeklyWasteCost),
      topOffenders,
    },
    sales: {
      weeklyRevenue: Math.round(salesWeeklyRevenue),
      priorWeekRevenue: Math.round(salesPriorWeekRevenue),
      wowChangePct,
      weeklyOrders: salesWeeklyOrders,
      avgOrderValue: salesWeeklyOrders > 0 ? Math.round(salesWeeklyRevenue / salesWeeklyOrders) : 0,
      byOutlet: [...salesByOutletMap.entries()]
        .map(([outlet, v]) => ({ outlet, revenue: Math.round(v.revenue), orders: v.orders }))
        .sort((a, b) => b.revenue - a.revenue),
      topMenus: [...salesTopMenuMap.entries()]
        .map(([menu, v]) => ({ menu, units: v.units, revenue: Math.round(v.revenue) }))
        .sort((a, b) => b.units - a.units)
        .slice(0, 5),
    },
    loyalty: {
      totalMembers: loyaltyMembersTotal.count ?? 0,
      newMembers7d: loyaltyNewThisWeek.count ?? 0,
      priorWeekNewMembers: loyaltyNewPriorWeek.count ?? 0,
      activeMembers7d: loyaltyActive7d.count ?? 0,
      redemptions7d: redemptionsData.length,
      priorWeekRedemptions: redemptionsPriorWeek.count ?? 0,
      topOutletsByRedemption: [...redemptionOutletMap.entries()]
        .map(([outlet, redemptions]) => ({ outlet, redemptions }))
        .sort((a, b) => b.redemptions - a.redemptions)
        .slice(0, 5),
    },
  };
}

// ────────────────────────────────────────────────────────────
// Claude analysis — return structured recommendations
// ────────────────────────────────────────────────────────────

async function analyse(snapshot: OverviewSnapshot): Promise<AgentRecommendation[]> {
  const mytNow = new Date().toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" });

  const prompt = `You are the AI operations advisor for Celsius Coffee, a multi-outlet specialty coffee
business in Malaysia. The current time in Kuala Lumpur is ${mytNow}.

Below is a live 7-day snapshot of the business. Your job is to decide:
  (1) WHICH decisions or improvements the owner genuinely needs to know right now, and
  (2) WHETHER they are urgent enough to interrupt the owner with a Telegram alert at this hour.

Rules:
- Only surface items that materially affect revenue, cost, compliance, or customer experience.
- Skip anything already healthy or trending in the right direction.
- Do NOT raise the same routine alert every cycle — only escalate if it has gotten worse.
- If nothing is worth interrupting the owner with right now, return an empty list.
- Outside Malaysian business hours (8am–11pm MYT), only "critical" items should be returned.
- Hard ceiling: 6 items.

Signal coverage — consider all areas, not just ops + inventory:
- sales: week-over-week revenue change, outlet revenue gaps, abnormal AOV or order volume shifts.
  Compare sales.weeklyRevenue to sales.priorWeekRevenue (wowChangePct) — flag drops >15%.
  Flag outlets whose share of revenue has shifted materially.
- loyalty: declining new-member signups (compare newMembers7d to priorWeekNewMembers), falling
  redemption volume, outlets with zero redemptions when peers have many.
- ops, inventory, wastage, cash, people: as before.

Snapshot (JSON):
${JSON.stringify(snapshot, null, 2)}

Return STRICT JSON with this shape — no markdown, no commentary:
{
  "recommendations": [
    {
      "area": "sales" | "loyalty" | "ops" | "inventory" | "wastage" | "cash" | "people" | "other",
      "priority": "critical" | "high" | "medium" | "low",
      "title": "short headline (<= 60 chars)",
      "why": "1-2 sentences with the data point that triggered this",
      "action": "1-2 sentences telling the owner what to do next"
    }
  ]
}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  const parsed = JSON.parse(jsonMatch[0]) as { recommendations?: AgentRecommendation[] };
  return (parsed.recommendations ?? []).slice(0, 8);
}

// ────────────────────────────────────────────────────────────
// Telegram delivery
// ────────────────────────────────────────────────────────────

const PRIORITY_EMOJI: Record<AgentRecommendation["priority"], string> = {
  critical: "🚨",
  high: "🔴",
  medium: "🟠",
  low: "🟡",
};

const AREA_EMOJI: Record<AgentRecommendation["area"], string> = {
  sales: "📈",
  loyalty: "🎁",
  ops: "📋",
  inventory: "📦",
  wastage: "🗑️",
  cash: "💰",
  people: "👥",
  other: "📌",
};

function formatRecommendation(r: AgentRecommendation, idx: number, total: number): string {
  return [
    `${PRIORITY_EMOJI[r.priority]} <b>${escapeHtml(r.title)}</b>`,
    `${AREA_EMOJI[r.area]} ${r.area} · ${r.priority} · ${idx + 1}/${total}`,
    "",
    `<b>Why:</b> ${escapeHtml(r.why)}`,
    `<b>Action:</b> ${escapeHtml(r.action)}`,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function deliver(recommendations: AgentRecommendation[]): Promise<{ chatId: number; messages: number } | null> {
  const chatRaw = process.env.TELEGRAM_OWNER_CHAT_ID;
  if (!chatRaw) {
    console.warn("[ai-agent] TELEGRAM_OWNER_CHAT_ID not configured — skipping delivery");
    return null;
  }
  const chatId = parseInt(chatRaw, 10);
  if (Number.isNaN(chatId)) return null;

  if (recommendations.length === 0) {
    // Stay silent — agent decided nothing is worth interrupting the owner.
    return { chatId, messages: 0 };
  }

  const header = `🤖 <b>Celsius AI Agent — ${recommendations.length} item${recommendations.length === 1 ? "" : "s"} need your attention</b>\n<i>${new Date().toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}</i>`;
  await sendMessage(chatId, header);

  for (let i = 0; i < recommendations.length; i++) {
    await sendMessage(chatId, formatRecommendation(recommendations[i], i, recommendations.length));
  }

  return { chatId, messages: recommendations.length + 1 };
}

// ────────────────────────────────────────────────────────────
// Public entry point
// ────────────────────────────────────────────────────────────

export type RunOptions = {
  sendTelegram?: boolean; // default true
  persist?: boolean;      // default true — writes to agent_insights_cache
};

export async function runCelsiusOverviewAgent(opts: RunOptions = {}): Promise<AgentResult> {
  const { sendTelegram = true, persist = true } = opts;
  const snapshot = await buildSnapshot();
  const recommendations = await analyse(snapshot);
  const delivered = sendTelegram ? await deliver(recommendations) : null;
  const generatedAt = new Date().toISOString();

  const result: AgentResult = {
    generatedAt,
    snapshot,
    recommendations,
    delivered,
  };

  if (persist) {
    try {
      await supabaseAdmin
        .from("agent_insights_cache")
        .insert({
          agent_name: "celsius-overview",
          payload: result,
          generated_at: generatedAt,
        });
    } catch (err) {
      console.error("[ai-agent] cache persist failed:", err);
    }
  }

  return result;
}

export async function getLatestCelsiusOverview(): Promise<AgentResult | null> {
  const { data, error } = await supabaseAdmin
    .from("agent_insights_cache")
    .select("payload, generated_at")
    .eq("agent_name", "celsius-overview")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.payload as AgentResult;
}
