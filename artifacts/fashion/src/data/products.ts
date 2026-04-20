// Product types. The catalog is fetched live from the API (see
// src/lib/productsApi.ts and src/context/ProductsContext.tsx).

export interface ProductColor {
  name: string;
  hex: string;
  image: string;
}

export type BucketKey =
  | 'new_in'
  | 'collection'
  | 'tiktok_verified'
  | 'trending';

export interface Product {
  id: string;
  title: string;
  price: number;
  category: string;
  colors: ProductColor[];
  sizes: string[];
  image: string;
  imageAlt: string;
  gallery: string[];
  // Synthesised merch-bucket flags from the API. Always present; men's
  // products and any future genders default to all-false.
  isNewIn: boolean;
  isCollection: boolean;
  isTikTokVerified: boolean;
  isTrending: boolean;
  trendScore: number;
  buckets: BucketKey[];
}

export const CATEGORIES: string[] = [
  'Dresses',
  'Tops',
  'Knitwear',
  'Bottoms',
  'Sets',
  'Outerwear',
  'Jumpsuits',
  'Swim',
  'Lingerie',
];

export const ALL_SIZES: string[] = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];

// Legacy empty export kept for backwards-compatibility with any callers
// importing the constant directly.
export const PRODUCTS: Product[] = [];
