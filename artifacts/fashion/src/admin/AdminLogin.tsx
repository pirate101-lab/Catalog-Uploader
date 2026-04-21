import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { ShieldAlert, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Mode = "loading" | "login" | "setup";

export function AdminLogin() {
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<Mode>("loading");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // First contact decides which form we render. The setup form is only
  // available while the admin_users table is empty — once an operator
  // has registered, this endpoint flips to needsSetup:false forever
  // and the form swaps back to a normal sign-in.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin-auth/setup-status", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { needsSetup?: boolean }) => {
        if (cancelled) return;
        setMode(d.needsSetup ? "setup" : "login");
      })
      .catch(() => !cancelled && setMode("login"));
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "setup" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const endpoint =
        mode === "setup" ? "/api/admin-auth/setup" : "/api/admin-auth/login";
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        const map: Record<string, string> = {
          invalid_credentials: "Invalid username or password.",
          missing_credentials: "Enter a username and password.",
          invalid_username:
            body.message ??
            "Use 3–64 letters, numbers, dot, underscore or dash.",
          weak_password: body.message ?? "Password is too weak.",
          username_taken: "That username is already taken.",
          setup_already_done:
            "Setup has already completed. Please sign in instead.",
        };
        setError(map[body.error ?? ""] ?? "Sign-in failed. Please try again.");
        if (body.error === "setup_already_done") setMode("login");
        return;
      }
      navigate("/admin");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (mode === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const isSetup = mode === "setup";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <form
        onSubmit={onSubmit}
        className="max-w-md w-full p-8 border rounded-lg space-y-6"
        data-testid={isSetup ? "admin-setup-form" : "admin-login-form"}
      >
        <div className="text-center space-y-2">
          {isSetup ? (
            <Sparkles className="w-10 h-10 mx-auto text-primary" />
          ) : (
            <ShieldAlert className="w-10 h-10 mx-auto text-primary" />
          )}
          <h1 className="font-serif text-3xl font-bold">VELOUR Admin</h1>
          <p className="text-sm text-muted-foreground">
            {isSetup
              ? "Welcome — create the first admin account to claim the dashboard."
              : "Sign in to manage the storefront."}
          </p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="admin-username">Username</Label>
            <Input
              id="admin-username"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
              data-testid="admin-username-input"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-password">Password</Label>
            <Input
              id="admin-password"
              type="password"
              autoComplete={isSetup ? "new-password" : "current-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              data-testid="admin-password-input"
            />
            {isSetup ? (
              <p className="text-[11px] text-muted-foreground">
                8–200 characters. Pick something only you know — this account
                gets full access to secrets and other admins.
              </p>
            ) : null}
          </div>
          {isSetup ? (
            <div className="space-y-1.5">
              <Label htmlFor="admin-password-confirm">Confirm password</Label>
              <Input
                id="admin-password-confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={submitting}
                data-testid="admin-password-confirm-input"
              />
            </div>
          ) : null}
        </div>
        {error && (
          <p
            role="alert"
            className="text-sm text-destructive text-center"
            data-testid="admin-auth-error"
          >
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="w-full h-11"
          disabled={
            submitting ||
            !username.trim() ||
            !password ||
            (isSetup && !confirmPassword)
          }
          data-testid={isSetup ? "admin-setup-submit" : "admin-login-submit"}
        >
          {submitting
            ? isSetup
              ? "Creating…"
              : "Signing in…"
            : isSetup
              ? "Create super-admin account"
              : "Sign in"}
        </Button>
        {!isSetup ? (
          <p className="text-xs text-muted-foreground text-center">
            Forgot your password? A super-admin can reset it from the Admins
            tab.
          </p>
        ) : null}
      </form>
    </div>
  );
}
