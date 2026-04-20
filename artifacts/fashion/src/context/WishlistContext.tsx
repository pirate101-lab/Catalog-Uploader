import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'velour-wishlist';

interface WishlistContextValue {
  ids: string[];
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  add: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  count: number;
}

const WishlistContext = createContext<WishlistContextValue | undefined>(undefined);

function readInitial(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<string[]>(readInitial);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }, [ids]);

  const value = useMemo<WishlistContextValue>(() => {
    const set = new Set(ids);
    return {
      ids,
      has: (id) => set.has(id),
      add: (id) => setIds((cur) => (cur.includes(id) ? cur : [...cur, id])),
      remove: (id) => setIds((cur) => cur.filter((x) => x !== id)),
      toggle: (id) =>
        setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])),
      clear: () => setIds([]),
      count: ids.length,
    };
  }, [ids]);

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist(): WishlistContextValue {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error('useWishlist must be used inside WishlistProvider');
  return ctx;
}
