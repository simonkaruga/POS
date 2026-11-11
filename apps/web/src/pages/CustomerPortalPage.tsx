import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ShoppingBag, CreditCard, FileText, LogOut, RefreshCw, ChevronDown,
  ChevronUp, Copy, Check, X, MapPin, Phone,
} from 'lucide-react';
import { useOtpTimers } from '../hooks/useOtpTimers';
import { printHtml } from '../lib/printHtml';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PortalSession {
  token: string;
  customerId: string;
  shopCode: string;
  customerName: string;
  phone: string;
  expiresAt: number;
}

interface FieldOrderItem {
  id: string;
  itemName: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  deliveredQuantity?: number;
  isSample?: boolean;
}

interface FieldOrder {
  id: string;
  orderNumber: string;
  status: 'SUBMITTED' | 'CONFIRMED' | 'PACKED' | 'DISPATCHED' | 'DELIVERED' | 'INVOICED' | 'CANCELLED';
  paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
  totalCents: number;
  vatCents?: number;
  subtotalCents?: number;
  expectedDeliveryDate?: string;
  createdAt: string;
  items?: FieldOrderItem[];
  itemCount?: number;
  mpesaReference?: string;
}

interface PortalStatement {
  creditLimitCents: number;
  outstandingCents: number;
  availableCreditCents: number;
  paymentTermsDays: number;
  unpaidOrders: FieldOrder[];
  recentPayments: Array<{
    id: string;
    orderNumber: string;
    amountCents: number;
    method: string;
    paidAt: string;
    reference?: string;
  }>;
}

// ── Portal fetch helper ───────────────────────────────────────────────────────

/** Set by the page so an expired session can drop straight back to the login screen. */
let onSessionLost: (() => void) | null = null;

const portalFetch = async (path: string, opts?: RequestInit) => {
  const session = JSON.parse(localStorage.getItem('portal-session') ?? 'null') as PortalSession | null;
  const res = await fetch(`/api/v1${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  // The stored session was only ever checked once at boot, so a session revoked
  // or expired mid-visit left every panel showing a raw 401 body.
  if (res.status === 401 && session?.token) {
    localStorage.removeItem('portal-session');
    onSessionLost?.();
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtKES(cents: number) {
  return (cents / 100).toLocaleString('en-KE', { style: 'currency', currency: 'KES' });
}

function fmtDate(s?: string) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
}

const ORDER_STATUS_STYLE: Record<FieldOrder['status'], string> = {
  SUBMITTED:  'bg-blue-100 text-blue-700',
  CONFIRMED:  'bg-indigo-100 text-indigo-700',
  PACKED:     'bg-amber-100 text-amber-700',
  DISPATCHED: 'bg-orange-100 text-orange-700',
  DELIVERED:  'bg-green-100 text-green-700',
  INVOICED:   'bg-purple-100 text-purple-700',
  CANCELLED:  'bg-gray-100 text-gray-500',
};

const PAY_STATUS_STYLE: Record<FieldOrder['paymentStatus'], string> = {
  UNPAID:  'bg-red-100 text-red-700',
  PARTIAL: 'bg-amber-100 text-amber-700',
  PAID:    'bg-green-100 text-green-700',
};

// ── OTP Login ─────────────────────────────────────────────────────────────────

function OtpLoginScreen({ onLogin }: { onLogin: (session: PortalSession) => void }) {
  const params = new URLSearchParams(window.location.search);
  const bizFromUrl = params.get('biz') ?? '';

  const [phase, setPhase] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [businessId, setBusinessId] = useState(bizFromUrl);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const timers = useOtpTimers();

  async function requestOtp() {
    if (!phone || !businessId) { toast.error('Enter your phone and business ID'); return; }
    setLoading(true);
    try {
      const r = await portalFetch('/portal/auth/request-otp', {
        method: 'POST',
        body: JSON.stringify({ phone, businessId }),
      });
      toast.success('A 6-digit code has been sent to your phone');
      setOtp('');
      setPhase('otp');
      timers.start(r.expiresInSeconds, r.resendInSeconds);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    if (timers.expired) { toast.error('That code has expired. Ask for a new one.'); return; }
    if (!otp || otp.length < 4) { toast.error('Enter the OTP code'); return; }
    setLoading(true);
    try {
      const data = await portalFetch('/portal/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ phone, otp, businessId }),
      });
      const session: PortalSession = {
        token: data.token,
        customerId: data.customerId,
        shopCode: data.shopCode ?? '',
        customerName: data.customerName ?? phone,
        phone,
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      };
      localStorage.setItem('portal-session', JSON.stringify(session));
      timers.clear();
      onLogin(session);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 mb-4">
            <span className="text-white text-2xl font-extrabold">F</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Faida</h1>
          <p className="text-slate-400 mt-1 text-sm">Customer Portal</p>
        </div>

        <div className="bg-slate-800 rounded-2xl p-6 shadow-2xl border border-slate-700">
          {phase === 'phone' ? (
            <>
              <h2 className="text-white font-bold text-lg mb-4">Sign In</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Phone Number</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. 0712345678"
                    className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && requestOtp()}
                  />
                </div>
                {!bizFromUrl && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Business ID</label>
                    <input
                      value={businessId}
                      onChange={(e) => setBusinessId(e.target.value)}
                      placeholder="e.g. biz-001"
                      className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                      onKeyDown={(e) => e.key === 'Enter' && requestOtp()}
                    />
                  </div>
                )}
                <button
                  onClick={requestOtp}
                  disabled={loading || !phone || !businessId}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors text-sm"
                >
                  {loading ? 'Sending…' : 'Send OTP'}
                </button>
              </div>
            </>
          ) : (
            <>
              <button onClick={() => setPhase('phone')} className="flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm mb-4 transition-colors">
                <X className="w-4 h-4" /> Back
              </button>
              <div className="flex items-baseline justify-between mb-1">
                <h2 className="text-white font-bold text-lg">Enter OTP</h2>
                <span className={`text-xs font-semibold tabular-nums ${timers.expired ? 'text-red-400' : timers.secondsLeft <= 60 ? 'text-amber-400' : 'text-slate-400'}`}>
                  {timers.expired ? 'Expired' : `Expires in ${timers.countdown}`}
                </span>
              </div>
              <p className="text-slate-400 text-sm mb-4">Code sent to {phone}</p>
              <div className="space-y-4">
                <input
                  type="number"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="6-digit code"
                  disabled={timers.expired}
                  className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-indigo-500 text-lg tracking-widest text-center disabled:opacity-50"
                  onKeyDown={(e) => e.key === 'Enter' && verifyOtp()}
                />
                <button
                  onClick={verifyOtp}
                  disabled={loading || !otp || timers.expired}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors text-sm"
                >
                  {loading ? 'Verifying…' : 'Verify & Sign In'}
                </button>
                <button
                  onClick={requestOtp}
                  disabled={loading || timers.resendIn > 0}
                  className="w-full py-2 text-slate-400 hover:text-slate-200 disabled:text-slate-400 disabled:hover:text-slate-400 text-sm transition-colors"
                >
                  {timers.resendIn > 0 ? `Resend code in ${timers.resendIn}s` : 'Resend code'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Payment Modal ─────────────────────────────────────────────────────────────

function PaymentModal({
  order,
  phone,
  onClose,
}: {
  order: FieldOrder;
  phone: string;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<'STK_PUSH' | 'PAYBILL' | null>(null);
  const [result, setResult] = useState<{ paybill?: string; accountRef?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function handlePay(m: 'STK_PUSH' | 'PAYBILL') {
    setMethod(m);
    setLoading(true);
    try {
      const data = await portalFetch('/portal/me/pay', {
        method: 'POST',
        body: JSON.stringify({ fieldOrderId: order.id, method: m }),
      });
      setResult(data);
      if (m === 'STK_PUSH') {
        toast.success(`M-Pesa prompt sent to ${phone}. Enter your PIN to complete payment.`);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="bg-slate-800 rounded-t-2xl sm:rounded-2xl w-full max-w-sm border border-slate-700 shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-700">
          <div>
            <h3 className="font-bold text-white">Pay Invoice</h3>
            <p className="text-xs text-slate-400 mt-0.5">{order.orderNumber} · {fmtKES(order.totalCents)}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 transition-colors" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {!method ? (
            <>
              <p className="text-sm text-slate-400 mb-4">Choose a payment method</p>
              <button
                onClick={() => handlePay('STK_PUSH')}
                disabled={loading}
                className="w-full flex items-center gap-4 p-4 bg-green-900/30 border border-green-700/50 hover:border-green-500 rounded-xl transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-green-600 flex items-center justify-center flex-shrink-0">
                  <Phone className="w-5 h-5 text-white" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-white">M-Pesa STK Push</p>
                  <p className="text-xs text-slate-400">Prompt sent to {phone}</p>
                </div>
              </button>
              <button
                onClick={() => handlePay('PAYBILL')}
                disabled={loading}
                className="w-full flex items-center gap-4 p-4 bg-blue-900/30 border border-blue-700/50 hover:border-blue-500 rounded-xl transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0">
                  <CreditCard className="w-5 h-5 text-white" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-white">Paybill</p>
                  <p className="text-xs text-slate-400">Pay via M-Pesa Paybill</p>
                </div>
              </button>
            </>
          ) : method === 'STK_PUSH' ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-green-900/40 border-2 border-green-500 flex items-center justify-center mx-auto mb-4">
                <Phone className="w-7 h-7 text-green-400" />
              </div>
              <p className="text-white font-semibold mb-2">M-Pesa Prompt Sent</p>
              <p className="text-slate-400 text-sm">Check your phone ({phone}) and enter your M-Pesa PIN to complete the payment of <span className="text-white font-semibold">{fmtKES(order.totalCents)}</span>.</p>
              <button onClick={onClose} className="mt-5 w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-semibold transition-colors">Done</button>
            </div>
          ) : result ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-400 mb-2">Go to <strong className="text-white">M-Pesa</strong> &rsaquo; <strong className="text-white">Lipa na M-Pesa</strong> &rsaquo; <strong className="text-white">Pay Bill</strong></p>
              {[
                { label: 'Business Number', value: result.paybill ?? '—', key: 'paybill' },
                { label: 'Account Number',  value: result.accountRef ?? order.orderNumber, key: 'account' },
                { label: 'Amount',          value: String(Math.round(order.totalCents / 100)), key: 'amount' },
              ].map(({ label, value, key }) => (
                <div key={key} className="flex items-center justify-between bg-slate-700/50 rounded-xl p-3.5">
                  <div>
                    <p className="text-xs text-slate-400">{label}</p>
                    <p className="text-white font-semibold font-mono text-sm">{value}</p>
                  </div>
                  <button
                    onClick={() => copyToClipboard(value, key)}
                    className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-600 transition-colors"
                  >
                    {copied === key ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              ))}
              <button onClick={onClose} className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-semibold transition-colors mt-2">Close</button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Orders Tab ────────────────────────────────────────────────────────────────

function OrdersTab({ session }: { session: PortalSession }) {
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: orders = [], isLoading, refetch } = useQuery<FieldOrder[]>({
    queryKey: ['portal-orders', session.customerId],
    queryFn: () => portalFetch('/portal/me/orders'),
    retry: false,
  });

  const reorderMutation = useMutation({
    mutationFn: (fieldOrderId: string) => portalFetch('/portal/me/reorder', {
      method: 'POST',
      body: JSON.stringify({ fieldOrderId }),
    }),
    onSuccess: () => {
      toast.success('Reorder submitted! Your agent will confirm it.');
      qc.invalidateQueries({ queryKey: ['portal-orders'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  if (isLoading) return (
    <div className="flex items-center justify-center py-16">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400" />
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold">{orders.length} order{orders.length !== 1 ? 's' : ''}</p>
        <button onClick={() => refetch()} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors" aria-label="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {orders.length === 0 && (
        <div className="text-center py-16">
          <ShoppingBag className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">No orders yet</p>
        </div>
      )}

      {orders.map((order) => {
        const isExpanded = expandedId === order.id;
        return (
          <div key={order.id} className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
            <button
              className="w-full text-left p-4"
              onClick={() => setExpandedId(isExpanded ? null : order.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-bold text-white">{order.orderNumber}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ORDER_STATUS_STYLE[order.status]}`}>
                      {order.status}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PAY_STATUS_STYLE[order.paymentStatus]}`}>
                      {order.paymentStatus}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{fmtDate(order.createdAt)}</p>
                  {order.expectedDeliveryDate && (
                    <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> Delivery: {fmtDate(order.expectedDeliveryDate)}
                    </p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-lg font-bold text-white">{fmtKES(order.totalCents)}</p>
                  {order.itemCount !== undefined && (
                    <p className="text-xs text-slate-400">{order.itemCount} item{order.itemCount !== 1 ? 's' : ''}</p>
                  )}
                  {isExpanded
                    ? <ChevronUp className="w-4 h-4 text-slate-400 ml-auto mt-1" />
                    : <ChevronDown className="w-4 h-4 text-slate-400 ml-auto mt-1" />}
                </div>
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-slate-700 px-4 pb-4 pt-3 space-y-2">
                {order.items && order.items.length > 0 ? (
                  order.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-sm">
                      <div className="flex-1 min-w-0">
                        <span className="text-slate-300">{item.itemName}</span>
                        {item.isSample && <span className="ml-1 text-xs text-amber-400">(sample)</span>}
                        <span className="text-slate-400 ml-2">&times;{item.quantity}</span>
                      </div>
                      <span className="text-slate-300 font-medium">{fmtKES(item.totalCents)}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400">No item details available</p>
                )}

                {order.status === 'DELIVERED' && (
                  <button
                    onClick={() => reorderMutation.mutate(order.id)}
                    disabled={reorderMutation.isPending}
                    className="mt-3 w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" /> Reorder
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Pay Tab ───────────────────────────────────────────────────────────────────

function PayTab({ session }: { session: PortalSession }) {
  const [payingOrder, setPayingOrder] = useState<FieldOrder | null>(null);

  const { data: statement, isLoading } = useQuery<PortalStatement>({
    queryKey: ['portal-statement', session.customerId],
    queryFn: () => portalFetch('/portal/me/statement'),
    retry: false,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center py-16">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400" />
    </div>
  );

  const outstanding = statement?.outstandingCents ?? 0;
  const unpaid = statement?.unpaidOrders ?? [];

  return (
    <div className="space-y-5">
      {/* Balance card */}
      <div className={`rounded-2xl p-5 border ${outstanding > 0 ? 'bg-red-900/20 border-red-800/50' : 'bg-green-900/20 border-green-800/50'}`}>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Outstanding Balance</p>
        <p className={`text-4xl font-extrabold ${outstanding > 0 ? 'text-red-400' : 'text-green-400'}`}>
          {fmtKES(outstanding)}
        </p>
        {outstanding === 0 && <p className="text-green-400 text-sm mt-1">All invoices paid</p>}
      </div>

      {/* Unpaid orders */}
      {unpaid.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-3">Unpaid Invoices</p>
          <div className="space-y-3">
            {unpaid.map((order) => (
              <div key={order.id} className="bg-slate-800 border border-slate-700 rounded-2xl p-4 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-bold text-white">{order.orderNumber}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PAY_STATUS_STYLE[order.paymentStatus]}`}>
                      {order.paymentStatus}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-white mt-1">{fmtKES(order.totalCents)}</p>
                  <p className="text-xs text-slate-400">{fmtDate(order.createdAt)}</p>
                </div>
                <button
                  onClick={() => setPayingOrder(order)}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors flex-shrink-0 min-h-[44px]"
                >
                  Pay Now
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {payingOrder && (
        <PaymentModal
          order={payingOrder}
          phone={session.phone}
          onClose={() => setPayingOrder(null)}
        />
      )}
    </div>
  );
}

// ── Statement Tab ─────────────────────────────────────────────────────────────

function StatementTab({ session }: { session: PortalSession }) {
  const { data: statement, isLoading } = useQuery<PortalStatement>({
    queryKey: ['portal-statement', session.customerId],
    queryFn: () => portalFetch('/portal/me/statement'),
    retry: false,
  });

  function handlePrint() {
    const s = statement;
    if (!s) return;
    printHtml(`
      <html><head><title>Statement - ${session.customerName}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 32px; max-width: 700px; margin: 0 auto; }
        h1 { font-size: 22px; margin-bottom: 4px; }
        .sub { color: #666; font-size: 13px; margin-bottom: 24px; }
        .cards { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
        .card { flex: 1; min-width: 140px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; }
        .card-label { font-size: 11px; color: #6b7280; text-transform: uppercase; margin-bottom: 4px; }
        .card-value { font-size: 20px; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #f3f4f6; }
        th { background: #f9fafb; font-weight: 600; color: #374151; }
        @media print { button { display: none; } }
      </style></head><body>
      <h1>Account Statement</h1>
      <div class="sub">${session.customerName} (${session.shopCode}) - Generated ${new Date().toLocaleDateString()}</div>
      <div class="cards">
        <div class="card"><div class="card-label">Credit Limit</div><div class="card-value">${fmtKES(s.creditLimitCents)}</div></div>
        <div class="card"><div class="card-label">Outstanding</div><div class="card-value" style="color:#dc2626">${fmtKES(s.outstandingCents)}</div></div>
        <div class="card"><div class="card-label">Available</div><div class="card-value" style="color:#16a34a">${fmtKES(s.availableCreditCents)}</div></div>
      </div>
      <h2 style="font-size:15px;margin-bottom:10px">Recent Payments</h2>
      <table>
        <thead><tr><th>Date</th><th>Order</th><th>Method</th><th>Amount</th><th>Reference</th></tr></thead>
        <tbody>
          ${s.recentPayments.map((p) => `<tr>
            <td>${new Date(p.paidAt).toLocaleDateString()}</td>
            <td>${p.orderNumber}</td>
            <td>${p.method}</td>
            <td>${fmtKES(p.amountCents)}</td>
            <td>${p.reference ?? '-'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p style="margin-top:24px;font-size:11px;color:#9ca3af">Payment terms: Net ${s.paymentTermsDays} days</p>
      </body></html>
    `);
  }

  if (isLoading) return (
    <div className="flex items-center justify-center py-16">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400" />
    </div>
  );

  const s = statement;

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-blue-900/20 border border-blue-800/50 rounded-2xl p-4 text-center">
          <p className="text-xs text-slate-400 mb-1">Credit Limit</p>
          <p className="text-base font-bold text-blue-400">{fmtKES(s?.creditLimitCents ?? 0)}</p>
        </div>
        <div className="bg-red-900/20 border border-red-800/50 rounded-2xl p-4 text-center">
          <p className="text-xs text-slate-400 mb-1">Outstanding</p>
          <p className="text-base font-bold text-red-400">{fmtKES(s?.outstandingCents ?? 0)}</p>
        </div>
        <div className="bg-green-900/20 border border-green-800/50 rounded-2xl p-4 text-center">
          <p className="text-xs text-slate-400 mb-1">Available</p>
          <p className="text-base font-bold text-green-400">{fmtKES(s?.availableCreditCents ?? 0)}</p>
        </div>
      </div>

      {/* Payment terms */}
      {s && (
        <div className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-slate-400">Payment terms</p>
          <p className="text-sm font-semibold text-white">Net {s.paymentTermsDays} days</p>
        </div>
      )}

      {/* Recent payments */}
      <div>
        <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-3">Recent Payments</p>
        {!s?.recentPayments?.length ? (
          <p className="text-slate-400 text-sm text-center py-6">No payments recorded yet</p>
        ) : (
          <div className="space-y-2">
            {s.recentPayments.map((p) => (
              <div key={p.id} className="bg-slate-800 border border-slate-700 rounded-xl p-3.5 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{p.orderNumber}</p>
                  <p className="text-xs text-slate-400">{fmtDate(p.paidAt)} &middot; {p.method}{p.reference && ` · ${p.reference}`}</p>
                </div>
                <span className="text-sm font-bold text-green-400">{fmtKES(p.amountCents)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Download statement */}
      <button
        onClick={handlePrint}
        className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 min-h-[44px]"
      >
        <FileText className="w-4 h-4" /> Download Statement
      </button>
    </div>
  );
}

// ── Dashboard (after login) ───────────────────────────────────────────────────

type PortalTab = 'orders' | 'pay' | 'statement';

interface TabConfig {
  id: PortalTab;
  label: string;
  icon: React.ReactNode;
}

function PortalDashboard({ session, onLogout }: { session: PortalSession; onLogout: () => void }) {
  const [tab, setTab] = useState<PortalTab>('orders');

  const tabConfig: TabConfig[] = [
    { id: 'orders',    label: 'Orders',    icon: <ShoppingBag className="w-5 h-5" /> },
    { id: 'pay',       label: 'Pay',       icon: <CreditCard className="w-5 h-5" /> },
    { id: 'statement', label: 'Statement', icon: <FileText className="w-5 h-5" /> },
  ];

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col max-w-[480px] mx-auto relative">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 px-5 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-sm font-extrabold">F</span>
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-tight">{session.customerName}</p>
            <p className="text-slate-400 text-xs font-mono">{session.shopCode}</p>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 pb-24">
        {tab === 'orders'    && <OrdersTab    session={session} />}
        {tab === 'pay'       && <PayTab       session={session} />}
        {tab === 'statement' && <StatementTab session={session} />}
      </div>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-slate-800 border-t border-slate-700 flex z-40">
        {tabConfig.map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 min-h-[56px] transition-colors ${
              tab === id
                ? 'text-indigo-400'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            {icon}
            <span className="text-[10px] font-semibold">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CustomerPortalPage() {
  const [session, setSession] = useState<PortalSession | null>(null);
  const [loading, setLoading] = useState(true);

  const verifySession = useCallback(async (sess: PortalSession): Promise<boolean> => {
    localStorage.setItem('portal-session', JSON.stringify(sess));
    try {
      await portalFetch('/portal/me/orders');
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    onSessionLost = () => setSession(null);
    return () => { onSessionLost = null; };
  }, []);

  useEffect(() => {
    async function init() {
      const stored = JSON.parse(localStorage.getItem('portal-session') ?? 'null') as PortalSession | null;
      if (stored && stored.expiresAt > Date.now()) {
        const valid = await verifySession(stored);
        if (valid) {
          setSession(stored);
        } else {
          localStorage.removeItem('portal-session');
        }
      }
      setLoading(false);
    }
    init();
  }, [verifySession]);

  function handleLogin(sess: PortalSession) {
    setSession(sess);
  }

  function handleLogout() {
    localStorage.removeItem('portal-session');
    setSession(null);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-400" />
      </div>
    );
  }

  if (!session) {
    return <OtpLoginScreen onLogin={handleLogin} />;
  }

  return <PortalDashboard session={session} onLogout={handleLogout} />;
}
