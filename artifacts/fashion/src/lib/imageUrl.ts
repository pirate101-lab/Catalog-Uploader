// Resolves catalog image paths to displayable URLs.
//
// The storefront API returns fully-qualified image URLs (Cloudflare R2 CDN),
// so we pass absolute URLs straight through. Relative paths are joined with
// VITE_STORAGE_BASE_URL when provided, otherwise we render the bundled
// "PHOTO COMING SOON" placeholder.

const STORAGE_BASE = (import.meta.env.VITE_STORAGE_BASE_URL as string | undefined)?.replace(/\/$/, '');
const BASE_URL = (import.meta.env.BASE_URL as string | undefined) ?? '/';

export const PLACEHOLDER_IMAGE = `${BASE_URL}image-coming-soon.svg`;

function isAbsolute(url: string): boolean {
  return /^(https?:)?\/\//i.test(url);
}

export function imageUrl(
  path: string | undefined,
  _opts: { category: string; id: string; w?: number },
): string {
  if (!path) return PLACEHOLDER_IMAGE;
  if (isAbsolute(path)) return path;
  if (STORAGE_BASE) return `${STORAGE_BASE}/${path}`;
  return PLACEHOLDER_IMAGE;
}

// Kept for backwards compatibility with <ProductImage>'s onError handler.
export function fallbackImage(_category: string, _id: string, _w = 600): string {
  return PLACEHOLDER_IMAGE;
}

export function isStorageConfigured(): boolean {
  return true;
}
