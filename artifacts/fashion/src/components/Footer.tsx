import React from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

export function Footer() {
  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success('Subscribed to the VELOUR newsletter');
  };

  return (
    <footer className="bg-foreground text-background py-16 md:py-24">
      <div className="container mx-auto px-4 grid grid-cols-1 md:grid-cols-12 gap-12">
        <div className="md:col-span-3 space-y-6">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <svg viewBox="0 0 36 36" className="w-8 h-8" aria-hidden="true">
              <defs>
                <linearGradient id="velourFooterGrad" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="hsl(var(--primary))" />
                  <stop offset="60%" stopColor="hsl(285 80% 62%)" />
                  <stop offset="100%" stopColor="hsl(var(--price))" />
                </linearGradient>
              </defs>
              <rect x="1" y="1" width="34" height="34" rx="8" fill="url(#velourFooterGrad)" />
              <path d="M9 12 L18 26 L27 12" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="18" cy="8.5" r="1.6" fill="#fff" />
            </svg>
            <h2 className="text-2xl font-serif font-black tracking-[0.14em]">VELOUR</h2>
          </Link>
          <p className="text-background/60 text-sm leading-relaxed max-w-sm">
            Modern editorial fashion with an after-dark edge. Dress for the version of yourself
            you want to become.
          </p>
        </div>

        <div className="md:col-span-2 space-y-4">
          <h3 className="font-medium text-sm tracking-wider uppercase">Shop</h3>
          <ul className="space-y-3 text-sm text-background/60">
            <li><Link href="/shop?sort=newest" className="hover:text-background transition-colors">New Arrivals</Link></li>
            <li><Link href="/shop" className="hover:text-background transition-colors">All Collections</Link></li>
            <li><Link href="/shop?category=Dresses" className="hover:text-background transition-colors">Dresses</Link></li>
            <li><Link href="/shop?gender=men" className="hover:text-background transition-colors">Men</Link></li>
          </ul>
        </div>

        <div className="md:col-span-2 space-y-4">
          <h3 className="font-medium text-sm tracking-wider uppercase">Help</h3>
          <ul className="space-y-3 text-sm text-background/60">
            <li><a href="#" className="hover:text-background transition-colors">FAQ</a></li>
            <li><a href="#" className="hover:text-background transition-colors">Shipping</a></li>
            <li><a href="#" className="hover:text-background transition-colors">Returns</a></li>
            <li><a href="#" className="hover:text-background transition-colors">Contact</a></li>
          </ul>
        </div>

        <div className="md:col-span-2 space-y-4">
          <h3 className="font-medium text-sm tracking-wider uppercase">Follow Us</h3>
          <ul className="space-y-3 text-sm text-background/60">
            <li><a href="#" className="hover:text-background transition-colors">Instagram</a></li>
            <li><a href="#" className="hover:text-background transition-colors">TikTok</a></li>
            <li><a href="#" className="hover:text-background transition-colors">Pinterest</a></li>
            <li><a href="#" className="hover:text-background transition-colors">YouTube</a></li>
          </ul>
        </div>

        <div className="md:col-span-3 space-y-4">
          <h3 className="font-medium text-sm tracking-wider uppercase">Newsletter</h3>
          <p className="text-sm text-background/60">
            Subscribe for early drops, exclusive deals, and behind-the-scenes from the studio.
          </p>
          <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-2 pt-2">
            <Input
              type="email"
              placeholder="you@email.com"
              required
              className="bg-background/10 border-background/20 text-background placeholder:text-background/40 focus-visible:ring-primary rounded-none h-10"
            />
            <Button
              type="submit"
              className="rounded-none h-10 w-full sm:w-auto uppercase text-xs tracking-wider font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Subscribe
            </Button>
          </form>
        </div>
      </div>
      <div className="container mx-auto px-4 mt-16 pt-8 border-t border-background/10 text-xs text-background/50 flex flex-col md:flex-row justify-between items-center">
        <p>&copy; {new Date().getFullYear()} VELOUR. All rights reserved.</p>
        <div className="flex space-x-6 mt-4 md:mt-0">
          <a href="#" className="hover:text-background transition-colors">Terms</a>
          <a href="#" className="hover:text-background transition-colors">Privacy</a>
          <a href="#" className="hover:text-background transition-colors">Cookies</a>
        </div>
      </div>
    </footer>
  );
}
