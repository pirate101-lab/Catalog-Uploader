export interface Review {
  id: number;
  name: string;
  rating: number;
  title?: string | null;
  body: string;
  verifiedPurchase?: boolean;
  createdAt: string;
}

export interface ReviewsResponse {
  reviews: Review[];
  count: number;
  average: number;
}

export type ReviewEligibilityReason =
  | 'not_authenticated'
  | 'no_email'
  | 'not_a_buyer'
  | 'already_reviewed';

export interface ReviewEligibility {
  canReview: boolean;
  reason?: ReviewEligibilityReason;
  defaultName?: string | null;
}

export async function fetchReviews(productId: string): Promise<ReviewsResponse> {
  const res = await fetch(
    `/api/storefront/products/${encodeURIComponent(productId)}/reviews`,
  );
  if (!res.ok) {
    return { reviews: [], count: 0, average: 0 };
  }
  return (await res.json()) as ReviewsResponse;
}

export async function fetchReviewEligibility(
  productId: string,
): Promise<ReviewEligibility> {
  try {
    const res = await fetch(
      `/api/storefront/products/${encodeURIComponent(productId)}/reviews/eligibility`,
    );
    if (!res.ok) return { canReview: false, reason: 'not_authenticated' };
    return (await res.json()) as ReviewEligibility;
  } catch {
    return { canReview: false, reason: 'not_authenticated' };
  }
}

export interface SubmitReviewInput {
  name: string;
  rating: number;
  body: string;
}

export interface SubmitReviewResult {
  ok: boolean;
  status?: string;
  error?: string;
}

export async function submitReview(
  productId: string,
  input: SubmitReviewInput,
): Promise<SubmitReviewResult> {
  const res = await fetch(
    `/api/storefront/products/${encodeURIComponent(productId)}/reviews`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? 'submit_failed' };
  }
  const data = (await res.json()) as { status?: string };
  return { ok: true, status: data.status };
}
