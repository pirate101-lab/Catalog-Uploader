import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { LogOut, MapPin, Plus, Trash2, Edit2, Check } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

interface Address {
  id: string;
  label: string | null;
  fullName: string;
  phone: string | null;
  countryCode: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
  isDefault: boolean;
}

const EMPTY_FORM = {
  label: '',
  fullName: '',
  phone: '',
  countryCode: '+254',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postalCode: '',
  country: 'Kenya',
  isDefault: false,
};

const COUNTRY_DIAL_CODES = [
  { code: '+1', label: '🇺🇸 United States (+1)' },
  { code: '+44', label: '🇬🇧 United Kingdom (+44)' },
  { code: '+254', label: '🇰🇪 Kenya (+254)' },
  { code: '+255', label: '🇹🇿 Tanzania (+255)' },
  { code: '+256', label: '🇺🇬 Uganda (+256)' },
  { code: '+27', label: '🇿🇦 South Africa (+27)' },
  { code: '+234', label: '🇳🇬 Nigeria (+234)' },
  { code: '+91', label: '🇮🇳 India (+91)' },
  { code: '+971', label: '🇦🇪 UAE (+971)' },
  { code: '+33', label: '🇫🇷 France (+33)' },
  { code: '+49', label: '🇩🇪 Germany (+49)' },
  { code: '+86', label: '🇨🇳 China (+86)' },
];

function ProfileInner() {
  const { user, isLoaded, signOut } = useAuth();
  const [, navigate] = useLocation();
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = `${basePath}/api`;

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${apiBase}/addresses`, { credentials: 'include' });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      setAddresses(d.addresses ?? []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load addresses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isLoaded && user) refresh();
  }, [isLoaded, user]);

  const startNew = () => {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      fullName: fullName || '',
    });
    setShowForm(true);
  };

  const startEdit = (a: Address) => {
    setEditingId(a.id);
    setForm({
      label: a.label || '',
      fullName: a.fullName,
      phone: a.phone || '',
      countryCode: a.countryCode || '+254',
      line1: a.line1,
      line2: a.line2 || '',
      city: a.city,
      region: a.region || '',
      postalCode: a.postalCode || '',
      country: a.country,
      isDefault: a.isDefault,
    });
    setShowForm(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const url = editingId
        ? `${apiBase}/addresses/${editingId}`
        : `${apiBase}/addresses`;
      const r = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error((await r.json())?.error || 'Save failed');
      setShowForm(false);
      setEditingId(null);
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this address?')) return;
    await fetch(`${apiBase}/addresses/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    refresh();
  };

  if (!isLoaded) {
    return <div className="container mx-auto px-4 py-12 text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl">
      <div className="flex items-center gap-4 mb-8">
        {user?.profileImageUrl ? (
          <img src={user.profileImageUrl} alt="" className="w-16 h-16 rounded-full object-cover border border-border" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center text-2xl font-bold text-muted-foreground">
            {(user?.firstName?.[0] || user?.email?.[0] || 'U').toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-serif font-bold truncate">
            {fullName || user?.email || 'Account'}
          </h1>
          <p className="text-sm text-muted-foreground truncate">
            {user?.email}
          </p>
        </div>
        <button
          onClick={async () => {
            await signOut();
            navigate('/');
          }}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          data-testid="button-sign-out"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>

      <div className="border-b border-border mb-6" />

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <MapPin className="w-5 h-5" />
          Delivery addresses
        </h2>
        {!showForm && (
          <button
            onClick={startNew}
            className="flex items-center gap-1.5 text-sm bg-primary text-primary-foreground px-3 py-1.5 rounded-full hover:opacity-90"
            data-testid="button-add-address"
          >
            <Plus className="w-4 h-4" />
            Add address
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
          {error}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={submit}
          className="border border-border rounded-xl p-5 mb-6 space-y-4 bg-card"
          data-testid="form-address"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Label (Home, Work, …)">
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Full name *">
              <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Country dialling code">
              <select
                value={form.countryCode}
                onChange={(e) => setForm({ ...form, countryCode: e.target.value })}
                className={inputCls}
                data-testid="select-country-code"
              >
                {COUNTRY_DIAL_CODES.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Phone number">
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} placeholder="712 345 678" />
            </Field>
            <Field label="Address line 1 *" wide>
              <input required value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Address line 2" wide>
              <input value={form.line2} onChange={(e) => setForm({ ...form, line2: e.target.value })} className={inputCls} />
            </Field>
            <Field label="City *">
              <input required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Region / state">
              <input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Postal code">
              <input value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Country *">
              <input required value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
            Use as default delivery address
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="bg-primary text-primary-foreground px-4 py-2 rounded-full text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving…' : editingId ? 'Update address' : 'Save address'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} className="px-4 py-2 rounded-full text-sm border border-border">
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading addresses…</p>
      ) : addresses.length === 0 && !showForm ? (
        <p className="text-sm text-muted-foreground">
          No saved addresses yet. Add one to speed up checkout.
        </p>
      ) : (
        <ul className="space-y-3">
          {addresses.map((a) => (
            <li
              key={a.id}
              className="border border-border rounded-xl p-4 flex items-start gap-3 bg-card"
              data-testid={`address-${a.id}`}
            >
              <MapPin className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold">{a.label || a.fullName}</span>
                  {a.isDefault && (
                    <span className="text-[10px] uppercase tracking-wider bg-primary/15 text-primary px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                      <Check className="w-3 h-3" /> Default
                    </span>
                  )}
                </div>
                <div className="text-foreground/90">{a.fullName}</div>
                <div className="text-muted-foreground">
                  {a.line1}{a.line2 ? `, ${a.line2}` : ''}
                </div>
                <div className="text-muted-foreground">
                  {[a.city, a.region, a.postalCode].filter(Boolean).join(', ')}
                </div>
                <div className="text-muted-foreground">{a.country}</div>
                {a.phone && (
                  <div className="text-muted-foreground mt-1">
                    {a.countryCode} {a.phone}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <button onClick={() => startEdit(a)} className="text-muted-foreground hover:text-foreground p-1" aria-label="Edit">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button onClick={() => remove(a.id)} className="text-muted-foreground hover:text-destructive p-1" aria-label="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const inputCls =
  'w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 text-xs uppercase tracking-wider text-muted-foreground ${wide ? 'md:col-span-2' : ''}`}>
      <span>{label}</span>
      <span className="normal-case tracking-normal text-foreground">{children}</span>
    </label>
  );
}

export function ProfilePage() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) {
    return <div className="container mx-auto px-4 py-12 text-muted-foreground">Loading…</div>;
  }
  if (isSignedIn) {
    return <ProfileInner />;
  }
  return (
    <div className="container mx-auto px-4 py-12 text-center">
      <h1 className="text-2xl font-serif font-bold mb-2">Sign in to view your profile</h1>
      <p className="text-muted-foreground mb-6">
        Manage your delivery addresses and account details.
      </p>
      <Link
        href="/sign-in"
        className="inline-block bg-primary text-primary-foreground px-5 py-2.5 rounded-full text-sm font-medium"
      >
        Sign in
      </Link>
    </div>
  );
}
