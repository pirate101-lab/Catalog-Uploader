import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Search, X, ArrowRight } from 'lucide-react';
import { useProducts } from '@/context/ProductsContext';
import { ProductImage } from './ProductImage';
import type { Product } from '@/data/products';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-fill the input when the overlay opens (e.g. from the header bar). */
  initialQuery?: string;
}

export function SearchOverlay({ open, onClose, initialQuery = '' }: Props) {
  const { search } = useProducts();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      return;
    }
    // Seed the overlay with whatever the user already typed in the header bar.
    setQuery(initialQuery);
    setDebouncedQuery(initialQuery);
    const t = setTimeout(() => {
      const input = document.getElementById('velour-search-input') as HTMLInputElement | null;
      input?.focus();
      // Place caret at the end so the user can keep typing.
      const len = input?.value.length ?? 0;
      input?.setSelectionRange(len, len);
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    search({ q, limit: 12, sort: 'featured' })
      .then((r) => {
        if (cancelled) return;
        setResults(r.products);
        setSearching(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, search]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-md">
      <div className="container mx-auto px-4 pt-6 pb-4 flex items-center gap-3 border-b border-border">
        <Search className="w-5 h-5 text-muted-foreground" />
        <input
          id="velour-search-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search 41,000+ pieces…"
          className="flex-1 bg-transparent border-0 outline-none text-xl md:text-2xl font-serif placeholder:text-muted-foreground/60"
          data-testid="input-search"
        />
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close search"
          data-testid="button-close-search"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto container mx-auto px-4 py-8">
        {query.trim().length < 2 ? (
          <div className="text-center text-muted-foreground py-24">
            <p className="text-sm uppercase tracking-widest mb-2">Type to search</p>
            <p className="font-serif text-xl">Find your next favorite piece</p>
          </div>
        ) : searching && results.length === 0 ? (
          <div className="text-center text-muted-foreground py-24">
            <p className="font-serif text-lg">Searching…</p>
          </div>
        ) : results.length === 0 ? (
          <div className="text-center text-muted-foreground py-24">
            <p className="font-serif text-xl">No results for &ldquo;{query}&rdquo;</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {results.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  navigate(`/product/${p.id}`);
                  onClose();
                }}
                className="group text-left"
                data-testid={`search-result-${p.id}`}
              >
                <div className="aspect-[3/4] bg-muted overflow-hidden mb-2">
                  <ProductImage
                    src={p.image}
                    category={p.category}
                    id={p.id}
                    alt={p.imageAlt}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <p className="text-xs uppercase tracking-widest text-primary mb-1">{p.category}</p>
                <p className="text-sm font-medium line-clamp-2 group-hover:text-primary transition-colors">
                  {p.title}
                </p>
                <p className="text-sm font-serif font-bold mt-1">${p.price.toFixed(2)}</p>
              </button>
            ))}
            {results.length === 12 && (
              <div className="col-span-full pt-2 text-center">
                <button
                  onClick={() => {
                    navigate(`/shop?q=${encodeURIComponent(query)}`);
                    onClose();
                  }}
                  className="inline-flex items-center gap-2 text-sm uppercase tracking-widest text-primary hover:underline"
                >
                  See all results <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
