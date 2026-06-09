/**
 * Transition-mode bridge: pull StoreHub sales for StoreHub-sourced outlets
 * from the BACKOFFICE sales module (which already has the StoreHub client +
 * credentials), forwarding the caller's bearer token. Returns contributions
 * in SEN so the staff dashboard route can add them to native pos+app totals.
 *
 * StoreHub gives revenue / orders / channels / trend — NOT payment-method or
 * customer-level growth, so those stay native/app-only.
 */

type ShChannel = { revenue?: number; orders?: number };
type ShPeriod = {
  summary?: { revenue?: number; orders?: number };
  hourly?: { hour: number; revenue: number }[];
  dailyTotals?: { date: string; revenue: number }[];
  channels?: { dineIn?: ShChannel; takeaway?: ShChannel; delivery?: ShChannel };
  rounds?: { key: string; revenue: number }[];
};

const sen = (rm: number | undefined) => Math.round((rm || 0) * 100);

export type ShContrib = {
  curRevSen: number; curOrd: number; prevRevSen: number; prevOrd: number;
  curHour: number[]; prevHour: number[];
  curByDate: Record<string, number>; prevByDate: Record<string, number>;
  chan: { dine_in: number; takeaway: number; delivery: number };
  rounds: Record<string, number>;
  warnings: string[];
};

export async function fetchStorehubContributions(opts: {
  baseUrl: string;
  authz: string | null;
  outlets: { id: string; storehubId: string | null }[];
  cur: { from: string; to: string };
  prev: { from: string; to: string };
  granularity: "hour" | "day";
}): Promise<ShContrib> {
  const out: ShContrib = {
    curRevSen: 0, curOrd: 0, prevRevSen: 0, prevOrd: 0,
    curHour: Array.from({ length: 24 }, () => 0),
    prevHour: Array.from({ length: 24 }, () => 0),
    curByDate: {}, prevByDate: {},
    chan: { dine_in: 0, takeaway: 0, delivery: 0 },
    rounds: {},
    warnings: [],
  };
  if (!opts.authz || opts.outlets.length === 0) {
    if (!opts.authz) out.warnings.push("StoreHub skipped (no bearer token)");
    return out;
  }

  const periods = `${opts.cur.from}:${opts.cur.to},${opts.prev.from}:${opts.prev.to}`;
  const results = await Promise.all(
    opts.outlets.map(async (o) => {
      try {
        // source=storehub → backoffice returns StoreHub-only (no pos+pickup), so
        // we can add our own native pos+pickup totals without double-counting.
        const url = `${opts.baseUrl}/api/sales/compare?periods=${periods}&outletId=${o.id}&source=storehub`;
        // Backoffice /api/sales/compare authenticates via getSession(), which
        // reads the `celsius-session` COOKIE — never the Authorization header.
        // The staff bearer token is the SAME JWT (shared @celsius/auth +
        // JWT_SECRET), so forward it as that cookie too. Without this the bridge
        // 401s and StoreHub silently drops out of the consolidated sales totals.
        const jwt = opts.authz!.replace(/^Bearer\s+/i, "");
        const res = await fetch(url, {
          headers: { cookie: `celsius-session=${jwt}`, authorization: opts.authz! },
        });
        console.warn(`[sh-bridge] ${o.id} -> ${res.status}`);
        if (!res.ok) return { id: o.id, periods: null as ShPeriod[] | null };
        const j = (await res.json()) as { periods?: ShPeriod[] };
        return { id: o.id, periods: j.periods ?? null };
      } catch (e) {
        console.error(`[sh-bridge] ${o.id} error`, e instanceof Error ? e.message : e);
        return { id: o.id, periods: null as ShPeriod[] | null };
      }
    }),
  );

  for (const r of results) {
    if (!r.periods || r.periods.length < 2) {
      out.warnings.push(`StoreHub ${r.id}: unavailable`);
      continue;
    }
    const [c, p] = r.periods;
    out.curRevSen += sen(c.summary?.revenue); out.curOrd += c.summary?.orders || 0;
    out.prevRevSen += sen(p.summary?.revenue); out.prevOrd += p.summary?.orders || 0;
    if (opts.granularity === "hour") {
      for (let h = 0; h < 24; h++) {
        out.curHour[h] += sen(c.hourly?.find((x) => x.hour === h)?.revenue);
        out.prevHour[h] += sen(p.hourly?.find((x) => x.hour === h)?.revenue);
      }
    } else {
      for (const d of c.dailyTotals || []) out.curByDate[d.date] = (out.curByDate[d.date] || 0) + sen(d.revenue);
      for (const d of p.dailyTotals || []) out.prevByDate[d.date] = (out.prevByDate[d.date] || 0) + sen(d.revenue);
    }
    out.chan.dine_in += sen(c.channels?.dineIn?.revenue);
    out.chan.takeaway += sen(c.channels?.takeaway?.revenue);
    out.chan.delivery += sen(c.channels?.delivery?.revenue);
    for (const rd of c.rounds || []) out.rounds[rd.key] = (out.rounds[rd.key] || 0) + sen(rd.revenue);
  }
  return out;
}
