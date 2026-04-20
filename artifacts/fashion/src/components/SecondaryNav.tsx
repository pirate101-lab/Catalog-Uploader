import { useLocation } from 'wouter';
import { TOP_LEVEL } from '@/data/taxonomy';

/**
 * Trendsi-style horizontal top-level category bar that sits directly under
 * the main header. Highlights the active entry derived from the current
 * URL's `?category=` (or "Category" by default on the Shop page).
 */
export function SecondaryNav() {
  const [location, navigate] = useLocation();
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const params = new URLSearchParams(search);
  const activeCategory = params.get('category');
  const onShop = location.startsWith('/shop');
  const active = activeCategory ?? (onShop ? 'Category' : null);

  const onClick = (label: string) => {
    if (label === 'Category') {
      navigate('/shop');
      return;
    }
    if (label === 'Sale') {
      navigate('/shop?category=Sale');
      return;
    }
    navigate(`/shop?category=${encodeURIComponent(label)}`);
  };

  return (
    <div className="border-b border-border bg-background/95 backdrop-blur-md">
      <div className="container mx-auto px-2 md:px-4">
        <ul
          className="flex items-center gap-2 md:gap-1 lg:gap-2 overflow-x-auto whitespace-nowrap snap-x snap-mandatory no-scrollbar h-11"
          role="tablist"
        >
          {TOP_LEVEL.map((label) => {
            const isActive = label === active;
            const isSale = label === 'Sale';
            return (
              <li key={label} className="snap-start">
                <button
                  onClick={() => onClick(label)}
                  className={`relative inline-flex items-center px-3 md:px-4 h-11 text-[12px] font-extrabold tracking-[0.16em] uppercase transition-colors ${
                    isActive
                      ? 'text-foreground'
                      : isSale
                        ? 'text-primary hover:text-primary/80'
                        : 'text-foreground/85 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground'
                  }`}
                  data-testid={`secondary-nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  {label}
                  {isActive && (
                    <span className="absolute left-3 right-3 md:left-4 md:right-4 bottom-0 h-[2px] bg-primary" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
