import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ALL_SIZES, type Product } from '@/data/products';
import type { GenderKey } from '@/lib/homeFilters';
import { useProducts } from '@/context/ProductsContext';
import { ProductCard } from '@/components/ProductCard';
import { ProductCardSkeleton } from '@/components/ProductCardSkeleton';
import { CategoryRail } from '@/components/CategoryRail';
import { RAIL_GROUPS } from '@/data/taxonomy';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ChevronRight, X, SlidersHorizontal } from 'lucide-react';

type SortKey = 'featured' | 'newest' | 'name-asc' | 'price-asc' | 'price-desc';
const PAGE_SIZE = 24;
const PRICE_MAX = 250;

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

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-muted text-foreground text-xs px-3 py-1.5 border border-border">
      <span className="font-medium">{label}</span>
      <button
        onClick={onClear}
        aria-label={`Remove ${label} filter`}
        className="text-muted-foreground hover:text-destructive"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </span>
  );
}

function useQueryParam(key: string): string {
  const [location] = useLocation();
  const search = typeof window !== 'undefined' ? window.location.search : '';
  void location;
  const params = new URLSearchParams(search);
  return params.get(key) ?? '';
}

const SORT_KEYS: SortKey[] = ['featured', 'newest', 'name-asc', 'price-asc', 'price-desc'];
const SIZE_SET = new Set(ALL_SIZES);

function readUrlFilters(search: string): {
  category: string;
  q: string;
  gender: GenderKey;
  sizes: string[];
  priceMin: number;
  priceMax: number;
  sort: SortKey;
} {
  const p = new URLSearchParams(search);
  const genderRaw = p.get('gender');
  const gender: GenderKey =
    genderRaw === 'women' || genderRaw === 'men' ? genderRaw : 'all';
  const sortRaw = p.get('sort') as SortKey | null;
  const sort: SortKey = sortRaw && SORT_KEYS.includes(sortRaw) ? sortRaw : 'featured';
  const sizes = (p.get('sizes') ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => SIZE_SET.has(s));
  const clamp = (raw: string | null, fallback: number) => {
    if (raw === null || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(PRICE_MAX, Math.max(0, n));
  };
  const priceMin = clamp(p.get('priceMin'), 0);
  const priceMax = Math.max(priceMin, clamp(p.get('priceMax'), PRICE_MAX));
  return {
    category: p.get('category') ?? '',
    q: p.get('q') ?? '',
    gender,
    sizes,
    priceMin,
    priceMax,
    sort,
  };
}

interface FilterPanelProps {
  selectedSizes: string[];
  toggleSize: (s: string) => void;
  priceRange: [number, number];
  setPriceRange: (r: [number, number]) => void;
  topColors: { name: string; hex: string }[];
  selectedColors: string[];
  toggleColor: (c: string) => void;
  clearFilters: () => void;
}

function FilterPanel(props: FilterPanelProps) {
  const {
    selectedSizes,
    toggleSize,
    priceRange,
    setPriceRange,
    topColors,
    selectedColors,
    toggleColor,
    clearFilters,
  } = props;
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4">Size</h3>
        <div className="grid grid-cols-3 gap-2">
          {ALL_SIZES.map((size) => (
            <button
              key={size}
              onClick={() => toggleSize(size)}
              className={`h-10 text-xs font-semibold border transition-all ${
                selectedSizes.includes(size)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-foreground hover:border-foreground'
              }`}
              data-testid={`filter-size-${size}`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4">
          Price · ${priceRange[0]} – ${priceRange[1]}
        </h3>
        <Slider
          min={0}
          max={PRICE_MAX}
          step={5}
          value={priceRange}
          onValueChange={(v) => setPriceRange([v[0], v[1]] as [number, number])}
          className="mt-2"
        />
      </div>

      {topColors.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest mb-4">Color</h3>
          <div className="space-y-2 max-h-72 overflow-y-auto pr-2">
            {topColors.map((c) => (
              <label key={c.name} className="flex items-center gap-3 cursor-pointer text-sm">
                <Checkbox
                  checked={selectedColors.includes(c.name)}
                  onCheckedChange={() => toggleColor(c.name)}
                />
                <span
                  className="w-4 h-4 rounded-full border border-border"
                  style={{ backgroundColor: c.hex }}
                />
                <span className="text-muted-foreground">{c.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <Button
        variant="outline"
        className="w-full rounded-none text-xs uppercase tracking-widest"
        onClick={clearFilters}
        data-testid="button-clear-filters"
      >
        Clear Filters
      </Button>
    </div>
  );
}

export function ShopPage() {
  const { search } = useProducts();
  const initial = readUrlFilters(
    typeof window !== 'undefined' ? window.location.search : '',
  );

  const [railLabel, setRailLabel] = useState<string>(initial.category || 'All');
  const [sort, setSort] = useState<SortKey>(initial.sort);
  const [selectedSizes, setSelectedSizes] = useState<string[]>(initial.sizes);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [priceRange, setPriceRange] = useState<[number, number]>([
    initial.priceMin,
    initial.priceMax,
  ]);
  const [gender, setGender] = useState<GenderKey>(initial.gender);
  const [query, setQuery] = useState(initial.q);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [location] = useLocation();

  // Server-driven page state
  const [items, setItems] = useState<Product[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [pageLoading, setPageLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Re-sync filter state when the URL changes (e.g., user clicks a homepage
  // CTA that points to /shop?gender=men&sizes=M, or uses browser back/forward).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const next = readUrlFilters(window.location.search);
    setRailLabel(next.category || 'All');
    setQuery(next.q);
    setGender(next.gender);
    setSelectedSizes(next.sizes);
    setPriceRange([next.priceMin, next.priceMax]);
    setSort(next.sort);
  }, [location]);

  const effectiveCategory = RAIL_TO_CATEGORY[railLabel] ?? 'All';

  // Reset + fetch first page whenever the server-side filters change.
  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setOffset(0);
    setHasMore(true);
    setPageLoading(true);
    search({
      q: query.trim() || undefined,
      category: effectiveCategory,
      gender: gender === 'all' ? undefined : gender,
      sizes: selectedSizes.length > 0 ? selectedSizes : undefined,
      priceMin: priceRange[0] > 0 ? priceRange[0] : undefined,
      priceMax: priceRange[1] < PRICE_MAX ? priceRange[1] : undefined,
      sort,
      limit: PAGE_SIZE,
      offset: 0,
    })
      .then((r) => {
        if (cancelled) return;
        setItems(r.products);
        setServerTotal(r.total);
        setOffset(r.products.length);
        setHasMore(r.products.length < r.total);
        setPageLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPageLoading(false);
        setHasMore(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveCategory, query, sort, search, gender, selectedSizes, priceRange]);

  // Infinite scroll: when sentinel hits viewport, load the next page.
  // Each filter combination gets its own version token so a slow page
  // request from a previous filter set can never append into a fresh one.
  const filterVersionRef = useRef(0);
  useEffect(() => {
    filterVersionRef.current += 1;
  }, [effectiveCategory, query, sort, gender, selectedSizes, priceRange]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || pageLoading) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const version = filterVersionRef.current;
          setPageLoading(true);
          search({
            q: query.trim() || undefined,
            category: effectiveCategory,
            gender: gender === 'all' ? undefined : gender,
            sizes: selectedSizes.length > 0 ? selectedSizes : undefined,
            priceMin: priceRange[0] > 0 ? priceRange[0] : undefined,
            priceMax: priceRange[1] < PRICE_MAX ? priceRange[1] : undefined,
            sort,
            limit: PAGE_SIZE,
            offset,
          })
            .then((r) => {
              if (version !== filterVersionRef.current) return;
              setItems((prev) => [...prev, ...r.products]);
              setOffset((prevOffset) => {
                const next = prevOffset + r.products.length;
                setHasMore(next < r.total);
                return next;
              });
              setServerTotal(r.total);
            })
            .finally(() => {
              if (version === filterVersionRef.current) setPageLoading(false);
            });
          break;
        }
      },
      { rootMargin: '600px' },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [
    hasMore,
    pageLoading,
    offset,
    effectiveCategory,
    query,
    sort,
    search,
    gender,
    selectedSizes,
    priceRange,
  ]);

  // Client-side refinements (size/color/price) operate on whatever is loaded.
  // Top colors are derived from currently-loaded items (best effort).
  const topColors = useMemo(() => {
    const counts = new Map<string, { hex: string; n: number }>();
    for (const p of items) {
      for (const c of p.colors) {
        const cur = counts.get(c.name);
        if (cur) cur.n++;
        else counts.set(c.name, { hex: c.hex, n: 1 });
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 20)
      .map(([name, v]) => ({ name, hex: v.hex }));
  }, [items]);

  const refined = useMemo(() => {
    let list = items;
    list = list.filter((p) => p.price >= priceRange[0] && p.price <= priceRange[1]);
    if (selectedSizes.length) {
      list = list.filter((p) => p.sizes.some((s) => selectedSizes.includes(s)));
    }
    if (selectedColors.length) {
      list = list.filter((p) => p.colors.some((c) => selectedColors.includes(c.name)));
    }
    return list;
  }, [items, selectedSizes, selectedColors, priceRange]);

  const toggleSize = (size: string) =>
    setSelectedSizes((c) => (c.includes(size) ? c.filter((s) => s !== size) : [...c, size]));
  const toggleColor = (color: string) =>
    setSelectedColors((c) => (c.includes(color) ? c.filter((x) => x !== color) : [...c, color]));

  const clearFilters = () => {
    setRailLabel('All');
    setSelectedSizes([]);
    setSelectedColors([]);
    setPriceRange([0, PRICE_MAX]);
    setQuery('');
  };

  const initialLoading = pageLoading && items.length === 0;

  return (
    <section className="pb-24 bg-background min-h-screen">
      <div className="container mx-auto px-4 pt-6">
        <nav className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-6">
          <Link href="/" className="hover:text-foreground">Home</Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground">Shop</span>
          {railLabel !== 'All' && (
            <>
              <ChevronRight className="w-3 h-3" />
              <span className="text-foreground">{railLabel}</span>
            </>
          )}
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-10">
          <aside className="hidden lg:block lg:sticky lg:top-32 lg:self-start lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto pr-2 space-y-10">
            <CategoryRail active={railLabel} onChange={setRailLabel} />
            <FilterPanel
              selectedSizes={selectedSizes}
              toggleSize={toggleSize}
              priceRange={priceRange}
              setPriceRange={setPriceRange}
              topColors={topColors}
              selectedColors={selectedColors}
              toggleColor={toggleColor}
              clearFilters={clearFilters}
            />
          </aside>

          <div>
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
              <div>
                <h1 className="font-serif text-3xl md:text-4xl font-extrabold text-foreground mb-1">
                  {railLabel === 'All' ? 'Shop All' : railLabel}
                </h1>
                <p className="text-muted-foreground text-sm">
                  {initialLoading
                    ? 'Loading the catalog…'
                    : `${serverTotal.toLocaleString()} pieces`}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMobileFiltersOpen(true)}
                  className="lg:hidden inline-flex items-center gap-2 h-10 px-4 border border-border text-xs uppercase tracking-widest"
                  data-testid="button-mobile-filters"
                >
                  <SlidersHorizontal className="w-4 h-4" /> Filter
                </button>
                <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                  <SelectTrigger className="w-[180px] rounded-none h-10" data-testid="select-sort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="featured">Featured</SelectItem>
                    <SelectItem value="newest">Newest</SelectItem>
                    <SelectItem value="name-asc">Name: A → Z</SelectItem>
                    <SelectItem value="price-asc">Price: Low to High</SelectItem>
                    <SelectItem value="price-desc">Price: High to Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {(query ||
              railLabel !== 'All' ||
              selectedSizes.length > 0 ||
              selectedColors.length > 0 ||
              priceRange[0] !== 0 ||
              priceRange[1] !== PRICE_MAX) && (
              <div className="flex flex-wrap items-center gap-2 mb-6">
                <span className="text-xs uppercase tracking-widest text-muted-foreground mr-1">
                  Active filters:
                </span>
                {query && <FilterChip label={`Search: ${query}`} onClear={() => setQuery('')} />}
                {railLabel !== 'All' && (
                  <FilterChip label={railLabel} onClear={() => setRailLabel('All')} />
                )}
                {selectedSizes.map((s) => (
                  <FilterChip key={s} label={`Size ${s}`} onClear={() => toggleSize(s)} />
                ))}
                {selectedColors.map((c) => (
                  <FilterChip key={c} label={c} onClear={() => toggleColor(c)} />
                ))}
                {(priceRange[0] !== 0 || priceRange[1] !== PRICE_MAX) && (
                  <FilterChip
                    label={`$${priceRange[0]} – $${priceRange[1]}`}
                    onClear={() => setPriceRange([0, PRICE_MAX])}
                  />
                )}
                <button
                  onClick={clearFilters}
                  className="text-xs uppercase tracking-widest text-primary hover:underline ml-2"
                  data-testid="button-clear-all-filters"
                >
                  Clear all
                </button>
              </div>
            )}

            {initialLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-10">
                {Array.from({ length: 12 }).map((_, i) => (
                  <ProductCardSkeleton key={i} />
                ))}
              </div>
            ) : refined.length === 0 ? (
              <div className="text-center py-32 text-muted-foreground font-light text-lg">
                No products match these filters.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-10">
                  {refined.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>

                {hasMore && (
                  <div
                    ref={sentinelRef}
                    className="mt-12 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-10"
                  >
                    {Array.from({ length: 4 }).map((_, i) => (
                      <ProductCardSkeleton key={i} />
                    ))}
                  </div>
                )}
                {!hasMore && serverTotal > PAGE_SIZE && (
                  <p className="text-center text-xs uppercase tracking-widest text-muted-foreground mt-16">
                    You&apos;ve reached the end · {serverTotal.toLocaleString()} pieces
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileFiltersOpen(false)}
          />
          <div className="absolute left-0 top-0 bottom-0 w-[88%] max-w-sm bg-background overflow-y-auto p-6 space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-xl font-extrabold">Filter</h2>
              <button
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="Close filters"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <CategoryRail
              active={railLabel}
              onChange={(l) => {
                setRailLabel(l);
                setMobileFiltersOpen(false);
              }}
            />
            <FilterPanel
              selectedSizes={selectedSizes}
              toggleSize={toggleSize}
              priceRange={priceRange}
              setPriceRange={setPriceRange}
              topColors={topColors}
              selectedColors={selectedColors}
              toggleColor={toggleColor}
              clearFilters={clearFilters}
            />
            <Button
              className="w-full h-12 rounded-none text-xs uppercase tracking-widest"
              onClick={() => setMobileFiltersOpen(false)}
            >
              View {refined.length.toLocaleString()} results
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
