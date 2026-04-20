import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useLocation } from 'wouter';
import { Star, Minus, Plus, ShoppingBag, ChevronRight, Heart } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useProducts } from '@/context/ProductsContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  fetchReviews,
  submitReview,
  type Review,
  type ReviewsResponse,
} from '@/lib/reviews';
import { getProductDescription, PRODUCT_DETAILS } from '@/lib/productDescriptions';
import { getGalleryImages } from '@/lib/productImages';
import { ProductImage } from '@/components/ProductImage';
import { PriceTag } from '@/components/PriceTag';
import { imageUrl, imagePreload } from '@/lib/imageUrl';

const HERO_IMAGE_SIZES = '(min-width: 1024px) 480px, (min-width: 768px) 45vw, 100vw';

function Stars({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'md' }) {
  const px = size === 'md' ? 'w-5 h-5' : 'w-4 h-4';
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`${px} ${
            i <= Math.round(rating) ? 'fill-primary text-primary' : 'text-muted-foreground/40'
          }`}
        />
      ))}
    </div>
  );
}

export function ProductDetailPage() {
  const params = useParams();
  const [, navigate] = useLocation();
  const { addItem } = useCart();
  const { getProduct } = useProducts();
  const { has: inWishlist, toggle: toggleWishlist } = useWishlist();

  const [product, setProduct] = useState<import('@/data/products').Product | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedColor, setSelectedColor] = useState('');
  const [selectedSize, setSelectedSize] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProduct(null);
    const id = String(params.id ?? '');
    if (!id) {
      setLoading(false);
      return;
    }
    getProduct(id)
      .then((p) => {
        if (cancelled) return;
        setProduct(p);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setProduct(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params.id, getProduct]);

  const [reviewData, setReviewData] = useState<ReviewsResponse>({
    reviews: [],
    count: 0,
    average: 0,
  });
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [formName, setFormName] = useState('');
  const [formRating, setFormRating] = useState(0);
  const [formBody, setFormBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadReviews = useCallback(async (productId: string) => {
    setReviewsLoading(true);
    try {
      const data = await fetchReviews(productId);
      setReviewData(data);
    } finally {
      setReviewsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (product) {
      setSelectedColor(product.colors[0]?.name || '');
      setSelectedSize(product.sizes[0] || '');
      setQuantity(1);
      setActiveImage(0);
      setFormName('');
      setFormRating(0);
      setFormBody('');
      void loadReviews(product.id);
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, [product?.id, loadReviews]);

  if (loading) {
    return (
      <div className="pt-28 pb-24 container mx-auto px-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          <div className="aspect-[3/4] skeleton" />
          <div className="space-y-6">
            <div className="h-4 w-24 skeleton" />
            <div className="h-10 w-3/4 skeleton" />
            <div className="h-6 w-1/4 skeleton" />
            <div className="h-32 skeleton" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="pt-40 pb-24 container mx-auto px-4 text-center">
        <h1 className="font-serif text-3xl mb-4">Product not found</h1>
        <Link href="/shop" className="text-primary underline underline-offset-4">
          Back to shop
        </Link>
      </div>
    );
  }

  const showSwatches = product.colors.length > 1;
  const gallery = getGalleryImages(product, selectedColor);
  const reviews: Review[] = reviewData.reviews;
  const rating = { average: reviewData.average, count: reviewData.count };
  const description = getProductDescription(product);
  const wishlisted = inWishlist(product.id);
  const heroPreload = imagePreload(gallery[activeImage], {
    category: product.category,
    id: product.id,
  });

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      toast.error('Please enter your name');
      return;
    }
    if (formRating < 1 || formRating > 5) {
      toast.error('Please choose a rating');
      return;
    }
    if (formBody.trim().length < 4) {
      toast.error('Please write a short review');
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitReview(product.id, {
        name: formName.trim(),
        rating: formRating,
        body: formBody.trim(),
      });
      if (!result.ok) {
        toast.error('Could not submit review. Please try again.');
        return;
      }
      toast.success('Thanks! Your review will appear once approved.');
      setFormName('');
      setFormRating(0);
      setFormBody('');
      await loadReviews(product.id);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddToCart = () => {
    if (showSwatches && !selectedColor) {
      toast.error('Please select a color');
      return;
    }
    if (!selectedSize) {
      toast.error('Please select a size');
      return;
    }
    addItem({
      productId: product.id,
      color: selectedColor || product.colors[0]?.name || 'Default',
      size: selectedSize,
      quantity,
      price: product.price,
      title: product.title,
      image: imageUrl(
        product.colors.find((c) => c.name === selectedColor)?.image ?? product.image,
        { category: product.category, id: product.id, w: 200 },
      ),
    });
    toast.success('Added to cart');
  };

  const handleBuyNow = () => {
    handleAddToCart();
    navigate('/checkout');
  };

  return (
    <div className="pt-28 pb-24 bg-background min-h-screen">
      {heroPreload && (
        <link
          rel="preload"
          as="image"
          href={heroPreload.href}
          imageSrcSet={heroPreload.imageSrcSet}
          imageSizes={HERO_IMAGE_SIZES}
          type={heroPreload.type}
          fetchPriority="high"
        />
      )}
      <div className="container mx-auto px-4">
        <nav className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-8">
          <Link href="/" className="hover:text-foreground">Home</Link>
          <ChevronRight className="w-3 h-3" />
          <Link href="/shop" className="hover:text-foreground">Shop</Link>
          <ChevronRight className="w-3 h-3" />
          <Link
            href={`/shop?category=${encodeURIComponent(product.category)}`}
            className="hover:text-foreground"
          >
            {product.category}
          </Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground line-clamp-1 max-w-[40ch]">{product.title}</span>
        </nav>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-12 lg:gap-16 items-start">
          <div className="flex flex-col-reverse md:flex-row gap-4 w-full max-w-[560px] mx-auto md:mx-0 md:sticky md:top-28">
            <div className="flex md:flex-col gap-3 md:max-h-[560px] overflow-x-auto md:overflow-y-auto">
              {gallery.map((img, idx) => (
                <button
                  key={img + idx}
                  onClick={() => setActiveImage(idx)}
                  className={`flex-shrink-0 w-20 h-24 rounded-lg overflow-hidden border-2 transition-all ${
                    activeImage === idx
                      ? 'border-primary'
                      : 'border-transparent hover:border-border'
                  }`}
                  data-testid={`thumbnail-${idx}`}
                >
                  <ProductImage
                    src={img}
                    category={product.category}
                    id={product.id}
                    alt=""
                    className="w-full h-full object-cover"
                    width={200}
                  />
                </button>
              ))}
            </div>
            <div className="flex-1 min-w-0 bg-muted aspect-[3/4] relative overflow-hidden rounded-2xl ring-1 ring-border/40 shadow-sm">
              <ProductImage
                src={gallery[activeImage]}
                category={product.category}
                id={product.id}
                alt={product.imageAlt}
                className="absolute inset-0 w-full h-full object-cover"
                priority
                sizes={HERO_IMAGE_SIZES}
              />
              <button
                onClick={() => {
                  toggleWishlist(product.id);
                  toast.success(wishlisted ? 'Removed from wishlist' : 'Saved to wishlist');
                }}
                className={`absolute top-4 right-4 w-11 h-11 rounded-full flex items-center justify-center backdrop-blur transition-colors ${
                  wishlisted
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background/85 text-foreground hover:bg-background'
                }`}
                aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
                data-testid="button-wishlist-detail"
              >
                <Heart className={`w-5 h-5 ${wishlisted ? 'fill-current' : ''}`} />
              </button>
            </div>
          </div>

          <div className="flex flex-col">
            <span className="text-primary text-xs font-bold tracking-widest uppercase mb-3">
              {product.category}
            </span>
            <h1 className="font-serif text-3xl md:text-4xl lg:text-5xl font-extrabold mb-4 leading-tight">
              {product.title}
            </h1>
            <div className="flex items-center gap-3 mb-6">
              <Stars rating={rating.average} />
              <span className="text-sm text-muted-foreground">
                {rating.average.toFixed(1)} · {rating.count} reviews
              </span>
            </div>
            <PriceTag amount={product.price} size="xl" className="mb-8 inline-block" />

            <p className="text-sm text-muted-foreground leading-relaxed mb-8">{description}</p>

            {showSwatches && (
              <div className="mb-8">
                <div className="flex justify-between mb-4">
                  <span className="text-xs font-bold uppercase tracking-widest">
                    Color: <span className="text-muted-foreground ml-1 font-normal">{selectedColor}</span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-3">
                  {product.colors.map((color) => (
                    <button
                      key={color.name}
                      onClick={() => {
                        setSelectedColor(color.name);
                        setActiveImage(0);
                      }}
                      className={`w-10 h-10 rounded-full border-2 transition-all ${
                        selectedColor === color.name
                          ? 'border-primary scale-110 shadow-md'
                          : 'border-transparent hover:scale-105'
                      }`}
                      style={{
                        backgroundColor: color.hex,
                        boxShadow:
                          selectedColor === color.name
                            ? '0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--primary))'
                            : 'none',
                      }}
                      title={color.name}
                      data-testid={`color-${color.name}`}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="mb-8">
              <div className="flex justify-between mb-4">
                <span className="text-xs font-bold uppercase tracking-widest">
                  Size: <span className="text-muted-foreground ml-1 font-normal">{selectedSize}</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {product.sizes.map((size) => (
                  <button
                    key={size}
                    onClick={() => setSelectedSize(size)}
                    className={`min-w-[3.5rem] h-12 px-4 text-sm font-medium border transition-all ${
                      selectedSize === size
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-foreground hover:border-foreground'
                    }`}
                    data-testid={`size-${size}`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="flex items-center border border-border h-14 bg-background">
                <button
                  className="w-14 h-full flex items-center justify-center text-muted-foreground hover:text-foreground"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="w-12 text-center font-medium text-lg" data-testid="quantity">
                  {quantity}
                </span>
                <button
                  className="w-14 h-full flex items-center justify-center text-muted-foreground hover:text-foreground"
                  onClick={() => setQuantity(quantity + 1)}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <Button
                onClick={handleAddToCart}
                className="flex-1 h-14 rounded-full text-xs tracking-widest uppercase font-bold"
                data-testid="button-add-to-cart"
              >
                <ShoppingBag className="w-4 h-4 mr-3" />
                Add to Cart
              </Button>
            </div>
            <Button
              variant="outline"
              onClick={handleBuyNow}
              className="h-12 rounded-full text-xs tracking-widest uppercase font-bold"
              data-testid="button-buy-now"
            >
              Buy Now
            </Button>

            <ul className="mt-10 pt-8 border-t border-border dark:border-border/50 text-xs text-muted-foreground space-y-2">
              {PRODUCT_DETAILS.map((d) => (
                <li key={d}>· {d}</li>
              ))}
            </ul>
          </div>
        </div>

        <section className="mt-24 pt-12 border-t border-border">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10">
            <div>
              <h2 className="font-serif text-3xl md:text-4xl font-extrabold mb-3">
                Customer Reviews
              </h2>
              <div className="flex items-center gap-3">
                <Stars rating={rating.average} size="md" />
                <span className="text-muted-foreground">
                  {rating.count > 0
                    ? `${rating.average.toFixed(1)} out of 5 · ${rating.count} review${rating.count === 1 ? '' : 's'}`
                    : 'No reviews yet'}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 max-w-5xl">
            <div className="space-y-8">
              {reviewsLoading && reviews.length === 0 ? (
                <p className="text-sm text-muted-foreground">Loading reviews…</p>
              ) : reviews.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Be the first to review this product.
                </p>
              ) : (
                reviews.map((r) => (
                  <article
                    key={r.id}
                    className="border-b border-border dark:border-border/50 pb-8 last:border-b-0"
                    data-testid={`review-${r.id}`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <Stars rating={r.rating} />
                    </div>
                    <p className="text-xs text-muted-foreground mb-3 uppercase tracking-widest">
                      {r.name} · {new Date(r.createdAt).toISOString().slice(0, 10)}
                    </p>
                    <p className="text-sm text-foreground/80 leading-relaxed">{r.body}</p>
                  </article>
                ))
              )}
            </div>

            <form
              onSubmit={handleSubmitReview}
              className="border border-border dark:border-border/50 p-6 space-y-5 h-fit"
              data-testid="review-form"
            >
              <h3 className="font-serif text-xl font-extrabold">Write a review</h3>

              <div className="space-y-2">
                <Label htmlFor="review-name" className="text-xs uppercase tracking-widest">
                  Your name
                </Label>
                <Input
                  id="review-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  maxLength={80}
                  required
                  data-testid="input-review-name"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-widest">Rating</Label>
                <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setFormRating(i)}
                      className="p-1"
                      aria-label={`${i} star${i === 1 ? '' : 's'}`}
                      aria-checked={formRating === i}
                      role="radio"
                      data-testid={`rating-star-${i}`}
                    >
                      <Star
                        className={`w-6 h-6 ${
                          i <= formRating
                            ? 'fill-primary text-primary'
                            : 'text-muted-foreground/40'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="review-body" className="text-xs uppercase tracking-widest">
                  Your review
                </Label>
                <Textarea
                  id="review-body"
                  value={formBody}
                  onChange={(e) => setFormBody(e.target.value)}
                  rows={5}
                  maxLength={2000}
                  required
                  data-testid="input-review-body"
                />
              </div>

              <Button
                type="submit"
                disabled={submitting}
                className="w-full h-12 rounded-full text-xs tracking-widest uppercase font-bold"
                data-testid="button-submit-review"
              >
                {submitting ? 'Submitting…' : 'Submit Review'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Reviews appear after a quick check by our team.
              </p>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
