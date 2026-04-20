// Resolves catalog image paths to displayable URLs.
//
// The canonical source is the user's catalog photos, served from Replit
// Object Storage. Set VITE_STORAGE_BASE_URL (e.g. "/api/storage/public-objects")
// once the upload script in `scripts/src/upload-catalog-images.ts` has run.
//
// When storage isn't configured yet, every product falls back to the bundled
// "PHOTO COMING SOON" placeholder so the storefront stays visually consistent
// instead of showing arbitrary stock imagery.

const STORAGE_BASE = (import.meta.env.VITE_STORAGE_BASE_URL as string | undefined)?.replace(/\/$/, '');
const BASE_URL = (import.meta.env.BASE_URL as string | undefined) ?? '/';

if (!STORAGE_BASE && typeof window !== 'undefined') {
  // eslint-disable-next-line no-console
  console.warn(
    '[VELOUR] VITE_STORAGE_BASE_URL is not set — every product image will render the bundled "Photo Coming Soon" placeholder. Run `pnpm exec tsx scripts/src/upload-catalog-images.ts` and set VITE_STORAGE_BASE_URL to switch over to your real catalog photos.',
  );
}

export const PLACEHOLDER_IMAGE = `${BASE_URL}image-coming-soon.svg`;

export function imageUrl(
  path: string | undefined,
  _opts: { category: string; id: string; w?: number },
): string {
  if (STORAGE_BASE && path) return `${STORAGE_BASE}/${path}`;
  return PLACEHOLDER_IMAGE;
}

// Kept for backwards compatibility with <ProductImage>'s onError handler.
export function fallbackImage(_category: string, _id: string, _w = 600): string {
  return PLACEHOLDER_IMAGE;
}

export function isStorageConfigured(): boolean {
  return Boolean(STORAGE_BASE);
}
