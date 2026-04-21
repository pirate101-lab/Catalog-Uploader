import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { loadStripe, type Stripe as StripeJs } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { useCart, type CartItem } from '@/context/CartContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, Lock, AlertTriangle } from 'lucide-react';
import { PriceTag } from '@/components/PriceTag';

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
  stripePublishableKey: string | null;
  paymentsConfigured: boolean;
  bankTransfer?: BankTransferDetails;
}

interface IntentResponse {
  clientSecret: string;
  paymentIntentId: string;
  cartHash: string;
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
}

interface ConfirmResponse {
  orderId: string;
  totalCents: number;
  currency: string;
  paymentIntentId: string;
  receiptEmail: string | null;
}

const stripePromiseCache = new Map<string, Promise<StripeJs | null>>();
function getStripePromise(pk: string): Promise<StripeJs | null> {
  let p = stripePromiseCache.get(pk);
  if (!p) {
    p = loadStripe(pk);
    stripePromiseCache.set(pk, p);
  }
  return p;
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

export function CheckoutPage() {
  const { items, subtotal, clearCart } = useCart();
  const [, navigate] = useLocation();
  const [submitted, setSubmitted] = useState(false);
  const [orderId, setOrderId] = useState('');
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
  const [intent, setIntent] = useState<IntentResponse | null>(null);
  const [intentError, setIntentError] = useState<string | null>(null);

  // Client-side estimate, only used until the server-authoritative
  // totals come back in the `intent`.
  const estShippingCents =
    subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD
      ? 0
      : Math.round(SHIPPING_FLAT * 100);
  const estSubtotalCents = Math.round(subtotal * 100);
  const estTaxCents = Math.round(estSubtotalCents * TAX_RATE);
  const estTotalCents = estSubtotalCents + estShippingCents + estTaxCents;

  const currencySymbol = settings?.currencySymbol ?? '$';
  const subtotalCents = intent?.subtotalCents ?? estSubtotalCents;
  const shippingCents = intent?.shippingCents ?? estShippingCents;
  const taxCents = intent?.taxCents ?? estTaxCents;
  const totalCents = intent?.totalCents ?? estTotalCents;

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

  // Build a stable key over the cart contents so we only refresh the
  // PaymentIntent when the cart actually changes.
  const cartKey = useMemo(
    () =>
      items
        .map(
          (i) =>
            `${i.productId}|${i.color}|${i.size}|${i.quantity}`,
        )
        .sort()
        .join(','),
    [items],
  );

  // Create a PaymentIntent as soon as the cart + payment config are ready.
  useEffect(() => {
    if (!settings?.paymentsConfigured) return;
    if (items.length === 0) return;
    if (submitted) return;
    let cancelled = false;
    setIntent(null);
    setIntentError(null);
    fetch('/api/checkout/intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: form.getValues('email') || 'guest@example.com',
        items: buildItemPayload(items),
      }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok) {
          throw new Error(
            (data && (data.message || data.error)) ||
              `Could not start payment (HTTP ${r.status}).`,
          );
        }
        return data as IntentResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setIntent(data);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setIntentError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [
    settings?.paymentsConfigured,
    settings?.currency,
    cartKey,
    items,
    submitted,
    form,
  ]);

  const stripePromise = useMemo(() => {
    if (!settings?.stripePublishableKey) return null;
    return getStripePromise(settings.stripePublishableKey);
  }, [settings?.stripePublishableKey]);

  if (submitted) {
    const bank = settings?.bankTransfer;
    // Always render the server-authoritative total persisted on the order;
    // never show the client-side estimate after submit, otherwise the wire
    // amount on the success page could disagree with what's in the database.
    const finalTotalCents = confirmedTotalCents ?? totalCents;
    const finalSymbol = confirmedCurrencySymbol ?? currencySymbol;
    const totalDisplay = fmt(finalTotalCents, finalSymbol);
    return (
      <div className="pt-32 pb-24 min-h-screen bg-background">
        <div className="container mx-auto px-4 max-w-2xl">
          <div className="text-center">
            <CheckCircle2 className="w-16 h-16 mx-auto text-primary mb-6" />
            <h1 className="font-serif text-4xl md:text-5xl font-bold mb-4">
              Order received
            </h1>
            <p className="text-muted-foreground mb-2">
              Your order has been recorded. Please complete payment by bank
              transfer using the details below — once we see the deposit we'll
              ship your order and email you a confirmation.
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

          <div className="border border-border bg-muted/20 p-8 mb-10">
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
              </div>
            </section>

            <section>
              <h2 className="text-xs font-bold uppercase tracking-widest mb-5 flex items-center gap-2">
                Payment <Lock className="w-3 h-3" />
              </h2>

              {settingsLoading ? (
                <p className="text-sm text-muted-foreground">
                  Loading payment options…
                </p>
              ) : !settings?.paymentsConfigured ? (
                <BankTransferSubmit
                  form={form}
                  items={items}
                  bank={settings?.bankTransfer}
                  totalLabel={`Place Order — ${fmt(totalCents, currencySymbol)}`}
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
              ) : intentError ? (
                <p className="text-sm text-destructive flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  {intentError}
                </p>
              ) : !intent || !stripePromise ? (
                <p className="text-sm text-muted-foreground">
                  Preparing secure payment…
                </p>
              ) : (
                <Elements
                  stripe={stripePromise}
                  options={{
                    clientSecret: intent.clientSecret,
                    appearance: { theme: 'stripe' },
                  }}
                >
                  <StripePaymentForm
                    form={form}
                    intent={intent}
                    items={items}
                    onSuccess={(res) => {
                      setOrderId(res.orderId);
                      setSubmitted(true);
                      clearCart();
                      window.scrollTo({
                        top: 0,
                        behavior: 'instant' as ScrollBehavior,
                      });
                    }}
                    totalLabel={`Pay ${fmt(intent.totalCents, currencySymbol)}`}
                  />
                </Elements>
              )}

              <p className="text-xs text-muted-foreground mt-4 flex items-center gap-2">
                <Lock className="w-3 h-3" />{' '}
                {settings?.paymentsConfigured
                  ? 'Card details are tokenized by Stripe — they never touch our servers.'
                  : 'No card is charged at checkout — payment is completed by bank transfer using the details shown after you place your order.'}
              </p>
            </section>
          </form>

          <aside className="bg-muted/30 p-8 h-fit border border-border">
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

interface StripePaymentFormProps {
  form: ReturnType<typeof useForm<CheckoutForm>>;
  intent: IntentResponse;
  items: CartItem[];
  totalLabel: string;
  onSuccess: (res: ConfirmResponse) => void;
}

function StripePaymentForm({
  form,
  intent,
  items,
  totalLabel,
  onSuccess,
}: StripePaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePay = async () => {
    setError(null);
    const valid = await form.trigger();
    if (!valid) {
      setError('Please complete your contact and shipping details above.');
      return;
    }
    if (!stripe || !elements) return;

    setSubmitting(true);
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? 'Could not validate card details.');
      setSubmitting(false);
      return;
    }

    const { error: payError, paymentIntent } = await stripe.confirmPayment({
      elements,
      clientSecret: intent.clientSecret,
      redirect: 'if_required',
      confirmParams: {
        receipt_email: form.getValues('email'),
      },
    });

    if (payError) {
      setError(payError.message ?? 'Payment was declined.');
      setSubmitting(false);
      return;
    }
    if (!paymentIntent || paymentIntent.status !== 'succeeded') {
      setError(
        `Payment status: ${paymentIntent?.status ?? 'unknown'}. Please try again.`,
      );
      setSubmitting(false);
      return;
    }

    try {
      const data = form.getValues();
      const res = await fetch('/api/checkout/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          paymentIntentId: paymentIntent.id,
          email: data.email,
          customerName: `${data.firstName} ${data.lastName}`.trim(),
          shipping: {
            firstName: data.firstName,
            lastName: data.lastName,
            address: data.address,
            city: data.city,
            state: data.state,
            zip: data.zip,
            country: data.country,
          },
          items: buildItemPayload(items),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (body && (body.message || body.error)) ||
            `Could not save order (HTTP ${res.status}).`,
        );
      }
      onSuccess(body as ConfirmResponse);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Your card was charged but we could not save your order: ${e.message}. Please contact support.`
          : 'Your card was charged but we could not save your order. Please contact support.',
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="border border-border p-4">
        <PaymentElement />
      </div>
      {error ? (
        <p className="text-sm text-destructive flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        onClick={handlePay}
        disabled={submitting || !stripe || !elements}
        className="w-full h-14 rounded-full text-xs tracking-widest uppercase font-bold"
        data-testid="button-place-order"
      >
        {submitting ? 'Processing…' : totalLabel}
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
