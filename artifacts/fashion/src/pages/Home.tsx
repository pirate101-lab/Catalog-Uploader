import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { ProductCard } from '@/components/ProductCard';
import { HeroSlider, type HeroSlide } from '@/components/HeroSlider';
import { CategoryRail } from '@/components/CategoryRail';
import { HomeFilters } from '@/components/HomeFilters';
import { ProductCardSkeleton } from '@/components/ProductCardSkeleton';
import { Button } from '@/components/ui/button';
import { useProducts } from '@/context/ProductsContext';
import { RAIL_GROUPS } from '@/data/taxonomy';
import { ArrowRight, SlidersHorizontal, X } from 'lucide-react';
import {
  DEFAULT_FILTERS,
  PRICE_MAX,
  parseFilters,
  serializeFilters,
  shopHref,
  type HomeFilterState,
} from '@/lib/homeFilters';
import { imagePreload } from '@/lib/imageUrl';
import type { Product } from '@/data/products';

interface ApiHeroSlide {
  id: number;
  imageUrl: string | null;
  kicker?: string | null;
  headline?: string;
  subline?: string | null;
  primaryLabel?: string | null;
  primaryHref?: string | null;
  secondaryLabel?: string | null;
  secondaryHref?: string | null;
  title?: string;
  subtitle?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
}

const FALLBACK_HERO_SLIDES: HeroSlide[] = [
  {
    image: `${import.meta.env.BASE_URL}hero-1-boutique.jpg`,
    imageAlt: 'Couple seated together on a velvet bench inside a warmly lit designer boutique',
    kicker: 'Fall / Winter 2026',
    headline: 'LOVE WITH STYLE',
    subline: 'The New Season Collection',
    primaryCta: { label: 'Shop the Collection', href: '/shop' },
    secondaryCta: { label: 'Explore Featured', href: '/shop' },
  },
  {
    image: `${import.meta.env.BASE_URL}hero-2-display.jpg`,
    imageAlt: 'Spotlit mannequin in a sculpted coat on display in a dark studio showroom',
    kicker: 'Step Inside',
    headline: 'THE TAILORING FLOOR',
    subline: 'Quiet luxury, sharp shoulders, the cuts our stylists are reaching for first.',
    primaryCta: { label: 'Shop Tailoring', href: '/shop?category=Outerwear' },
    secondaryCta: { label: 'See the Edit', href: '/shop' },
  },
  {
    image: `${import.meta.env.BASE_URL}hero-3-vintage.jpg`,
    imageAlt: 'Two stylists chatting at the counter of a vintage-inspired boutique',
    kicker: 'Weekend Drop',
    headline: 'STUDIO STORIES',
    subline: 'Off-duty silhouettes, easy denim and the prints lighting up your feed.',
    primaryCta: { label: 'Shop New In', href: '/shop?sort=newest' },
    secondaryCta: { label: 'Browse All', href: '/shop' },
  },
  {
    image: `${import.meta.env.BASE_URL}hero-4-moda.jpg`,
    imageAlt: 'Two friends browsing a rail of dresses together at a sunlit boutique',
    kicker: 'Bring a Friend',
    headline: 'STYLED TOGETHER',
    subline: 'The pieces your group chat will fight over — pulled, tried on, and sent home today.',
    primaryCta: { label: 'Shop the Drop', href: '/shop?sort=newest' },
    secondaryCta: { label: 'Find Your Fit', href: '/shop' },
  },
];

// Same fine→coarse mapping as the Shop page so the rail filters the
// preview grid sensibly.
const RAIL_TO_CATEGORY: Record<string, string> = {
  All: 'All',
  'Plus Size': 'All',
  Tops: 'Tops',
  Dresses: 'Dresses',
  'Jeans & Denim': 'Bottoms',
  Swimwear: 'Swim',
  'Jumpsuits & Rompers': 'Jumpsuits',
  Bottoms: 'Bottoms',
  'Two-Piece Sets': 'Sets',
  Activewear: 'Tops',
  'Sweaters & Knitwear': 'Knitwear',
  Outerwear: 'Outerwear',
  'Loungewear & Intimates': 'Lingerie',
  Graphic: 'Tops',
};
for (const g of RAIL_GROUPS) {
  for (const item of g.items ?? []) {
    if (RAIL_TO_CATEGORY[item] === undefined) {
      RAIL_TO_CATEGORY[item] = RAIL_TO_CATEGORY[g.label] ?? 'All';
    }
  }
}

const PAGE_SIZE = 24;

export function HomePage() {
  const { search } = useProducts();
  const [, navigate] = useLocation();
  const queryString = useSearch();
  const [heroSlides, setHeroSlides] = useState<HeroSlide[]>(FALLBACK_HERO_SLIDES);
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [pageLoading, setPageLoading] = useState(true);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // URL-driven filter state. parseFilters tolerates missing/garbage params
  // so the homepage always renders even with a stray refresh.
  const filters = useMemo<HomeFilterState>(() => parseFilters(queryString), [queryString]);

  const updateFilters = useCallback(
    (patch: Partial<HomeFilterState>) => {
      const next = { ...filters, ...patch };
      const qs = serializeFilters(next).toString();
      navigate(qs ? `/?${qs}` : '/', { replace: true });
    },
    [filters, navigate],
  );

  const clearFilters = useCallback(() => {
    navigate('/', { replace: true });
  }, [navigate]);

  // Hero slides
  useEffect(() => {
    let cancelled = false;
    fetch('/api/storefront/hero')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((rows: ApiHeroSlide[]) => {
        if (cancelled || !Array.isArray(rows) || rows.length === 0) return;
        const base = (import.meta.env.BASE_URL as string | undefined) ?? '/';
        const resolveImg = (raw: string | null, i: number): string => {
          if (!raw) return FALLBACK_HERO_SLIDES[i % FALLBACK_HERO_SLIDES.length]!.image;
          if (raw.startsWith('/') && !raw.startsWith('//')) {
            return `${base.replace(/\/$/, '')}${raw}`;
          }
          return raw;
        };
        setHeroSlides(
          rows.map((r, i) => {
            const fallback = FALLBACK_HERO_SLIDES[i % FALLBACK_HERO_SLIDES.length]!;
            const headline = (r.headline ?? r.title ?? '').trim() || fallback.headline;
            const subline = (r.subline ?? r.subtitle ?? '') || fallback.subline;
            const kicker = r.kicker ?? fallback.kicker;
            const primaryLabel = r.primaryLabel ?? r.ctaLabel ?? fallback.primaryCta.label;
            const primaryHref = r.primaryHref ?? r.ctaHref ?? fallback.primaryCta.href;
            return {
              image: resolveImg(r.imageUrl, i),
              imageAlt: headline,
              kicker: kicker ?? undefined,
              headline,
              subline: subline ?? undefined,
              primaryCta: { label: primaryLabel, href: primaryHref },
              secondaryCta: r.secondaryLabel
                ? { label: r.secondaryLabel, href: r.secondaryHref ?? '/shop' }
                : fallback.secondaryCta,
            };
          }),
        );
      })
      .catch(() => {
        // Keep the fallback slides on any failure so the page never breaks.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The rail uses the user-facing label; map it to the storage category.
  const effectiveCategory = RAIL_TO_CATEGORY[filters.category] ?? filters.category ?? 'All';

  // Refetch the grid whenever the URL filters change.
  useEffect(() => {
    let cancelled = false;
    setPageLoading(true);
    search({
      category: effectiveCategory,
      gender: filters.gender === 'all' ? undefined : filters.gender,
      sizes: filters.sizes.length > 0 ? filters.sizes : undefined,
      priceMin: filters.priceMin > 0 ? filters.priceMin : undefined,
      priceMax: filters.priceMax < PRICE_MAX ? filters.priceMax : undefined,
      sort: filters.sort,
      limit: PAGE_SIZE,
      offset: 0,
    })
      .then((r) => {
        if (cancelled) return;
        setItems(r.products);
        setTotal(r.total);
        setPageLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setTotal(0);
        setPageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    effectiveCategory,
    filters.gender,
    filters.sizes,
    filters.priceMin,
    filters.priceMax,
    filters.sort,
    search,
  ]);

  // LCP hint for the first hero slide. For sized .webp variants we can
  // emit the full responsive imageSrcSet; for static JPGs (the default
  // bundled heroes) we emit a plain href preload.
  const firstHero = heroSlides[0];
  const heroPreload = firstHero
    ? imagePreload(firstHero.image, { category: 'hero', id: 'hero-0' })
    : null;
  useEffect(() => {
    if (!firstHero) return;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    (link as HTMLLinkElement & { fetchPriority?: string }).fetchPriority = 'high';
    if (heroPreload) {
      link.href = heroPreload.href;
      link.setAttribute('imagesrcset', heroPreload.imageSrcSet);
      link.setAttribute('imagesizes', '100vw');
      link.type = heroPreload.type;
    } else {
      link.href = firstHero.image;
    }
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, [firstHero, heroPreload]);

  const hasActiveFilters =
    filters.category !== DEFAULT_FILTERS.category ||
    filters.gender !== DEFAULT_FILTERS.gender ||
    filters.sizes.length > 0 ||
    filters.priceMin !== DEFAULT_FILTERS.priceMin ||
    filters.priceMax !== DEFAULT_FILTERS.priceMax ||
    filters.sort !== DEFAULT_FILTERS.sort;

  const headline = (() => {
    if (filters.category && filters.category !== 'All') return filters.category;
    if (filters.gender === 'men') return "Men's Edit";
    if (filters.gender === 'women') return "Women's Edit";
    return 'Browse the Collection';
  })();

  const sidebarContent = (
    <div className="space-y-10">
      <CategoryRail
        active={filters.category}
        onChange={(label) => {
          updateFilters({ category: label });
          setMobileFiltersOpen(false);
        }}
      />
      <HomeFilters
        gender={filters.gender}
        onGenderChange={(g) => updateFilters({ gender: g })}
        sizes={filters.sizes}
        onSizesChange={(s) => updateFilters({ sizes: s })}
        priceMin={filters.priceMin}
        priceMax={filters.priceMax}
        onPriceChange={(min, max) => updateFilters({ priceMin: min, priceMax: max })}
        sort={filters.sort}
        onSortChange={(s) => updateFilters({ sort: s })}
        onClear={() => {
          clearFilters();
          setMobileFiltersOpen(false);
        }}
      />
    </div>
  );

  return (
    <>
      {/* React 19 hoists <link> into <head>; this kicks off the LCP fetch
          alongside the initial markup so the browser doesn't wait for
          React to mount the <img>. The useEffect above is a safety net
          for browsers/runtimes that don't hoist (and lets us also set
          fetchPriority="high"). */}
      {firstHero && heroPreload && (
        <link
          rel="preload"
          as="image"
          href={heroPreload.href}
          imageSrcSet={heroPreload.imageSrcSet}
          imageSizes="100vw"
          type={heroPreload.type}
          fetchPriority="high"
        />
      )}
      {firstHero && !heroPreload && (
        <link
          rel="preload"
          as="image"
          href={firstHero.image}
          fetchPriority="high"
        />
      )}

      <HeroSlider slides={heroSlides} />

      <section id="home-browse" className="py-12 md:py-20 bg-background">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
            <div>
              <span className="text-xs font-bold uppercase tracking-[0.3em] text-primary mb-3 block">
                The Edit
              </span>
              <h2 className="font-serif text-3xl md:text-4xl font-extrabold text-foreground">
                {headline}
              </h2>
              <p className="text-sm text-muted-foreground mt-2">
                {pageLoading && items.length === 0
                  ? 'Loading the collection…'
                  : `${total.toLocaleString()} pieces available`}
              </p>
            </div>
            <div className="flex items-center gap-3 self-start md:self-auto">
              <button
                onClick={() => setMobileFiltersOpen(true)}
                className="lg:hidden inline-flex items-center gap-2 h-10 px-4 border border-border text-xs uppercase tracking-widest"
                data-testid="home-filters-open"
              >
                <SlidersHorizontal className="w-4 h-4" /> Filters
              </button>
              <Link
                href={shopHref(filters)}
                className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-primary hover:underline"
                data-testid="home-view-all"
              >
                View all <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-10">
            <aside className="hidden lg:block lg:sticky lg:top-32 lg:self-start lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto pr-2">
              {sidebarContent}
            </aside>

            <div>
              {pageLoading && items.length === 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-10">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <ProductCardSkeleton key={i} />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <div className="text-center py-24 text-muted-foreground">
                  <p className="mb-4">No pieces match these filters.</p>
                  {hasActiveFilters && (
                    <button
                      onClick={clearFilters}
                      className="text-xs uppercase tracking-widest text-primary hover:underline"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-10">
                  {items.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              )}

              {items.length > 0 && (
                <div className="flex justify-center mt-12">
                  <Link
                    href={shopHref(filters)}
                    className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-12 h-14 text-xs tracking-widest uppercase font-bold shadow-lg hover:shadow-xl transition-all"
                    data-testid="link-shop-collection"
                  >
                    Shop the Full Collection <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileFiltersOpen(false)}
          />
          <div className="absolute left-0 top-0 bottom-0 w-[88%] max-w-sm bg-background overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-serif text-xl font-extrabold">Filters</h2>
              <button
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="Close filters"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {sidebarContent}
            <Button
              className="w-full h-12 rounded-none text-xs uppercase tracking-widest mt-8"
              onClick={() => setMobileFiltersOpen(false)}
            >
              View {total.toLocaleString()} results
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
