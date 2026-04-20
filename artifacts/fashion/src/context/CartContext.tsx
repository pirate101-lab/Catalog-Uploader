import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';

const CART_STORAGE_KEY = 'fashion-store-cart';

export interface CartItem {
  productId: string;
  color: string;
  size: string;
  quantity: number;
  price: number;
  title: string;
  image: string;
}

interface CartContextType {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'quantity'> & { quantity?: number }) => void;
  removeItem: (productId: string, color: string, size: string) => void;
  updateQuantity: (productId: string, color: string, size: string, quantity: number) => void;
  updateQty: (productId: string, color: string, size: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: number;
  itemCount: number;
  subtotal: number;
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = window.localStorage.getItem(CART_STORAGE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is CartItem =>
        item && typeof item.productId === 'string'
        && typeof item.color === 'string'
        && typeof item.size === 'string'
        && typeof item.quantity === 'number'
        && typeof item.price === 'number'
        && typeof item.title === 'string'
        && typeof item.image === 'string'
      );
    } catch {
      return [];
    }
  });
  const [isCartOpen, setIsCartOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch {
      // ignore storage errors (quota, private mode, etc.)
    }
  }, [items]);

  const addItem = (newItem: Omit<CartItem, 'quantity'> & { quantity?: number }) => {
    setItems(current => {
      const existingIndex = current.findIndex(
        item => item.productId === newItem.productId && item.color === newItem.color && item.size === newItem.size
      );

      if (existingIndex >= 0) {
        const updated = [...current];
        updated[existingIndex].quantity += (newItem.quantity || 1);
        return updated;
      }

      return [...current, { ...newItem, quantity: newItem.quantity || 1 }];
    });
    setIsCartOpen(true);
  };

  const removeItem = (productId: string, color: string, size: string) => {
    setItems(current => current.filter(
      item => !(item.productId === productId && item.color === color && item.size === size)
    ));
  };

  const updateQuantity = (productId: string, color: string, size: string, quantity: number) => {
    if (quantity < 1) {
      removeItem(productId, color, size);
      return;
    }
    setItems(current => current.map(item => {
      if (item.productId === productId && item.color === color && item.size === size) {
        return { ...item, quantity };
      }
      return item;
    }));
  };

  const totalItems = useMemo(() => items.reduce((acc, item) => acc + item.quantity, 0), [items]);
  const subtotal = useMemo(() => items.reduce((acc, item) => acc + (item.price * item.quantity), 0), [items]);

  return (
    <CartContext.Provider value={{
      items,
      addItem,
      removeItem,
      updateQuantity,
      updateQty: updateQuantity,
      clearCart: () => setItems([]),
      totalItems,
      itemCount: totalItems,
      subtotal,
      isCartOpen,
      setIsCartOpen
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}