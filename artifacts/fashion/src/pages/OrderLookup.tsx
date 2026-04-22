import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronRight } from 'lucide-react';

const basePath = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

interface LookupResponse {
  url?: string;
  error?: string;
}

export function OrderLookupPage() {
  const [, navigate] = useLocation();
  const [orderId, setOrderId] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const trimmedId = orderId.trim();
    const trimmedEmail = email.trim();
    if (!trimmedId || !trimmedEmail) {
      setError('Please enter both your order number and email.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${basePath}/api/storefront/orders/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: trimmedId, email: trimmedEmail }),
      });
      const data = (await res.json().catch(() => ({}))) as LookupResponse;
      if (res.ok && data.url) {
        // The server returns a storefront-relative URL (e.g.
        // /orders/<id>?t=...). wouter's `navigate` is base-aware, so
        // we pass the path as-is — only normalising to ensure it has
        // a single leading slash regardless of what the server emits.
        const target = data.url.startsWith('/') ? data.url : `/${data.url}`;
        navigate(target);
        return;
      }
      setError(
        data.error ??
          "We couldn't find an order matching those details. Double-check the order number and email from your confirmation.",
      );
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="pt-28 pb-24 bg-background min-h-screen">
      <div className="container mx-auto px-4 max-w-md">
        <nav className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-6">
          <Link href="/" className="hover:text-foreground">Home</Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground">Look up order</span>
        </nav>

        <h1 className="text-2xl font-semibold mb-2">Look up your order</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Lost the link from your confirmation email? Enter your order number
          and the email you used at checkout to pull it back up.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="order-id" className="block text-xs uppercase tracking-widest text-muted-foreground mb-2">
              Order number
            </label>
            <input
              id="order-id"
              type="text"
              autoComplete="off"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              className="w-full border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. 8f3a1b2c-…"
              required
            />
          </div>

          <div>
            <label htmlFor="order-email" className="block text-xs uppercase tracking-widest text-muted-foreground mb-2">
              Email used at checkout
            </label>
            <input
              id="order-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="you@example.com"
              required
            />
          </div>

          {error && (
            <div
              role="alert"
              className="text-sm text-destructive border border-destructive/40 bg-destructive/5 rounded-md px-3 py-2"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-foreground text-background rounded-md py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition"
          >
            {submitting ? 'Looking up…' : 'Find my order'}
          </button>
        </form>

        <p className="text-xs text-muted-foreground mt-8">
          Still stuck? Reply to your order email and our team will help track it
          down.
        </p>
      </div>
    </section>
  );
}
