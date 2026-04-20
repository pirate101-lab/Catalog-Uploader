// Product types. The catalog is fetched live from the API (see
// src/lib/productsApi.ts and src/context/ProductsContext.tsx).

export interface ProductColor {
  name: string;
  hex: string;
  image: string;
}

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
