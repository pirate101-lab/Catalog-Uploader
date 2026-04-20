// Shared types + URL serialization for the homepage filter sidebar.
// Lifted out of Home.tsx so the same parsing can be reused for the
// "carry filters through to /shop" CTAs without duplicating logic.

import { ALL_SIZES } from '@/data/products';

export type GenderKey = 'all' | 'women' | 'men';
export type SortKey =
  | 'featured'
  | 'newest'
  | 'name-asc'
  | 'price-asc'
  | 'price-desc';

export const PRICE_MAX = 250;

export interface HomeFilterState {
  category: string;
  gender: GenderKey;
  sizes: string[];
  priceMin: number;
  priceMax: number;
  sort: SortKey;
}

export const DEFAULT_FILTERS: HomeFilterState = {
  category: 'All',
  gender: 'all',
  sizes: [],
  priceMin: 0,
  priceMax: PRICE_MAX,
  sort: 'featured',
};

const SIZE_SET = new Set(ALL_SIZES);
const SORTS: SortKey[] = ['featured', 'newest', 'name-asc', 'price-asc', 'price-desc'];

export function parseFilters(search: string): HomeFilterState {
  const params = new URLSearchParams(search);
  const genderRaw = params.get('gender');
  const gender: GenderKey =
    genderRaw === 'women' || genderRaw === 'men' ? genderRaw : 'all';
  const sortRaw = params.get('sort') as SortKey | null;
  const sort: SortKey = sortRaw && SORTS.includes(sortRaw) ? sortRaw : 'featured';
  const sizes = (params.get('sizes') ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => SIZE_SET.has(s));
  const priceMin = clampNum(params.get('priceMin'), 0, PRICE_MAX, 0);
  const priceMaxRaw = clampNum(params.get('priceMax'), 0, PRICE_MAX, PRICE_MAX);
  const priceMax = Math.max(priceMin, priceMaxRaw);
  return {
    category: params.get('category') ?? 'All',
    gender,
    sizes,
    priceMin,
    priceMax,
    sort,
  };
}

function clampNum(raw: string | null, lo: number, hi: number, fallback: number): number {
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** URL search params reflecting only the *non-default* filters. */
export function serializeFilters(f: HomeFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (f.category !== 'All') params.set('category', f.category);
  if (f.gender !== 'all') params.set('gender', f.gender);
  if (f.sizes.length > 0) params.set('sizes', f.sizes.join(','));
  if (f.priceMin !== 0) params.set('priceMin', String(f.priceMin));
  if (f.priceMax !== PRICE_MAX) params.set('priceMax', String(f.priceMax));
  if (f.sort !== 'featured') params.set('sort', f.sort);
  return params;
}

/** Build a `/shop?...` href that carries the active homepage filters. */
export function shopHref(f: HomeFilterState, extra?: Record<string, string>): string {
  const params = serializeFilters(f);
  if (extra) for (const [k, v] of Object.entries(extra)) params.set(k, v);
  const qs = params.toString();
  return qs ? `/shop?${qs}` : '/shop';
}
