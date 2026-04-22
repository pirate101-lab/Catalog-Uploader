import { createContext, useContext, type ReactNode } from 'react';

interface CurrencyState {
  code: string;
  symbol: string;
}

// Display currency is hard-locked to USD. The merchant Paystack
// account is locked to KES, so we quote the catalog in USD and
// convert to KES only at checkout time. The storefront never needs
// to render multiple currency options — that switch lives in the
// admin Settings → FX rate card instead.
const DEFAULT_STATE: CurrencyState = { code: 'USD', symbol: '$' };

const CurrencyContext = createContext<CurrencyState>(DEFAULT_STATE);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  return (
    <CurrencyContext.Provider value={DEFAULT_STATE}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency(): CurrencyState {
  return useContext(CurrencyContext);
}
