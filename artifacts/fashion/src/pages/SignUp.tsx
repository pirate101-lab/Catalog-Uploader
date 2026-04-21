import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/context/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export function SignUpPage() {
  const { signUp } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await signUp({
        email: email.trim(),
        password,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
      });
      navigate('/');
    } catch (err: any) {
      setError(err?.message || 'Could not create account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg">
        <h1 className="font-serif text-3xl font-bold text-center mb-2">Join VELOUR</h1>
        <p className="text-sm text-muted-foreground text-center mb-8">
          Create an account to track orders and save addresses.
        </p>

        <form onSubmit={submit} className="space-y-4" data-testid="form-sign-up">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase tracking-widest mb-2 block">First name</Label>
              <Input
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="rounded-lg h-12"
                data-testid="input-signup-first"
              />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-widest mb-2 block">Last name</Label>
              <Input
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="rounded-lg h-12"
                data-testid="input-signup-last"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest mb-2 block">Email</Label>
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg h-12"
              data-testid="input-signup-email"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest mb-2 block">
              Password (min. 8 characters)
            </Label>
            <Input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg h-12"
              data-testid="input-signup-password"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" data-testid="error-signup">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={submitting}
            className="w-full h-12 rounded-full text-xs tracking-widest uppercase font-bold"
            data-testid="button-signup-submit"
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>

        <p className="text-sm text-muted-foreground text-center mt-6">
          Already have an account?{' '}
          <Link href="/sign-in" className="text-primary hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
