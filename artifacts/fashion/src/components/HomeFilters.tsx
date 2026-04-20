import { useEffect, useState } from 'react';
import { ALL_SIZES } from '@/data/products';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SortKey } from '@/lib/homeFilters';
import { PRICE_MAX } from '@/lib/homeFilters';

interface Props {
  sizes: string[];
  onSizesChange: (s: string[]) => void;
  priceMin: number;
  priceMax: number;
  onPriceChange: (min: number, max: number) => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
}

export function HomeFilters({
  sizes,
  onSizesChange,
  priceMin,
  priceMax,
  onPriceChange,
  sort,
  onSortChange,
}: Props) {
  // Local draft for the price inputs so we only commit on blur / Enter and
  // don't refetch the grid on every keystroke.
  const [minDraft, setMinDraft] = useState(String(priceMin));
  const [maxDraft, setMaxDraft] = useState(String(priceMax));
  useEffect(() => setMinDraft(String(priceMin)), [priceMin]);
  useEffect(() => setMaxDraft(String(priceMax)), [priceMax]);

  const commitPrice = () => {
    const parsedMin = Math.max(0, Number(minDraft) || 0);
    const parsedMax = Math.min(PRICE_MAX, Number(maxDraft) || PRICE_MAX);
    const lo = Math.min(parsedMin, parsedMax);
    const hi = Math.max(parsedMin, parsedMax);
    onPriceChange(lo, hi);
  };

  const toggleSize = (s: string) => {
    onSizesChange(sizes.includes(s) ? sizes.filter((x) => x !== s) : [...sizes, s]);
  };

  return (
    <div className="space-y-7">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-foreground">
          Size
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {ALL_SIZES.map((s) => (
            <button
              key={s}
              onClick={() => toggleSize(s)}
              className={`h-9 text-xs font-semibold border transition-all ${
                sizes.includes(s)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-foreground hover:border-foreground'
              }`}
              data-testid={`home-filter-size-${s}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-foreground">
          Price
        </h3>
        <div className="flex items-center gap-2">
          <label className="flex-1">
            <span className="sr-only">Minimum price</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={PRICE_MAX}
              value={minDraft}
              onChange={(e) => setMinDraft(e.target.value)}
              onBlur={commitPrice}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitPrice();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="Min"
              className="w-full h-9 px-2 text-sm border border-border bg-background"
              data-testid="home-filter-price-min"
            />
          </label>
          <span className="text-muted-foreground text-xs">to</span>
          <label className="flex-1">
            <span className="sr-only">Maximum price</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={PRICE_MAX}
              value={maxDraft}
              onChange={(e) => setMaxDraft(e.target.value)}
              onBlur={commitPrice}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitPrice();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="Max"
              className="w-full h-9 px-2 text-sm border border-border bg-background"
              data-testid="home-filter-price-max"
            />
          </label>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-foreground">
          Sort
        </h3>
        <Select value={sort} onValueChange={(v) => onSortChange(v as SortKey)}>
          <SelectTrigger className="w-full rounded-lg h-9" data-testid="home-filter-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="featured">Featured</SelectItem>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="name-asc">Name: A → Z</SelectItem>
            <SelectItem value="price-asc">Price: Low to High</SelectItem>
            <SelectItem value="price-desc">Price: High to Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

    </div>
  );
}
