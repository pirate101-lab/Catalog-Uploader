import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

interface CurrencyState {
  code: string;
  symbol: string;
}

const DEFAULT_STATE: CurrencyState = { code: 'USD', symbol: '$' };

const CurrencyContext = createContext<CurrencyState>(DEFAULT_STATE);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CurrencyState>(DEFAULT_STATE);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/storefront/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const code =
          typeof data.currency === 'string' && data.currency
            ? data.currency
            : DEFAULT_STATE.code;
        const symbol =
          typeof data.currencySymbol === 'string' && data.currencySymbol
            ? data.currencySymbol
            : DEFAULT_STATE.symbol;
        setState({ code, symbol });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <CurrencyContext.Provider value={state}>{children}</CurrencyContext.Provider>
  );
}

export function useCurrency(): CurrencyState {
  return useContext(CurrencyContext);
}
