import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ProductCard } from '@/components/ProductCard';
import { HeroSlider, type HeroSlide } from '@/components/HeroSlider';
import { CategoryRail } from '@/components/CategoryRail';
import { ProductCardSkeleton } from '@/components/ProductCardSkeleton';
import { useProducts } from '@/context/ProductsContext';
import { RAIL_GROUPS } from '@/data/taxonomy';
import { ArrowRight } from 'lucide-react';
import type { Product } from '@/data/products';

interface ApiHeroSlide {
  id: number;
  imageUrl: string | null;
  kicker: string | null;
  headline: string;
  subline: string | null;
  primaryLabel: string | null;
  primaryHref: string | null;
  secondaryLabel: string | null;
  secondaryHref: string | null;
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
// preview grid sensibly. Kept inline here to avoid a new shared module
// just for this preview shell.
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

const PREVIEW_COUNT = 12;

export function HomePage() {
  const { featured, loading: featuredLoading, search } = useProducts();
  const [railLabel, setRailLabel] = useState<string>('All');
  const [, navigate] = useLocation();
  const [heroSlides, setHeroSlides] = useState<HeroSlide[]>(FALLBACK_HERO_SLIDES);
  const [previewSlice, setPreviewSlice] = useState<Product[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Pull hero slides from the admin-managed API; fall back to bundled
  // images if the API is unreachable or has no slides configured yet.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/storefront/hero')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((rows: ApiHeroSlide[]) => {
        if (cancelled || !Array.isArray(rows) || rows.length === 0) return;
        setHeroSlides(
          rows.map((r, i) => ({
            image: r.imageUrl || FALLBACK_HERO_SLIDES[i % FALLBACK_HERO_SLIDES.length]!.image,
            imageAlt: r.headline,
            kicker: r.kicker ?? undefined,
            headline: r.headline,
            subline: r.subline ?? undefined,
            primaryCta: r.primaryLabel
              ? { label: r.primaryLabel, href: r.primaryHref ?? '/shop' }
              : { label: 'Shop now', href: '/shop' },
            secondaryCta: r.secondaryLabel
              ? { label: r.secondaryLabel, href: r.secondaryHref ?? '/shop' }
              : undefined,
          })),
        );
      })
      .catch(() => {
        // Keep the fallback slides on any failure so the page never breaks.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveCategory = RAIL_TO_CATEGORY[railLabel] ?? 'All';

  // For "All" we reuse the featured slice the context already loaded.
  // For specific rail labels we fetch a fresh slice from the API.
  useEffect(() => {
    if (effectiveCategory === 'All') {
      setPreviewSlice(featured.slice(0, PREVIEW_COUNT));
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    search({ category: effectiveCategory, limit: PREVIEW_COUNT, sort: 'featured' })
      .then((r) => {
        if (cancelled) return;
        setPreviewSlice(r.products);
        setPreviewLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveCategory, featured, search]);

  const loading = effectiveCategory === 'All' ? featuredLoading : previewLoading;

  // Tiny scroll affordance: keep the browse section in view when the user
  // changes the rail label so the result swap is obvious.
  useEffect(() => {
    if (railLabel === 'All') return;
    document.getElementById('home-browse')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [railLabel]);

  return (
    <>
      <HeroSlider slides={heroSlides} />

      <section id="home-browse" className="py-16 md:py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10">
            <div>
              <span className="text-xs font-bold uppercase tracking-[0.3em] text-primary mb-3 block">
                The Edit
              </span>
              <h2 className="font-serif text-3xl md:text-4xl font-extrabold text-foreground">
                {railLabel === 'All' ? 'Browse the collection' : railLabel}
              </h2>
            </div>
            <button
              onClick={() =>
                navigate(railLabel === 'All' ? '/shop' : `/shop?category=${encodeURIComponent(railLabel)}`)
              }
              className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-primary hover:underline"
            >
              View all <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-10">
            <aside className="hidden lg:block lg:max-h-[560px] lg:overflow-y-auto pr-2">
              <CategoryRail active={railLabel} onChange={setRailLabel} />
            </aside>

            <div>
              {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-10">
                  {Array.from({ length: PREVIEW_COUNT }).map((_, i) => (
                    <ProductCardSkeleton key={i} />
                  ))}
                </div>
              ) : previewSlice.length === 0 ? (
                <p className="text-center py-20 text-muted-foreground">
                  No pieces in this category yet.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-10">
                  {previewSlice.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              )}

              <div className="flex justify-center mt-12">
                <Link
                  href="/shop"
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-12 h-14 text-xs tracking-widest uppercase font-bold shadow-lg hover:shadow-xl transition-all"
                  data-testid="link-shop-collection"
                >
                  Shop the Full Collection <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
