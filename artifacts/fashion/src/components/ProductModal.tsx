import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Minus, Plus, ShoppingBag } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { toast } from 'sonner';
import type { Product } from '@/data/products';
import { ProductImage } from './ProductImage';
import { PriceTag } from './PriceTag';
import { imageUrl } from '@/lib/imageUrl';

interface ProductModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ProductModal({ product, isOpen, onClose }: ProductModalProps) {
  const { addItem } = useCart();
  const [selectedColor, setSelectedColor] = useState<string>('');
  const [selectedSize, setSelectedSize] = useState<string>('');
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (product) {
      setSelectedColor(product.colors[0]?.name || '');
      setSelectedSize(product.sizes[0] || '');
      setQuantity(1);
    }
  }, [product]);

  if (!product) return null;

  const showSwatches = product.colors.length > 1;
  const activeColor = product.colors.find((c) => c.name === selectedColor);

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
      image: imageUrl(activeColor?.image || product.image, {
        category: product.category,
        id: product.id,
        w: 200,
      }),
    });
    toast.success('Added to cart');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl p-0 overflow-hidden bg-background border-border rounded-none shadow-2xl gap-0">
        <DialogTitle className="sr-only">{product.title}</DialogTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 h-full max-h-[90vh]">
          <div className="bg-muted aspect-square md:aspect-auto md:h-[90vh] relative">
            <ProductImage
              src={activeColor?.image || product.image}
              category={product.category}
              id={product.id}
              alt={product.imageAlt}
              className="absolute inset-0 w-full h-full object-cover"
              loading="eager"
              width={900}
            />
          </div>

          <div className="p-8 md:p-12 flex flex-col md:h-[90vh] overflow-y-auto bg-background">
            <span className="text-primary text-xs font-bold tracking-widest uppercase mb-3 block">
              {product.category}
            </span>
            <h2 className="font-serif text-3xl md:text-4xl font-bold mb-4 leading-tight">
              {product.title}
            </h2>
            <PriceTag amount={product.price} size="xl" className="mb-10 inline-block" />

            {showSwatches && (
              <div className="mb-8">
                <div className="flex justify-between mb-4">
                  <span className="text-xs font-bold uppercase tracking-widest">
                    Color:{' '}
                    <span className="text-muted-foreground ml-1 font-normal">{selectedColor}</span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-3">
                  {product.colors.map((color) => (
                    <button
                      key={color.name}
                      onClick={() => setSelectedColor(color.name)}
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
                      data-testid={`modal-color-${color.name}`}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="mb-10">
              <div className="flex justify-between mb-4">
                <span className="text-xs font-bold uppercase tracking-widest">
                  Size:{' '}
                  <span className="text-muted-foreground ml-1 font-normal">{selectedSize}</span>
                </span>
                <button className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors">
                  Size Guide
                </button>
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
                    data-testid={`modal-size-${size}`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-auto pt-6 flex flex-col sm:flex-row gap-4">
              <div className="flex items-center border border-border h-14 bg-background">
                <button
                  className="w-14 h-full flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="w-12 text-center font-medium text-lg">{quantity}</span>
                <button
                  className="w-14 h-full flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setQuantity(quantity + 1)}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <Button
                onClick={handleAddToCart}
                className="flex-1 h-14 rounded-none text-xs tracking-widest uppercase font-bold shadow-lg hover:shadow-xl transition-all"
                data-testid="modal-add-to-cart"
              >
                <ShoppingBag className="w-4 h-4 mr-3" />
                Add to Cart
              </Button>
            </div>

            <div className="mt-8 pt-8 border-t border-border dark:border-border/50 text-xs text-muted-foreground space-y-2">
              <p>Free standard shipping on orders over $150.</p>
              <p>Free returns within 30 days.</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
