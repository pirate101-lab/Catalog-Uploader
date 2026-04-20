import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Product } from '@/data/products';
import {
  fetchProduct,
  fetchProductsByIds,
  searchProducts,
  type SearchOptions,
  type SearchResult,
} from '@/lib/productsApi';

interface ProductsContextValue {
  /** Featured/initial slice for the homepage; fetched on mount. */
  featured: Product[];
  /** True until the featured slice has been fetched. */
  loading: boolean;
  error: string | null;
  /** Single-product cache, populated by detail / wishlist / search. */
  byId: Map<string, Product>;
  /** Memoize a product into the byId cache. */
  remember: (products: Product[]) => void;
  /** Get a single product (cache-first, then network). */
  getProduct: (id: string) => Promise<Product | null>;
  /** Bulk fetch by ids (used by the wishlist page). */
  getProductsByIds: (ids: string[]) => Promise<Product[]>;
  /** Server-side search/filter/sort for the shop + search overlay. */
  search: (opts: SearchOptions) => Promise<SearchResult>;
}

const ProductsContext = createContext<ProductsContextValue | undefined>(undefined);

export function ProductsProvider({ children }: { children: React.ReactNode }) {
  const [featured, setFeatured] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Use a ref so we never trigger renders just to memoize a product.
  const cacheRef = useRef<Map<string, Product>>(new Map());
  const [, forceTick] = useState(0);

  const remember = useCallback((products: Product[]) => {
    if (products.length === 0) return;
    // Always upsert so admin edits surfaced via later searches refresh
    // detail / wishlist views instead of serving stale cache entries.
    for (const p of products) {
      cacheRef.current.set(p.id, p);
    }
    forceTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    searchProducts({ limit: 24, sort: 'featured' })
      .then((r) => {
        if (cancelled) return;
        setFeatured(r.products);
        remember(r.products);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err?.message ?? err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [remember]);

  const getProduct = useCallback(
    async (id: string) => {
      const cached = cacheRef.current.get(id);
      if (cached) return cached;
      const p = await fetchProduct(id);
      if (p) remember([p]);
      return p;
    },
    [remember],
  );

  const getProductsByIds = useCallback(
    async (ids: string[]) => {
      const missing = ids.filter((id) => !cacheRef.current.has(id));
      if (missing.length > 0) {
        const rows = await fetchProductsByIds(missing);
        remember(rows);
      }
      return ids
        .map((id) => cacheRef.current.get(id))
        .filter((p): p is Product => Boolean(p));
    },
    [remember],
  );

  const search = useCallback(
    async (opts: SearchOptions) => {
      const r = await searchProducts(opts);
      remember(r.products);
      return r;
    },
    [remember],
  );

  const value = useMemo<ProductsContextValue>(
    () => ({
      featured,
      loading,
      error,
      byId: cacheRef.current,
      remember,
      getProduct,
      getProductsByIds,
      search,
    }),
    [featured, loading, error, remember, getProduct, getProductsByIds, search],
  );

  return <ProductsContext.Provider value={value}>{children}</ProductsContext.Provider>;
}

export function useProducts(): ProductsContextValue {
  const ctx = useContext(ProductsContext);
  if (!ctx) throw new Error('useProducts must be used inside ProductsProvider');
  return ctx;
}
