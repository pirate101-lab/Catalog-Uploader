import { useEffect, useState } from 'react';
import { imageUrl, fallbackImage, isStorageConfigured, PLACEHOLDER_IMAGE } from '@/lib/imageUrl';

interface ProductImageProps {
  src?: string;
  category: string;
  id: string;
  alt: string;
  className?: string;
  width?: number;
  loading?: 'lazy' | 'eager';
}

export function ProductImage({
  src,
  category,
  id,
  alt,
  className,
  width = 600,
  loading = 'lazy',
}: ProductImageProps) {
  const initial = imageUrl(src, { category, id, w: width });
  const [url, setUrl] = useState(initial);

  useEffect(() => {
    setUrl(imageUrl(src, { category, id, w: width }));
  }, [src, category, id, width]);

  // While catalog photos haven't been wired up yet, render an empty neutral
  // box (no fallback graphic, no shimmer) so the UI stays calm. Once storage
  // is configured the real photos light up automatically.
  if (!isStorageConfigured() || !src) {
    return <div aria-label={alt} className={className} />;
  }

  return (
    <img
      src={url}
      alt={alt}
      loading={loading}
      decoding="async"
      className={className}
      onError={() => {
        const fb = fallbackImage(category, id, width);
        if (url !== fb && url !== PLACEHOLDER_IMAGE) setUrl(fb);
      }}
    />
  );
}
