import { apiGet } from "./api";

/**
 * POS customer-display posters (idle carousel). Mirrors the web
 * customer-display: GET /api/posters → active pos-display posters,
 * already schedule-filtered + sorted server-side.
 */
export type DisplayPoster = {
  id: string;
  imageUrl: string;
  title: string | null;
  deeplink: string | null;
  durationMs: number;
};

export async function fetchPosters(): Promise<DisplayPoster[]> {
  try {
    const res = await apiGet<{ posters?: DisplayPoster[] }>("/api/posters");
    return (res.posters ?? []).filter((p) => !!p.imageUrl);
  } catch {
    return [];
  }
}
