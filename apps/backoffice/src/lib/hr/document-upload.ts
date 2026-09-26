/**
 * Validation for employee-document uploads into the private `hr-documents`
 * bucket. Same shape as the inventory/upload checks: size cap, MIME
 * allow-list, and the stored extension derived from the MIME type rather
 * than from the client's filename.
 */

export const HR_DOC_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export type HrDocFileCheck = { ok: true; ext: string; contentType: string } | { ok: false; error: string };

export function checkHrDocumentFile(file: { size: number; type: string; name: string }): HrDocFileCheck {
  if (file.size <= 0) return { ok: false, error: "Empty file" };
  if (file.size > HR_DOC_MAX_BYTES) {
    return { ok: false, error: `File too large (max ${Math.round(HR_DOC_MAX_BYTES / 1024 / 1024)} MB)` };
  }
  const type = (file.type || "").toLowerCase().split(";")[0].trim();
  const ext = EXT_BY_MIME[type];
  if (!ext) {
    return { ok: false, error: `Unsupported file type${type ? ` (${type})` : ""}: upload a PDF or an image` };
  }
  return { ok: true, ext, contentType: type };
}
