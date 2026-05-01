"use client";

import { useState, useRef, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CameraCaptureModal } from "@/components/camera-capture-modal";
import {
  ArrowLeft, CheckCircle2, Loader2, Camera, X, MessageSquare, RotateCcw,
  Image as ImageIcon, Star, ThumbsUp, ThumbsDown, Minus, Building2,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

/* eslint-disable @next/next/no-img-element */

type AuditItem = {
  id: string;
  sectionName: string;
  itemTitle: string;
  sortOrder: number;
  photoRequired: boolean;
  ratingType: string;
  rating: number | null;
  notes: string | null;
  photos: string[];
};

type AuditDetail = {
  id: string;
  date: string;
  status: string;
  overallScore: number | null;
  overallNotes: string | null;
  completedAt: string | null;
  template: { id: string; name: string; description: string | null; roleType: string };
  outlet: { id: string; name: string; code: string };
  auditor: { id: string; name: string };
  items: AuditItem[];
};

export default function AuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: audit, isLoading, mutate } = useFetch<AuditDetail>(`/api/audits/${id}`);

  const [uploadingItem, setUploadingItem] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [overallNotes, setOverallNotes] = useState("");
  const [showComplete, setShowComplete] = useState(false);

  const activeItemRef = useRef<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const replacingPhotoRef = useRef<string | null>(null);

  const setRating = async (item: AuditItem, rating: number) => {
    // Optimistic update
    mutate((prev: AuditDetail | undefined) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((i) =>
          i.id === item.id ? { ...i, rating } : i
        ),
      };
    }, false);

    await fetch(`/api/audits/${id}/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
    });
    mutate();
  };

  const saveNote = async (itemId: string) => {
    setNotesOpen(null);
    mutate((prev: AuditDetail | undefined) => {
      if (!prev) return prev;
      return { ...prev, items: prev.items.map((i) => i.id === itemId ? { ...i, notes: noteText } : i) };
    }, false);
    setNoteText("");
    await fetch(`/api/audits/${id}/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: noteText }),
    });
    mutate();
  };

  const handlePhotoClick = (itemId: string) => {
    activeItemRef.current = itemId;
    setCameraOpen(true);
  };

  // Upload a captured photo blob and attach it to the active audit item
  const handleCameraCapture = async (blob: Blob) => {
    const itemId = activeItemRef.current;
    if (!itemId) return;

    setUploadingItem(itemId);
    try {
      const file = new File([blob], `audit-${itemId}-${Date.now()}.jpg`, { type: "image/jpeg" });
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) { alert(uploadData.error || "Upload failed"); return; }

      // If replacingPhotoRef is set, replace that specific photo instead of appending
      const replacing = replacingPhotoRef.current;
      replacingPhotoRef.current = null;
      const body = replacing
        ? { photos: ((audit?.items?.find((i) => i.id === itemId)?.photos) || []).map((p: string) => p === replacing ? uploadData.url : p) }
        : { addPhoto: uploadData.url };

      await fetch(`/api/audits/${id}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      mutate();
    } finally {
      setUploadingItem(null);
    }
  };

  const handleDeleteAuditPhoto = async (itemId: string, url: string) => {
    if (!window.confirm("Remove this photo?")) return;
    setUploadingItem(itemId);
    try {
      await fetch(`/api/audits/${id}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removePhoto: url }),
      });
      mutate();
    } finally {
      setUploadingItem(null);
    }
  };

  const handleRetakeAuditPhoto = (itemId: string, url: string) => {
    activeItemRef.current = itemId;
    replacingPhotoRef.current = url;
    setCameraOpen(true);
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await fetch(`/api/audits/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complete: true, overallNotes }),
      });
      mutate();
      setShowComplete(false);
    } finally {
      setCompleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!audit) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Audit not found</p>
        <Link href="/audit" className="mt-2 text-sm text-terracotta hover:underline">Back</Link>
      </div>
    );
  }

  const ratedCount = audit.items.filter((i) => i.rating !== null).length;
  const totalCount = audit.items.length;
  const progress = totalCount > 0 ? Math.round((ratedCount / totalCount) * 100) : 0;
  const isCompleted = audit.status === "COMPLETED";

  // Group items by section
  const sections: Record<string, AuditItem[]> = {};
  for (const item of audit.items) {
    if (!sections[item.sectionName]) sections[item.sectionName] = [];
    sections[item.sectionName].push(item);
  }

  return (
    <div className="p-4 lg:p-6">
      {/* Fullscreen camera modal — getUserMedia-based, 100% camera-only.
          Replaces the legacy <input type="file" capture> path. */}
      <CameraCaptureModal
        open={cameraOpen}
        facingMode="environment"
        title="Audit Photo"
        onCapture={handleCameraCapture}
        onClose={() => setCameraOpen(false)}
      />

      {/* Photo preview */}
      {photoPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setPhotoPreview(null)}>
          <button className="absolute top-4 right-4 text-white" onClick={() => setPhotoPreview(null)}>
            <X className="h-6 w-6" />
          </button>
          <img src={photoPreview} alt="Photo" className="max-h-[80vh] max-w-[90vw] rounded-lg" />
        </div>
      )}

      {/* Header */}
      <div className="mb-4">
        <Link href="/audit" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="h-4 w-4" />Back to Audits
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-foreground">{audit.template.name}</h1>
          <Badge className={isCompleted ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}>
            {isCompleted ? "Completed" : "In Progress"}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
          <Building2 className="h-3 w-3" />
          {audit.outlet.name} · {audit.date} · {audit.auditor.name}
        </p>
      </div>

      {/* Progress */}
      <Card className="mb-4">
        <CardContent className="p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">Progress</span>
            <span className="text-xs font-bold">{ratedCount}/{totalCount} items · {progress}%</span>
          </div>
          <div className="rounded-full bg-muted h-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${isCompleted ? "bg-green-500" : "bg-terracotta"}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          {isCompleted && audit.overallScore !== null && (
            <p className="mt-2 text-xs text-green-600 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Score: {audit.overallScore}%
              {audit.completedAt && ` · ${new Date(audit.completedAt).toLocaleString()}`}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Sections & Items */}
      {Object.entries(sections).map(([sectionName, items]) => (
        <div key={sectionName} className="mb-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            {sectionName}
          </h2>
          <div className="space-y-2">
            {items.map((item) => (
              <Card key={item.id} className={`transition-all ${item.rating !== null ? "opacity-80" : ""}`}>
                <CardContent className="p-0">
                  <div className="p-3">
                    {/* Item header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-foreground">{item.itemTitle}</h4>
                        {item.photoRequired && item.photos.length === 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-medium text-red-600 mt-1">
                            <Camera className="h-2.5 w-2.5" />Photo required
                          </span>
                        )}
                      </div>
                      {/* Action buttons */}
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => handlePhotoClick(item.id)}
                          disabled={uploadingItem === item.id || isCompleted}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40"
                        >
                          {uploadingItem === item.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : item.photos.length > 0 ? (
                            <ImageIcon className="h-3.5 w-3.5 text-green-500" />
                          ) : (
                            <Camera className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => {
                            setNotesOpen(notesOpen === item.id ? null : item.id);
                            setNoteText(item.notes ?? "");
                          }}
                          disabled={isCompleted}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40"
                        >
                          <MessageSquare className={`h-3.5 w-3.5 ${item.notes ? "text-blue-500" : ""}`} />
                        </button>
                      </div>
                    </div>

                    {/* Rating controls */}
                    <div className="mt-2">
                      {item.ratingType === "pass_fail" && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => !isCompleted && setRating(item, 1)}
                            disabled={isCompleted}
                            className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                              item.rating === 1
                                ? "bg-green-500 text-white shadow-sm"
                                : "bg-gray-100 text-gray-500 hover:bg-green-50 hover:text-green-600"
                            } disabled:opacity-60`}
                          >
                            <ThumbsUp className="h-3.5 w-3.5" /> Pass
                          </button>
                          <button
                            onClick={() => !isCompleted && setRating(item, 0)}
                            disabled={isCompleted}
                            className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                              item.rating === 0
                                ? "bg-red-500 text-white shadow-sm"
                                : "bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-600"
                            } disabled:opacity-60`}
                          >
                            <ThumbsDown className="h-3.5 w-3.5" /> Fail
                          </button>
                          <button
                            onClick={() => !isCompleted && setRating(item, -1)}
                            disabled={isCompleted}
                            className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                              item.rating === -1
                                ? "bg-gray-500 text-white shadow-sm"
                                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                            } disabled:opacity-60`}
                          >
                            <Minus className="h-3.5 w-3.5" /> N/A
                          </button>
                        </div>
                      )}
                      {item.ratingType === "rating_5" && (
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              onClick={() => !isCompleted && setRating(item, n)}
                              disabled={isCompleted}
                              className="transition-transform active:scale-90 disabled:opacity-60"
                            >
                              <Star
                                className={`h-6 w-6 ${
                                  item.rating !== null && n <= item.rating
                                    ? "fill-yellow-400 text-yellow-400"
                                    : "text-gray-300"
                                }`}
                              />
                            </button>
                          ))}
                        </div>
                      )}
                      {item.ratingType === "rating_3" && (
                        <div className="flex gap-2">
                          {[
                            { v: 3, label: "Good", color: "green" },
                            { v: 2, label: "Fair", color: "yellow" },
                            { v: 1, label: "Poor", color: "red" },
                          ].map((opt) => (
                            <button
                              key={opt.v}
                              onClick={() => !isCompleted && setRating(item, opt.v)}
                              disabled={isCompleted}
                              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                                item.rating === opt.v
                                  ? `bg-${opt.color}-500 text-white shadow-sm`
                                  : `bg-gray-100 text-gray-500 hover:bg-${opt.color}-50`
                              } disabled:opacity-60`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Notes display */}
                    {item.notes && notesOpen !== item.id && (
                      <p className="mt-2 text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">{item.notes}</p>
                    )}

                    {/* Photo thumbnails */}
                    {item.photos.length > 0 && (
                      <div className="mt-2 flex gap-2 overflow-x-auto">
                        {item.photos.map((url, idx) => (
                          <div key={idx} className="relative shrink-0">
                            <button onClick={() => setPhotoPreview(url)} aria-label="View photo">
                              <img
                                src={url}
                                alt={`Photo ${idx + 1}`}
                                className="h-14 w-14 rounded-lg object-cover border border-border hover:opacity-80 transition-opacity"
                              />
                            </button>
                            <button
                              onClick={() => handleDeleteAuditPhoto(item.id, url)}
                              disabled={uploadingItem === item.id}
                              aria-label="Delete photo"
                              className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white shadow-md hover:bg-red-700 disabled:opacity-50"
                            >
                              <X className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => handleRetakeAuditPhoto(item.id, url)}
                              disabled={uploadingItem === item.id}
                              aria-label="Retake photo"
                              title="Retake"
                              className="absolute -bottom-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-white shadow-md hover:bg-gray-900 disabled:opacity-50"
                            >
                              <RotateCcw className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Notes input */}
                  {notesOpen === item.id && (
                    <div className="border-t border-border px-3 py-3 bg-muted/30">
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="Add a note..."
                        rows={2}
                        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs resize-none"
                        autoFocus
                      />
                      <div className="mt-2 flex gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={() => setNotesOpen(null)}>Cancel</Button>
                        <Button size="sm" onClick={() => saveNote(item.id)} className="bg-terracotta hover:bg-terracotta-dark">
                          Save Note
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}

      {/* Complete button */}
      {!isCompleted && (
        <div className="mt-6">
          {!showComplete ? (
            <Button
              onClick={() => setShowComplete(true)}
              disabled={ratedCount === 0}
              className="w-full bg-terracotta hover:bg-terracotta-dark"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Complete Audit ({ratedCount}/{totalCount} rated)
            </Button>
          ) : (
            <Card className="p-4 space-y-3 border-terracotta/30">
              <h3 className="text-sm font-semibold">Complete Audit</h3>
              <textarea
                value={overallNotes}
                onChange={(e) => setOverallNotes(e.target.value)}
                placeholder="Overall notes or observations (optional)..."
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowComplete(false)} className="flex-1">
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleComplete}
                  disabled={completing}
                  className="bg-green-600 hover:bg-green-700 flex-1"
                >
                  {completing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                  Submit
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Overall notes (completed) */}
      {isCompleted && audit.overallNotes && (
        <Card className="mt-4">
          <CardContent className="p-3">
            <h3 className="text-xs font-medium mb-1">Overall Notes</h3>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{audit.overallNotes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
