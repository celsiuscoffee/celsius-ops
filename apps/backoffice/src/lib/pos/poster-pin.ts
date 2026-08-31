/**
 * Campaign pins for the poster autopilot.
 *
 * The autopilot rewrites `active` + `sort_order` on every poster it manages,
 * every morning. That is right for the standing AOV rotation and wrong for a
 * campaign: hand-curating a launch in the CMS used to be undone at the next
 * 07:00 run. A pin is the operator saying "this one is mine until the campaign
 * ends", and it beats the rotation for that window.
 *
 * Only a BOUNDED window pins, i.e. `ends_at` is set. An open-ended start date
 * is just a delayed poster and stays autopilot-managed once it starts, so a
 * half-filled schedule can never freeze a surface forever. Once `ends_at`
 * passes, the poster drops back under autopilot control and gets scored (and
 * usually benched) like any other, which is what returns the surface to normal
 * on its own the morning after a campaign.
 *
 * Kept in its own module, free of DB imports, so the rule is unit-testable.
 */

/**
 *   managed     → autopilot owns active + sort_order, exactly as before
 *   pinned      → scheduled, not showing yet; autopilot must not write to it
 *   pinned-live → showing now; also benches every unpinned poster on the surface
 */
export type PinState = "managed" | "pinned" | "pinned-live";

export type PinnablePoster = {
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
};

export function pinStateOf(po: PinnablePoster, nowMs: number): PinState {
  if (!po.ends_at) return "managed";
  const endsMs = Date.parse(po.ends_at);
  // An unparseable or already-past end date releases the poster rather than
  // stranding the surface on a campaign nobody can see.
  if (!Number.isFinite(endsMs) || endsMs < nowMs) return "managed";

  const startsMs = po.starts_at ? Date.parse(po.starts_at) : null;
  const started = startsMs === null || !Number.isFinite(startsMs) || startsMs <= nowMs;

  // A pin the operator has switched off is still off. It holds its slot against
  // the autopilot but does not claim the surface.
  return po.active && started ? "pinned-live" : "pinned";
}
