import { Link } from 'wouter';
import { X, Heart, ShoppingBag } from 'lucide-react';
import { useProducts } from '@/context/ProductsContext';
import { useWishlist } from '@/context/WishlistContext';
import { useCart } from '@/context/CartContext';
import { ProductImage } from './ProductImage';
import { PriceTag } from './PriceTag';
import { imageUrl } from '@/lib/imageUrl';
import { toast } from 'sonner';
import type { Product } from '@/data/products';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function WishlistDrawer({ open, onClose }: Props) {
  const { byId } = useProducts();
  const { ids, remove, clear } = useWishlist();
  const { addItem } = useCart();

  const items = ids.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p));

  const handleAdd = (p: Product) => {
    addItem({
      productId: p.id,
      color: p.colors[0]?.name ?? 'Default',
      size: p.sizes[0] ?? 'OS',
      price: p.price,
      title: p.title,
      image: imageUrl(p.image, { category: p.category, id: p.id, w: 200 }),
    });
    toast.success(`${p.title} added to cart`);
  };

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity duration-300 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed top-0 right-0 z-50 h-full w-full max-w-md bg-background border-l border-border shadow-2xl flex flex-col transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-hidden={!open}
        role="dialog"
        aria-label="Wishlist"
      >
        <header className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 className="font-serif text-2xl font-extrabold flex items-center gap-2">
              <Heart className="w-5 h-5 text-primary fill-current" />
              Wishlist
            </h2>
            <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
              {items.length} saved
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close wishlist"
            className="text-muted-foreground hover:text-foreground"
            data-testid="button-close-wishlist"
          >
            <X className="w-6 h-6" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="p-12 text-center">
              <Heart className="w-10 h-10 mx-auto text-muted-foreground mb-4" />
              <p className="font-serif text-xl mb-2">Your wishlist is empty</p>
              <p className="text-sm text-muted-foreground mb-6">
                Tap the heart on any piece to save it.
              </p>
              <Link
                href="/shop"
                onClick={onClose}
                className="inline-block bg-primary text-primary-foreground px-6 h-11 leading-[2.75rem] text-xs uppercase tracking-widest font-bold"
              >
                Browse the Shop
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((p) => (
                <li key={p.id} className="p-5 flex gap-4" data-testid={`drawer-wishlist-${p.id}`}>
                  <Link
                    href={`/product/${p.id}`}
                    onClick={onClose}
                    className="w-24 h-32 bg-muted shrink-0 overflow-hidden"
                  >
                    <ProductImage
                      src={p.image}
                      category={p.category}
                      id={p.id}
                      alt={p.imageAlt}
                      className="w-full h-full object-cover"
                      width={200}
                    />
                  </Link>
                  <div className="flex-1 flex flex-col">
                    <Link
                      href={`/product/${p.id}`}
                      onClick={onClose}
                      className="text-sm font-medium leading-snug line-clamp-2 hover:text-primary transition-colors"
                    >
                      {p.title}
                    </Link>
                    <PriceTag amount={p.price} size="sm" className="mt-1 inline-block" />
                    <div className="mt-auto flex items-center gap-2 pt-3">
                      <button
                        onClick={() => handleAdd(p)}
                        className="flex-1 inline-flex items-center justify-center gap-2 bg-foreground text-background h-9 text-[10px] uppercase tracking-widest font-bold hover:bg-primary transition-colors"
                        data-testid={`drawer-add-${p.id}`}
                      >
                        <ShoppingBag className="w-3.5 h-3.5" /> Add
                      </button>
                      <button
                        onClick={() => remove(p.id)}
                        className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                        aria-label={`Remove ${p.title} from wishlist`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <footer className="p-5 border-t border-border space-y-3">
            <Link
              href="/wishlist"
              onClick={onClose}
              className="block text-center bg-primary text-primary-foreground h-12 leading-[3rem] text-xs uppercase tracking-widest font-bold"
            >
              View Full Wishlist
            </Link>
            <button
              onClick={clear}
              className="block w-full text-center text-xs uppercase tracking-widest text-muted-foreground hover:text-destructive"
              data-testid="button-clear-wishlist-drawer"
            >
              Clear all
            </button>
          </footer>
        )}
      </aside>
    </>
  );
}
