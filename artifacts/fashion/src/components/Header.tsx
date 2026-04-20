import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ShoppingBag, Search, Heart, Menu, Sun, Moon, X } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useTheme } from '@/context/ThemeContext';
import { SearchOverlay } from './SearchOverlay';
import { WishlistDrawer } from './WishlistDrawer';
import { SecondaryNav } from './SecondaryNav';

export function Header() {
  const { totalItems, setIsCartOpen } = useCart();
  const { count: wishlistCount } = useWishlist();
  const { theme, toggle: toggleTheme } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const [wishOpen, setWishOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [headerQuery, setHeaderQuery] = useState('');
  const [, navigate] = useLocation();
  const lastY = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      lastY.current = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (headerQuery.trim().length < 2) {
      setSearchOpen(true);
      return;
    }
    navigate(`/shop?q=${encodeURIComponent(headerQuery.trim())}`);
    setHeaderQuery('');
  };

  const iconBtn =
    'relative text-foreground hover:text-primary dark:text-foreground/80 dark:hover:text-foreground transition-colors';

  return (
    <>
      <header className="sticky top-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-4 h-16 md:h-[68px] flex items-center gap-4">
          <button
            onClick={() => setMobileOpen((o) => !o)}
            className="lg:hidden -ml-1 text-foreground"
            aria-label="Toggle navigation"
            data-testid="button-mobile-menu"
          >
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          <Link
            href="/"
            className="flex items-center gap-2 md:gap-2.5 text-foreground"
            data-testid="link-logo"
            aria-label="VELOUR home"
          >
            <svg
              viewBox="0 0 36 36"
              className="w-7 h-7 md:w-8 md:h-8 shrink-0"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="velourLogoGrad" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="hsl(var(--primary))" />
                  <stop offset="60%" stopColor="hsl(285 80% 62%)" />
                  <stop offset="100%" stopColor="hsl(var(--price))" />
                </linearGradient>
              </defs>
              <rect x="1" y="1" width="34" height="34" rx="8" fill="url(#velourLogoGrad)" />
              <path
                d="M9 12 L18 26 L27 12"
                fill="none"
                stroke="#fff"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="18" cy="8.5" r="1.6" fill="#fff" />
            </svg>
            <span className="font-serif text-[22px] md:text-[26px] font-black tracking-[0.14em] leading-none">
              VELOUR
            </span>
          </Link>

          <form
            onSubmit={submitSearch}
            className="hidden md:flex items-center gap-2 h-10 px-4 flex-1 max-w-2xl mx-auto border border-border bg-muted dark:bg-muted/40 text-foreground rounded-full"
            data-testid="form-header-search"
          >
            <Search className="w-4 h-4 text-muted-foreground dark:opacity-70 dark:text-current" />
            <input
              type="search"
              value={headerQuery}
              onChange={(e) => setHeaderQuery(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search women's fashion"
              className="bg-transparent border-0 outline-none text-sm w-full placeholder:text-muted-foreground"
              data-testid="input-header-search"
            />
          </form>

          <div className="ml-auto md:ml-0 flex items-center gap-3 md:gap-5">
            <button
              onClick={() => setSearchOpen(true)}
              className={`md:hidden ${iconBtn}`}
              aria-label="Search"
              data-testid="button-search"
            >
              <Search className="w-5 h-5" />
            </button>

            <button
              onClick={toggleTheme}
              className={iconBtn}
              aria-label="Toggle theme"
              data-testid="button-theme-toggle"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            <button
              onClick={() => setWishOpen(true)}
              className={iconBtn}
              data-testid="button-wishlist"
              aria-label="Wishlist"
            >
              <Heart className="w-5 h-5" />
              {wishlistCount > 0 && (
                <span className="absolute -top-2 -right-2 bg-accent text-accent-foreground text-[10px] w-[18px] h-[18px] flex items-center justify-center rounded-full font-bold">
                  {wishlistCount}
                </span>
              )}
            </button>

            <button
              className={iconBtn}
              onClick={() => setIsCartOpen(true)}
              aria-label="Cart"
              data-testid="button-cart"
            >
              <ShoppingBag className="w-5 h-5" />
              {totalItems > 0 && (
                <span className="absolute -top-2 -right-2 bg-primary text-primary-foreground text-[10px] w-[18px] h-[18px] flex items-center justify-center rounded-full font-bold">
                  {totalItems}
                </span>
              )}
            </button>
          </div>
        </div>

        <SecondaryNav />

        {mobileOpen && (
          <div className="lg:hidden border-t border-border bg-background text-foreground">
            <nav className="container mx-auto px-4 py-4 flex flex-col gap-4 text-sm font-semibold uppercase tracking-widest">
              <Link href="/" onClick={() => setMobileOpen(false)}>Home</Link>
              <Link href="/shop" onClick={() => setMobileOpen(false)}>Shop</Link>
              <Link href="/wishlist" onClick={() => setMobileOpen(false)}>
                Wishlist {wishlistCount > 0 && `(${wishlistCount})`}
              </Link>
            </nav>
          </div>
        )}
      </header>

      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        initialQuery={headerQuery}
      />
      <WishlistDrawer open={wishOpen} onClose={() => setWishOpen(false)} />
    </>
  );
}
