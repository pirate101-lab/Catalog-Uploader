import { useEffect, useState } from 'react';
import { imageUrl, fallbackImage, isStorageConfigured, PLACEHOLDER_IMAGE } from '@/lib/imageUrl';

interface ProductImageProps {
  src?: string;
  category: string;
  id: string;
  alt: string;
  className?: string;
  /** Display width hint for srcset / DPR scaling. Omit to skip srcset. */
  width?: number;
  /** sizes attr passed straight through. */
  sizes?: string;
  loading?: 'lazy' | 'eager';
  /** When true, marks the image as high priority for the browser. */
  priority?: boolean;
}

export function ProductImage({
  src,
  category,
  id,
  alt,
  className,
  width,
  sizes,
  loading = 'lazy',
  priority = false,
}: ProductImageProps) {
  const initial = imageUrl(src, { category, id, w: width });
  const [url, setUrl] = useState(initial);

  useEffect(() => {
    setUrl(imageUrl(src, { category, id, w: width }));
  }, [src, category, id, width]);

  if (!isStorageConfigured() || !src) {
    return <div aria-label={alt} className={className} />;
  }

  // Our R2 catalog ships a single resolution per asset, so DPR-based srcset
  // hints just nudge browsers to upscale less aggressively on retina screens.
  const srcSet = width ? `${url} 1x, ${url} 2x` : undefined;

  return (
    <img
      src={url}
      srcSet={srcSet}
      sizes={sizes}
      alt={alt}
      loading={priority ? 'eager' : loading}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
      className={className}
      onError={() => {
        const fb = fallbackImage(category, id, width);
        if (url !== fb && url !== PLACEHOLDER_IMAGE) setUrl(fb);
      }}
    />
  );
}
