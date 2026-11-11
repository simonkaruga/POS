import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, LogOut, Copy, Check, Users, TrendingUp, Wallet, BadgeCheck, Clock,
  Link2, CircleDollarSign, Handshake,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────
interface Affiliate {
  id: string; name: string; email: string; phone?: string | null; code: string;
  status: string; commissionPercent: number; payoutMethod?: string | null; payoutDetails?: string | null;
  balanceCents: number; totalEarnedCents: number;
  /** Built server-side from FRONTEND_URL. Optional so an older API still renders. */
  referralLink?: string;
}
interface Stats { signups: number; subscribed: number; paidOutCents: number; balanceCents: number; totalEarnedCents: number }
interface Me extends Affiliate { stats: Stats }
interface Conversion { id: string; businessId: string; status: string; createdAt: string; subscribedAt?: string | null }
interface Commission { id: string; amountCents: number; baseCents: number; percent: number; status: string; createdAt: string }
interface Payout { id: string; amountCents: number; method?: string | null; reference?: string | null; createdAt: string }
interface Session { token: string; affiliate: Affiliate }

const SESSION_KEY = 'affiliate-session';
const KES = (c: number) => `KES ${(c / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

function loadSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null'); } catch { return null; }
}
function saveSession(s: Session | null) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY);
}
async function affiliateFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const s = loadSession();
  const res = await fetch(`/api/v1${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(s?.token ? { Authorization: `Bearer ${s.token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  if (res.status === 401) { saveSession(null); window.location.reload(); throw new Error('Session expired'); }
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return res.json();
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700', ACTIVE: 'bg-green-100 text-green-700',
  SUSPENDED: 'bg-red-100 text-red-700', REJECTED: 'bg-gray-100 text-gray-500',
  SIGNED_UP: 'bg-blue-100 text-blue-700', SUBSCRIBED: 'bg-green-100 text-green-700',
  PAID: 'bg-green-100 text-green-700', CHURNED: 'bg-gray-100 text-gray-500',
};

export default function AffiliatePortalPage() {
  const [session, setSession] = useState<Session | null>(loadSession);
  if (!session) return <AuthView onAuth={(s) => { saveSession(s); setSession(s); }} />;
  return <Dashboard onLogout={() => { saveSession(null); setSession(null); }} />;
}

// ── Auth (login + apply) ──────────────────────────────────────────────────────
function AuthView({ onAuth }: { onAuth: (s: Session) => void }) {
  const [tab, setTab] = useState<'login' | 'apply'>('login');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setLoading(true); setError('');
    try {
      const path = tab === 'login' ? '/affiliate/auth/login' : '/affiliate/auth/register';
      const body = tab === 'login'
        ? { email: form.email.trim(), password: form.password }
        : { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), password: form.password };
      const res = await affiliateFetch<Session>(path, { method: 'POST', body: JSON.stringify(body) });
      onAuth(res);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-violet-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-indigo-600 mx-auto flex items-center justify-center mb-3">
            <Handshake className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Faida Affiliate Program</h1>
          <p className="text-sm text-gray-500">Earn recurring commission for every business you refer that subscribes.</p>
        </div>
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <div className="flex gap-2 mb-4">
            {(['login', 'apply'] as const).map((t) => (
              <button key={t} onClick={() => { setTab(t); setError(''); }}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold ${tab === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                {t === 'login' ? 'Log in' : 'Become an affiliate'}
              </button>
            ))}
          </div>
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          <div className="space-y-3">
            {tab === 'apply' && (
              <>
                <input placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                <input placeholder="Phone (M-Pesa)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
              </>
            )}
            <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            <input type="password" placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            <button onClick={submit} disabled={loading}
              className="w-full bg-indigo-600 text-white rounded-lg py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {tab === 'login' ? 'Log in' : 'Apply to join'}
            </button>
            {tab === 'apply' && <p className="text-xs text-gray-400 text-center">New affiliates are reviewed and approved before your link starts earning.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [copied, setCopied] = useState(false);
  const [payoutMethod, setPayoutMethod] = useState('MPESA');
  const [payoutDetails, setPayoutDetails] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  const load = useCallback(() => {
    affiliateFetch<Me>('/affiliate/me').then((m) => {
      setMe(m);
      setPayoutMethod(m.payoutMethod ?? 'MPESA');
      setPayoutDetails(m.payoutDetails ?? '');
    }).catch(() => {});
    affiliateFetch<Conversion[]>('/affiliate/me/conversions').then(setConversions).catch(() => {});
    affiliateFetch<Commission[]>('/affiliate/me/commissions').then(setCommissions).catch(() => {});
    affiliateFetch<Payout[]>('/affiliate/me/payouts').then(setPayouts).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!me) return <div className="min-h-screen bg-gray-50 flex justify-center pt-20"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>;

  const link = me.referralLink ?? `${window.location.origin}/?mode=register&aff=${me.code}`;
  const copy = () => { void navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); };
  async function savePayout() {
    await affiliateFetch('/affiliate/me', { method: 'PATCH', body: JSON.stringify({ payoutMethod, payoutDetails }) }).catch(() => {});
    setSavedMsg('Saved'); setTimeout(() => setSavedMsg(''), 1800);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Handshake className="w-5 h-5 text-indigo-600" />
            <div>
              <h1 className="font-bold text-gray-900 leading-tight">{me.name}</h1>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[me.status]}`}>{me.status}</span>
            </div>
          </div>
          <button onClick={onLogout} className="text-gray-400 hover:text-gray-700 flex items-center gap-1 text-sm"><LogOut className="w-4 h-4" /> Log out</button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-5 space-y-5">
        {me.status !== 'ACTIVE' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            {me.status === 'PENDING' ? 'Your application is under review. Your link will start earning once approved.' : `Your account is ${me.status.toLowerCase()}.`}
          </div>
        )}

        {/* Referral link */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-2"><Link2 className="w-4 h-4 text-indigo-600" /><h2 className="font-semibold">Your referral link</h2>
            <span className="ml-auto text-xs text-gray-500">{me.commissionPercent}% recurring commission</span></div>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 font-mono text-xs bg-gray-50 border rounded-lg px-3 py-2.5 truncate select-all">{link}</div>
            <button onClick={copy} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-1">
              {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy</>}
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(link)}`} alt="Referral QR" width={90} height={90} className="rounded-lg border bg-white p-1" />
            <p className="text-xs text-gray-500">Share this link or QR. When a business signs up through it and subscribes, you earn {me.commissionPercent}% of every payment they make.</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={<Users className="w-5 h-5" />} label="Signups" value={String(me.stats.signups)} />
          <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Subscribed" value={String(me.stats.subscribed)} />
          <StatCard icon={<CircleDollarSign className="w-5 h-5" />} label="Total earned" value={KES(me.stats.totalEarnedCents)} />
          <StatCard icon={<Wallet className="w-5 h-5" />} label="Balance owed" value={KES(me.stats.balanceCents)} highlight />
        </div>

        {/* Payout details */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-3"><BadgeCheck className="w-4 h-4 text-indigo-600" /><h2 className="font-semibold">Payout details</h2>
            {savedMsg && <span className="ml-auto text-xs text-green-600">{savedMsg}</span>}</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <select value={payoutMethod} onChange={(e) => setPayoutMethod(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" aria-label="M-Pesa">
              <option value="MPESA">M-Pesa</option>
              <option value="BANK">Bank</option>
            </select>
            <input value={payoutDetails} onChange={(e) => setPayoutDetails(e.target.value)} placeholder={payoutMethod === 'MPESA' ? 'M-Pesa phone number' : 'Bank account details'}
              className="flex-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            <button onClick={savePayout} className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-semibold">Save</button>
          </div>
          <p className="text-xs text-gray-400 mt-2">Payouts are processed manually by the Faida team against your balance.</p>
        </div>

        {/* Tables */}
        <TablePanel title="Referred businesses" empty="No signups yet — share your link to get started.">
          {conversions.map((c) => (
            <Row key={c.id} left={<span className="font-mono text-xs">{c.businessId.slice(0, 8)}</span>}
              mid={new Date(c.createdAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}
              right={<span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[c.status]}`}>{c.status}</span>} />
          ))}
        </TablePanel>

        <TablePanel title="Commissions" empty="No commissions yet.">
          {commissions.map((c) => (
            <Row key={c.id} left={<span>{c.percent}% of {KES(c.baseCents)}</span>}
              mid={new Date(c.createdAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' })}
              right={<span className="font-semibold">{KES(c.amountCents)} <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_STYLE[c.status]}`}>{c.status}</span></span>} />
          ))}
        </TablePanel>

        <TablePanel title="Payouts" empty="No payouts recorded yet.">
          {payouts.map((p) => (
            <Row key={p.id} left={<span className="font-semibold">{KES(p.amountCents)}</span>}
              mid={`${p.method ?? ''} ${p.reference ?? ''}`}
              right={new Date(p.createdAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })} />
          ))}
        </TablePanel>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white'}`}>
      <div className={`${highlight ? 'text-indigo-100' : 'text-indigo-600'} mb-1`}>{icon}</div>
      <div className="text-lg font-bold leading-tight">{value}</div>
      <div className={`text-xs ${highlight ? 'text-indigo-100' : 'text-gray-500'}`}>{label}</div>
    </div>
  );
}
function TablePanel({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  const hasRows = items.some(Boolean) && (children as unknown[]).length !== 0;
  return (
    <div className="bg-white rounded-xl border p-5">
      <h2 className="font-semibold mb-3">{title}</h2>
      {hasRows ? <div className="divide-y">{children}</div> : <p className="text-sm text-gray-400">{empty}</p>}
    </div>
  );
}
function Row({ left, mid, right }: { left: React.ReactNode; mid: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="py-2.5 flex items-center justify-between gap-3 text-sm">
      <div className="flex-1 text-gray-800">{left}</div>
      <div className="text-xs text-gray-400 hidden sm:block">{mid}</div>
      <div className="text-right text-gray-700">{right}</div>
    </div>
  );
}
