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
    <footer className="bg-zinc-950 text-zinc-100 py-6 md:py-10">
      <div className="container mx-auto px-4 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-10 md:items-center">
        <div className="space-y-2">
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

        <div className="space-y-2">
          <h3 className="font-medium text-sm tracking-wider uppercase">Newsletter</h3>
          <form onSubmit={handleSubscribe} className="flex flex-row gap-2">
            <Input
              type="email"
              placeholder="you@email.com"
              required
              className="bg-white/5 border-white/15 text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-primary rounded-lg h-10 flex-1 min-w-0"
            />
            <Button
              type="submit"
              className="rounded-lg h-10 uppercase text-xs tracking-wider font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
            >
              Subscribe
            </Button>
          </form>
        </div>
      </div>
      <div className="container mx-auto px-4 mt-6 pt-4 border-t border-white/10 text-xs text-zinc-500 flex flex-col md:flex-row justify-between items-center gap-3">
        <p>&copy; {new Date().getFullYear()} VELOUR. All rights reserved.</p>
        <div className="flex space-x-6 items-center">
          <Link
            href="/orders"
            className="hover:text-zinc-100 transition-colors min-h-[40px] inline-flex items-center px-1"
            data-testid="link-footer-track-order"
          >
            Track an order
          </Link>
          <FooterLegalLink label="Terms" />
          <FooterLegalLink label="Privacy" />
          <FooterLegalLink label="Cookies" />
        </div>
      </div>
    </footer>
  );
}

// Placeholder for legal pages (Terms / Privacy / Cookies) until the
// actual content is published.
function FooterLegalLink({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => toast.info(`${label} page coming soon`)}
      className="hover:text-zinc-100 transition-colors min-h-[40px] inline-flex items-center px-1"
    >
      {label}
    </button>
  );
}
