import { api } from "../api";

export type AuditStatus = "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export type AuditListItem = {
  id: string;
  date: string;
  status: AuditStatus | string;
  overallScore: number | null;
  completedAt: string | null;
  template: { id: string; name: string; roleType: string | null };
  outlet: { id: string; name: string; code: string };
  auditor: { id: string; name: string };
  isMine: boolean;
  totalItems: number;
  completedItems: number;
  progress: number;
};

export type AuditItem = {
  id: string;
  sectionName: string;
  itemTitle: string;
  sortOrder: number;
  photoRequired: boolean;
  ratingType: "pass_fail" | "rating_3" | "rating_5" | string;
  rating: number | null;
  notes: string | null;
  photos: string[];
};

export type AuditDetail = {
  id: string;
  date: string;
  status: AuditStatus | string;
  overallScore: number | null;
  overallNotes: string | null;
  completedAt: string | null;
  template: { id: string; name: string; description: string | null; roleType: string | null };
  outlet: { id: string; name: string; code: string };
  auditor: { id: string; name: string };
  items: AuditItem[];
};

export type AuditTemplate = {
  id: string;
  name: string;
  description: string | null;
  roleType: string | null;
  auditTarget: "OUTLET" | "STAFF" | string;
  jobRoleFilter: string[];
  sections: { id: string; name: string; _count: { items: number } }[];
  _count: { reports: number };
};

export type AuditOutlet = { id: string; name: string; code: string };

export type AuditAuditee = { id: string; name: string; position: string | null };

export type AuditInsight = {
  severity: "high" | "medium" | "low";
  finding: string;
  action: string;
  category: string;
};

export type AuditInsightsResponse = {
  focus: string;
  summary: string;
  insights: AuditInsight[];
  basedOnAudits: number;
  lastAuditDate: string | null;
};

export function listAudits(status?: string) {
  const q = status && status !== "all" ? `?status=${status}` : "";
  return api<AuditListItem[]>(`/api/audits${q}`);
}

export function getAudit(id: string) {
  return api<AuditDetail>(`/api/audits/${id}`);
}

export function updateAuditItem(
  reportId: string,
  itemId: string,
  body: {
    rating?: number | null;
    notes?: string | null;
    photos?: string[];
    addPhoto?: string;
    removePhoto?: string;
  },
) {
  return api<{
    item: { id: string; rating: number | null; notes: string | null; photos: string[] };
    progress: { total: number; rated: number; percent: number };
  }>(`/api/audits/${reportId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function completeAudit(id: string, overallNotes?: string) {
  return api<{ id: string; status: string; overallScore: number | null }>(
    `/api/audits/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ complete: true, overallNotes }),
    },
  );
}

export function updateAuditNotes(id: string, overallNotes: string) {
  return api<{ id: string; status: string; overallScore: number | null }>(
    `/api/audits/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ overallNotes }),
    },
  );
}

export function listAuditTemplates(roleType?: string) {
  const q = roleType ? `?roleType=${roleType}` : "";
  return api<AuditTemplate[]>(`/api/audits/templates${q}`);
}

export function listAuditOutlets() {
  return api<AuditOutlet[]>("/api/audits/outlets");
}

export function listAuditees(templateId: string, outletId: string) {
  return api<AuditAuditee[]>(
    `/api/audits/auditees?templateId=${templateId}&outletId=${outletId}`,
  );
}

export function createAudit(input: {
  templateId: string;
  outletId: string;
  auditeeId?: string;
}) {
  return api<{ id: string }>("/api/audits", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getAuditInsights(outletId?: string) {
  const q = outletId ? `?outletId=${outletId}` : "";
  return api<AuditInsightsResponse>(`/api/audits/insights${q}`);
}

// Per-staff audit coverage, answers "who hasn't been audited yet, and
// how did the ones audited do?". Returned per active STAFF template.
export type AuditCoverageStatus = "never" | "stale" | "recent";

export type AuditCoverageAuditee = {
  userId: string;
  name: string;
  position: string | null;
  status: AuditCoverageStatus;
  lastAudit: {
    reportId: string;
    date: string;            // YYYY-MM-DD
    overallScore: number | null;
  } | null;
};

export type AuditCoverageTemplate = {
  id: string;
  name: string;
  description: string | null;
  jobRoleFilter: string[];
  totals: {
    eligible: number;
    recent: number;
    stale: number;
    never: number;
    avgScore: number | null;
  };
  auditees: AuditCoverageAuditee[];
};

export type AuditCoverageResponse = {
  templates: AuditCoverageTemplate[];
  windowDays: number;
};

export function fetchAuditCoverage(opts?: { outletId?: string; windowDays?: number }) {
  const params = new URLSearchParams();
  if (opts?.outletId) params.set("outletId", opts.outletId);
  if (opts?.windowDays) params.set("windowDays", String(opts.windowDays));
  const q = params.toString();
  return api<AuditCoverageResponse>(`/api/audits/coverage${q ? `?${q}` : ""}`);
}
