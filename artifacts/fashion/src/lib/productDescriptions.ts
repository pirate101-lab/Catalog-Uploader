import type { Product } from '@/data/products';

export function getProductDescription(product: Product): string {
  const tone = product.category === 'Dresses'
    ? 'Cut from a fluid, breathable fabric that moves with you, this piece is designed to feel as good as it looks.'
    : product.category === 'Tops'
    ? 'A wardrobe essential reimagined with a contemporary silhouette and a soft, structured hand.'
    : product.category === 'Jeans'
    ? 'A premium denim with the perfect amount of stretch — tailored for everyday confidence.'
    : product.category === 'Outerwear'
    ? 'A sculpted layer designed to elevate any look, from city streets to cooler-weather travel.'
    : 'A coordinated look made for the moments that deserve a little more intention.';
  return `${tone} The ${product.title.toLowerCase()} is offered in ${product.colors.length} ${product.colors.length === 1 ? 'color' : 'colors'} and a full size run from ${product.sizes[0]} through ${product.sizes[product.sizes.length - 1]}, so you can find the right fit and finish for your style.`;
}

export const PRODUCT_DETAILS = [
  'Imported. Designed in-house by VELOUR atelier.',
  'Lined and constructed with reinforced seams for lasting wear.',
  'Machine wash cold inside out, lay flat to dry.',
  'Free standard shipping on orders over $150.',
  'Free returns within 30 days.',
];
