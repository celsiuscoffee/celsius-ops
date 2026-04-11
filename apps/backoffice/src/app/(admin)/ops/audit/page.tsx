"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, Clock, AlertTriangle, Camera, Loader2,
  ChevronDown, ChevronRight, AlertCircle, Building2, User,
  X, ImageIcon,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

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
const SHIFT_COLORS: Record<string, string> = { OPENING: "bg-amber-100 text-amber-700", MIDDAY: "bg-blue-100 text-blue-700", CLOSING: "bg-purple-100 text-purple-700" };
const STATUS_COLORS: Record<string, string> = { PENDING: "bg-yellow-100 text-yellow-700", IN_PROGRESS: "bg-blue-100 text-blue-700", COMPLETED: "bg-green-100 text-green-700" };

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
    <div className="p-6">
      {/* Photo preview overlay */}
      {photoPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setPhotoPreview(null)}>
          <button className="absolute top-4 right-4 text-white" onClick={() => setPhotoPreview(null)}><X className="h-6 w-6" /></button>
          <img src={photoPreview} alt="Photo proof" className="max-h-[80vh] max-w-[90vw] rounded-lg" />
        </div>
      )}

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Checklist Audit</h2>
        <p className="mt-0.5 text-sm text-gray-500">Review completed checklists and photo evidence</p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
        <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="rounded-md border border-gray-200 px-3 py-2 text-sm">
          <option value="">All Outlets</option>
          {outlets?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-gray-200 px-3 py-2 text-sm">
          <option value="ALL">All Status</option>
          <option value="COMPLETED">Completed</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="PENDING">Pending</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-terracotta" /></div>
      ) : !data ? (
        <p className="text-sm text-gray-500">No data</p>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-4 mb-6">
            <Card><CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-terracotta/10 p-2"><CheckCircle2 className="h-5 w-5 text-terracotta" /></div>
              <div><p className="text-2xl font-bold text-gray-900">{data.summary.completed}/{data.summary.total}</p>
                <p className="text-xs text-gray-500">Completed</p></div>
            </CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4">
              <div className={`rounded-lg p-2 ${data.summary.withIssues > 0 ? "bg-red-100" : "bg-green-100"}`}>
                <AlertTriangle className={`h-5 w-5 ${data.summary.withIssues > 0 ? "text-red-500" : "text-green-500"}`} />
              </div>
              <div><p className="text-2xl font-bold text-gray-900">{data.summary.withIssues}</p>
                <p className="text-xs text-gray-500">With Issues</p></div>
            </CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-blue-100 p-2"><Camera className="h-5 w-5 text-blue-500" /></div>
              <div><p className="text-2xl font-bold text-gray-900">{data.summary.totalPhotosUploaded}/{data.summary.totalPhotosRequired}</p>
                <p className="text-xs text-gray-500">Photos Captured</p></div>
            </CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-gray-100 p-2"><Clock className="h-5 w-5 text-gray-500" /></div>
              <div><p className="text-2xl font-bold text-gray-900">{data.summary.total > 0 ? Math.round((data.summary.completed / data.summary.total) * 100) : 0}%</p>
                <p className="text-xs text-gray-500">Completion Rate</p></div>
            </CardContent></Card>
          </div>

          {/* Checklists */}
          {data.checklists.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm text-gray-500">No checklists for this date</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {data.checklists.map((cl) => (
                <Card key={cl.id} className={cl.hasIssues && cl.status !== "COMPLETED" ? "border-l-4 border-l-red-400" : cl.status === "COMPLETED" ? "border-l-4 border-l-green-400" : ""}>
                  <CardContent className="p-0">
                    {/* Checklist header — clickable */}
                    <button onClick={() => toggle(cl.id)} className="flex w-full items-center gap-4 p-4 text-left hover:bg-gray-50/50 transition-colors">
                      {expandedId === cl.id ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-gray-900">{cl.sop.title}</span>
                          <Badge className={`text-[10px] ${SHIFT_COLORS[cl.shift]}`}>{SHIFT_LABELS[cl.shift]}</Badge>
                          <Badge className={`text-[10px] ${STATUS_COLORS[cl.status]}`}>{cl.status.replace("_", " ")}</Badge>
                          {cl.missingPhotos > 0 && (
                            <span className="flex items-center gap-0.5 text-[10px] text-red-500 font-medium">
                              <AlertCircle className="h-3 w-3" />{cl.missingPhotos} photo{cl.missingPhotos !== 1 ? "s" : ""} missing
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-4 text-xs text-gray-400">
                          <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{cl.outlet.name}</span>
                          {cl.assignedTo && <span className="flex items-center gap-1"><User className="h-3 w-3" />{cl.assignedTo.name}</span>}
                          <span>{cl.completedItems}/{cl.totalItems} {cl.totalItems === 1 ? 'item' : 'items'}</span>
                          {cl.completedAt && <span>Completed {new Date(cl.completedAt).toLocaleTimeString()}</span>}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-lg font-bold ${cl.progress === 100 ? "text-green-600" : cl.progress > 0 ? "text-blue-600" : "text-gray-400"}`}>{cl.progress}%</p>
                      </div>
                    </button>

                    {/* Expanded — item details */}
                    {expandedId === cl.id && (
                      <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/30">
                        <div className="space-y-1">
                          {cl.items.map((item) => (
                            <div key={item.id} className={`flex items-start gap-3 rounded-lg p-2.5 ${
                              item.photoRequired && !item.photoUrl ? "bg-red-50/50" : ""
                            }`}>
                              {/* Status icon */}
                              {item.isCompleted ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                              ) : (
                                <div className="h-4 w-4 rounded-full border-2 border-gray-300 shrink-0 mt-0.5" />
                              )}

                              {/* Content */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-gray-400">#{item.stepNumber}</span>
                                  <span className={`text-sm ${item.isCompleted ? "text-gray-700" : "text-gray-500"}`}>{item.title}</span>
                                  {item.photoRequired && !item.photoUrl && (
                                    <span className="flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] text-red-600 font-medium">
                                      <Camera className="h-2.5 w-2.5" />Missing
                                    </span>
                                  )}
                                  {item.photoRequired && item.photoUrl && (
                                    <span className="flex items-center gap-0.5 rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] text-green-600 font-medium">
                                      <Camera className="h-2.5 w-2.5" />OK
                                    </span>
                                  )}
                                </div>
                                {item.completedBy && (
                                  <p className="text-[10px] text-gray-400 mt-0.5">
                                    {item.completedBy.name}
                                    {item.completedAt && ` · ${new Date(item.completedAt).toLocaleTimeString()}`}
                                  </p>
                                )}
                                {item.notes && (
                                  <p className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1 mt-1">{item.notes}</p>
                                )}
                              </div>

                              {/* Photo thumbnail */}
                              {item.photoUrl && (
                                <button onClick={() => setPhotoPreview(item.photoUrl)} className="shrink-0">
                                  <img src={item.photoUrl} alt="Proof" className="h-12 w-12 rounded-lg object-cover border border-gray-200 hover:opacity-80 transition-opacity" />
                                </button>
                              )}
                              {item.photoRequired && !item.photoUrl && (
                                <div className="h-12 w-12 rounded-lg border-2 border-dashed border-red-300 flex items-center justify-center shrink-0">
                                  <ImageIcon className="h-4 w-4 text-red-300" />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
