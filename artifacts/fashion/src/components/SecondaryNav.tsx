import { useLocation } from 'wouter';
import { TOP_LEVEL, TOP_LEVEL_BUCKETS } from '@/data/taxonomy';

/**
 * Trendsi-style horizontal top-level category bar that sits directly under
 * the main header. The four merch tabs (New In, Collection, TikTok
 * Verified, Trending) navigate to /shop with `?bucket=...`; "Category"
 * opens the unfiltered /shop view. Active highlight is derived from the
 * current URL's `?bucket=` param.
 */
export function SecondaryNav() {
  const [location, navigate] = useLocation();
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const params = new URLSearchParams(search);
  const activeBucket = params.get('bucket');
  const onShop = location.startsWith('/shop');
  // Reverse-lookup the nav label for the active bucket.
  const activeLabel = (() => {
    if (!activeBucket) return onShop ? 'Category' : null;
    for (const [label, bk] of Object.entries(TOP_LEVEL_BUCKETS)) {
      if (bk === activeBucket) return label;
    }
    return null;
  })();

  const onClick = (label: string) => {
    const bucket = TOP_LEVEL_BUCKETS[label];
    if (!bucket) {
      navigate('/shop');
      return;
    }
    navigate(`/shop?bucket=${encodeURIComponent(bucket)}`);
  };

  return (
    <div className="border-b border-border bg-background/95 backdrop-blur-md">
      <div className="container mx-auto px-2 md:px-4">
        <ul
          className="flex items-center gap-2 md:gap-1 lg:gap-2 overflow-x-auto whitespace-nowrap no-scrollbar h-11"
          role="tablist"
        >
          {TOP_LEVEL.map((label) => {
            const isActive = label === activeLabel;
            return (
              <li key={label}>
                <button
                  type="button"
                  onClick={() => onClick(label)}
                  className={`inline-flex items-center px-3 md:px-4 h-11 text-[12px] font-extrabold tracking-[0.16em] uppercase transition-colors touch-manipulation ${
                    isActive
                      ? 'text-foreground'
                      : 'text-foreground/85 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground'
                  }`}
                  data-testid={`secondary-nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <span className="relative inline-block py-1">
                    {label}
                    {isActive && (
                      <span className="absolute left-0 right-0 -bottom-0.5 h-[2px] bg-primary" />
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
