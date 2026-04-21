import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AdminShell, AdminPageHeader, useAdminIdentity } from "./AdminShell";
import { adminApi, type AdminUserRow, type AdminRoleValue } from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ShieldCheck, Trash2, KeyRound, UserPlus, ShieldOff } from "lucide-react";

const ROLE_ERROR_MAP: Record<string, string> = {
  invalid_username:
    "Use 3–64 letters, numbers, dot, underscore or dash for the username.",
  weak_password: "Password must be 8–200 characters.",
  username_taken: "That username is already taken.",
  invalid_role: "Pick a valid role.",
  last_super_admin:
    "At least one super admin must remain — promote someone else first.",
  cannot_delete_self:
    "You can't delete your own account while signed in.",
  forbidden: "Super admin only.",
};

function explain(error: string | undefined, message?: string): string {
  if (!error) return message ?? "Request failed.";
  return ROLE_ERROR_MAP[error] ?? message ?? error;
}

export function AdminsAdmin() {
  const me = useAdminIdentity();
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .listAdminUsers()
      .then((r) => !cancelled && setRows(r.rows))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const reload = () => setReloadKey((n) => n + 1);

  const superAdminCount = useMemo(
    () => (rows ?? []).filter((r) => r.role === "super_admin").length,
    [rows],
  );

  return (
    <AdminShell>
      <AdminPageHeader
        title="Admins"
        description="Manage who can sign in to the dashboard. Super admins can configure secrets and add or remove other admins; general admins can only run day-to-day operations."
      />
      <div className="space-y-8 max-w-4xl">
        <CreateAdminCard onCreated={reload} />

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !rows ? (
          <p className="text-sm text-muted-foreground">Loading admins…</p>
        ) : (
          <div className="border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Username</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Last sign-in</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <AdminRow
                    key={row.id}
                    row={row}
                    isMe={!!me && me.via === "admin-local" && me.id === row.id}
                    superAdminCount={superAdminCount}
                    onChanged={reload}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

function CreateAdminCard({ onCreated }: { onCreated: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminRoleValue>("admin");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await adminApi.createAdminUser({
        username: username.trim(),
        password,
        role,
      });
      toast.success(`Created ${username.trim()} (${role.replace("_", " ")})`);
      setUsername("");
      setPassword("");
      setRole("admin");
      onCreated();
    } catch (err) {
      const body = parseAdminError(err);
      toast.error(explain(body.error, body.message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="border rounded-lg bg-card overflow-hidden">
      <header className="px-6 py-4 border-b bg-muted/30 flex items-start gap-3">
        <div className="p-2 rounded-md bg-background border">
          <UserPlus className="w-4 h-4 text-emerald-600" />
        </div>
        <div>
          <h2 className="font-semibold">Add an admin</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            New accounts default to the general admin role. Promote to super
            admin only if they need access to secrets and other admins.
          </p>
        </div>
      </header>
      <form onSubmit={submit} className="p-6 grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
        <div className="space-y-1.5">
          <Label htmlFor="new-admin-username">Username</Label>
          <Input
            id="new-admin-username"
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. jane.doe"
            required
            data-testid="new-admin-username"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-admin-password">Temporary password</Label>
          <Input
            id="new-admin-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8–200 characters"
            required
            data-testid="new-admin-password"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-admin-role">Role</Label>
          <select
            id="new-admin-role"
            value={role}
            onChange={(e) => setRole(e.target.value as AdminRoleValue)}
            className="w-full h-10 rounded-md border bg-background px-3 text-sm"
            data-testid="new-admin-role"
          >
            <option value="admin">Admin</option>
            <option value="super_admin">Super admin</option>
          </select>
        </div>
        <Button
          type="submit"
          disabled={submitting || !username.trim() || password.length < 8}
          data-testid="create-admin-submit"
        >
          {submitting ? "Adding…" : "Add admin"}
        </Button>
      </form>
    </section>
  );
}

function AdminRow({
  row,
  isMe,
  superAdminCount,
  onChanged,
}: {
  row: AdminUserRow;
  isMe: boolean;
  superAdminCount: number;
  onChanged: () => void;
}) {
  const [pwd, setPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);

  const lastSuper = row.role === "super_admin" && superAdminCount <= 1;

  const setRole = async (next: AdminRoleValue) => {
    setBusy(true);
    try {
      await adminApi.updateAdminUser(row.id, { role: next });
      toast.success(
        `Updated ${row.username} → ${next === "super_admin" ? "super admin" : "admin"}`,
      );
      onChanged();
    } catch (err) {
      const body = parseAdminError(err);
      toast.error(explain(body.error, body.message));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (pwd.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await adminApi.updateAdminUser(row.id, { password: pwd });
      toast.success(`Password reset for ${row.username}`);
      setPwd("");
      setShowPwd(false);
    } catch (err) {
      const body = parseAdminError(err);
      toast.error(explain(body.error, body.message));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !confirm(
        `Delete admin "${row.username}"? They'll be signed out and unable to sign in again.`,
      )
    )
      return;
    setBusy(true);
    try {
      await adminApi.deleteAdminUser(row.id);
      toast.success(`Removed ${row.username}`);
      onChanged();
    } catch (err) {
      const body = parseAdminError(err);
      toast.error(explain(body.error, body.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <tr className="align-middle" data-testid={`admin-row-${row.id}`}>
        <td className="px-4 py-3 font-medium">
          {row.username}
          {isMe ? (
            <span className="ml-2 text-[10px] uppercase tracking-widest text-muted-foreground">
              you
            </span>
          ) : null}
        </td>
        <td className="px-4 py-3">
          <span
            className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${
              row.role === "super_admin"
                ? "bg-fuchsia-500/10 text-fuchsia-600 border-fuchsia-500/30"
                : "bg-muted/40 text-muted-foreground"
            }`}
          >
            {row.role === "super_admin" ? (
              <ShieldCheck className="w-3 h-3" />
            ) : (
              <ShieldOff className="w-3 h-3" />
            )}
            {row.role === "super_admin" ? "Super admin" : "Admin"}
          </span>
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleDateString()}
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">
          {row.lastLoginAt
            ? new Date(row.lastLoginAt).toLocaleString()
            : "never"}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-2 flex-wrap">
            {row.role === "super_admin" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || lastSuper}
                onClick={() => setRole("admin")}
                title={
                  lastSuper
                    ? "At least one super admin must remain"
                    : "Demote to general admin"
                }
                data-testid={`demote-${row.id}`}
              >
                Demote
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setRole("super_admin")}
                data-testid={`promote-${row.id}`}
              >
                Promote
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setShowPwd((v) => !v)}
              data-testid={`reset-toggle-${row.id}`}
            >
              <KeyRound className="w-3 h-3 mr-1" /> Reset password
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive border-destructive/40 hover:bg-destructive/10"
              disabled={busy || isMe || lastSuper}
              onClick={remove}
              title={
                isMe
                  ? "You can't delete your own account"
                  : lastSuper
                    ? "At least one super admin must remain"
                    : "Remove this admin"
              }
              data-testid={`delete-${row.id}`}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </td>
      </tr>
      {showPwd ? (
        <tr className="bg-muted/20">
          <td colSpan={5} className="px-4 py-3">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor={`reset-${row.id}`} className="text-xs">
                  New password for {row.username}
                </Label>
                <Input
                  id={`reset-${row.id}`}
                  type="password"
                  autoComplete="new-password"
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                  placeholder="8–200 characters"
                  data-testid={`reset-password-input-${row.id}`}
                />
              </div>
              <Button
                size="sm"
                onClick={resetPassword}
                disabled={busy || pwd.length < 8}
                data-testid={`reset-submit-${row.id}`}
              >
                Save new password
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPwd("");
                  setShowPwd(false);
                }}
              >
                Cancel
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Share the new password with {row.username} over a secure channel.
              Ask them to change it after they sign in.
            </p>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function parseAdminError(err: unknown): { error?: string; message?: string } {
  const m = (err as Error)?.message ?? "";
  // adminFetch throws "HTTP 409: {json...}" — pull the JSON tail.
  const idx = m.indexOf("{");
  if (idx === -1) return { message: m };
  try {
    return JSON.parse(m.slice(idx)) as { error?: string; message?: string };
  } catch {
    return { message: m };
  }
}
