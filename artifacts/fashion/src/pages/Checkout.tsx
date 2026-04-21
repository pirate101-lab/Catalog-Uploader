import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/context/AuthContext';
import { useCart, type CartItem } from '@/context/CartContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  CheckCircle2,
  Lock,
  AlertTriangle,
  MapPin,
  Pencil,
  CreditCard,
  Banknote,
} from 'lucide-react';
import { PriceTag } from '@/components/PriceTag';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

interface SavedAddress {
  id: string;
  fullName: string;
  phone: string | null;
  countryCode: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
  isDefault: boolean;
}

// Display-only estimates while we wait for the server to price the cart.
// All amounts the customer is actually charged come from the server.
const SHIPPING_FLAT = 8.0;
const FREE_SHIPPING_THRESHOLD = 150;
const TAX_RATE = 0.08;

const checkoutSchema = z.object({
  email: z.string().email('Enter a valid email'),
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().min(1, 'Required'),
  address: z.string().min(3, 'Required'),
  city: z.string().min(1, 'Required'),
  state: z.string().min(2, 'Required'),
  zip: z.string().min(3, 'Required'),
  country: z.string().min(2, 'Required'),
});

type CheckoutForm = z.infer<typeof checkoutSchema>;

interface BankTransferDetails {
  bankName: string | null;
  accountName: string | null;
  accountNumber: string | null;
  swiftCode: string | null;
  routingNumber: string | null;
  instructions: string | null;
}

interface StorefrontSettings {
  currency: string | null;
  currencySymbol: string | null;
  paystackEnabled: boolean;
  paystackPublicKey: string | null;
  paystackTestMode: boolean;
  bankTransfer?: BankTransferDetails;
}

interface PaystackInitResponse {
  authorizationUrl: string;
  reference: string;
  totalCents: number;
  currency: string;
}

interface CheckoutQuote {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  currencySymbol: string;
}

// Only what the server needs. Prices/shipping/tax are NOT sent — the server
// looks up product prices from the database to prevent tampering.
function buildItemPayload(items: CartItem[]) {
  return items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    color: item.color,
    size: item.size,
  }));
}

function fmt(cents: number, symbol: string = '$'): string {
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const trimmed = (full || '').trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export function CheckoutPage() {
  const { items, subtotal, clearCart } = useCart();
  const { isSignedIn, user } = useAuth();
  const [, navigate] = useLocation();
  const [submitted, setSubmitted] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [savedAddress, setSavedAddress] = useState<SavedAddress | null>(null);
  const [editingAddress, setEditingAddress] = useState(false);
  // Server-authoritative total returned by /checkout/submit. The pre-submit
  // estimates can drift (price changes, free-shipping threshold, tax rules),
  // so we ALWAYS show the value the API persisted on the order — that is
  // the exact amount the customer must wire.
  const [confirmedTotalCents, setConfirmedTotalCents] = useState<number | null>(
    null,
  );
  const [confirmedCurrencySymbol, setConfirmedCurrencySymbol] = useState<
    string | null
  >(null);
  const [settings, setSettings] = useState<StorefrontSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  // When Paystack is enabled, the customer can choose between Paystack
  // and the bank-transfer fallback. Default is Paystack.
  const [paymentMethod, setPaymentMethod] = useState<'paystack' | 'bank'>(
    'paystack',
  );
  // Server-authoritative pricing for the cart, refetched whenever the
  // cart changes. The displayed totals (and the Paystack button label)
  // are bound to this — never to the local estimates below — so the
  // customer always sees exactly what the server will charge.
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Pre-quote estimates only used while the first /checkout/quote is in
  // flight, so the summary doesn't flash blank for sub-second loads.
  const estShippingCents =
    subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD
      ? 0
      : Math.round(SHIPPING_FLAT * 100);
  const estSubtotalCents = Math.round(subtotal * 100);
  const estTaxCents = Math.round(estSubtotalCents * TAX_RATE);
  const estTotalCents = estSubtotalCents + estShippingCents + estTaxCents;

  const currencySymbol = quote?.currencySymbol ?? settings?.currencySymbol ?? '$';
  const subtotalCents = quote?.subtotalCents ?? estSubtotalCents;
  const shippingCents = quote?.shippingCents ?? estShippingCents;
  const taxCents = quote?.taxCents ?? estTaxCents;
  const totalCents = quote?.totalCents ?? estTotalCents;
  const pricingReady = quote !== null;
  const paystackReady = !!(
    settings?.paystackEnabled && settings.paystackPublicKey
  );

  const form = useForm<CheckoutForm>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      email: '',
      firstName: '',
      lastName: '',
      address: '',
      city: '',
      state: '',
      zip: '',
      country: 'United States',
    },
  });

  // Load the signed-in shopper's saved addresses so we can collapse the
  // shipping form when they already have one (no need to re-type it).
  useEffect(() => {
    if (!isSignedIn) {
      setSavedAddress(null);
      return;
    }
    let cancelled = false;
    fetch(`${basePath}/api/addresses`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.addresses?.length) return;
        const list: SavedAddress[] = data.addresses;
        const def = list.find((a) => a.isDefault) ?? list[0];
        if (!def) return;
        setSavedAddress(def);
        const { firstName, lastName } = splitName(def.fullName);
        form.reset({
          email: form.getValues('email') || user?.email || '',
          firstName,
          lastName,
          address: [def.line1, def.line2].filter(Boolean).join(', '),
          city: def.city,
          state: def.region ?? '',
          zip: def.postalCode ?? '',
          country: def.country,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // form.reset is stable; user object identity is stable per render scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, user?.id]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/storefront/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: StorefrontSettings | null) => {
        if (cancelled) return;
        setSettings(data);
        setSettingsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSettings(null);
        setSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // If Paystack is unavailable, force the bank-transfer choice so the UI
  // doesn't get stuck on a hidden tab.
  useEffect(() => {
    if (!paystackReady) setPaymentMethod('bank');
  }, [paystackReady]);

  // Fetch a server-priced quote whenever the cart contents change.
  const cartKey = useMemo(
    () =>
      items
        .map((i) => `${i.productId}|${i.color}|${i.size}|${i.quantity}`)
        .sort()
        .join(','),
    [items],
  );

  useEffect(() => {
    if (items.length === 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError(null);
    fetch(`${basePath}/api/checkout/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: buildItemPayload(items) }),
    })
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as
          | CheckoutQuote
          | { error?: string }
          | null;
        if (!r.ok || !body || 'error' in body) {
          throw new Error(
            (body && 'error' in body && body.error) ||
              `Could not price cart (HTTP ${r.status}).`,
          );
        }
        return body as CheckoutQuote;
      })
      .then((q) => {
        if (cancelled) return;
        setQuote(q);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setQuoteError(e.message);
        setQuote(null);
      })
      .finally(() => {
        if (!cancelled) setQuoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cartKey, items.length]);

  const [paystackReturnError, setPaystackReturnError] = useState<string | null>(
    null,
  );

  // Handle Paystack callback redirect: ?paid=1&order=… (success) or
  // ?paid=0&error=… (verify failed / unknown order / abandoned).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const paid = url.searchParams.get('paid');
    const orderQ = url.searchParams.get('order');
    const err = url.searchParams.get('error');
    if (paid === '1' && orderQ) {
      setOrderId(orderQ);
      setSubmitted(true);
      setConfirmedTotalCents(null);
      clearCart();
    } else if (paid === '0' && err) {
      setPaystackReturnError(humanizePaystackError(err));
    }
    if (paid !== null) {
      url.searchParams.delete('paid');
      url.searchParams.delete('order');
      url.searchParams.delete('error');
      window.history.replaceState(
        {},
        '',
        url.pathname + (url.search ? `?${url.searchParams.toString()}` : ''),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (submitted) {
    const bank = settings?.bankTransfer;
    const finalTotalCents = confirmedTotalCents ?? totalCents;
    const finalSymbol = confirmedCurrencySymbol ?? currencySymbol;
    const totalDisplay = fmt(finalTotalCents, finalSymbol);
    // Was this an online (Paystack) payment? If we have no bank fallback
    // amount it means the customer paid online and we don't need to show
    // wire instructions.
    const wasPaidOnline = confirmedTotalCents === null;
    return (
      <div className="pt-32 pb-24 min-h-screen bg-background">
        <div className="container mx-auto px-4 max-w-2xl">
          <div className="text-center">
            <CheckCircle2 className="w-16 h-16 mx-auto text-primary mb-6" />
            <h1 className="font-serif text-4xl md:text-5xl font-bold mb-4">
              {wasPaidOnline ? 'Order paid' : 'Order received'}
            </h1>
            <p className="text-muted-foreground mb-2">
              {wasPaidOnline
                ? "Thanks — we've received your payment and will email you a receipt and shipping update shortly."
                : "Your order has been recorded. Please complete payment by bank transfer using the details below — once we see the deposit we'll ship your order and email you a confirmation."}
            </p>
            <p className="text-sm uppercase tracking-widest mb-10">
              Order #
              <span
                className="text-primary font-bold"
                data-testid="order-id"
              >
                {orderId}
              </span>
            </p>
          </div>

          {wasPaidOnline ? null : (
            <div className="rounded-2xl border border-border bg-muted/20 p-8 mb-10">
              <h2 className="text-xs font-bold uppercase tracking-widest mb-6">
                Payment Instructions
              </h2>
              <BankDetailsList
                bank={bank}
                memo={orderId}
                total={totalDisplay}
              />
              <p className="text-xs text-muted-foreground mt-6">
                <strong>Important:</strong> use the order number{' '}
                <span className="text-foreground font-mono">{orderId}</span> as
                the transfer reference / memo so we can match your payment to
                your order.
              </p>
            </div>
          )}

          <div className="text-center">
            <Button
              onClick={() => navigate('/shop')}
              className="rounded-full px-12 h-14 text-xs tracking-widest uppercase font-bold"
            >
              Continue Shopping
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="pt-32 pb-24 min-h-screen bg-background">
        <div className="container mx-auto px-4 max-w-2xl text-center">
          <h1 className="font-serif text-3xl md:text-4xl font-bold mb-4">
            Your cart is empty
          </h1>
          <p className="text-muted-foreground mb-8">
            Add a piece you love before continuing to checkout.
          </p>
          <Link
            href="/shop"
            className="inline-block bg-primary text-white rounded-full px-12 h-14 leading-[3.5rem] text-xs tracking-widest uppercase font-bold"
          >
            Browse the Shop
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-28 pb-24 min-h-screen bg-background">
      <div className="container mx-auto px-4">
        <h1 className="font-serif text-4xl md:text-5xl font-bold mb-10">
          Checkout
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-12">
          <form
            className="space-y-10"
            data-testid="checkout-form"
            onSubmit={(e) => e.preventDefault()}
          >
            <section>
              <h2 className="text-xs font-bold uppercase tracking-widest mb-5">
                Contact
              </h2>
              <Field label="Email" error={form.formState.errors.email?.message}>
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  {...form.register('email')}
                  data-testid="input-email"
                  className="rounded-lg h-12"
                />
              </Field>
            </section>

            <section>
              <h2 className="text-xs font-bold uppercase tracking-widest mb-5">
                Shipping Address
              </h2>
              {savedAddress && !editingAddress ? (
                <div
                  className="rounded-2xl border border-border bg-muted/20 p-6 flex items-start gap-4"
                  data-testid="saved-address-card"
                >
                  <MapPin className="w-5 h-5 mt-0.5 text-primary shrink-0" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium">{savedAddress.fullName}</p>
                    <p className="text-muted-foreground mt-0.5">
                      {savedAddress.line1}
                      {savedAddress.line2 ? `, ${savedAddress.line2}` : ''}
                    </p>
                    <p className="text-muted-foreground">
                      {[savedAddress.city, savedAddress.region, savedAddress.postalCode]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                    <p className="text-muted-foreground">{savedAddress.country}</p>
                    {savedAddress.phone ? (
                      <p className="text-muted-foreground mt-1">
                        {savedAddress.countryCode} {savedAddress.phone}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingAddress(true)}
                    className="text-xs uppercase tracking-widest text-primary hover:underline inline-flex items-center gap-1.5 shrink-0"
                    data-testid="button-edit-address"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                </div>
              ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="First name" error={form.formState.errors.firstName?.message}>
                  <Input
                    autoComplete="given-name"
                    autoCapitalize="words"
                    {...form.register('firstName')}
                    data-testid="input-firstName"
                    className="rounded-lg h-12"
                  />
                </Field>
                <Field label="Last name" error={form.formState.errors.lastName?.message}>
                  <Input
                    autoComplete="family-name"
                    autoCapitalize="words"
                    {...form.register('lastName')}
                    data-testid="input-lastName"
                    className="rounded-lg h-12"
                  />
                </Field>
                <Field
                  label="Address"
                  error={form.formState.errors.address?.message}
                  className="md:col-span-2"
                >
                  <Input
                    autoComplete="street-address"
                    autoCapitalize="words"
                    {...form.register('address')}
                    data-testid="input-address"
                    className="rounded-lg h-12"
                  />
                </Field>
                <Field label="City" error={form.formState.errors.city?.message}>
                  <Input
                    autoComplete="address-level2"
                    autoCapitalize="words"
                    {...form.register('city')}
                    data-testid="input-city"
                    className="rounded-lg h-12"
                  />
                </Field>
                <Field label="State / Region" error={form.formState.errors.state?.message}>
                  <Input
                    autoComplete="address-level1"
                    autoCapitalize="words"
                    {...form.register('state')}
                    data-testid="input-state"
                    className="rounded-lg h-12"
                  />
                </Field>
                <Field label="ZIP / Postal code" error={form.formState.errors.zip?.message}>
                  <Input
                    inputMode="numeric"
                    autoComplete="postal-code"
                    {...form.register('zip')}
                    data-testid="input-zip"
                    className="rounded-lg h-12"
                  />
                </Field>
                <Field label="Country" error={form.formState.errors.country?.message}>
                  <Input
                    autoComplete="country-name"
                    autoCapitalize="words"
                    {...form.register('country')}
                    data-testid="input-country"
                    className="rounded-lg h-12"
                  />
                </Field>
                {savedAddress && editingAddress ? (
                  <div className="md:col-span-2">
                    <button
                      type="button"
                      onClick={() => setEditingAddress(false)}
                      className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
                      data-testid="button-cancel-edit-address"
                    >
                      ← Use my saved address
                    </button>
                  </div>
                ) : null}
              </div>
              )}
            </section>

            <section>
              <h2 className="text-xs font-bold uppercase tracking-widest mb-5 flex items-center gap-2">
                Payment <Lock className="w-3 h-3" />
              </h2>

              {paystackReturnError ? (
                <p className="text-sm text-destructive flex items-start gap-2 mb-4" data-testid="paystack-return-error">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  {paystackReturnError}
                </p>
              ) : null}

              {settingsLoading || quoteLoading && !pricingReady ? (
                <p className="text-sm text-muted-foreground">
                  {settingsLoading ? 'Loading payment options…' : 'Pricing your cart…'}
                </p>
              ) : quoteError && !pricingReady ? (
                <p className="text-sm text-destructive flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  {quoteError}
                </p>
              ) : (
                <>
                  {paystackReady ? (
                    <PaymentMethodPicker
                      method={paymentMethod}
                      onChange={setPaymentMethod}
                      testMode={!!settings?.paystackTestMode}
                    />
                  ) : null}

                  {paystackReady && paymentMethod === 'paystack' ? (
                    <PaystackSubmit
                      form={form}
                      items={items}
                      disabled={!pricingReady}
                      totalLabel={
                        pricingReady
                          ? `Pay ${fmt(totalCents, currencySymbol)} with Paystack`
                          : 'Pricing your cart…'
                      }
                    />
                  ) : (
                    <BankTransferSubmit
                      form={form}
                      items={items}
                      bank={settings?.bankTransfer}
                      totalLabel={
                        pricingReady
                          ? `Place Order — ${fmt(totalCents, currencySymbol)}`
                          : 'Pricing your cart…'
                      }
                      onSuccess={(res) => {
                        setOrderId(res.orderId);
                        setConfirmedTotalCents(res.totalCents);
                        setConfirmedCurrencySymbol(currencySymbol);
                        setSubmitted(true);
                        clearCart();
                        window.scrollTo({
                          top: 0,
                          behavior: 'instant' as ScrollBehavior,
                        });
                      }}
                    />
                  )}
                </>
              )}

              <p className="text-xs text-muted-foreground mt-4 flex items-center gap-2">
                <Lock className="w-3 h-3" />{' '}
                {paystackReady && paymentMethod === 'paystack'
                  ? "You'll be redirected to Paystack's secure page — card details never touch our servers."
                  : 'Payment is completed by bank transfer using the details shown after you place your order.'}
              </p>
            </section>
          </form>

          <aside className="rounded-2xl bg-muted/30 p-8 h-fit border border-border">
            <h2 className="text-xs font-bold uppercase tracking-widest mb-6">
              Order Summary
            </h2>
            <div className="space-y-5 mb-6">
              {items.map((item) => (
                <div
                  key={`${item.productId}-${item.color}-${item.size}`}
                  className="flex gap-4"
                >
                  <div className="w-16 h-20 bg-background border border-border flex-shrink-0">
                    <img
                      src={item.image}
                      alt={item.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium line-clamp-2">{item.title}</p>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mt-1">
                      {item.color} / {item.size} · Qty {item.quantity}
                    </p>
                  </div>
                  <PriceTag amount={item.price * item.quantity} size="sm" />
                </div>
              ))}
            </div>

            <div className="border-t border-border pt-5 space-y-3 text-sm">
              <Row label="Subtotal" value={fmt(subtotalCents, currencySymbol)} />
              <Row
                label="Shipping"
                value={
                  shippingCents === 0 ? 'Free' : fmt(shippingCents, currencySymbol)
                }
              />
              <Row
                label={`Tax (${(TAX_RATE * 100).toFixed(0)}%)`}
                value={fmt(taxCents, currencySymbol)}
              />
            </div>
            <div className="border-t border-border mt-5 pt-5 flex justify-between items-center">
              <span className="text-xs uppercase tracking-widest font-bold">Total</span>
              <PriceTag
                amount={totalCents / 100}
                currencySymbol={currencySymbol}
                size="xl"
                className="inline-block"
              />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function BankDetailsList({
  bank,
  memo,
  total,
}: {
  bank: BankTransferDetails | null | undefined;
  memo: string;
  total?: string;
}) {
  // Hide a row entirely when its env var is unset, so the list doesn't show
  // empty fields like "Account number: —". If the entire bank block is
  // missing we fall back to a clear "contact us" message.
  const rows: { label: string; value: string }[] = [];
  if (bank?.bankName) rows.push({ label: 'Bank', value: bank.bankName });
  if (bank?.accountName)
    rows.push({ label: 'Account name', value: bank.accountName });
  if (bank?.accountNumber)
    rows.push({ label: 'Account number', value: bank.accountNumber });
  if (bank?.routingNumber)
    rows.push({ label: 'Routing / ABA', value: bank.routingNumber });
  if (bank?.swiftCode)
    rows.push({ label: 'SWIFT / BIC', value: bank.swiftCode });

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="bank-missing">
        Bank details aren't configured yet. The store team will contact you at
        the email address you provided with payment instructions.
      </p>
    );
  }

  return (
    <dl className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-x-6 gap-y-3 text-sm">
      {rows.map((row) => (
        <Fragment key={row.label}>
          <dt className="text-xs uppercase tracking-widest text-muted-foreground">
            {row.label}
          </dt>
          <dd className="font-mono break-all">{row.value}</dd>
        </Fragment>
      ))}
      {total ? (
        <>
          <dt className="text-xs uppercase tracking-widest text-muted-foreground">
            Amount (USD)
          </dt>
          <dd className="font-mono font-bold">{total}</dd>
        </>
      ) : null}
      <dt className="text-xs uppercase tracking-widest text-muted-foreground">
        Reference / Memo
      </dt>
      <dd className="font-mono font-bold">{memo}</dd>
      {bank?.instructions ? (
        <>
          <dt className="text-xs uppercase tracking-widest text-muted-foreground">
            Notes
          </dt>
          <dd className="text-muted-foreground">{bank.instructions}</dd>
        </>
      ) : null}
    </dl>
  );
}

function BankTransferSubmit({
  form,
  items,
  bank,
  totalLabel,
  onSuccess,
}: {
  form: ReturnType<typeof useForm<CheckoutForm>>;
  items: CartItem[];
  bank: BankTransferDetails | null | undefined;
  totalLabel: string;
  onSuccess: (res: { orderId: string; totalCents: number; currency: string }) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeOrder = async () => {
    setError(null);
    const valid = await form.trigger();
    if (!valid) {
      setError('Please complete your contact and shipping details above.');
      return;
    }
    setSubmitting(true);
    try {
      const data = form.getValues();
      const res = await fetch('/api/checkout/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: buildItemPayload(items),
          customer: data,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (body && (body.message || body.error)) ||
            `Could not place order (HTTP ${res.status}).`,
        );
      }
      // Use the server-authoritative total/currency. The pre-submit
      // estimate may differ if pricing changed between page load and submit.
      onSuccess({
        orderId: body.orderId,
        totalCents: typeof body.totalCents === 'number' ? body.totalCents : 0,
        currency: typeof body.currency === 'string' ? body.currency : 'USD',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not place order.');
      setSubmitting(false);
    }
  };

  const hasBankDetails =
    !!(bank?.bankName || bank?.accountNumber || bank?.accountName);

  return (
    <div className="space-y-5">
      <div className="border border-border bg-muted/20 p-5 text-sm">
        <p className="font-medium mb-2 flex items-center gap-2">
          <Lock className="w-4 h-4" /> Pay by bank transfer
        </p>
        <p className="text-muted-foreground mb-4">
          Place your order now, then send the total in USD to the account
          below. We'll ship as soon as the deposit clears (typically the same
          business day for ACH, 1–3 days for international wires).
        </p>
        {hasBankDetails ? (
          <div className="border border-border bg-background p-4">
            <BankDetailsList bank={bank} memo="(your order # appears here after you place the order)" />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Bank details haven't been configured for this store yet. You can
            still place your order — we'll email you with payment instructions
            within one business day.
          </p>
        )}
      </div>
      {error ? (
        <p className="text-sm text-destructive flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        onClick={placeOrder}
        disabled={submitting}
        className="w-full h-14 rounded-full text-xs tracking-widest uppercase font-bold"
        data-testid="button-place-order"
      >
        {submitting ? 'Placing…' : totalLabel}
      </Button>
    </div>
  );
}

function humanizePaystackError(code: string): string {
  switch (code) {
    case 'missing_reference':
      return 'Paystack returned without a reference. Please try paying again.';
    case 'not_configured':
      return 'Paystack is not currently configured on this store.';
    case 'order_not_found':
      return "Paystack accepted the payment but we couldn't find the matching order. Please contact support before retrying.";
    case 'amount_mismatch':
      return "We've put your order on hold because the amount Paystack confirmed doesn't match the order total. Please contact support — do not retry the payment.";
    case 'failed':
      return 'Paystack reported the payment as failed. Please try a different card.';
    case 'abandoned':
      return 'The payment was abandoned. You can try again below.';
    default:
      return `Payment was not completed (${code}).`;
  }
}

function PaymentMethodPicker({
  method,
  onChange,
  testMode,
}: {
  method: 'paystack' | 'bank';
  onChange: (m: 'paystack' | 'bank') => void;
  testMode: boolean;
}) {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5"
      role="radiogroup"
      aria-label="Choose payment method"
    >
      <MethodTile
        active={method === 'paystack'}
        onClick={() => onChange('paystack')}
        icon={<CreditCard className="w-4 h-4" />}
        title={`Pay with Paystack${testMode ? ' (Test mode)' : ''}`}
        subtitle="Card, bank, USSD — secure popup"
        testId="method-paystack"
      />
      <MethodTile
        active={method === 'bank'}
        onClick={() => onChange('bank')}
        icon={<Banknote className="w-4 h-4" />}
        title="Bank transfer"
        subtitle="Place order, send wire after"
        testId="method-bank"
      />
    </div>
  );
}

function MethodTile({
  active,
  onClick,
  icon,
  title,
  subtitle,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      data-testid={testId}
      className={`text-left rounded-xl border p-4 transition-all ${
        active
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border hover:border-foreground/30'
      }`}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
    </button>
  );
}

function PaystackSubmit({
  form,
  items,
  totalLabel,
  disabled,
}: {
  form: ReturnType<typeof useForm<CheckoutForm>>;
  items: CartItem[];
  totalLabel: string;
  disabled?: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startPayment = async () => {
    setError(null);
    const valid = await form.trigger();
    if (!valid) {
      setError('Please complete your contact and shipping details above.');
      return;
    }
    setSubmitting(true);
    try {
      const data = form.getValues();
      const res = await fetch('/api/checkout/paystack/init', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: buildItemPayload(items),
          customer: data,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (body && (body.message || body.error)) ||
            `Could not start Paystack payment (HTTP ${res.status}).`,
        );
      }
      const init = body as PaystackInitResponse;
      if (!init.authorizationUrl) {
        throw new Error('Paystack did not return an authorization URL.');
      }
      // Hand off to Paystack's hosted payment page. They redirect back
      // to /api/checkout/paystack/callback?reference=… after success or
      // failure, where the server verifies the charge before bouncing
      // the customer back to /checkout?paid=1&order=…
      window.location.href = init.authorizationUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start payment.');
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="border border-border bg-muted/20 p-5 text-sm">
        <p className="font-medium mb-2 flex items-center gap-2">
          <CreditCard className="w-4 h-4" /> Pay securely with Paystack
        </p>
        <p className="text-muted-foreground">
          You'll be redirected to Paystack's secure payment page. Card details
          never touch our servers.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        onClick={startPayment}
        disabled={submitting || !!disabled}
        className="w-full h-14 rounded-full text-xs tracking-widest uppercase font-bold"
        data-testid="button-place-order"
      >
        {submitting ? 'Redirecting…' : totalLabel}
      </Button>
    </div>
  );
}

function Field({
  label,
  error,
  children,
  className,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-xs uppercase tracking-widest mb-2 block">{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive mt-1">{error}</p> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
