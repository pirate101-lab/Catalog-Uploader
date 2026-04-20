import type { Product } from '@/data/products';

// Returns up to 5 unique gallery images for a product, preferring the
// currently-selected color variant first. The raw catalog already provides a
// `gallery` array per product; we layer the selected color's image in front
// when present.
export function getGalleryImages(product: Product, selectedColor?: string): string[] {
  const variantImage = selectedColor
    ? product.colors.find((c) => c.name === selectedColor)?.image
    : undefined;

  const candidates: string[] = [];
  if (variantImage) candidates.push(variantImage);
  if (product.image) candidates.push(product.image);
  for (const g of product.gallery) candidates.push(g);
  for (const c of product.colors) if (c.image) candidates.push(c.image);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const img of candidates) {
    if (!img || seen.has(img)) continue;
    seen.add(img);
    out.push(img);
  }
  // Always return at least one entry so the gallery never collapses.
  if (out.length === 0) out.push(product.image || '');
  return out.slice(0, 5);
}
