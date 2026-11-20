import { useQuery } from "@tanstack/react-query";
import { useStaff } from "../store";
import { canApprove } from "./approvals";
import { fetchApprovals } from "./approvals-api";

export const APPROVALS_KEY = ["hr-approvals"] as const;

/**
 * One query for the Approvals screen and the Me / Today rows, so the count on
 * the row is the count on the screen. Off for anyone the endpoints would
 * refuse (not OWNER / ADMIN / MANAGER).
 */
export function useApprovals() {
  const session = useStaff((s) => s.session);
  const enabled = !!session && canApprove(session.role);
  const query = useQuery({
    queryKey: [...APPROVALS_KEY, session?.userId ?? ""],
    queryFn: () => fetchApprovals({ id: session!.userId, role: session!.role }),
    enabled,
  });
  return { ...query, enabled };
}
