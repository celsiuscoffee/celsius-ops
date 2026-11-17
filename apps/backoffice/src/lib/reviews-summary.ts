// Customers › Reviews key numbers (restructure step 6, 17 Nov 2026), worked
// out from the reviews dashboard the page already loads. Pure, so it is tested
// without the page. The questions: how are we rated, is every review answered,
// what went wrong, and is every outlet connected to Google.

export type ReviewRow = { rating: number; reply?: { comment: string } | null };
export type OutletRow = { google: { connected: boolean } };

export type ReviewSummary = {
  /** new Google reviews in the period, and how many have no reply yet */
  google: { count: number; unreplied: number };
  /** 1-3 star Google reviews plus QR feedback in the period */
  complaints: { count: number; lowGoogle: number; qr: number };
  /** outlets connected to Google, of all outlets */
  connected: { count: number; of: number };
};

export function summariseReviews(reviews: ReviewRow[], feedbackCount: number, outlets: OutletRow[]): ReviewSummary {
  const lowGoogle = reviews.filter((r) => r.rating <= 3).length;
  return {
    google: { count: reviews.length, unreplied: reviews.filter((r) => !r.reply?.comment).length },
    complaints: { count: lowGoogle + feedbackCount, lowGoogle, qr: feedbackCount },
    connected: { count: outlets.filter((o) => o.google.connected).length, of: outlets.length },
  };
}
