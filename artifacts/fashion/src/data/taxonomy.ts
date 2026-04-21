// Trendsi-style top-level + grouped sub-category taxonomy.
// Used to seed the secondary category bar and the left-rail navigation.

export interface TaxonomyGroup {
  /** Group label shown in the rail. */
  label: string;
  /** Optional sub-categories shown when the group is expanded. */
  items?: string[];
}

// Women-only storefront — non-women top-level entries (Pet, Men, Luxe,
// generic "Women") were removed so the secondary nav only shows things
// shoppers actually want to browse here.
export const TOP_LEVEL: string[] = [
  'Category',
  'New In',
  'Collection',
  'TikTok Verified',
  'Trending',
];

// Maps a TOP_LEVEL nav label to the synthesised merch bucket the
// API understands. 'Category' has no bucket — it just opens /shop.
export const TOP_LEVEL_BUCKETS: Record<string, string | null> = {
  Category: null,
  'New In': 'new_in',
  Collection: 'collection',
  'TikTok Verified': 'tiktok_verified',
  Trending: 'trending',
};

/**
 * Standalone leaf entries shown above the grouped categories in the rail.
 */
export const RAIL_LEAFS: string[] = ['All', 'Plus Size'];

/**
 * Men-only rail leaves (no Plus Size — separate ladies-only sizing concept).
 */
export const MEN_RAIL_LEAFS: string[] = ['All'];

// Sub-categories were removed because the storefront API only filters by
// the top-level category — clicking "Casual Dresses" vs "Maxi Dresses"
// returned identical product grids, which was confusing. Each entry is now
// a single leaf that maps directly to a real category in the catalog.
export const RAIL_GROUPS: TaxonomyGroup[] = [
  { label: 'Tops' },
  { label: 'Dresses' },
  { label: 'Jeans & Denim' },
  { label: 'Swimwear' },
  { label: 'Jumpsuits & Rompers' },
  { label: 'Bottoms' },
  { label: 'Two-Piece Sets' },
  { label: 'Activewear' },
  { label: 'Sweaters & Knitwear' },
  { label: 'Outerwear' },
  { label: 'Loungewear & Intimates' },
  { label: 'Graphic' },
];

/**
 * Men's rail. Mirrors the men catalog categories actually present in the
 * data file (tops, denim, knitwear, shoes, bottoms, accessories, shorts,
 * outerwear, sets, formal, activewear) so every link in the sidebar
 * resolves to a non-empty grid.
 */
export const MEN_RAIL_GROUPS: TaxonomyGroup[] = [
  { label: 'Tops' },
  { label: 'Jeans & Denim' },
  { label: 'Sweaters & Knitwear' },
  { label: 'Shoes' },
  { label: 'Bottoms' },
  { label: 'Shorts' },
  { label: 'Outerwear' },
  { label: 'Two-Piece Sets' },
  { label: 'Formal' },
  { label: 'Activewear' },
  { label: 'Accessories' },
];

export type GenderForTaxonomy = 'women' | 'men' | 'all';

export function getRailGroups(gender: GenderForTaxonomy): TaxonomyGroup[] {
  return gender === 'men' ? MEN_RAIL_GROUPS : RAIL_GROUPS;
}

export function getRailLeafs(gender: GenderForTaxonomy): string[] {
  return gender === 'men' ? MEN_RAIL_LEAFS : RAIL_LEAFS;
}
