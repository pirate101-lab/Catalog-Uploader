import { useEffect, useState } from 'react';
import { imageUrl, imageSrcSet, fallbackImage, isStorageConfigured, PLACEHOLDER_IMAGE } from '@/lib/imageUrl';

interface ProductImageProps {
  src?: string;
  category: string;
  id: string;
  alt: string;
  className?: string;
  /** Display width hint used to choose the default `src` variant. */
  width?: number;
  /** sizes attr passed straight through; pairs with the width-descriptor srcset. */
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
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setUrl(imageUrl(src, { category, id, w: width }));
    setErrored(false);
  }, [src, category, id, width]);

  if (!isStorageConfigured() || !src) {
    return <div aria-label={alt} className={className} />;
  }

  // Catalog assets are uploaded to R2 in 400 / 800 / 1600px widths; emit a
  // real width-descriptor srcset so browsers can pick the right file for the
  // viewport and DPR.
  const srcSet = errored ? undefined : imageSrcSet(src, { category, id });

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
        if (url !== fb && url !== PLACEHOLDER_IMAGE) {
          setErrored(true);
          setUrl(fb);
        }
      }}
    />
  );
}
