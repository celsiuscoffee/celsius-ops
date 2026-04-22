import { PDFDocument } from "pdf-lib";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL || "";
const supabaseKey = process.env.LOYALTY_SUPABASE_SERVICE_ROLE_KEY || "";

const BUCKET = "invoices";

function getSupabase() {
  if (!supabaseUrl || !supabaseKey) throw new Error("Supabase not configured");
  return createClient(supabaseUrl, supabaseKey);
}

/**
 * Split a PDF buffer into individual single-page PDF buffers.
 * Returns array of Buffers, one per page.
 */
export async function splitPdfPages(pdfBuffer: Buffer): Promise<Buffer[]> {
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const pageCount = srcDoc.getPageCount();

  if (pageCount <= 1) {
    return [pdfBuffer]; // Single page — no split needed
  }

  const pages: Buffer[] = [];
  for (let i = 0; i < pageCount; i++) {
    const newDoc = await PDFDocument.create();
    const [copiedPage] = await newDoc.copyPages(srcDoc, [i]);
    newDoc.addPage(copiedPage);
    const bytes = await newDoc.save();
    pages.push(Buffer.from(bytes));
  }

  return pages;
}

/**
 * Split a PDF into individual pages and upload each to Supabase Storage.
 * Returns array of public URLs, one per page.
 */
export async function splitAndUploadPdfPages(
  pdfBuffer: Buffer,
  baseFileName: string,
): Promise<string[]> {
  const pages = await splitPdfPages(pdfBuffer);

  // Single page — upload as-is
  if (pages.length === 1) {
    const url = await uploadToStorage(pages[0], `pop/${baseFileName}.pdf`, "application/pdf");
    return [url];
  }

  // Multi-page — upload each separately
  const urls: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const url = await uploadToStorage(
      pages[i],
      `pop/${baseFileName}-page${i + 1}.pdf`,
      "application/pdf",
    );
    urls.push(url);
  }

  return urls;
}

/**
 * Move a file within the `invoices` bucket. Rewrites the object path (e.g.
 * renaming `pop/pop-1776xxx.pdf` → `pop/2026-04-21_26-0374_BLANCOZ_RM240.pdf`)
 * and returns the new public URL. No-op if the file is hosted outside Supabase.
 */
export async function moveInStorage(
  currentUrl: string,
  newPath: string,
): Promise<string | null> {
  const supabase = getSupabase();

  // Extract current object path from a Supabase public URL:
  //   https://<ref>.supabase.co/storage/v1/object/public/invoices/pop/foo.pdf
  //   →  pop/foo.pdf
  const match = currentUrl.match(/\/storage\/v1\/object\/public\/invoices\/(.+)$/);
  if (!match) return null;
  const currentPath = decodeURIComponent(match[1]);
  if (currentPath === newPath) {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(newPath);
    return data.publicUrl;
  }

  const { error } = await supabase.storage.from(BUCKET).move(currentPath, newPath);
  if (error) {
    // If the target already exists (idempotent rerun), try copy-then-delete.
    if (/already exists/i.test(error.message)) {
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(newPath);
      return data.publicUrl;
    }
    throw new Error(`Storage move failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(newPath);
  return data.publicUrl;
}

/**
 * Upload a buffer to Supabase Storage and return the public URL.
 */
export async function uploadToStorage(
  buffer: Buffer,
  path: string,
  contentType: string,
): Promise<string> {
  const supabase = getSupabase();

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType, upsert: true });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Get page count of a PDF from a URL.
 */
export async function getPdfPageCount(url: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const doc = await PDFDocument.load(buffer);
  return doc.getPageCount();
}

/**
 * Split a PDF from a URL into pages and upload to storage.
 * Returns array of public URLs.
 */
export async function splitPdfFromUrl(
  url: string,
  baseFileName: string,
): Promise<string[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return splitAndUploadPdfPages(buffer, baseFileName);
}
