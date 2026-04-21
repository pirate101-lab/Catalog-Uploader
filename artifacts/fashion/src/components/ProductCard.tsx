import { memo } from 'react';
import { Link } from 'wouter';
import { ShoppingBag, Heart, Star, Info } from 'lucide-react';
import type { Product } from '@/data/products';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { toast } from 'sonner';
import { ProductImage } from '@/components/ProductImage';
import { PriceTag } from '@/components/PriceTag';
import { imageUrl } from '@/lib/imageUrl';

interface ProductCardProps {
  product: Product;
  /** Kept for API compatibility with callers; quick-view overlay is no longer rendered. */
  onQuickView?: (product: Product) => void;
}

/**
 * Hash a product id into a deterministic 32-bit integer so every render
 * produces the same stub metadata for the same product. The store doesn't
 * yet ship review counts, sales counts, or RRP from the backend, so we
 * derive Temu-style tile decoration from the id.
 */
function hashId(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface CardStubs {
  sold: number;
  rating: number; // 1 decimal, e.g. 4.7
  reviews: number;
  rrp: number; // strikethrough RRP > price
}

/**
 * Derive deterministic numeric stubs (sold count, rating, review count,
 * RRP) from the product id. The Sale and Local pills are always shown
 * per the reference layout — no probabilistic gating.
 */
function deriveStubs(product: Product): CardStubs {
  const h = hashId(product.id);
  const soldRaw = (h >>> 7) % 4000;
  const sold = Math.max(5, Math.round(Math.pow(soldRaw, 1.05)));
  const ratingTenths = 38 + ((h >>> 12) % 13);
  const rating = Math.min(50, ratingTenths) / 10;
  const reviews = 3 + ((h >>> 16) % 220);
  const multTenths = 14 + ((h >>> 20) % 8);
  const raw = product.price * (multTenths / 10);
  const rrp = Math.max(product.price + 5, Math.floor(raw) + 0.99);
  return { sold, rating, reviews, rrp };
}

function formatSold(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function ProductCardImpl({ product }: ProductCardProps) {
  const { addItem } = useCart();
  const { has: inWishlist, toggle: toggleWishlist } = useWishlist();
  const wishlisted = inWishlist(product.id);
  const stubs = deriveStubs(product);

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Most catalog rows come from upstream with no color variants and a
    // generic size grid — fall back to sensible defaults so the bag-icon
    // quick-add always succeeds. Shoppers can still pick exact options on
    // the product page; this just gets the item into the bag immediately.
    const firstColor = product.colors[0];
    const color = firstColor?.name ?? 'Default';
    const size = product.sizes[0] ?? 'One Size';
    addItem({
      productId: product.id,
      color,
      size,
      price: product.price,
      title: product.title,
      image: imageUrl(firstColor?.image || product.image, {
        category: product.category,
        id: product.id,
        w: 200,
      }),
    });
    toast.success(`${product.title} added to cart`);
  };

  const handleWishlist = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleWishlist(product.id);
    toast.success(wishlisted ? 'Removed from wishlist' : 'Saved to wishlist');
  };

  return (
    <Link
      href={`/product/${product.id}`}
      className="group cursor-pointer flex flex-col h-full"
      data-testid={`product-card-${product.id}`}
    >
      {/* Image lives in its own rounded, bordered box. Labels sit loose below. */}
      <div className="relative aspect-square bg-muted overflow-hidden rounded-2xl border border-border shadow-sm group-hover:shadow-md transition-shadow">
        <ProductImage
          src={product.image}
          category={product.category}
          id={product.id}
          alt={product.title}
          className="absolute inset-0 w-full h-full object-cover"
          width={600}
        />
        <button
          onClick={handleWishlist}
          className={`absolute top-2.5 right-2.5 w-10 h-10 flex items-center justify-center rounded-full transition-all backdrop-blur z-10 ${
            wishlisted
              ? 'bg-primary text-primary-foreground'
              : 'bg-background/85 text-foreground hover:bg-background'
          }`}
          aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
          data-testid={`button-wishlist-${product.id}`}
        >
          <Heart className={`w-4 h-4 ${wishlisted ? 'fill-current' : ''}`} />
        </button>
      </div>

      <div className="flex flex-col flex-grow pt-3 gap-2">
        {/* Title — own block, up to 2 lines */}
        <h3
          className="text-[13px] text-foreground line-clamp-2 leading-snug min-h-[2.4em]"
          title={product.title}
        >
          {product.title}
        </h3>

        {/* Price row + circular cart button */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <PriceTag amount={product.price} size="md" splitCents />
            <span className="text-[11px] text-muted-foreground leading-none truncate">
              {formatSold(stubs.sold)} sold
            </span>
          </div>
          <button
            onClick={handleQuickAdd}
            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full border border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
            aria-label={`Add ${product.title} to cart`}
            data-testid={`button-quick-add-${product.id}`}
          >
            <ShoppingBag className="w-4 h-4" />
          </button>
        </div>

        {/* RRP + stars on a single horizontal row */}
        <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-[11px] text-muted-foreground -mt-1 mt-auto">
          <span className="inline-flex items-center gap-1">
            <span>
              RRP <span className="line-through">${stubs.rrp.toFixed(2)}</span>
            </span>
            <Info className="w-3 h-3" aria-hidden="true" />
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="flex" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`w-3 h-3 ${
                    i < Math.round(stubs.rating)
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-zinc-300 dark:text-muted-foreground/40'
                  }`}
                />
              ))}
            </span>
            <span>{stubs.reviews}</span>
          </span>
        </div>
      </div>
    </Link>
  );
}

// Grids of 24+ cards re-render on every filter/state change in Shop/Home.
// Card markup is purely a function of the product object (and `onQuickView`,
// which is not used here). Shallow-equal memoisation keeps the grid cheap.
export const ProductCard = memo(ProductCardImpl, (prev, next) => prev.product === next.product);
