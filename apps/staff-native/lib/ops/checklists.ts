import { api } from "../api";

export type ChecklistStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED";
export type ChecklistShift = "OPENING" | "MIDDAY" | "CLOSING";

export type ChecklistSummary = {
  id: string;
  date: string;
  shift: ChecklistShift;
  status: ChecklistStatus;
  timeSlot: string | null;
  dueAt: string | null;
  sop: { id: string; title: string; category: { name: string } };
  outlet: { id: string; code: string; name: string };
  assignedTo: { id: string; name: string } | null;
  // Whole-outlet work (opening/closing/cleaning) anyone on shift owns. Shared
  // checklists appear in everyone's "Mine" tab, not just the auto-assigned owner.
  shared: boolean;
  completedBy: { id: string; name: string } | null;
  totalItems: number;
  completedItems: number;
  // How many items on this checklist the calling user has ticked off.
  // 0 if the user hasn't touched it yet. Used to show personal
  // contribution alongside the team total.
  myCompletedItems: number;
  progress: number;
};

export type ChecklistItem = {
  id: string;
  stepNumber: number;
  title: string;
  description: string | null;
  photoRequired: boolean;
  isCompleted: boolean;
  completedBy: { id: string; name: string } | null;
  completedAt: string | null;
  notes: string | null;
  photoUrl: string | null;
};

export type ChecklistDetail = {
  id: string;
  date: string;
  shift: ChecklistShift;
  status: ChecklistStatus;
  sop: {
    id: string;
    title: string;
    description: string | null;
    content: string | null;
    category: { name: string };
  };
  outlet: { id: string; code: string; name: string };
  assignedTo: { id: string; name: string } | null;
  completedBy: { id: string; name: string } | null;
  completedAt: string | null;
  notes: string | null;
  items: ChecklistItem[];
};

export function listChecklists(params: { date?: string; outletId?: string; mine?: boolean }) {
  const qs = new URLSearchParams();
  if (params.date) qs.set("date", params.date);
  if (params.outletId) qs.set("outletId", params.outletId);
  if (params.mine) qs.set("mine", "true");
  return api<ChecklistSummary[]>(`/api/checklists?${qs.toString()}`);
}

export function getChecklist(id: string) {
  return api<ChecklistDetail>(`/api/checklists/${id}`);
}

export function updateChecklistItem(
  id: string,
  itemId: string,
  body: { isCompleted?: boolean; notes?: string | null; photoUrl?: string | null },
) {
  return api<{ success: boolean }>(`/api/checklists/${id}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function generateChecklists(input: { outletId: string; date: string }) {
  return api<{ success: boolean }>("/api/checklists/generate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
