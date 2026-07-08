import { API_BASE_URL } from "./env";
import { loadSession } from "./session";

/**
 * Upload a captured photo to /api/upload and return the public URL.
 * Re-used across claims, checklists, audit, receiving, any flow that
 * needs proof photos persisted to storage.
 */
export async function uploadPhoto(photo: {
  uri: string;
  base64?: string;
}): Promise<string> {
  const session = await loadSession();
  const form = new FormData();
  const filename = `photo-${Date.now()}.jpg`;
  form.append("file", {
    uri: photo.uri,
    name: filename,
    type: "image/jpeg",
  } as unknown as Blob);

  const res = await fetch(`${API_BASE_URL}/api/upload`, {
    method: "POST",
    body: form,
    headers: session?.token
      ? { Authorization: `Bearer ${session.token}` }
      : undefined,
  });

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Upload failed: ${res.status}`;
    throw new Error(msg);
  }

  const url =
    body && typeof body === "object" && "url" in body
      ? String((body as { url: unknown }).url)
      : "";
  if (!url) throw new Error("Upload returned no URL");
  return url;
}
