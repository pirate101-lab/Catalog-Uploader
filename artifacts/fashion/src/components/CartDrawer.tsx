import { useLocation } from 'wouter';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Minus, Plus, X, ShoppingBag } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { PriceTag } from '@/components/PriceTag';

export function CartDrawer() {
  const { isCartOpen, setIsCartOpen, items, updateQuantity, removeItem, subtotal } = useCart();
  const [, navigate] = useLocation();

  const handleCheckout = () => {
    setIsCartOpen(false);
    navigate('/checkout');
  };

  return (
    <Sheet open={isCartOpen} onOpenChange={setIsCartOpen}>
      <SheetContent className="w-full sm:max-w-md border-l border-border bg-background p-0 flex flex-col shadow-2xl">
        <SheetHeader className="p-6 border-b border-border bg-muted/30">
          <SheetTitle className="font-serif text-2xl flex items-center gap-3">
            <ShoppingBag className="w-6 h-6" />
            Your Cart ({items.reduce((a, c) => a + c.quantity, 0)})
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-6">
              <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center">
                <ShoppingBag className="w-10 h-10 opacity-50" />
              </div>
              <p className="text-lg font-light">Your cart is empty.</p>
              <Button 
                variant="default" 
                className="mt-4 rounded-full px-8 text-xs tracking-widest uppercase font-bold"
                onClick={() => setIsCartOpen(false)}
              >
                Continue Shopping
              </Button>
            </div>
          ) : (
            <div className="space-y-8">
              {items.map(item => (
                <div key={`${item.productId}-${item.color}-${item.size}`} className="flex gap-5">
                  <div className="w-24 h-32 bg-muted flex-shrink-0 border border-border dark:border-border/50">
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div aria-label={item.title} className="w-full h-full" />
                    )}
                  </div>
                  <div className="flex-1 flex flex-col">
                    <div className="flex justify-between items-start gap-2">
                      <h4 className="font-medium text-sm leading-snug line-clamp-2 pr-4">{item.title}</h4>
                      <button 
                        onClick={() => removeItem(item.productId, item.color, item.size)}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1 -mr-2 -mt-1"
                        title="Remove item"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="text-xs text-muted-foreground mt-2 uppercase tracking-wider">
                      {item.color} / {item.size}
                    </div>
                    <div className="mt-auto pt-4 flex items-center justify-between">
                      <div className="flex items-center border border-border h-9">
                        <button 
                          className="w-9 h-full flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors bg-muted/20"
                          onClick={() => updateQuantity(item.productId, item.color, item.size, item.quantity - 1)}
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-10 text-center text-sm font-medium">{item.quantity}</span>
                        <button 
                          className="w-9 h-full flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors bg-muted/20"
                          onClick={() => updateQuantity(item.productId, item.color, item.size, item.quantity + 1)}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <PriceTag amount={item.price * item.quantity} size="md" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="p-6 border-t border-border bg-background shadow-[0_-10px_20px_rgba(0,0,0,0.05)]">
            <div className="flex justify-between items-center mb-6">
              <span className="text-sm uppercase tracking-wider font-bold">Subtotal</span>
              <PriceTag amount={subtotal} size="xl" />
            </div>
            <p className="text-xs text-muted-foreground mb-6">Shipping and taxes calculated at checkout.</p>
            <Button 
              className="w-full h-14 rounded-full text-sm tracking-widest uppercase font-bold shadow-lg hover:shadow-xl transition-all"
              onClick={handleCheckout}
              data-testid="button-checkout"
            >
              Checkout
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}