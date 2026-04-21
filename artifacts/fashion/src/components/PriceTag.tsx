import { useCurrency } from '@/context/CurrencyContext';

interface PriceTagProps {
  amount: number;
  currencySymbol?: string;
  /** Visual size preset. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Render the cents (decimal portion) at a smaller font, like a price tag. */
  splitCents?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<PriceTagProps['size']>, { whole: string; cents: string; full: string }> = {
  sm: { whole: 'text-base', cents: 'text-[10px]', full: 'text-sm' },
  md: { whole: 'text-lg', cents: 'text-xs', full: 'text-lg' },
  lg: { whole: 'text-2xl', cents: 'text-sm', full: 'text-2xl' },
  xl: { whole: 'text-3xl', cents: 'text-base', full: 'text-3xl' },
};

/**
 * Single source of truth for rendering a customer-facing price.
 * Always uses the `--price` token (electric blue) so the brand stays
 * consistent across cards, PDP, cart, checkout, and modals.
 */
export function PriceTag({
  amount,
  currencySymbol,
  size = 'md',
  splitCents = false,
  className = '',
}: PriceTagProps) {
  const { symbol: contextSymbol } = useCurrency();
  const symbol = currencySymbol ?? contextSymbol;
  const safe = Number.isFinite(amount) ? amount : 0;
  const fixed = safe.toFixed(2);
  const sizes = SIZE_CLASSES[size];

  if (splitCents) {
    const dot = fixed.indexOf('.');
    const whole = fixed.slice(0, dot + 1);
    const cents = fixed.slice(dot + 1);
    return (
      <span className={`font-bold leading-none whitespace-nowrap text-price ${className}`}>
        <span className={sizes.whole}>{symbol}{whole}</span>
        <span className={sizes.cents}>{cents}</span>
      </span>
    );
  }

  return (
    <span
      className={`font-bold leading-none whitespace-nowrap text-price ${sizes.full} ${className}`}
    >
      {symbol}{fixed}
    </span>
  );
}
