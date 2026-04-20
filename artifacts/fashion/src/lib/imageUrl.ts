// Resolves catalog image paths to displayable URLs.
//
// The storefront API returns fully-qualified image URLs (Cloudflare R2 CDN),
// so we pass absolute URLs straight through. Relative paths are joined with
// VITE_STORAGE_BASE_URL when provided, otherwise we render the bundled
// "PHOTO COMING SOON" placeholder.
//
// Catalog .webp assets in R2 are stored as a single canonical file (no
// per-width variants exist on the bucket today), so we render the base
// URL as-is and skip building a `srcset`.

const STORAGE_BASE = (import.meta.env.VITE_STORAGE_BASE_URL as string | undefined)?.replace(/\/$/, '');
const BASE_URL = (import.meta.env.BASE_URL as string | undefined) ?? '/';

export const PLACEHOLDER_IMAGE = `${BASE_URL}image-coming-soon.svg`;

export const IMAGE_WIDTHS = [400, 800, 1600] as const;
const DEFAULT_WIDTH = 800;

function isAbsolute(url: string): boolean {
  return /^(https?:)?\/\//i.test(url);
}

function resolveBase(path: string): string | null {
  if (isAbsolute(path)) return path;
  if (STORAGE_BASE) return `${STORAGE_BASE}/${path}`;
  return null;
}

function pickWidth(target: number): number {
  for (const w of IMAGE_WIDTHS) {
    if (w >= target) return w;
  }
  return IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1];
}

// Inject `_<width>` before the .webp extension. Non-.webp URLs (e.g.
// remote source images) are returned unchanged so callers still get a
// usable URL.
function withSize(url: string, width: number): string {
  return url.replace(/(\.webp)(\?.*)?$/i, `_${width}$1$2`);
}

function isSizedAsset(url: string): boolean {
  return /\.webp(\?.*)?$/i.test(url);
}

export function imageUrl(
  path: string | undefined,
  _opts: { category: string; id: string; w?: number },
): string {
  if (!path) return PLACEHOLDER_IMAGE;
  const base = resolveBase(path);
  if (!base) return PLACEHOLDER_IMAGE;
  return base;
}

export function imageSrcSet(
  _path: string | undefined,
  _opts: { category: string; id: string },
): string | undefined {
  return undefined;
}

// Builds the inputs needed for a `<link rel="preload" as="image">` hint that
// mirrors what <ProductImage> will request. Returns null when the asset is
// not a sized .webp (e.g. external/legacy images) since the browser can't
// usefully preload a non-srcset variant we won't actually render.
export function imagePreload(
  path: string | undefined,
  _opts: { category: string; id: string; w?: number },
): { href: string; imageSrcSet: string; type: string } | null {
  if (!path) return null;
  const base = resolveBase(path);
  if (!base || !isSizedAsset(base)) return null;
  return {
    href: base,
    imageSrcSet: `${base} ${DEFAULT_WIDTH}w`,
    type: 'image/webp',
  };
}

// Kept for backwards compatibility with <ProductImage>'s onError handler.
export function fallbackImage(_category: string, _id: string, _w = 600): string {
  return PLACEHOLDER_IMAGE;
}

export function isStorageConfigured(): boolean {
  return true;
}
