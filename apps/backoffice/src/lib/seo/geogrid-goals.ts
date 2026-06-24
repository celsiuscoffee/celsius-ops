/**
 * Geogrid goals, per outlet — the targets the loop is graded against.
 *
 * Three tiers (see docs/design/gbp-geogrid-rank-loop.md → Success Criteria):
 *   - FLOOR (never lose):   100% top-3 in the inner 3×3 — own your doorstep.
 *   - COMMITTED (graded on): Share of Local Voice — % of cells in the top 3.
 *                            This is the order-driving number and the one the
 *                            levers actually move.
 *   - STRETCH (the ask):    #1-reach (km) — radius of the concentric #1 zone.
 *                           Proximity-capped, so it's the headline, not the grade.
 *
 * IMPORTANT — these are STARTING HYPOTHESES, not gospel. Set real per-outlet
 * targets only after ~2 sweeps establish each outlet's baseline: a mall outlet
 * (Putrajaya/IOI) and a standalone (Nilai) start in very different places.
 * Calibrate solvTarget to baseline + ~15–20pp/quarter, and oneReachTargetKm to
 * roughly double the baseline #1-reach. Edit the numbers here once baselines land.
 */

export type GeoGoal = {
  /** Floor: required % of the inner 3×3 that must be top-3 (own the neighbourhood). */
  innerTop3Pct: number;
  /** Committed: target Share of Local Voice (% of all cells in the top 3). */
  solvTarget: number;
  /** Stretch: target #1-reach in km. */
  oneReachTargetKm: number;
};

// Fallback for any outlet without an explicit goal.
export const DEFAULT_GOAL: GeoGoal = { innerTop3Pct: 100, solvTarget: 60, oneReachTargetKm: 1.5 };

// Keyed by the same name-substring match as geogrid-config.ts.
export const OUTLET_GOALS: Record<string, GeoGoal> = {
  // Mall + wide catchment, but dense competition inside IOI City → modest reach.
  putrajaya: { innerTop3Pct: 100, solvTarget: 55, oneReachTargetKm: 1.2 },
  "shah alam": { innerTop3Pct: 100, solvTarget: 60, oneReachTargetKm: 1.5 },
  tamarind: { innerTop3Pct: 100, solvTarget: 60, oneReachTargetKm: 1.5 },
  // Less dense, fewer cafés competing → more #1 headroom.
  nilai: { innerTop3Pct: 100, solvTarget: 65, oneReachTargetKm: 2.0 },
};

export function goalForOutlet(outletName: string): GeoGoal {
  const lower = outletName.toLowerCase();
  for (const [match, goal] of Object.entries(OUTLET_GOALS)) {
    if (lower.includes(match)) return goal;
  }
  return DEFAULT_GOAL;
}
