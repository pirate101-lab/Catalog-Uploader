import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/context/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export function SignInPage() {
  const { signIn } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      navigate('/');
    } catch (err: any) {
      setError(err?.message || 'Could not sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg">
        <h1 className="font-serif text-3xl font-bold text-center mb-2">
          Welcome back to VELOUR
        </h1>
        <p className="text-sm text-muted-foreground text-center mb-8">
          Sign in to track orders and save addresses.
        </p>

        <form onSubmit={submit} className="space-y-4" data-testid="form-sign-in">
          <div>
            <Label className="text-xs uppercase tracking-widest mb-2 block">Email</Label>
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg h-12"
              data-testid="input-signin-email"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest mb-2 block">Password</Label>
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg h-12"
              data-testid="input-signin-password"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" data-testid="error-signin">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={submitting}
            className="w-full h-12 rounded-full text-xs tracking-widest uppercase font-bold"
            data-testid="button-signin-submit"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="text-sm text-muted-foreground text-center mt-6">
          New to VELOUR?{' '}
          <Link href="/sign-up" className="text-primary hover:underline font-medium">
            Create an account
          </Link>
        </p>

        <p className="text-xs text-muted-foreground text-center mt-4">
          Checked out as a guest?{' '}
          <Link
            href="/orders"
            className="text-primary hover:underline font-medium"
            data-testid="link-signin-track-order"
          >
            Track an order
          </Link>
        </p>
      </div>
    </div>
  );
}
