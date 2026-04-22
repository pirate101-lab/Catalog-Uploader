import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ChevronRight } from 'lucide-react';

const basePath = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

interface OrderItem {
  productId: string;
  title: string;
  quantity: number;
  color?: string;
  size?: string;
  unitPriceCents: number;
  image?: string;
}

interface ShippingAddress {
  firstName?: string | null;
  lastName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
}

interface OrderView {
  id: string;
  status: string;
  items: OrderItem[];
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  displayCurrency: string | null;
  displaySubtotalCents: number | null;
  displayShippingCents: number | null;
  displayTaxCents: number | null;
  displayTotalCents: number | null;
  shippingAddress: ShippingAddress | null;
  paymentProvider: string | null;
  paidAt: string | null;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  new: 'Received',
  paid: 'Confirmed',
  packed: 'Being packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

function formatMoney(cents: number, currency: string): string {
  // Best-effort symbol mapping; fall back to the currency code.
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '';
  const amount = (cents / 100).toFixed(2);
  return sym ? `${sym}${amount}` : `${amount} ${currency}`;
}

function shortOrderId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

export function OrderStatusPage({ id }: { id: string }) {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('t');
    if (!token) {
      setError('This link is missing its access token. Please use the link from your order email.');
      setLoading(false);
      return;
    }
    const url = `${basePath}/api/storefront/orders/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}`;
    fetch(url)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setError("We couldn't find that order. The link may have expired — please check your email for the latest update.");
          setLoading(false);
          return;
        }
        if (!res.ok) {
          setError('Something went wrong loading your order. Please try again in a moment.');
          setLoading(false);
          return;
        }
        const data = (await res.json()) as OrderView;
        setOrder(data);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Network error. Please check your connection and try again.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <section className="pt-28 pb-24 bg-background min-h-screen">
        <div className="container mx-auto px-4">
          <div className="text-sm text-muted-foreground">Loading your order…</div>
        </div>
      </section>
    );
  }

  if (error || !order) {
    return (
      <section className="pt-28 pb-24 bg-background min-h-screen">
        <div className="container mx-auto px-4 max-w-2xl">
          <h1 className="text-2xl font-semibold mb-4">Order not available</h1>
          <p className="text-muted-foreground mb-6">{error ?? 'Order not found.'}</p>
          <Link href="/" className="text-sm underline">Back to the shop</Link>
        </div>
      </section>
    );
  }

  const displayCurrency = order.displayCurrency ?? order.currency;
  const subtotal = formatMoney(order.displaySubtotalCents ?? order.subtotalCents, displayCurrency);
  const shipping = formatMoney(order.displayShippingCents ?? order.shippingCents, displayCurrency);
  const tax = formatMoney(order.displayTaxCents ?? order.taxCents, displayCurrency);
  const total = formatMoney(order.displayTotalCents ?? order.totalCents, displayCurrency);
  const showCharge =
    !!order.displayCurrency &&
    order.currency.toUpperCase() !== order.displayCurrency.toUpperCase();
  const chargeTotal = showCharge ? formatMoney(order.totalCents, order.currency) : null;
  const isPaystack = order.paymentProvider === 'paystack';

  const addr = order.shippingAddress;
  const addressLines: string[] = [];
  if (addr) {
    const name = [addr.firstName, addr.lastName].filter(Boolean).join(' ').trim();
    if (name) addressLines.push(name);
    if (addr.address) addressLines.push(addr.address);
    const cityLine = [addr.city, [addr.state, addr.zip].filter(Boolean).join(' ')]
      .filter((p) => p && String(p).trim().length > 0)
      .join(', ');
    if (cityLine) addressLines.push(cityLine);
    if (addr.country) addressLines.push(addr.country);
  }

  const statusLabel = STATUS_LABELS[order.status] ?? order.status;
  const ref = shortOrderId(order.id);

  return (
    <section className="pt-28 pb-24 bg-background min-h-screen">
      <div className="container mx-auto px-4 max-w-2xl">
        <nav className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-6">
          <Link href="/" className="hover:text-foreground">Home</Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground">Order #{ref}</span>
        </nav>

        <div className="mb-8">
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
            Status
          </div>
          <h1 className="text-2xl font-semibold">{statusLabel}</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Placed on {new Date(order.createdAt).toLocaleDateString()}
            {order.paidAt ? ` · paid ${new Date(order.paidAt).toLocaleDateString()}` : ''}
          </p>
        </div>

        <div className="border border-border rounded-lg p-6 mb-6">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-4">
            Items
          </h2>
          <ul className="divide-y divide-border">
            {order.items.map((it, idx) => {
              const variant = [it.color, it.size].filter(Boolean).join(' / ');
              return (
                <li key={`${it.productId}-${idx}`} className="py-3 flex justify-between gap-4">
                  <div>
                    <div className="font-medium">{it.title}</div>
                    {variant && (
                      <div className="text-xs text-muted-foreground">{variant}</div>
                    )}
                    <div className="text-xs text-muted-foreground">Qty {it.quantity}</div>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    {formatMoney(it.unitPriceCents * it.quantity, displayCurrency)}
                  </div>
                </li>
              );
            })}
          </ul>

          <dl className="mt-4 pt-4 border-t border-border text-sm space-y-1">
            <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd>{subtotal}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Shipping</dt><dd>{shipping}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Tax</dt><dd>{tax}</dd></div>
            <div className="flex justify-between font-semibold pt-2 border-t border-border mt-2"><dt>Total</dt><dd>{total}</dd></div>
          </dl>

          {chargeTotal && (
            <p className="mt-3 text-xs text-muted-foreground">
              Your card was charged {chargeTotal}
              {isPaystack ? ' via Paystack' : ''} (≈ {total}).
            </p>
          )}
        </div>

        {addressLines.length > 0 && (
          <div className="border border-border rounded-lg p-6 mb-6">
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-4">
              Shipping to
            </h2>
            <address className="not-italic text-sm leading-relaxed">
              {addressLines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </address>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Need help? Reply to your order email and our team will get back to you.
        </p>
      </div>
    </section>
  );
}
