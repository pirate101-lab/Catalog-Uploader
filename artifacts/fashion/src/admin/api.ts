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
  /** "all" slides show in every view; "men" / "women" only show when
   *  the storefront passes a matching `?gender=` to the hero endpoint. */
  gender: "all" | "men" | "women";
}

export interface ProductOverride {
  productId: string;
  featured: boolean;
  hidden: boolean;
  priceOverride: string | null;
  badge: string | null;
  stockLevel: number | null;
  // T26 catalog management
  categoryOverride: string | null;
  subCategoryOverride: string | null;
  titleOverride: string | null;
  imageUrlOverride: string | null;
  sizesOverride: string[] | null;
  colorsOverride: { name: string; hex: string; image?: string }[] | null;
  genderOverride: "men" | "women" | null;
  deletedAt: string | null;
}

export interface CustomProductInput {
  title: string;
  category: string;
  subCategory?: string | null;
  price: string | number;
  imageUrls?: string[];
  imageUrl?: string;
  sizes?: string[];
  colors?: { name: string; hex: string; image?: string }[];
  gender: "men" | "women";
  badge?: string | null;
  featured?: boolean;
  hidden?: boolean;
  stockLevel?: number | null;
}

export interface CustomProduct {
  id: string;
  title: string;
  category: string;
  subCategory: string | null;
  price: string;
  imageUrls: string[];
  sizes: string[];
  colors: { name: string; hex: string; image?: string }[];
  gender: "men" | "women";
  badge: string | null;
  featured: boolean;
  hidden: boolean;
  stockLevel: number | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  /** CHARGE-side amounts: what the merchant account was actually
   *  billed (KES today for Paystack orders). For bank-transfer / legacy
   *  orders this matches the display amounts because there's no FX
   *  conversion happening. */
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  /** DISPLAY-side amounts: what the shopper saw on the storefront. Null
   *  on rows that predate the hybrid-currency split — the boot-time
   *  backfill normalises these but TypeScript still sees nullable until
   *  the migration completes everywhere. */
  displayCurrency: string | null;
  displaySubtotalCents: number | null;
  displayShippingCents: number | null;
  displayTaxCents: number | null;
  displayTotalCents: number | null;
  /** Locked USD→KES rate used for this order (string from Drizzle
   *  numeric column). Null when no FX conversion happened. */
  fxRate: string | null;
  fxRateLockedAt: string | null;
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
  /** Paystack-supported ISO currency code (USD/NGN/GHS/ZAR/KES). The
   *  symbol is derived server-side from this and updated on save. */
  currencyCode: string;
  maintenanceMode: boolean;
  storeName: string;
  tagline: string | null;
  logoUrl: string | null;
  emailFromAddress: string | null;
  emailFromName: string | null;
  emailReplyTo: string | null;
  heroAutoAdvance: boolean;
  allowGuestReviews: boolean;
  paystackEnabled: boolean;
  paystackTestMode: boolean;
  paystackLivePublicKey: string | null;
  /** Masked (e.g. "sk_live_••••1234") or empty string. Send back as-is to
   *  preserve the existing key, or replace with a fresh value to update. */
  paystackLiveSecretKey: string;
  paystackTestPublicKey: string | null;
  paystackTestSecretKey: string;
  paystackLiveSecretKeySet: boolean;
  paystackTestSecretKeySet: boolean;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankSwiftCode: string | null;
  bankRoutingNumber: string | null;
  bankInstructions: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpUsername: string | null;
  /** Masked or empty. Send back as-is to keep, or replace to update. */
  smtpPassword: string;
  smtpPasswordSet: boolean;
  resendApiKey: string;
  resendApiKeySet: boolean;
  paymentAlertMode: "off" | "instant" | "hourly";
  paymentAlertRecipients: string | null;
  /** USD→KES conversion rate stored as a numeric string (Drizzle
   *  numeric column). Drives Paystack charge amounts at checkout. */
  usdToKesRate: string;
  /** ISO timestamp of the last successful FX refresh (manual or auto),
   *  or null if the rate has never been touched since seeding. */
  fxRateUpdatedAt: string | null;
  /** When true, the API server polls a free FX provider every hour and
   *  refreshes the stored rate when it's older than 24h. */
  fxAutoRefresh: boolean;
}

export interface FxRefreshResult {
  ok: boolean;
  rate?: number;
  asOf?: string | null;
  source?: string | null;
  error?: string;
}

export type SmtpErrorCategory =
  | "auth"
  | "tls"
  | "dns"
  | "timeout"
  | "connection"
  | "unknown";

export type SmtpField = "host" | "port" | "username" | "password";

export interface SmtpVerifyError {
  category: SmtpErrorCategory;
  code: string | null;
  statusCode: number | null;
  message: string;
  hint: string;
}

export interface SmtpVerifyResult {
  ok: boolean;
  configured: boolean;
  missing: SmtpField[];
  error: SmtpVerifyError | null;
}

/** Override credentials sent to /admin/settings/verify-smtp so the
 *  operator can verify the in-progress form values without saving
 *  first. Anything omitted falls back to the saved DB row. */
export interface SmtpVerifyOverrides {
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean;
  smtpUsername?: string | null;
  smtpPassword?: string | null;
}

export interface PaymentsUrls {
  callbackUrl: string;
  webhookUrl: string;
}

export interface PaymentsTestResult {
  ok: boolean;
  mode: "live" | "test";
  error?: string;
  enabled?: boolean;
  ready?: boolean;
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
  paymentsToday: { count: number; revenueCents: number };
  paystackStatus: "enabled" | "disabled" | "keys_missing";
  paystackTestMode: boolean;
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

export interface PaymentEventRow {
  id: number;
  orderId: string | null;
  reference: string | null;
  kind: "success" | "failed" | "abandoned";
  source: "webhook" | "callback";
  code: string;
  message: string | null;
  amountCents: number | null;
  currency: string | null;
  createdAt: string;
}

export interface ProductRow {
  id: string;
  title: string;
  category: string | null;
  subCategory?: string | null;
  price: string;
  imageUrls: string[];
  sizes?: string[];
  colors?: { name: string; hex: string; image?: string }[];
  gender: "women" | "men";
  badge?: string | null;
  featured?: boolean;
  hidden?: boolean;
}

export type AdminRoleValue = "admin" | "super_admin";

export interface AdminUserRow {
  id: number;
  username: string;
  role: AdminRoleValue;
  createdAt: string;
  createdById: number | null;
  lastLoginAt: string | null;
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
  /** Pull a fresh USD→KES rate from the upstream provider and persist
   *  it. Always resolves with a result object — `ok:false` carries the
   *  human-readable error so the UI can render it inline. */
  refreshFxRate: () =>
    adminFetch<FxRefreshResult>("/admin/settings/refresh-fx-rate", {
      method: "POST",
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
  /**
   * Run an SMTP handshake against the saved credentials. Useful for
   * confirming Titan / Zoho / etc. accept the username + password
   * before relying on order-confirmation delivery.
   */
  verifySmtp: async (
    overrides?: SmtpVerifyOverrides,
  ): Promise<SmtpVerifyResult> => {
    const res = await fetch("/api/admin/settings/verify-smtp", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(overrides ?? {}),
    });
    const fallback: SmtpVerifyResult = {
      ok: false,
      configured: false,
      missing: [],
      error: {
        category: "unknown",
        code: null,
        statusCode: null,
        message: `Verify request failed (${res.status})`,
        hint: "The server did not return a verify result. Check the API server logs.",
      },
    };
    return (await res.json().catch(() => fallback)) as SmtpVerifyResult;
  },

  /* Stats */
  getStats: () => adminFetch<DashboardStats>("/admin/stats"),
  getOverview: () => adminFetch<AdminOverview>("/admin/overview"),

  /* Payments */
  getPaymentsUrls: () => adminFetch<PaymentsUrls>("/admin/payments/urls"),
  testPayments: () =>
    adminFetch<PaymentsTestResult>("/admin/payments/test", { method: "POST" }),

  /* Payment events log */
  listPaymentEvents: (params?: {
    kind?: string;
    limit?: number;
    offset?: number;
    from?: string;
    to?: string;
    q?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.kind) q.set("kind", params.kind);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.q) q.set("q", params.q);
    const qs = q.toString();
    return adminFetch<{
      rows: PaymentEventRow[];
      total: number;
      limit: number;
      offset: number;
    }>(`/admin/payment-events${qs ? `?${qs}` : ""}`);
  },

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
    includeDeleted?: boolean;
    deletedOnly?: boolean;
  }) => {
    const q = new URLSearchParams();
    if (params.q) q.set("q", params.q);
    if (params.category) q.set("category", params.category);
    if (params.hiddenOnly) q.set("hiddenOnly", "1");
    if (params.featuredOnly) q.set("featuredOnly", "1");
    if (params.includeDeleted) q.set("includeDeleted", "1");
    if (params.deletedOnly) q.set("deletedOnly", "1");
    q.set("limit", String(params.limit ?? 500));
    q.set("offset", String(params.offset ?? 0));
    return adminFetch<{
      rows: Array<ProductRow & { override: ProductOverride | null }>;
      total: number;
      limit: number;
      offset: number;
    }>(`/admin/products?${q.toString()}`);
  },
  listProductCategories: () =>
    adminFetch<Array<{ category: string; count: number }>>(
      "/admin/products/categories",
    ),
  softDeleteProduct: (productId: string) =>
    adminFetch<{ ok: true; productId: string }>(
      `/admin/products/${encodeURIComponent(productId)}/delete`,
      { method: "POST" },
    ),
  restoreProduct: (productId: string) =>
    adminFetch<{ ok: true; productId: string }>(
      `/admin/products/${encodeURIComponent(productId)}/restore`,
      { method: "POST" },
    ),
  createCustomProduct: (data: CustomProductInput) =>
    adminFetch<CustomProduct>("/admin/custom-products", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateCustomProduct: (id: string, data: Partial<CustomProductInput>) =>
    adminFetch<CustomProduct>(`/admin/custom-products/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteCustomProduct: (id: string) =>
    adminFetch<void>(`/admin/custom-products/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  uploadProductImage: async (file: File): Promise<{ publicUrl: string }> => {
    const res = await fetch("/api/admin/products/image", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": file.type },
      body: file,
    });
    const body = (await res.json().catch(() => ({}))) as {
      publicUrl?: string;
      error?: string;
    };
    if (!res.ok || !body.publicUrl) {
      throw new Error(body.error || `Upload failed (${res.status})`);
    }
    return { publicUrl: body.publicUrl };
  },

  /* Admin users (super_admin only) */
  listAdminUsers: () =>
    adminFetch<{ rows: AdminUserRow[] }>("/admin-users"),
  createAdminUser: (data: {
    username: string;
    password: string;
    role: AdminRoleValue;
  }) =>
    adminFetch<AdminUserRow>("/admin-users", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateAdminUser: (
    id: number,
    data: { role?: AdminRoleValue; password?: string },
  ) =>
    adminFetch<AdminUserRow>(`/admin-users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteAdminUser: (id: number) =>
    adminFetch<{ ok: true }>(`/admin-users/${id}`, { method: "DELETE" }),

  uploadLogo: async (file: File): Promise<{ publicUrl: string }> => {
    const res = await fetch("/api/admin/settings/logo", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": file.type },
      body: file,
    });
    const body = (await res.json().catch(() => ({}))) as {
      publicUrl?: string;
      error?: string;
    };
    if (!res.ok || !body.publicUrl) {
      throw new Error(body.error || `Upload failed (${res.status})`);
    }
    return { publicUrl: body.publicUrl };
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

/** Format a charge-side amount with the order's stored currency code
 *  (e.g. "KSh 1,234.56" for KES, "$12.34" for USD). Used in admin
 *  rendering to tell shoppers what was actually billed alongside the
 *  USD price they saw at checkout. */
export function fmtCentsFor(cents: number, currency: string | null): string {
  const amount = (cents / 100).toFixed(2);
  switch ((currency ?? "USD").toUpperCase()) {
    case "KES":
      return `KSh ${amount}`;
    case "USD":
      return `$${amount}`;
    case "GHS":
      return `GH₵${amount}`;
    case "ZAR":
      return `R${amount}`;
    case "NGN":
      return `₦${amount}`;
    default:
      return `${amount} ${currency ?? ""}`.trim();
  }
}
