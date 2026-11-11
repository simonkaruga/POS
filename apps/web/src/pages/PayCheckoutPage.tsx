import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle, Smartphone, AlertTriangle } from 'lucide-react';
import { getApiUrl } from '../lib/api';

interface LinkDetails {
  id: string;
  code: string;
  description: string;
  amountCents: number;
  currency: string;
  expiresAt?: string;
  maxUses?: number;
  usesCount: number;
  businessName: string;
}

type Stage = 'loading' | 'ready' | 'entering_amount' | 'paying' | 'success' | 'error' | 'invalid';

function fmt(cents: number, currency = 'KES') {
  return `${currency} ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

export default function PayCheckoutPage() {
  const { code } = useParams<{ code: string }>();
  const [link, setLink] = useState<LinkDetails | null>(null);
  const [stage, setStage] = useState<Stage>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [phone, setPhone] = useState('');
  const [customAmount, setCustomAmount] = useState('');

  useEffect(() => {
    if (!code) { setStage('invalid'); return; }
    fetch(`${getApiUrl()}/payments/links/public/${code}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.message ?? 'Link not found');
        }
        return r.json() as Promise<LinkDetails>;
      })
      .then((data) => { setLink(data); setStage('ready'); })
      .catch((e) => { setErrorMsg(e.message); setStage('invalid'); });
  }, [code]);

  async function handlePay() {
    if (!link || !phone.trim()) return;
    const amount = link.amountCents > 0 ? link.amountCents : Math.round(Number(customAmount) * 100);
    if (!amount || amount <= 0) { setErrorMsg('Please enter a valid amount'); return; }
    setStage('paying');
    try {
      const res = await fetch(`${getApiUrl()}/payments/links/public/${code}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), amountCents: amount }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? 'Payment failed');
      }
      setStage('success');
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Payment failed. Please try again.');
      setStage('error');
    }
  }

  // ── Invalid / expired link ──────────────────────────────────────────────────
  if (stage === 'invalid') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link Unavailable</h1>
          <p className="text-gray-500 text-sm">{errorMsg || 'This payment link is invalid or has expired.'}</p>
        </div>
      </div>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (stage === 'loading' || !link) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-white animate-spin" />
      </div>
    );
  }

  // ── Success ─────────────────────────────────────────────────────────────────
  if (stage === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">STK Push Sent!</h1>
          <p className="text-gray-500 text-sm mb-1">Check your phone <span className="font-semibold text-gray-700">{phone}</span> for the M-Pesa prompt.</p>
          <p className="text-gray-400 text-xs mt-4">Enter your PIN on the prompt to complete payment to <span className="font-semibold">{link.businessName}</span>.</p>
        </div>
      </div>
    );
  }

  const isOpenAmount = link.amountCents === 0;

  // ── Main checkout ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-600 to-emerald-500 px-6 py-6 text-white text-center">
          <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <Smartphone className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium opacity-80">{link.businessName}</p>
          <h1 className="text-2xl font-bold mt-1">
            {isOpenAmount ? 'Pay via M-Pesa' : fmt(link.amountCents, link.currency)}
          </h1>
          {link.description && (
            <p className="text-sm opacity-80 mt-1">{link.description}</p>
          )}
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Expiry warning */}
          {link.expiresAt && (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Expires {new Date(link.expiresAt).toLocaleString()}
            </div>
          )}

          {/* Open amount input */}
          {isOpenAmount && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (KES)</label>
              <input
                type="number"
                min="1"
                step="0.01"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder="Enter amount"
                className="w-full px-4 py-3 rounded-xl border border-gray-300 text-gray-900 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          )}

          {/* Phone number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">M-Pesa Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 0712 345 678"
              className="w-full px-4 py-3 rounded-xl border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-xs text-gray-400 mt-1">You'll receive an STK push prompt on this number</p>
          </div>

          {/* Error */}
          {stage === 'error' && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <XCircle className="w-4 h-4 shrink-0" />
              {errorMsg}
            </div>
          )}

          {/* Pay button */}
          <button
            onClick={handlePay}
            disabled={stage === 'paying' || !phone.trim() || (isOpenAmount && !customAmount)}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold text-base transition-colors disabled:opacity-50"
          >
            {stage === 'paying' ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Sending prompt…</>
            ) : (
              <>
                <Smartphone className="w-5 h-5" />
                Pay with M-Pesa
              </>
            )}
          </button>

          <p className="text-center text-xs text-gray-400">
            Secured by <span className="font-semibold text-gray-600">Faida POS</span> · Powered by M-Pesa
          </p>
        </div>
      </div>
    </div>
  );
}
