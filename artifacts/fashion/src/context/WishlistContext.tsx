import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'velour-wishlist';
const SESSION_KEY = 'velour-session';

function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  let s = window.localStorage.getItem(SESSION_KEY);
  if (!s) {
    s = `s_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    window.localStorage.setItem(SESSION_KEY, s);
  }
  return s;
}

function sendWishlistSignal(productId: string) {
  try {
    fetch('/api/storefront/wishlist-signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ productId, sessionId: getSessionId() }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* fire-and-forget */
  }
}

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
      add: (id) =>
        setIds((cur) => {
          if (cur.includes(id)) return cur;
          sendWishlistSignal(id);
          return [...cur, id];
        }),
      remove: (id) => setIds((cur) => cur.filter((x) => x !== id)),
      toggle: (id) =>
        setIds((cur) => {
          if (cur.includes(id)) return cur.filter((x) => x !== id);
          sendWishlistSignal(id);
          return [...cur, id];
        }),
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
