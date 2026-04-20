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

export const RAIL_GROUPS: TaxonomyGroup[] = [
  {
    label: 'Tops',
    items: ['T-Shirts', 'Tank Tops & Camis', 'Blouses', 'Shirts', 'Knit Tops', 'Bodysuits', 'Sweatshirts & Hoodies'],
  },
  {
    label: 'Dresses',
    items: ['Casual Dresses', 'Cocktail Dresses', 'Maxi Dresses', 'Formal & Evening Dresses'],
  },
  {
    label: 'Jeans & Denim',
    items: ['Jeans', 'Denim Tops & Jackets', 'Denim Dresses & Skirts', 'Denim Shorts', 'Denim Overalls'],
  },
  {
    label: 'Swimwear',
    items: ['Bikinis & Tankinis', 'One-Pieces', 'Cover-Ups', 'Swim Bottoms', 'Swim Tops', 'Swim Sets'],
  },
  { label: 'Jumpsuits & Rompers' },
  {
    label: 'Bottoms',
    items: ['Shorts', 'Leggings', 'Pants', 'Skirts', 'Sweatpants'],
  },
  { label: 'Two-Piece Sets' },
  {
    label: 'Activewear',
    items: ['Active Tops', 'Active Bottoms', 'Active Sets'],
  },
  {
    label: 'Sweaters & Knitwear',
    items: ['Sweater Pullover', 'Cardigans', 'Knit Tops', 'Sweater Dresses', 'Sweater Hoodies', 'Ponchos', 'Sweater Two-Piece Sets'],
  },
  {
    label: 'Outerwear',
    items: ['Jackets', 'Coats', 'Blazers', 'Cardigans', 'Trench Coats', 'Faux Fur Jackets', 'Vests'],
  },
  {
    label: 'Loungewear & Intimates',
    items: [
      'Loungewear Sets',
      'Sleep Dresses',
      'Bras & Bra Sets',
      'Intimates Bras & Pantie Set',
      'Intimates Teddies & Bodysuits',
      'Intimates Lingerie',
      'Lounge Tops & Bottoms',
    ],
  },
  {
    label: 'Graphic',
    items: ['Graphic Tees', 'Graphic Sweatshirts & Hoodies', 'Graphic Sweatpants'],
  },
];
