import { describe, expect, it } from "vitest";
import { HR_DOC_MAX_BYTES, checkHrDocumentFile } from "./document-upload";

describe("checkHrDocumentFile", () => {
  it("derives the stored extension from the MIME type, not the filename", () => {
    const r = checkHrDocumentFile({ size: 10, type: "image/jpeg", name: "payslip.html" });
    expect(r).toEqual({ ok: true, ext: "jpg", contentType: "image/jpeg" });
  });
  it("rejects executables, HTML, empty and oversized files", () => {
    expect(checkHrDocumentFile({ size: 10, type: "text/html", name: "x.pdf" }).ok).toBe(false);
    expect(checkHrDocumentFile({ size: 10, type: "", name: "x.exe" }).ok).toBe(false);
    expect(checkHrDocumentFile({ size: 0, type: "application/pdf", name: "x.pdf" }).ok).toBe(false);
    expect(checkHrDocumentFile({ size: HR_DOC_MAX_BYTES + 1, type: "application/pdf", name: "x.pdf" }).ok).toBe(false);
  });
});
