/**
 * Google Business Profile API helper
 *
 * Uses OAuth2 with refresh tokens to auto-renew access.
 * Credentials: GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN
 */

const GBP_BASE = "https://mybusiness.googleapis.com/v4";

type GbpReview = {
  reviewId: string;
  reviewer: {
    profilePhotoUrl?: string;
    displayName: string;
  };
  starRating: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE";
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: {
    comment: string;
    updateTime: string;
  };
};

type GbpReviewsResponse = {
  reviews: GbpReview[];
  averageRating: number;
  totalReviewCount: number;
  nextPageToken?: string;
};

export type NormalizedReview = {
  id: string;
  reviewer: {
    name: string;
    photoUrl?: string;
  };
  rating: number;
  comment?: string;
  createdAt: string;
  reply?: {
    comment: string;
    updatedAt: string;
  };
};

const STAR_MAP: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

function normalizeReview(r: GbpReview): NormalizedReview {
  return {
    id: r.reviewId,
    reviewer: {
      name: r.reviewer.displayName,
      photoUrl: r.reviewer.profilePhotoUrl,
    },
    rating: STAR_MAP[r.starRating] ?? 0,
    comment: r.comment,
    createdAt: r.createTime,
    reply: r.reviewReply
      ? { comment: r.reviewReply.comment, updatedAt: r.reviewReply.updateTime }
      : undefined,
  };
}

// ─── OAuth2 Token Management ───────────────────────────────

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedAccessToken;
  }

  const clientId = process.env.GBP_CLIENT_ID;
  const clientSecret = process.env.GBP_CLIENT_SECRET;
  const refreshToken = process.env.GBP_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("GBP OAuth2 credentials not configured (GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN)");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to refresh GBP access token: ${res.status} ${body}`);
  }

  const data = await res.json();
  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;

  return cachedAccessToken!;
}

// ─── API Methods ───────────────────────────────────────────

export async function fetchGoogleReviews(
  accountId: string,
  locationName: string,
  pageSize = 50,
  pageToken?: string,
): Promise<{
  reviews: NormalizedReview[];
  averageRating: number;
  totalReviewCount: number;
  nextPageToken?: string;
}> {
  const token = await getAccessToken();
  const params = new URLSearchParams({ pageSize: String(pageSize) });
  if (pageToken) params.set("pageToken", pageToken);

  const res = await fetch(
    `${GBP_BASE}/${accountId}/${locationName}/reviews?${params}`,
    { headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 60 } },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GBP API error ${res.status}: ${body}`);
  }

  const data: GbpReviewsResponse = await res.json();

  return {
    reviews: (data.reviews ?? []).map(normalizeReview),
    averageRating: data.averageRating ?? 0,
    totalReviewCount: data.totalReviewCount ?? 0,
    nextPageToken: data.nextPageToken,
  };
}

export type GbpPost = {
  name?: string;
  summary: string;
  callToAction?: {
    actionType: "LEARN_MORE" | "BOOK" | "ORDER" | "SHOP" | "SIGN_UP" | "CALL";
    url?: string;
  };
  topicType: "STANDARD" | "EVENT" | "OFFER";
  state?: string;
  createTime?: string;
  updateTime?: string;
};

export async function createLocalPost(
  accountId: string,
  locationName: string,
  summary: string,
  callToAction?: { actionType: string; url: string },
): Promise<GbpPost> {
  const token = await getAccessToken();

  const body: Record<string, unknown> = {
    summary,
    topicType: "STANDARD",
  };
  if (callToAction) {
    body.callToAction = callToAction;
  }

  const res = await fetch(
    `${GBP_BASE}/${accountId}/${locationName}/localPosts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GBP create post error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function listLocalPosts(
  accountId: string,
  locationName: string,
  pageSize = 10,
): Promise<{ posts: GbpPost[]; nextPageToken?: string }> {
  const token = await getAccessToken();
  const params = new URLSearchParams({ pageSize: String(pageSize) });

  const res = await fetch(
    `${GBP_BASE}/${accountId}/${locationName}/localPosts?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GBP list posts error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return { posts: data.localPosts ?? [], nextPageToken: data.nextPageToken };
}

export async function replyToReview(
  accountId: string,
  locationName: string,
  reviewId: string,
  comment: string,
): Promise<void> {
  const token = await getAccessToken();

  const res = await fetch(
    `${GBP_BASE}/${accountId}/${locationName}/reviews/${reviewId}/reply`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ comment }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GBP reply error ${res.status}: ${body}`);
  }
}

const GBP_INFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";

// Resolve an outlet's precise centre (lat/lng) + Google Places id, so a geogrid
// scan can place its grid and find the business in each point's results.
export async function getLocationGeo(
  locationName: string,
): Promise<{ lat: number; lng: number; placeId: string | null; title: string | null }> {
  const token = await getAccessToken();
  const res = await fetch(
    `${GBP_INFO_BASE}/${locationName}?readMask=latlng,metadata,title`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GBP location info error ${res.status}: ${body}`);
  }
  const data = await res.json();
  return {
    lat: data.latlng?.latitude,
    lng: data.latlng?.longitude,
    placeId: data.metadata?.placeId ?? null,
    title: data.title ?? null,
  };
}

// Every location in the GBP account, with the Places id Google holds for it.
// This is the only way to map a public place id back to the internal
// locations/NNN name — used to detect/repair outlets whose stored
// gbpLocationName points at the wrong listing.
export async function listAccountLocations(
  accountId: string,
): Promise<{ name: string; title: string | null; placeId: string | null }[]> {
  const token = await getAccessToken();
  const out: { name: string; title: string | null; placeId: string | null }[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ readMask: "name,title,metadata", pageSize: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`${GBP_INFO_BASE}/${accountId}/locations?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GBP list locations error ${res.status}: ${body}`);
    }
    const data = await res.json();
    for (const l of data.locations ?? []) {
      out.push({ name: l.name, title: l.title ?? null, placeId: l.metadata?.placeId ?? null });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

// The relevance-bearing profile fields — what Google reads to decide which
// keywords this location is a match for. Input to the keyword relevance audit.
export type GbpLocationProfile = {
  title: string | null;
  primaryCategory: string | null;
  additionalCategories: string[];
  description: string | null;
  services: string[]; // service/menu item display names (+ free-form descriptions)
  websiteUri: string | null;
  hasPhone: boolean;
  hasHours: boolean;
};

export async function getLocationProfile(locationName: string): Promise<GbpLocationProfile> {
  const token = await getAccessToken();
  const readMask = "title,categories,profile,serviceItems,websiteUri,phoneNumbers,regularHours";
  const res = await fetch(`${GBP_INFO_BASE}/${locationName}?readMask=${readMask}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GBP location profile error ${res.status}: ${body}`);
  }
  const data = await res.json();

  // serviceItems: structured items carry only a serviceTypeId (machine id — grab
  // its trailing words) unless a label/description was set; free-form items carry
  // a displayName. Collect every human-readable string we can.
  const services: string[] = [];
  for (const s of data.serviceItems ?? []) {
    const free = s.freeFormServiceItem?.label;
    if (free?.displayName) services.push(free.displayName);
    if (free?.description) services.push(free.description);
    const structured = s.structuredServiceItem;
    if (structured?.description) services.push(structured.description);
    if (structured?.serviceTypeId) services.push(String(structured.serviceTypeId).replace(/^job_type_id:/, "").replace(/_/g, " "));
  }

  return {
    title: data.title ?? null,
    primaryCategory: data.categories?.primaryCategory?.displayName ?? null,
    additionalCategories: (data.categories?.additionalCategories ?? [])
      .map((c: { displayName?: string }) => c.displayName)
      .filter(Boolean),
    description: data.profile?.description ?? null,
    services,
    websiteUri: data.websiteUri ?? null,
    hasPhone: !!(data.phoneNumbers?.primaryPhone),
    hasHours: !!(data.regularHours?.periods?.length),
  };
}

const GBP_PERF_BASE = "https://businessprofileperformance.googleapis.com/v1";

// The actual search terms customers used to find this location, with monthly
// impressions — the data source for auto-selecting which keywords to track.
export async function getTopSearchKeywords(
  locationName: string,
  monthsBack = 5,
): Promise<{ keyword: string; impressions: number }[]> {
  const token = await getAccessToken();
  const now = new Date();
  // Use complete months: end = last month, start = end - (monthsBack-1).
  const end = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const start = new Date(end.getFullYear(), end.getMonth() - (monthsBack - 1), 1);
  const params = new URLSearchParams({
    "monthlyRange.startMonth.year": String(start.getFullYear()),
    "monthlyRange.startMonth.month": String(start.getMonth() + 1),
    "monthlyRange.endMonth.year": String(end.getFullYear()),
    "monthlyRange.endMonth.month": String(end.getMonth() + 1),
  });
  const res = await fetch(
    `${GBP_PERF_BASE}/${locationName}/searchkeywords/impressions/monthly?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GBP performance error ${res.status}: ${body}`);
  }
  const data = await res.json();
  const rows: { searchKeyword?: string; insightsValue?: { value?: string; threshold?: string } }[] =
    data.searchKeywordsCounts ?? [];
  return rows
    .map((r) => ({
      keyword: (r.searchKeyword ?? "").trim(),
      // "value" is the real count; "threshold" means "fewer than N" (low volume).
      impressions: Number(r.insightsValue?.value ?? r.insightsValue?.threshold ?? 0),
    }))
    .filter((r) => r.keyword)
    .sort((a, b) => b.impressions - a.impressions);
}
