import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle, FileText, Lock } from 'lucide-react';
import { getApiUrl } from '../lib/api';

/**
 * Supplier-facing quote form. Reached from the link in the RFQ WhatsApp/email message,
 * with no login: the token in the URL is the credential. Suppliers are not users of the
 * system, so everything here has to work for someone opening it once, on a phone.
 */

interface QuoteItem {
  id: string;
  name: string;
  quantityNeeded: number;
}

interface QuoteDetails {
  rfqNumber: string;
  businessName: string;
  notes?: string | null;
  deadline?: string | null;
  closed: boolean;
  supplierName: string;
  items: QuoteItem[];
  submitted: boolean;
  quote: {
    quotedPriceCents: number;
    deliveryDays?: number | null;
    validUntil?: string | null;
    notes?: string | null;
    respondedAt?: string | null;
  } | null;
}

type Stage = 'loading' | 'ready' | 'saving' | 'done' | 'invalid';

function fmt(cents: number) {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

export default function SupplierQuotePage() {
  const { token } = useParams<{ token: string }>();
  const [details, setDetails] = useState<QuoteDetails | null>(null);
  const [stage, setStage] = useState<Stage>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  const [price, setPrice] = useState('');
  const [days, setDays] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!token) { setStage('invalid'); return; }
    fetch(`${getApiUrl()}/rfq-quote/${token}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.message ?? 'This quote link is not valid');
        }
        return r.json() as Promise<QuoteDetails>;
      })
      .then((d) => {
        setDetails(d);
        // Let a supplier correct a price they already sent rather than starting blank.
        if (d.quote) {
          setPrice((d.quote.quotedPriceCents / 100).toString());
          setDays(d.quote.deliveryDays != null ? String(d.quote.deliveryDays) : '');
          setValidUntil(d.quote.validUntil ? d.quote.validUntil.slice(0, 10) : '');
          setNotes(d.quote.notes ?? '');
        }
        setStage('ready');
      })
      .catch((e: Error) => { setErrorMsg(e.message); setStage('invalid'); });
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setStage('saving');
    try {
      const res = await fetch(`${getApiUrl()}/rfq-quote/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quotedPriceCents: Math.round(parseFloat(price || '0') * 100),
          deliveryDays: days ? Number(days) : undefined,
          validUntil: validUntil || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? 'Could not submit your quote');
      }
      setStage('done');
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStage('ready');
    }
  }

  if (stage === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-purple-500 animate-spin" />
      </div>
    );
  }

  if (stage === 'invalid') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full text-center">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link Unavailable</h1>
          <p className="text-gray-500 text-sm">
            {errorMsg || 'This quote link is invalid or has expired.'}
          </p>
        </div>
      </div>
    );
  }

  if (stage === 'done') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Quote submitted</h1>
          <p className="text-gray-500 text-sm">
            Thank you. {details?.businessName} has received your price of{' '}
            <span className="font-semibold text-gray-700">
              {fmt(Math.round(parseFloat(price || '0') * 100))}
            </span>{' '}
            for {details?.rfqNumber}.
          </p>
          <p className="text-gray-400 text-xs mt-4">
            You can reopen this link any time to change your quote until the buyer awards it.
          </p>
        </div>
      </div>
    );
  }

  if (!details) return null;

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4">
      <div className="max-w-lg mx-auto bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-6 text-white">
          <div className="flex items-center gap-2 text-sm opacity-80">
            <FileText className="w-4 h-4" />
            Request for Quotation
          </div>
          <h1 className="text-2xl font-bold mt-1">{details.rfqNumber}</h1>
          <p className="text-sm opacity-90 mt-1">From {details.businessName}</p>
          {details.deadline && (
            <p className="text-xs opacity-75 mt-2">
              Reply by {new Date(details.deadline).toLocaleDateString('en-KE')}
            </p>
          )}
        </div>

        <div className="p-6 space-y-5">
          <p className="text-sm text-gray-600">
            Hello <span className="font-semibold text-gray-900">{details.supplierName}</span> — please
            quote your best price for the items below.
          </p>

          {details.notes && (
            <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              {details.notes}
            </p>
          )}

          {/* Items requested */}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
              Items Requested
            </h2>
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {details.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-gray-800">{item.name}</span>
                  <span className="text-gray-500">× {item.quantityNeeded}</span>
                </div>
              ))}
            </div>
          </div>

          {details.closed ? (
            <div className="flex items-start gap-2 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-3">
              <Lock className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />
              <span>
                This request is closed and is no longer accepting quotes.
                {details.quote && ` Your quote was ${fmt(details.quote.quotedPriceCents)}.`}
              </span>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {details.submitted && (
                <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  You already submitted a quote. Changing it below replaces your previous price.
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Your total price (KES) *
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="e.g. 45000"
                  required
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <p className="text-xs text-gray-400 mt-1">Total for all the items listed above.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Delivery (days)</label>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    placeholder="e.g. 3"
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Price valid until</label>
                  <input
                    type="date"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500" aria-label="Date" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Anything the buyer should know — part availability, payment terms…"
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                />
              </div>

              {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}

              <button
                type="submit"
                disabled={stage === 'saving' || !price}
                className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {stage === 'saving' && <Loader2 className="w-4 h-4 animate-spin" />}
                {stage === 'saving' ? 'Submitting…' : 'Submit my quote'}
              </button>
            </form>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-gray-400 mt-4">Powered by Faida POS</p>
    </div>
  );
}
