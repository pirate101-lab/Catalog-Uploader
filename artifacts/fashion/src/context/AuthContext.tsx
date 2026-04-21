import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const apiBase = `${basePath}/api`;

export interface AuthUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function deriveError(body: any, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  if (typeof body.message === 'string' && body.message) return body.message;
  if (typeof body.error === 'string' && body.error) {
    switch (body.error) {
      case 'invalid_email':
        return 'Enter a valid email address.';
      case 'weak_password':
        return 'Password must be at least 8 characters.';
      case 'email_taken':
        return 'An account already exists for that email. Try signing in.';
      case 'invalid_credentials':
        return 'Email or password is incorrect.';
      default:
        return body.error;
    }
  }
  return fallback;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/auth/user`, { credentials: 'include' });
      if (!r.ok) {
        setUser(null);
        return;
      }
      const body = await readJson(r);
      setUser((body?.user as AuthUser | null) ?? null);
    } catch {
      setUser(null);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const r = await fetch(`${apiBase}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await readJson(r);
      if (!r.ok) throw new Error(deriveError(body, 'Could not sign in.'));
      setUser((body?.user as AuthUser | null) ?? null);
      setIsLoaded(true);
    },
    [],
  );

  const signUp = useCallback(
    async (input: {
      email: string;
      password: string;
      firstName?: string;
      lastName?: string;
    }) => {
      const r = await fetch(`${apiBase}/auth/register`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body = await readJson(r);
      if (!r.ok) throw new Error(deriveError(body, 'Could not create account.'));
      setUser((body?.user as AuthUser | null) ?? null);
      setIsLoaded(true);
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await fetch(`${apiBase}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // ignore network errors — we still clear local state below
    }
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoaded,
      isSignedIn: !!user,
      signIn,
      signUp,
      signOut,
      refresh,
    }),
    [user, isLoaded, signIn, signUp, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}
