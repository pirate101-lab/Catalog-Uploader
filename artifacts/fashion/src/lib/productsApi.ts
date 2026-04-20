import type { Product, ProductColor } from '@/data/products';

interface ApiProductRow {
  id: string;
  title: string;
  category: string | null;
  subCategory: string | null;
  price: string;
  imageUrls: unknown;
  sizes: unknown;
  colors: unknown;
}

interface ListResponse {
  rows: ApiProductRow[];
  total: number;
  limit: number;
  offset: number;
}

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function rowToProduct(r: ApiProductRow): Product {
  const colorRows = asArray<{ name?: string; hex?: string; image?: string }>(
    r.colors,
  );
  const colors: ProductColor[] = colorRows.map((c) => ({
    name: String(c.name ?? ''),
    hex: String(c.hex ?? '#ccc'),
    image: String(c.image ?? ''),
  }));
  const images = asArray<string>(r.imageUrls).filter(Boolean);
  const primary = images[0] ?? colors[0]?.image ?? '';
  return {
    id: r.id,
    title: r.title,
    price: Number(r.price),
    category: r.category ?? '',
    colors,
    sizes: asArray<string>(r.sizes),
    image: primary,
    imageAlt: r.title,
    gallery: images.length > 0 ? images : primary ? [primary] : [],
  };
}

export type BucketKey =
  | 'new_in'
  | 'collection'
  | 'tiktok_verified'
  | 'trending';

export interface SearchOptions {
  q?: string;
  category?: string;
  gender?: 'men' | 'women';
  sizes?: string[];
  priceMin?: number;
  priceMax?: number;
  sort?: 'featured' | 'newest' | 'name-asc' | 'price-asc' | 'price-desc';
  limit?: number;
  offset?: number;
  /** Restrict to products in this synthetic merch bucket. */
  bucket?: BucketKey;
  /** When true with a `seed`, returns rows in seeded-random order. */
  dailyRotate?: boolean;
  /** Seed for `dailyRotate` — by convention YYYY-MM-DD UTC. */
  seed?: string;
  signal?: AbortSignal;
}

export interface SearchResult {
  products: Product[];
  total: number;
  limit: number;
  offset: number;
}

export async function searchProducts(opts: SearchOptions = {}): Promise<SearchResult> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.category && opts.category !== 'All') params.set('category', opts.category);
  if (opts.gender) params.set('gender', opts.gender);
  if (opts.sizes && opts.sizes.length > 0) params.set('sizes', opts.sizes.join(','));
  if (typeof opts.priceMin === 'number') params.set('priceMin', String(opts.priceMin));
  if (typeof opts.priceMax === 'number') params.set('priceMax', String(opts.priceMax));
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.bucket) params.set('bucket', opts.bucket);
  if (opts.dailyRotate) params.set('dailyRotate', 'true');
  if (opts.seed) params.set('seed', opts.seed);
  params.set('limit', String(opts.limit ?? 24));
  params.set('offset', String(opts.offset ?? 0));
  const res = await fetch(`${BASE}/api/storefront/products?${params}`, {
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`storefront/products ${res.status}`);
  const data = (await res.json()) as ListResponse;
  return {
    products: data.rows.map(rowToProduct),
    total: data.total,
    limit: data.limit,
    offset: data.offset,
  };
}

export async function fetchProductsByIds(ids: string[]): Promise<Product[]> {
  if (ids.length === 0) return [];
  const params = new URLSearchParams({ ids: ids.join(',') });
  const res = await fetch(`${BASE}/api/storefront/products?${params}`);
  if (!res.ok) throw new Error(`storefront/products ${res.status}`);
  const data = (await res.json()) as ListResponse;
  return data.rows.map(rowToProduct);
}

export async function fetchProduct(id: string): Promise<Product | null> {
  const res = await fetch(`${BASE}/api/storefront/products/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`storefront/products/${id} ${res.status}`);
  const row = (await res.json()) as ApiProductRow;
  return rowToProduct(row);
}

export interface StorefrontStats {
  products: number;
}

export async function fetchStats(): Promise<StorefrontStats> {
  const res = await fetch(`${BASE}/api/storefront/stats`);
  if (!res.ok) throw new Error(`storefront/stats ${res.status}`);
  return (await res.json()) as StorefrontStats;
}
