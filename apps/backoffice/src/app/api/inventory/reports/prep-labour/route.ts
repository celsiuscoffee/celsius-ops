import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { REST_DAY_ROLE_PATTERN } from "@/lib/hr/constants";
import { fetchSoldLines, expandIngredientsForLine } from "@/lib/inventory/report-sales";
import type { RecipeLine } from "@celsius/db";

// GET /api/inventory/reports/prep-labour?outletId=&from=&to=
//
// "Do we have enough manhours to prep?" — the two halves of that question put
// side by side.
//
// REQUIRED. Central Preparation turns raw stock into prepped products that
// outlet menus consume. Sales × the menu BOM says how many prepped units the
// period actually consumed; each prep recipe says how many minutes ONE person
// needs per batch. Units ÷ yield × prepMinutes = manhours of prep the period
// demanded. Demand is read from sales rather than from Central Prep transfers
// on purpose: transfers are recorded late and unevenly (102 sat stuck PENDING
// at the 2026-09-04 QA), so they undercount the work that was really done.
//
// AVAILABLE. Published rostered shifts over the same days, minus breaks and
// rest-day rows — the same roster payroll pays from.
//
// The report deliberately does NOT assume what share of a rostered hour goes to
// prep versus serving; it shows required against total rostered and the
// percentage between them, and leaves that judgement to the reader.
//
// Recipes with no prepMinutes are counted and named, never treated as zero
// work — otherwise a half-timed catalog would report a comfortable surplus.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const round2 = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86_400_000;

/** Rostered hours from PUBLISHED schedules: (end − start − break), rest days out. */
async function rosteredHours(opts: { outletId: string | null; from: Date; to: Date }): Promise<{
  hours: number; shifts: number; people: number; scheduleCount: number;
}> {
  let scheduleQuery = hrSupabaseAdmin
    .from("hr_schedules")
    .select("id")
    // A draft roster is a proposal, not committed labour.
    .not("published_at", "is", null);
  if (opts.outletId) scheduleQuery = scheduleQuery.eq("outlet_id", opts.outletId);
  const { data: schedules } = await scheduleQuery;
  const scheduleIds = (schedules ?? []).map((s: { id: string }) => s.id);
  if (scheduleIds.length === 0) return { hours: 0, shifts: 0, people: 0, scheduleCount: 0 };

  const { data: shifts } = await hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .select("user_id, shift_date, start_time, end_time, break_minutes, role_type")
    .in("schedule_id", scheduleIds)
    .gte("shift_date", ymd(opts.from))
    .lte("shift_date", ymd(opts.to));

  let minutes = 0;
  let counted = 0;
  const people = new Set<string>();
  for (const s of (shifts ?? []) as {
    user_id: string; start_time: string | null; end_time: string | null;
    break_minutes: number | null; role_type: string | null;
  }[]) {
    // Rest-day markers are 00:00–00:00 placeholders, not work.
    if ((s.role_type ?? "").toLowerCase().startsWith(REST_DAY_ROLE_PATTERN.replace("%", ""))) continue;
    if (!s.start_time || !s.end_time) continue;
    const toMin = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    const start = toMin(s.start_time);
    // A shift ending before it starts crossed midnight.
    const end = toMin(s.end_time) <= start ? toMin(s.end_time) + 1440 : toMin(s.end_time);
    const worked = end - start - (s.break_minutes ?? 0);
    if (worked <= 0) continue;
    minutes += worked;
    counted++;
    people.add(s.user_id);
  }
  return { hours: round2(minutes / 60), shifts: counted, people: people.size, scheduleCount: scheduleIds.length };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const outletId = searchParams.get("outletId") || null;
  const now = new Date();
  const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : new Date(now.getTime() - 7 * DAY);
  // Inclusive end day: the picker means "through this date".
  const toRaw = searchParams.get("to") ? new Date(searchParams.get("to")!) : now;
  const to = new Date(toRaw.getTime() + DAY);

  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const outletName = outletId ? (outlets.find((o) => o.id === outletId)?.name ?? "Unknown") : "All outlets";

  const [recipes, sales, roster] = await Promise.all([
    prisma.productRecipe.findMany({
      where: { isActive: true },
      select: {
        id: true, outputProductId: true, yieldQuantity: true, yieldUom: true, prepMinutes: true,
        outputProduct: { select: { name: true, sku: true, baseUom: true } },
      },
    }),
    fetchSoldLines({ outletIds: outletId ? [outletId] : undefined, from, to }),
    rosteredHours({ outletId, from, to: toRaw }),
  ]);

  // Expected consumption per product = Σ over sold lines of the recipe each line
  // consumed (same expansion the consumption engine and variance report use).
  const soldMenuIds = [...new Set(sales.map((s) => s.menuId).filter((m): m is string => !!m))];
  const menuIngredients = soldMenuIds.length
    ? await prisma.menuIngredient.findMany({
        where: { menuId: { in: soldMenuIds } },
        select: {
          menuId: true, productId: true, quantityUsed: true, serviceMode: true,
          modifier: true, replacesProductId: true,
        },
      })
    : [];
  const recipeMap = new Map<string, RecipeLine[]>();
  for (const r of menuIngredients) {
    const arr = recipeMap.get(r.menuId) ?? [];
    arr.push({
      productId: r.productId, quantityUsed: Number(r.quantityUsed),
      serviceMode: r.serviceMode, modifier: r.modifier, replacesProductId: r.replacesProductId,
    });
    recipeMap.set(r.menuId, arr);
  }
  const consumed = new Map<string, number>();
  for (const line of sales) {
    if (!line.menuId) continue;
    const recipe = recipeMap.get(line.menuId);
    if (!recipe) continue;
    for (const [productId, qty] of expandIngredientsForLine(line, recipe)) {
      consumed.set(productId, (consumed.get(productId) ?? 0) + qty);
    }
  }

  const items = recipes
    .map((r) => {
      const unitsNeeded = round2(consumed.get(r.outputProductId) ?? 0);
      const yieldQty = Number(r.yieldQuantity);
      const prepMinutes = r.prepMinutes != null ? Number(r.prepMinutes) : null;
      const minutesPerUnit = prepMinutes != null && yieldQty > 0 ? prepMinutes / yieldQty : null;
      const requiredMinutes = minutesPerUnit != null ? unitsNeeded * minutesPerUnit : null;
      return {
        recipeId: r.id,
        productId: r.outputProductId,
        productName: r.outputProduct.name,
        sku: r.outputProduct.sku,
        baseUom: r.outputProduct.baseUom,
        yieldQuantity: yieldQty,
        yieldUom: r.yieldUom,
        prepMinutes,
        minutesPerUnit: minutesPerUnit != null ? Math.round(minutesPerUnit * 10000) / 10000 : null,
        unitsNeeded,
        batches: yieldQty > 0 ? round2(unitsNeeded / yieldQty) : 0,
        requiredMinutes: requiredMinutes != null ? round2(requiredMinutes) : null,
        requiredHours: requiredMinutes != null ? round2(requiredMinutes / 60) : null,
        timed: prepMinutes != null,
      };
    })
    // A recipe nothing consumed in the window is noise on a labour plan.
    .filter((i) => i.unitsNeeded > 0)
    .sort((a, b) => (b.requiredMinutes ?? -1) - (a.requiredMinutes ?? -1));

  const requiredMinutes = items.reduce((s, i) => s + (i.requiredMinutes ?? 0), 0);
  const requiredHours = round2(requiredMinutes / 60);
  const untimed = items.filter((i) => !i.timed);

  return NextResponse.json({
    summary: {
      from: ymd(from), to: ymd(toRaw), outletId, outletName,
      requiredHours,
      rosteredHours: roster.hours,
      // Positive = spare capacity, negative = short.
      gapHours: round2(roster.hours - requiredHours),
      utilisationPct: roster.hours > 0 ? round2((requiredHours / roster.hours) * 100) : null,
      rosteredShifts: roster.shifts,
      rosteredPeople: roster.people,
      itemsAnalysed: items.length,
      untimedCount: untimed.length,
    },
    outlets,
    items,
    warnings: {
      // Named, not silently zeroed: these are prep hours the total is missing.
      untimedRecipes: untimed.map((i) => i.productName).sort(),
      noSales: sales.length === 0,
      noRoster: roster.scheduleCount === 0,
      menusWithoutRecipe: soldMenuIds.filter((id) => !recipeMap.has(id)).length,
    },
  });
}
