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
    <footer className="bg-zinc-950 text-zinc-100 py-8 md:py-12">
      <div className="container mx-auto px-4 grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-10">
        <div className="md:col-span-3 space-y-4">
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
          <p className="text-zinc-400 text-sm leading-relaxed max-w-sm">
            Modern editorial fashion with an after-dark edge. Dress for the version of yourself
            you want to become.
          </p>
        </div>

        <div className="md:col-span-2 space-y-3">
          <h3 className="font-medium text-sm tracking-wider uppercase">Shop</h3>
          <ul className="space-y-2 text-sm text-zinc-400">
            <li><Link href="/shop?sort=newest" className="hover:text-zinc-100 transition-colors">New Arrivals</Link></li>
            <li><Link href="/shop" className="hover:text-zinc-100 transition-colors">All Collections</Link></li>
            <li><Link href="/shop?category=Dresses" className="hover:text-zinc-100 transition-colors">Dresses</Link></li>
            <li><Link href="/shop?gender=men" className="hover:text-zinc-100 transition-colors">Men</Link></li>
          </ul>
        </div>

        <div className="md:col-span-2 space-y-3">
          <h3 className="font-medium text-sm tracking-wider uppercase">Help</h3>
          <ul className="space-y-2 text-sm text-zinc-400">
            <li><a href="#" className="hover:text-zinc-100 transition-colors">FAQ</a></li>
            <li><a href="#" className="hover:text-zinc-100 transition-colors">Shipping</a></li>
            <li><a href="#" className="hover:text-zinc-100 transition-colors">Returns</a></li>
            <li><a href="#" className="hover:text-zinc-100 transition-colors">Contact</a></li>
          </ul>
        </div>

        <div className="md:col-span-2 space-y-3">
          <h3 className="font-medium text-sm tracking-wider uppercase">Follow Us</h3>
          <ul className="space-y-2 text-sm text-zinc-400">
            <li><a href="#" className="hover:text-zinc-100 transition-colors">Instagram</a></li>
            <li><a href="#" className="hover:text-zinc-100 transition-colors">TikTok</a></li>
            <li><a href="#" className="hover:text-zinc-100 transition-colors">Pinterest</a></li>
            <li><a href="#" className="hover:text-zinc-100 transition-colors">YouTube</a></li>
          </ul>
        </div>

        <div className="md:col-span-3 space-y-3">
          <h3 className="font-medium text-sm tracking-wider uppercase">Newsletter</h3>
          <p className="text-sm text-zinc-400">
            Subscribe for early drops, exclusive deals, and behind-the-scenes from the studio.
          </p>
          <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-2">
            <Input
              type="email"
              placeholder="you@email.com"
              required
              className="bg-white/5 border-white/15 text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-primary rounded-lg h-10"
            />
            <Button
              type="submit"
              className="rounded-lg h-10 w-full sm:w-auto uppercase text-xs tracking-wider font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Subscribe
            </Button>
          </form>
        </div>
      </div>
      <div className="container mx-auto px-4 mt-8 pt-6 border-t border-white/10 text-xs text-zinc-500 flex flex-col md:flex-row justify-between items-center gap-3">
        <p>&copy; {new Date().getFullYear()} VELOUR. All rights reserved.</p>
        <div className="flex space-x-6">
          <a href="#" className="hover:text-zinc-100 transition-colors">Terms</a>
          <a href="#" className="hover:text-zinc-100 transition-colors">Privacy</a>
          <a href="#" className="hover:text-zinc-100 transition-colors">Cookies</a>
        </div>
      </div>
    </footer>
  );
}
