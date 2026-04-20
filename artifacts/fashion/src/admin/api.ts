async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface HeroSlide {
  id: number;
  title: string;
  subtitle: string | null;
  kicker: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  imageUrl: string;
  sortOrder: number;
  active: boolean;
}

export interface ProductOverride {
  productId: string;
  featured: boolean;
  hidden: boolean;
  priceOverride: string | null;
  badge: string | null;
  stockLevel: number | null;
}

export interface OrderRow {
  id: string;
  email: string;
  customerName: string | null;
  shippingAddress: Record<string, string | null>;
  items: Array<{
    productId: string;
    title: string;
    quantity: number;
    color?: string;
    size?: string;
    unitPriceCents: number;
    image?: string;
  }>;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  status: string;
  createdAt: string;
  emailEvents?: OrderEmailEvent[];
}

export interface OrderEmailEvent {
  id: number;
  orderId: string;
  kind: "received" | "confirmation" | "shipped" | "delivered";
  status: "sent" | "failed" | "skipped";
  toAddress: string | null;
  fromAddress: string | null;
  errorMessage: string | null;
  statusCode: number | null;
  createdAt: string;
}

export interface CustomerRow {
  email: string;
  name: string | null;
  orderCount: number;
  totalSpentCents: number;
  lastOrderAt: string | null;
  wishlistCount: number;
  lastWishlistAt: string | null;
}

export interface TestEmailResult {
  ok: boolean;
  error?: string;
  from?: string;
  usingSandbox?: boolean;
}

export interface SiteSettings {
  id: number;
  announcementText: string;
  announcementActive: boolean;
  defaultSort: string;
  freeShippingThresholdCents: number;
  currencySymbol: string;
  maintenanceMode: boolean;
  storeName: string;
  tagline: string | null;
  emailFromAddress: string | null;
  emailFromName: string | null;
  emailReplyTo: string | null;
  heroAutoAdvance: boolean;
  allowGuestReviews: boolean;
}

export interface OverviewWindow {
  count: number;
  revenueCents: number;
  aovCents: number;
}

export interface AdminOverview {
  today: OverviewWindow;
  week: OverviewWindow;
  month: OverviewWindow;
  funnel: Record<string, number>;
  topSellers: Array<{
    productId: string;
    title: string;
    qty: number;
    revenueCents: number;
  }>;
  recentOrders: OrderRow[];
  lowStockProducts: Array<{
    productId: string;
    title: string;
    stockLevel: number;
  }>;
  emailsFailed24h: number;
  productsCount: number;
}

export interface ReviewRow {
  id: number;
  productId: string;
  userId: string | null;
  orderId: string | null;
  email: string | null;
  name: string;
  rating: number;
  title: string | null;
  body: string;
  verifiedPurchase: boolean;
  seeded: boolean;
  createdAt: string;
}

export interface EmailEventRow {
  id: number;
  orderId: string;
  kind: "received" | "confirmation" | "shipped" | "delivered";
  status: "sent" | "failed" | "skipped";
  toAddress: string | null;
  fromAddress: string | null;
  errorMessage: string | null;
  statusCode: number | null;
  createdAt: string;
}

export interface DashboardStats {
  products: number;
  ordersToday: number;
  ordersWeek: number;
  revenueTodayCents: number;
  revenueWeekCents: number;
  lowStockCount: number;
  lowStockProducts: Array<{
    productId: string;
    title: string;
    stockLevel: number;
  }>;
  topCategories: Array<{ slug: string; count: number }>;
  recentOrders: OrderRow[];
  emailsFailed24h: number;
}

export interface ProductRow {
  id: string;
  title: string;
  category: string | null;
  price: string;
  imageUrls: string[];
  gender: "women" | "men";
  badge?: string | null;
  featured?: boolean;
}

export const adminApi = {
  /* Hero */
  listHero: () => adminFetch<HeroSlide[]>("/admin/hero-slides"),
  createHero: (data: Partial<HeroSlide>) =>
    adminFetch<HeroSlide>("/admin/hero-slides", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateHero: (id: number, data: Partial<HeroSlide>) =>
    adminFetch<HeroSlide>(`/admin/hero-slides/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteHero: (id: number) =>
    adminFetch<void>(`/admin/hero-slides/${id}`, { method: "DELETE" }),
  reorderHero: (order: number[]) =>
    adminFetch<{ success: true }>("/admin/hero-slides/reorder", {
      method: "POST",
      body: JSON.stringify({ order }),
    }),

  /* Overrides */
  listOverrides: () =>
    adminFetch<ProductOverride[]>("/admin/product-overrides"),
  upsertOverride: (productId: string, data: Partial<ProductOverride>) =>
    adminFetch<ProductOverride>(
      `/admin/product-overrides/${encodeURIComponent(productId)}`,
      { method: "PUT", body: JSON.stringify(data) },
    ),
  deleteOverride: (productId: string) =>
    adminFetch<void>(
      `/admin/product-overrides/${encodeURIComponent(productId)}`,
      { method: "DELETE" },
    ),
  bulkOverride: (productIds: string[], patch: Partial<ProductOverride>) =>
    adminFetch<{ updated: number }>("/admin/product-overrides/bulk", {
      method: "POST",
      body: JSON.stringify({ productIds, patch }),
    }),
  bulkRestore: (
    entries: Array<{
      productId: string;
      override: ProductOverride | null;
    }>,
  ) =>
    adminFetch<{ restored: number }>(
      "/admin/product-overrides/bulk-restore",
      { method: "POST", body: JSON.stringify({ entries }) },
    ),

  /* Orders */
  listOrders: (params?: { status?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    const qs = q.toString();
    return adminFetch<{ rows: OrderRow[]; limit: number; offset: number }>(
      `/admin/orders${qs ? `?${qs}` : ""}`,
    );
  },
  getOrder: (id: string) => adminFetch<OrderRow>(`/admin/orders/${id}`),
  setOrderStatus: (id: string, status: string) =>
    adminFetch<OrderRow>(`/admin/orders/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  resendOrderEmail: (id: string, kind: OrderEmailEvent["kind"]) =>
    adminFetch<{ ok: true; kind: OrderEmailEvent["kind"]; emailEvents: OrderEmailEvent[] }>(
      `/admin/orders/${id}/resend-email`,
      { method: "POST", body: JSON.stringify({ kind }) },
    ),

  /* Customers */
  listCustomers: () => adminFetch<CustomerRow[]>("/admin/customers"),

  /* Settings */
  getSettings: () => adminFetch<SiteSettings>("/admin/settings"),
  updateSettings: (data: Partial<SiteSettings>) =>
    adminFetch<SiteSettings>("/admin/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  /**
   * Send a sample order email to `to` using the saved From / Reply-To
   * branding. Doesn't throw on provider failures — the caller should
   * surface `result.error` inline.
   */
  sendTestEmail: async (to: string): Promise<TestEmailResult> => {
    const res = await fetch("/api/admin/settings/test-email", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to }),
    });
    const body = (await res.json().catch(() => ({}))) as TestEmailResult;
    return body;
  },

  /* Stats */
  getStats: () => adminFetch<DashboardStats>("/admin/stats"),
  getOverview: () => adminFetch<AdminOverview>("/admin/overview"),

  /* Reviews moderation */
  listReviews: (params?: { productId?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.productId) q.set("productId", params.productId);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    const qs = q.toString();
    return adminFetch<{ rows: ReviewRow[]; limit: number; offset: number }>(
      `/admin/reviews${qs ? `?${qs}` : ""}`,
    );
  },
  deleteReview: (id: number) =>
    adminFetch<{ success: true; productId: string }>(
      `/admin/reviews/${id}`,
      { method: "DELETE" },
    ),

  /* Email events log */
  listEmailEvents: (params?: { status?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    const qs = q.toString();
    return adminFetch<{
      rows: EmailEventRow[];
      total: number;
      limit: number;
      offset: number;
    }>(`/admin/email-events${qs ? `?${qs}` : ""}`);
  },

  /* Products — admin endpoint that includes hidden rows + override metadata */
  listProducts: (params: {
    q?: string;
    category?: string;
    limit?: number;
    offset?: number;
    hiddenOnly?: boolean;
    featuredOnly?: boolean;
  }) => {
    const q = new URLSearchParams();
    if (params.q) q.set("q", params.q);
    if (params.category) q.set("category", params.category);
    if (params.hiddenOnly) q.set("hiddenOnly", "1");
    if (params.featuredOnly) q.set("featuredOnly", "1");
    q.set("limit", String(params.limit ?? 50));
    q.set("offset", String(params.offset ?? 0));
    return adminFetch<{
      rows: Array<ProductRow & { override: ProductOverride | null }>;
      total: number;
      limit: number;
      offset: number;
    }>(`/admin/products?${q.toString()}`);
  },

  requestUploadUrl: (name: string) =>
    fetch("/api/storage/uploads/request-url", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => r.json()) as Promise<{
      uploadURL: string;
      objectPath: string;
      publicUrl: string;
    }>,
};

export function fmtCents(cents: number, symbol = "$"): string {
  return `${symbol}${(cents / 100).toFixed(2)}`;
}
