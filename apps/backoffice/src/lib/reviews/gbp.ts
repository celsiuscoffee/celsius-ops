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
