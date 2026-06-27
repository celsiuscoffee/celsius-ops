/**
 * Persist inbound WhatsApp media (supplier images / invoice PDFs) to Supabase
 * Storage so the chat inbox can open the attachment and captured invoices keep
 * the photo.
 *
 * The Cloud API only hands us a media id + a short-lived, token-gated download
 * URL — useless once the webhook returns. We fetch the bytes once and upload
 * them to the `invoices` bucket at a DETERMINISTIC path keyed on the media id,
 * so re-running (webhook redelivery, or captureInvoice re-fetching the same
 * media) upserts the same object rather than duplicating it.
 *
 * Best-effort: returns null and never throws so a storage hiccup can't block
 * the webhook's 200 to Meta.
 */
import { createClient } from "@supabase/supabase-js";
import { fetchWhatsAppMedia } from "@/lib/whatsapp";

const supabaseUrl = process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL || "";
const supabaseKey = process.env.LOYALTY_SUPABASE_SERVICE_ROLE_KEY || "";

const BUCKET = "invoices";

/** Map a MIME type to a file extension for the stored object path. */
function extFromMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "application/pdf") return "pdf";
  return "bin";
}

/**
 * Fetch a WhatsApp media object by id and upload it to Supabase Storage.
 * Returns the public URL, or null when there's no media id, Supabase isn't
 * configured, or anything fails. Idempotent: same media id → same object path.
 */
export async function storeWhatsAppMedia(
  mediaId: string | null | undefined,
): Promise<string | null> {
  if (!mediaId) return null;
  if (!supabaseUrl || !supabaseKey) return null;
  try {
    const media = await fetchWhatsAppMedia(mediaId);
    if (!media) return null;
    const ext = extFromMime(media.mimeType);
    const path = `whatsapp/${mediaId}.${ext}`;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, media.bytes, { contentType: media.mimeType, upsert: true });
    if (error) {
      console.warn(`[whatsapp:media] upload failed for ${mediaId}: ${error.message}`);
      return null;
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  } catch (e) {
    console.warn(
      `[whatsapp:media] store failed for ${mediaId}: ${e instanceof Error ? e.message : e}`,
    );
    return null;
  }
}
