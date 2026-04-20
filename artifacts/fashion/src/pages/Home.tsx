import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { ProductCard } from '@/components/ProductCard';
import { HeroSlider, type HeroSlide } from '@/components/HeroSlider';
import { CategoryRail } from '@/components/CategoryRail';
import { HomeFilters } from '@/components/HomeFilters';
import { ProductCardSkeleton } from '@/components/ProductCardSkeleton';
import { Button } from '@/components/ui/button';
import { useProducts } from '@/context/ProductsContext';
import { RAIL_GROUPS, RAIL_LEAFS } from '@/data/taxonomy';
import type { SortKey } from '@/lib/homeFilters';
import { ArrowRight, SlidersHorizontal, X } from 'lucide-react';
import {
  DEFAULT_FILTERS,
  PRICE_MAX,
  parseFilters,
  serializeFilters,
  shopHref,
  type GenderKey,
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

// Homepage shows the "TikTok Verified" merch bucket as the featured
// grid, 40 items at a time, daily-rotated by today's UTC date so every
// visitor sees the same lineup until midnight.
const PAGE_SIZE = 40;
const FEATURED_BUCKET = 'tiktok_verified' as const;

function todaySeedUTC(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function HomePage() {
  const { search } = useProducts();
  const [, navigate] = useLocation();
  const queryString = useSearch();
  const [heroSlides, setHeroSlides] = useState<HeroSlide[]>(FALLBACK_HERO_SLIDES);
  // Hero auto-advance interval (ms). 0 disables the timer. Reads
  // `heroAutoAdvance` from /storefront/settings so the admin toggle
  // takes effect on the next page load without a redeploy.
  const [heroIntervalMs, setHeroIntervalMs] = useState<number>(6000);
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [pageLoading, setPageLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  // Bumped on every filter change so an in-flight Load More resolves
  // against the OLD filters and is then ignored.
  const filterVersionRef = useRef(0);

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
    fetch('/api/storefront/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { heroAutoAdvance?: boolean } | null) => {
        if (cancelled || !data) return;
        // `heroAutoAdvance === false` disables the timer; default ON.
        setHeroIntervalMs(data.heroAutoAdvance === false ? 0 : 6000);
      })
      .catch(() => {
        /* keep default 6000ms */
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    filterVersionRef.current += 1;
    const myVersion = filterVersionRef.current;
    setPageLoading(true);
    setItems([]);
    // A pending Load More from the previous filter set can no longer
    // affect this view (its myVersion is stale), so clear the spinner.
    setLoadingMore(false);
    search({
      category: effectiveCategory,
      gender: filters.gender === 'all' ? undefined : filters.gender,
      sizes: filters.sizes.length > 0 ? filters.sizes : undefined,
      priceMin: filters.priceMin > 0 ? filters.priceMin : undefined,
      priceMax: filters.priceMax < PRICE_MAX ? filters.priceMax : undefined,
      // Sort is intentionally ignored when daily-rotation is active; the
      // shuffle IS the order. Other filters (size, price, category, gender)
      // still narrow the pool BEFORE the shuffle, so they keep working.
      sort: filters.sort,
      bucket: FEATURED_BUCKET,
      dailyRotate: true,
      seed: todaySeedUTC(),
      limit: PAGE_SIZE,
      offset: 0,
    })
      .then((r) => {
        if (cancelled || myVersion !== filterVersionRef.current) return;
        setItems(r.products);
        setTotal(r.total);
        setPageLoading(false);
      })
      .catch(() => {
        if (cancelled || myVersion !== filterVersionRef.current) return;
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

  const loadMore = useCallback(async () => {
    if (loadingMore || pageLoading) return;
    if (items.length >= total) return;
    const myVersion = filterVersionRef.current;
    setLoadingMore(true);
    try {
      const r = await search({
        category: effectiveCategory,
        gender: filters.gender === 'all' ? undefined : filters.gender,
        sizes: filters.sizes.length > 0 ? filters.sizes : undefined,
        priceMin: filters.priceMin > 0 ? filters.priceMin : undefined,
        priceMax: filters.priceMax < PRICE_MAX ? filters.priceMax : undefined,
        sort: filters.sort,
        bucket: FEATURED_BUCKET,
        dailyRotate: true,
        seed: todaySeedUTC(),
        limit: PAGE_SIZE,
        offset: items.length,
      });
      // Filters changed mid-flight — drop these stale results.
      if (myVersion !== filterVersionRef.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...r.products.filter((p) => !seen.has(p.id))];
      });
      setTotal(r.total);
    } finally {
      if (myVersion === filterVersionRef.current) setLoadingMore(false);
    }
  }, [
    loadingMore,
    pageLoading,
    items.length,
    total,
    search,
    effectiveCategory,
    filters.gender,
    filters.sizes,
    filters.priceMin,
    filters.priceMax,
    filters.sort,
  ]);

  // LCP hint for the first hero slide. For sized .webp variants we can
  // emit the full responsive imageSrcSet; for static JPGs (the default
  // bundled heroes) we emit a plain href preload. The actual <link> is
  // emitted in JSX below — React 19 hoists it into <head> so the browser
  // sees it alongside the initial markup.
  const firstHero = heroSlides[0];
  const heroPreload = firstHero
    ? imagePreload(firstHero.image, { category: 'hero', id: 'hero-0' })
    : null;

  // Carry active filters through to /shop on every hero CTA. Slides use
  // root-relative `/shop` hrefs, so we rewrite those to include the
  // current filter set; absolute or non-shop hrefs are left alone.
  const decoratedSlides = useMemo<HeroSlide[]>(() => {
    const decorate = (href: string): string => {
      if (!href.startsWith('/shop')) return href;
      const [, slideQs = ''] = href.split('?');
      const slideParams = new URLSearchParams(slideQs);
      const merged = serializeFilters(filters);
      // Slide-level params win over homepage filters so an editor-set
      // hero CTA (e.g. "?sort=newest") still does what they intended.
      for (const [k, v] of slideParams) merged.set(k, v);
      const qs = merged.toString();
      return qs ? `/shop?${qs}` : '/shop';
    };
    return heroSlides.map((s, i) => {
      const next: HeroSlide = {
        ...s,
        primaryCta: { ...s.primaryCta, href: decorate(s.primaryCta.href) },
        secondaryCta: s.secondaryCta
          ? { ...s.secondaryCta, href: decorate(s.secondaryCta.href) }
          : undefined,
      };
      // Only the first slide gets srcset hints (it's the LCP target and
      // the only one we preload); decorating other slides would force
      // the browser to also chew through their srcset on first paint.
      if (i === 0 && heroPreload) {
        next.imageSrcSet = heroPreload.imageSrcSet;
        next.imageSizes = '100vw';
      }
      return next;
    });
  }, [heroSlides, filters, heroPreload]);

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

  // Count of filters that differ from defaults — surfaced in the rail
  // header and on the mobile "Filters" trigger so the operator can see
  // at a glance how filtered the grid currently is.
  const activeFilterCount =
    (filters.category !== DEFAULT_FILTERS.category ? 1 : 0) +
    (filters.gender !== DEFAULT_FILTERS.gender ? 1 : 0) +
    filters.sizes.length +
    (filters.priceMin !== DEFAULT_FILTERS.priceMin ||
    filters.priceMax !== DEFAULT_FILTERS.priceMax
      ? 1
      : 0) +
    (filters.sort !== DEFAULT_FILTERS.sort ? 1 : 0);

  const GENDER_OPTIONS: { value: GenderKey; label: string }[] = [
    { value: 'women', label: 'Women' },
    { value: 'men', label: 'Men' },
    { value: 'all', label: 'All' },
  ];

  // Sheet content for the phone/tablet drawer — gender + categories
  // already live inline in the horizontal bar, so the sheet only carries
  // the remaining facets (size, price, sort).
  const sheetContent = (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-foreground">
          More filters
        </h2>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              clearFilters();
              setMobileFiltersOpen(false);
            }}
            className="text-[11px] uppercase tracking-widest text-primary hover:underline"
            data-testid="home-sheet-clear"
          >
            Clear all
          </button>
        )}
      </div>
      <HomeFilters
        sizes={filters.sizes}
        onSizesChange={(s) => updateFilters({ sizes: s })}
        priceMin={filters.priceMin}
        priceMax={filters.priceMax}
        onPriceChange={(min, max) => updateFilters({ priceMin: min, priceMax: max })}
        sort={filters.sort}
        onSortChange={(s) => updateFilters({ sort: s })}
      />
    </div>
  );

  const sidebarContent = (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-foreground">
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
              {activeFilterCount}
            </span>
          )}
        </h2>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              clearFilters();
              setMobileFiltersOpen(false);
            }}
            className="text-[11px] uppercase tracking-widest text-primary hover:underline"
            data-testid="home-rail-clear"
          >
            Clear all
          </button>
        )}
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-foreground">
          Shop for
        </h3>
        <div
          role="radiogroup"
          aria-label="Shop for"
          className="grid grid-cols-3 rounded-full border border-border overflow-hidden bg-background"
        >
          {GENDER_OPTIONS.map((g) => {
            const active = filters.gender === g.value;
            return (
              <button
                key={g.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => updateFilters({ gender: g.value })}
                className={`h-10 text-xs font-semibold uppercase tracking-widest transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground/80 hover:text-foreground'
                }`}
                data-testid={`home-rail-gender-${g.value}`}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      </div>

      <CategoryRail
        active={filters.category}
        onChange={(label) => {
          updateFilters({ category: label });
          setMobileFiltersOpen(false);
        }}
      />
      <HomeFilters
        sizes={filters.sizes}
        onSizesChange={(s) => updateFilters({ sizes: s })}
        priceMin={filters.priceMin}
        priceMax={filters.priceMax}
        onPriceChange={(min, max) => updateFilters({ priceMin: min, priceMax: max })}
        sort={filters.sort}
        onSortChange={(s) => updateFilters({ sort: s })}
      />
    </div>
  );

  return (
    <>
      {/* React 19 hoists <link> into <head>; this kicks off the LCP
          fetch alongside the initial markup so the browser doesn't wait
          for React to mount the <img>. The first hero slide also carries
          the matching srcSet/sizes so the <img> reuses this preload. */}
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

      <HeroSlider slides={decoratedSlides} intervalMs={heroIntervalMs} />

      {/* Horizontal browse bar — phones + tablets only. The desktop
          (lg+) layout keeps the full sidebar rail. */}
      <div className="lg:hidden sticky top-16 md:top-[68px] z-30 bg-background/95 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-4 py-2 md:py-3 flex flex-col gap-2 md:gap-3">
          {/* Row 1 — sort + Filters (Sort pushed far left on mobile);
              gender pills hidden on phones, shown from md up. */}
          <div className="flex items-center gap-2 flex-wrap">
            <div
              role="radiogroup"
              aria-label="Shop for"
              className="hidden md:flex rounded-full border border-border overflow-hidden bg-background h-11"
            >
              {GENDER_OPTIONS.map((g) => {
                const active = filters.gender === g.value;
                return (
                  <button
                    key={g.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => updateFilters({ gender: g.value })}
                    className={`px-4 min-w-[44px] text-[11px] font-semibold uppercase tracking-widest transition-colors ${
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground/80 hover:text-foreground'
                    }`}
                    data-testid={`home-bar-gender-${g.value}`}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>

            {activeFilterCount > 0 && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-widest text-foreground/80"
                data-testid="home-bar-active-count"
              >
                <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                  {activeFilterCount}
                </span>
                active
              </span>
            )}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-[11px] uppercase tracking-widest text-primary hover:underline h-11 px-2"
                data-testid="home-bar-clear"
              >
                Clear all
              </button>
            )}

            <div className="md:ml-auto flex items-center gap-2">
              <label className="relative">
                <span className="sr-only">Sort products</span>
                <select
                  value={filters.sort}
                  onChange={(e) => updateFilters({ sort: e.target.value as SortKey })}
                  className="h-11 pl-3 pr-8 rounded-full border border-border bg-background text-[11px] font-semibold uppercase tracking-widest appearance-none"
                  data-testid="home-bar-sort"
                >
                  <option value="featured">Sort: Featured</option>
                  <option value="newest">Sort: Newest</option>
                  <option value="name-asc">Sort: A → Z</option>
                  <option value="price-asc">Sort: Price ↑</option>
                  <option value="price-desc">Sort: Price ↓</option>
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-foreground/60 text-[10px]">▾</span>
              </label>
              <button
                onClick={() => setMobileFiltersOpen(true)}
                className="inline-flex items-center gap-2 h-11 px-4 rounded-full border border-border text-[11px] uppercase tracking-widest"
                data-testid="home-bar-filters-open"
              >
                <SlidersHorizontal className="w-4 h-4" /> Filters
                {activeFilterCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Row 2 — horizontally scrolling category chips with edge fade */}
          <div className="relative -mx-4">
            <div className="overflow-x-auto px-4">
              <div className="flex items-center gap-2 whitespace-nowrap">
                {([...RAIL_LEAFS, ...RAIL_GROUPS.map((g) => g.label)] as string[]).map((label) => {
                  // Resolve active through rail hierarchy so a selected leaf
                  // (e.g. "T-Shirts") still highlights its parent group chip.
                  const parentForActive = (() => {
                    if (filters.category === label) return label;
                    const grp = RAIL_GROUPS.find((g) => g.items?.includes(filters.category));
                    return grp?.label;
                  })();
                  const active = parentForActive === label;
                  return (
                    <button
                      key={label}
                      onClick={() => updateFilters({ category: label })}
                      className={`shrink-0 h-11 px-4 rounded-full border text-[11px] font-semibold uppercase tracking-widest transition-colors ${
                        active
                          ? 'bg-foreground text-background border-foreground'
                          : 'border-border text-foreground/80 hover:text-foreground'
                      }`}
                      data-testid={`home-bar-cat-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Right-edge fade hints there's more to scroll */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 right-0 h-full w-10 bg-gradient-to-l from-background via-background/70 to-transparent"
            />
          </div>
        </div>
      </div>

      <section id="home-browse" className="py-4 md:py-20 bg-background">
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
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-3 sm:gap-x-4 gap-y-8 sm:gap-y-10">
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
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-3 sm:gap-x-4 gap-y-8 sm:gap-y-10">
                  {items.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              )}

              {items.length > 0 && (
                <div className="flex flex-col items-center gap-4 mt-12">
                  {items.length < total && (
                    <>
                      <button
                        onClick={loadMore}
                        disabled={loadingMore}
                        className="inline-flex items-center gap-2 border border-foreground text-foreground px-12 h-14 text-xs tracking-widest uppercase font-bold hover:bg-foreground hover:text-background transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        data-testid="button-home-load-more"
                      >
                        {loadingMore
                          ? 'Loading…'
                          : `Show More (${(total - items.length).toLocaleString()} left)`}
                      </button>
                      <p className="text-xs text-muted-foreground">
                        Showing {items.length.toLocaleString()} of {total.toLocaleString()}
                      </p>
                    </>
                  )}
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
            {sheetContent}
            <Button
              className="w-full h-12 rounded-full text-xs uppercase tracking-widest mt-8"
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
