export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col" data-testid="skeleton-product-card">
      <div className="aspect-square skeleton rounded-2xl border border-border" />
      <div className="pt-3 space-y-2">
        <div className="h-3 w-3/4 skeleton rounded" />
        <div className="h-4 w-1/3 skeleton rounded" />
        <div className="h-3 w-1/4 skeleton rounded" />
        <div className="flex items-center justify-between pt-1">
          <div className="h-3 w-2/3 skeleton rounded" />
          <div className="h-9 w-9 rounded-full skeleton" />
        </div>
      </div>
    </div>
  );
}
