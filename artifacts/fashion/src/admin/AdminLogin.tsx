import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AdminLogin() {
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin-auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(
          body.error === "invalid_credentials"
            ? "Invalid username or password."
            : "Sign-in failed. Please try again.",
        );
        return;
      }
      navigate("/admin");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <form
        onSubmit={onSubmit}
        className="max-w-md w-full p-8 border rounded-lg space-y-6"
      >
        <div className="text-center space-y-2">
          <ShieldAlert className="w-10 h-10 mx-auto text-primary" />
          <h1 className="font-serif text-3xl font-bold">VELOUR Admin</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to manage the storefront.
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
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-password">Password</Label>
            <Input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>
        {error && (
          <p
            role="alert"
            className="text-sm text-destructive text-center"
          >
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="w-full h-11"
          disabled={submitting || !username.trim() || !password}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          First-time setup? The starting username and password were printed in
          your server console — change them after signing in.
        </p>
      </form>
    </div>
  );
}
