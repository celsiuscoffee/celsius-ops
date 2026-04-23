"use client";

/* eslint-disable @next/next/no-img-element */

import { useState, use } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Loader2, Building2, User, Camera, CheckCircle2, XCircle,
  Star, Clock, ImageIcon, X, AlertCircle, Printer,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type ReportItem = {
  id: string;
  title: string;
  ratingType: "pass_fail" | "rating_5" | "rating_3";
  rating: number | null;
  notes: string | null;
  photos: string[];
  photoRequired: boolean;
};

type Section = { name: string; items: ReportItem[] };

type Report = {
  id: string;
  date: string;
  status: "IN_PROGRESS" | "COMPLETED";
  overallScore: number | null;
  overallNotes: string | null;
  completedAt: string | null;
  createdAt: string;
  template: { id: string; name: string; description: string | null; roleType: string; version: number };
  outlet: { id: string; name: string; code: string };
  auditor: { id: string; name: string; role: string };
  sections: Section[];
  summary: {
    totalItems: number;
    ratedItems: number;
    passed: number;
    failed: number;
    totalPhotos: number;
    missingPhotos: number;
    progress: number;
  };
};

const ROLE_LABELS: Record<string, string> = {
  chef_head: "Head of Chef",
  barista_head: "Head of Barista",
  area_manager: "Area Manager",
};

const ROLE_COLORS: Record<string, string> = {
  chef_head: "bg-orange-100 text-orange-700",
  barista_head: "bg-amber-100 text-amber-700",
  area_manager: "bg-blue-100 text-blue-700",
};

function renderRating(item: ReportItem) {
  if (item.rating === null) {
    return <span className="text-xs text-gray-400">Not rated</span>;
  }
  if (item.ratingType === "pass_fail") {
    return item.rating === 1 ? (
      <span className="flex items-center gap-1 text-xs font-medium text-green-600">
        <CheckCircle2 className="h-4 w-4" /> Pass
      </span>
    ) : (
      <span className="flex items-center gap-1 text-xs font-medium text-red-600">
        <XCircle className="h-4 w-4" /> Fail
      </span>
    );
  }
  if (item.ratingType === "rating_5") {
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            className={`h-4 w-4 ${
              n <= (item.rating ?? 0)
                ? "fill-amber-400 text-amber-400"
                : "text-gray-200"
            }`}
          />
        ))}
        <span className="ml-1 text-xs text-gray-500">{item.rating}/5</span>
      </div>
    );
  }
  if (item.ratingType === "rating_3") {
    const labels = ["", "Poor", "Fair", "Good"];
    const colors = ["", "text-red-600", "text-amber-600", "text-green-600"];
    return (
      <span className={`text-xs font-medium ${colors[item.rating] ?? "text-gray-600"}`}>
        {labels[item.rating] ?? item.rating}
      </span>
    );
  }
  return <span className="text-xs">{item.rating}</span>;
}

export default function AuditReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: report, isLoading } = useFetch<Report>(
    `/api/ops/audit-reports/${id}`,
  );
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">Audit report not found</p>
            <Link
              href="/ops/audit-reports"
              className="mt-3 inline-block text-sm text-terracotta hover:underline"
            >
              ← Back to reports
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isDone = report.status === "COMPLETED";

  return (
    <div className="p-3 sm:p-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <Link
            href="/ops/audit-reports"
            className="mb-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-3 w-3" /> All audit reports
          </Link>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold text-gray-900">
              {report.template.name}
            </h2>
            <Badge className={`text-[10px] ${ROLE_COLORS[report.template.roleType]}`}>
              {ROLE_LABELS[report.template.roleType] ?? report.template.roleType}
            </Badge>
            <Badge className={`text-[10px] ${isDone ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
              {isDone ? (
                <><CheckCircle2 className="mr-0.5 h-3 w-3" /> Completed</>
              ) : (
                <><Clock className="mr-0.5 h-3 w-3" /> In Progress</>
              )}
            </Badge>
          </div>
          {report.template.description && (
            <p className="mt-1 text-sm text-gray-500">{report.template.description}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Building2 className="h-3 w-3" /> {report.outlet.name}
            </span>
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" /> {report.auditor.name}
            </span>
            <span>Date: {report.date}</span>
            {report.completedAt && (
              <span>Completed: {new Date(report.completedAt).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur" })}</span>
            )}
          </div>
        </div>

        <Button
          variant="outline"
          onClick={() => window.print()}
          className="shrink-0"
        >
          <Printer className="mr-1.5 h-4 w-4" /> Print
        </Button>
      </div>

      {/* Summary */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card><CardContent className="p-3">
          <div className="text-[11px] font-medium text-gray-500">Overall Score</div>
          <div className="mt-0.5 text-xl font-semibold">
            {report.overallScore !== null ? report.overallScore.toFixed(1) : "—"}
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[11px] font-medium text-gray-500">Items Rated</div>
          <div className="mt-0.5 text-xl font-semibold">
            {report.summary.ratedItems}
            <span className="ml-1 text-xs font-normal text-gray-400">/ {report.summary.totalItems}</span>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[11px] font-medium text-gray-500">Pass / Fail</div>
          <div className="mt-0.5 text-xl font-semibold">
            <span className="text-green-600">{report.summary.passed}</span>
            <span className="mx-1 text-gray-300">/</span>
            <span className="text-red-600">{report.summary.failed}</span>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[11px] font-medium text-gray-500">Photos</div>
          <div className="mt-0.5 text-xl font-semibold">{report.summary.totalPhotos}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[11px] font-medium text-gray-500">Missing Photos</div>
          <div className={`mt-0.5 text-xl font-semibold ${report.summary.missingPhotos > 0 ? "text-amber-600" : "text-gray-900"}`}>
            {report.summary.missingPhotos}
          </div>
        </CardContent></Card>
      </div>

      {/* Overall notes */}
      {report.overallNotes && (
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Auditor Notes
            </div>
            <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">
              {report.overallNotes}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Sections */}
      <div className="space-y-4">
        {report.sections.map((sec) => (
          <Card key={sec.name}>
            <CardContent className="p-0">
              <div className="border-b border-gray-100 px-4 py-3">
                <h3 className="text-sm font-semibold text-gray-900">{sec.name}</h3>
                <p className="text-[11px] text-gray-500">
                  {sec.items.length} item{sec.items.length !== 1 ? "s" : ""}
                </p>
              </div>

              <div className="divide-y divide-gray-100">
                {sec.items.map((item) => (
                  <div key={item.id} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900">{item.title}</span>
                          {item.photoRequired && (
                            <Badge className="text-[9px] bg-gray-100 text-gray-600">
                              <Camera className="mr-0.5 h-2.5 w-2.5" /> Photo required
                            </Badge>
                          )}
                          {item.photoRequired && item.photos.length === 0 && (
                            <Badge className="text-[9px] bg-amber-100 text-amber-700">
                              Missing photo
                            </Badge>
                          )}
                        </div>
                        {item.notes && (
                          <p className="mt-1 text-xs text-gray-600 whitespace-pre-wrap">
                            {item.notes}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0">{renderRating(item)}</div>
                    </div>

                    {/* Photos */}
                    {item.photos.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {item.photos.map((url, idx) => (
                          <button
                            key={idx}
                            onClick={() => setPhotoPreview(url)}
                            className="relative h-20 w-20 overflow-hidden rounded-md border border-gray-200 bg-gray-50 hover:opacity-80"
                          >
                            <img
                              src={url}
                              alt={`${item.title} photo ${idx + 1}`}
                              className="h-full w-full object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {sec.items.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-gray-400">
                    <ImageIcon className="mx-auto mb-1 h-5 w-5" />
                    No items
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Photo preview modal */}
      {photoPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPhotoPreview(null)}
        >
          <button
            onClick={() => setPhotoPreview(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={photoPreview}
            alt="Audit photo"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
