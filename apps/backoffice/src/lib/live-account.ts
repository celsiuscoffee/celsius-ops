// The account re-check every backoffice session goes through, cookie or
// Bearer: a deleted or deactivated account gets no session, and the role is
// the one on the user row now (a demotion or promotion since login applies
// within a minute), not the one baked into the token. Pure, so both auth
// paths share it and a test pins it.
export type LiveAccountState = { role: string; active: boolean };

export function applyLiveAccountState<S extends { role: string }>(
  session: S,
  live: LiveAccountState | null,
): S | null {
  if (live === null) return null; // account deleted
  if (!live.active) return null; // deactivated / resigned
  if (live.role && live.role !== session.role) return { ...session, role: live.role };
  return session;
}
