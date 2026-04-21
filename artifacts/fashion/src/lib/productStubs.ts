import type { Product } from '@/data/products';

export interface CardStubs {
  sold: number;
  rating: number; // 1 decimal, e.g. 4.7
  reviews: number;
  rrp: number; // strikethrough RRP > price
}

function hashId(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function deriveStubs(product: Product): CardStubs {
  const h = hashId(product.id);
  const soldRaw = (h >>> 7) % 4000;
  const sold = Math.max(5, Math.round(Math.pow(soldRaw, 1.05)));
  const ratingTenths = 38 + ((h >>> 12) % 13);
  const rating = Math.min(50, ratingTenths) / 10;
  const reviews = 3 + ((h >>> 16) % 220);
  const multTenths = 14 + ((h >>> 20) % 8);
  const raw = product.price * (multTenths / 10);
  const rrp = Math.max(product.price + 5, Math.floor(raw) + 0.99);
  return { sold, rating, reviews, rrp };
}

export function formatSold(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
