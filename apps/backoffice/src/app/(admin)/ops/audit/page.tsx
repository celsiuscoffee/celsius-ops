"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2, Camera, Loader2,
  ChevronDown, ChevronRight, AlertCircle, Building2, User,
  X, ImageIcon,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import { KeyNumber } from "@/components/ui/key-number";
import { AuditNav } from "../_nav";

type Outlet = { id: string; code: string; name: string };

type ChecklistItem = {
  id: string; stepNumber: number; title: string; description: string | null;
  photoRequired: boolean; isCompleted: boolean;
  completedBy: { id: string; name: string } | null;
  completedAt: string | null; notes: string | null; photoUrl: string | null;
};

type Checklist = {
  id: string; date: string; shift: "OPENING" | "MIDDAY" | "CLOSING";
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  sop: { id: string; title: string; category: { name: string } };
  outlet: { id: string; code: string; name: string };
  assignedTo: { id: string; name: string } | null;
  completedBy: { id: string; name: string } | null;
  completedAt: string | null;
  items: ChecklistItem[];
  totalItems: number; completedItems: number; progress: number;
  photoRequired: number; photosUploaded: number; missingPhotos: number;
  hasIssues: boolean;
};

type AuditData = {
  summary: { total: number; completed: number; withIssues: number; totalPhotosRequired: number; totalPhotosUploaded: number };
  checklists: Checklist[];
};

const SHIFT_LABELS: Record<string, string> = { OPENING: "Opening", MIDDAY: "Midday", CLOSING: "Closing" };
const STATUS_LABELS: Record<string, string> = { PENDING: "Not started", IN_PROGRESS: "In progress", COMPLETED: "Finished" };
const time12 = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "Asia/Kuala_Lumpur", hour: "numeric", minute: "2-digit" });
const STATUS_COLORS: Record<string, string> = { PENDING: "bg-warn-soft text-warn-text", IN_PROGRESS: "bg-info-soft text-info-text", COMPLETED: "bg-ok-soft text-ok-text" };

export default function AuditPage() {
  const { data: outlets } = useFetch<Outlet[]>("/api/ops/outlets");
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }));
  const [outletId, setOutletId] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  let apiUrl = `/api/ops/audit?date=${date}`;
  if (outletId) apiUrl += `&outletId=${outletId}`;
  if (statusFilter !== "ALL") apiUrl += `&status=${statusFilter}`;

  const { data, isLoading } = useFetch<AuditData>(apiUrl);

  const toggle = (id: string) => setExpandedId(expandedId === id ? null : id);

  return (
    <div className="max-w-[1100px] space-y-5 px-4 pt-6 pb-10 md:px-8">
      <AuditNav />
      {/* Photo preview overlay */}
      {photoPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setPhotoPreview(null)}>
          <button className="absolute top-4 right-4 text-white" onClick={() => setPhotoPreview(null)}><X className="h-6 w-6" /></button>
          <img src={photoPreview} alt="Photo proof" className="max-h-[80vh] max-w-[90vw] rounded-lg" />
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Audits</h1>
          <p className="mt-0.5 text-sm text-text-2">Each checklist for the day, whether it was finished, and the photo proof behind it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Day" className="h-10 w-auto" />
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)} aria-label="Outlet" className="h-10 rounded-ctl border border-line bg-surface px-3 text-sm text-text">
            <option value="">All outlets</option>
            {outlets?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status" className="h-10 rounded-ctl border border-line bg-surface px-3 text-sm text-text">
            <option value="ALL">Any status</option>
            <option value="COMPLETED">Finished</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="PENDING">Not started</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-text-3" /></div>
      ) : !data ? (
        <p className="text-sm text-text-2">No checklists for this day.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KeyNumber label="Finished" value={`${data.summary.total > 0 ? Math.round((data.summary.completed / data.summary.total) * 100) : 0}%`}
              tone={data.summary.total > 0 && data.summary.completed < data.summary.total ? "warn" : undefined}
              note={<><b className="font-semibold text-text-2">{data.summary.completed}</b> of {data.summary.total} checklists</>} />
            <KeyNumber label="With problems" value={String(data.summary.withIssues)} tone={data.summary.withIssues > 0 ? "warn" : undefined}
              note={data.summary.withIssues > 0 ? "missing steps or photos" : "nothing to follow up"} />
            <KeyNumber label="Photos taken" value={`${data.summary.totalPhotosUploaded}/${data.summary.totalPhotosRequired}`}
              tone={data.summary.totalPhotosUploaded < data.summary.totalPhotosRequired ? "warn" : undefined}
              note={`${Math.max(0, data.summary.totalPhotosRequired - data.summary.totalPhotosUploaded)} still missing`} />
            <KeyNumber label="Not started" value={String(data.checklists.filter((c) => c.status === "PENDING").length)}
              tone={data.checklists.some((c) => c.status === "PENDING") ? "warn" : undefined}
              note="no step ticked yet" />
          </div>

          {/* Checklists */}
          {data.checklists.length === 0 ? (
            <p className="rounded-card border border-line bg-surface py-12 text-center text-sm text-text-2">No checklists for this day.</p>
          ) : (
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              {data.checklists.map((cl) => (
                <div key={cl.id} className="border-b border-line last:border-b-0">
                  <div>
                    {/* Checklist header — clickable */}
                    <button onClick={() => toggle(cl.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-sunken/50">
                      {expandedId === cl.id ? <ChevronDown className="h-4 w-4 text-text-3 shrink-0" /> : <ChevronRight className="h-4 w-4 text-text-3 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-text">{cl.sop.title}</span>
                          <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] text-text-2">{SHIFT_LABELS[cl.shift]}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_COLORS[cl.status]}`}>{STATUS_LABELS[cl.status]}</span>
                          {cl.missingPhotos > 0 && (
                            <span className="flex items-center gap-0.5 text-[11px] font-medium text-warn-text">
                              <AlertCircle className="h-3 w-3" />{cl.missingPhotos} photo{cl.missingPhotos !== 1 ? "s" : ""} missing
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[12px] text-text-3">
                          <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{cl.outlet.name}</span>
                          {cl.assignedTo && <span className="flex items-center gap-1"><User className="h-3 w-3" />{cl.assignedTo.name}</span>}
                          <span>{cl.completedItems}/{cl.totalItems} {cl.totalItems === 1 ? 'item' : 'items'}</span>
                          {cl.completedAt && <span>Finished {time12(cl.completedAt)}</span>}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`font-mono text-sm font-semibold ${cl.progress === 100 ? "text-ok-text" : cl.progress > 0 ? "text-text" : "text-text-3"}`}>{cl.progress}%</p>
                      </div>
                    </button>

                    {/* Expanded — item details */}
                    {expandedId === cl.id && (
                      <div className="border-t border-line px-4 py-3 bg-sunken/30">
                        <div className="space-y-1">
                          {cl.items.map((item) => (
                            <div key={item.id} className={`flex items-start gap-3 rounded-lg p-2.5 ${
                              item.photoRequired && !item.photoUrl ? "bg-danger-soft" : ""
                            }`}>
                              {/* Status icon */}
                              {item.isCompleted ? (
                                <CheckCircle2 className="h-4 w-4 text-ok-text shrink-0 mt-0.5" />
                              ) : (
                                <div className="h-4 w-4 rounded-full border-2 border-line-2 shrink-0 mt-0.5" />
                              )}

                              {/* Content */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-text-3">#{item.stepNumber}</span>
                                  <span className={`text-sm ${item.isCompleted ? "text-text-2" : "text-text-2"}`}>{item.title}</span>
                                  {item.photoRequired && !item.photoUrl && (
                                    <span className="flex items-center gap-0.5 rounded-full bg-danger-soft px-1.5 py-0.5 text-[9px] text-danger-text font-medium">
                                      <Camera className="h-2.5 w-2.5" />Missing
                                    </span>
                                  )}
                                  {item.photoRequired && item.photoUrl && (
                                    <span className="flex items-center gap-0.5 rounded-full bg-ok-soft px-1.5 py-0.5 text-[9px] text-ok-text font-medium">
                                      <Camera className="h-2.5 w-2.5" />OK
                                    </span>
                                  )}
                                </div>
                                {item.completedBy && (
                                  <p className="text-[10px] text-text-3 mt-0.5">
                                    {item.completedBy.name}
                                    {item.completedAt && ` · ${time12(item.completedAt)}`}
                                  </p>
                                )}
                                {item.notes && (
                                  <p className="text-xs text-info-text bg-info-soft rounded px-2 py-1 mt-1">{item.notes}</p>
                                )}
                              </div>

                              {/* Photo thumbnail */}
                              {item.photoUrl && (
                                <button onClick={() => setPhotoPreview(item.photoUrl)} className="shrink-0">
                                  <img src={item.photoUrl} alt="Proof" className="h-12 w-12 rounded-lg object-cover border border-line hover:opacity-80 transition-opacity" />
                                </button>
                              )}
                              {item.photoRequired && !item.photoUrl && (
                                <div className="h-12 w-12 rounded-lg border-2 border-dashed border-danger/30 flex items-center justify-center shrink-0">
                                  <ImageIcon className="h-4 w-4 text-danger-text" />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
