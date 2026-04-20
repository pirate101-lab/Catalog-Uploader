import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ChevronRight, Heart } from 'lucide-react';
import { useProducts } from '@/context/ProductsContext';
import { useWishlist } from '@/context/WishlistContext';
import { ProductCard } from '@/components/ProductCard';
import { ProductCardSkeleton } from '@/components/ProductCardSkeleton';
import { QuickViewModal } from '@/components/QuickViewModal';
import { Button } from '@/components/ui/button';
import type { Product } from '@/data/products';

export function WishlistPage() {
  const { getProductsByIds } = useProducts();
  const { ids, clear } = useWishlist();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Product | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (ids.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    getProductsByIds(ids)
      .then((rows) => {
        if (cancelled) return;
        // Preserve the user's wishlist ordering.
        const byId = new Map(rows.map((r) => [r.id, r]));
        setItems(ids.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p)));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ids, getProductsByIds]);

  return (
    <section className="pt-28 pb-24 bg-background min-h-screen">
      <div className="container mx-auto px-4">
        <nav className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-6">
          <Link href="/" className="hover:text-foreground">Home</Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground">Wishlist</span>
        </nav>

        <div className="flex items-end justify-between mb-10">
          <div>
            <h1 className="font-serif text-4xl md:text-5xl font-extrabold mb-3">Wishlist</h1>
            <p className="text-muted-foreground font-light">
              {items.length} saved {items.length === 1 ? 'piece' : 'pieces'}
            </p>
          </div>
          {items.length > 0 && (
            <Button
              variant="outline"
              className="rounded-full text-xs uppercase tracking-widest"
              onClick={clear}
              data-testid="button-clear-wishlist"
            >
              Clear all
            </Button>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-16">
            {Array.from({ length: 4 }).map((_, i) => <ProductCardSkeleton key={i} />)}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-32 max-w-md mx-auto">
            <Heart className="w-12 h-12 mx-auto text-muted-foreground mb-6" />
            <h2 className="font-serif text-2xl mb-3">Your wishlist is empty</h2>
            <p className="text-muted-foreground mb-8">
              Tap the heart on any piece to save it for later.
            </p>
            <Link
              href="/shop"
              className="inline-block bg-primary text-primary-foreground px-10 h-12 leading-[3rem] text-xs tracking-widest uppercase font-bold"
              data-testid="link-shop-from-wishlist"
            >
              Browse the Shop
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-16">
            {items.map((p) => (
              <ProductCard key={p.id} product={p} onQuickView={setSelected} />
            ))}
          </div>
        )}
      </div>
      <QuickViewModal
        product={selected}
        isOpen={!!selected}
        onClose={() => setSelected(null)}
      />
    </section>
  );
}
