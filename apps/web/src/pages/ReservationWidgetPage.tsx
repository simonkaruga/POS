import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Calendar, Clock, Users, Phone, User, MessageSquare, CheckCircle2, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

// ─── Public embeddable reservation widget ─────────────────────────────────────
// URL: /reservation-widget?businessId=biz-001&storeId=store-001
// Embed: <iframe src="https://app.example.com/reservation-widget?businessId=..." />

function getParam(key: string) {
  return new URLSearchParams(window.location.search).get(key) ?? '';
}

export default function ReservationWidgetPage() {
  const businessId = getParam('businessId');
  const storeId = getParam('storeId');

  const [step, setStep] = useState<'form' | 'success'>('form');
  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    partySize: '2',
    reservationTime: '',
    notes: '',
    depositAmount: '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post('/hospitality/reservations', {
      businessId,
      storeId,
      ...form,
      partySize: parseInt(form.partySize),
      depositCents: form.depositAmount ? Math.round(parseFloat(form.depositAmount) * 100) : 0,
    }),
    onSuccess: () => setStep('success'),
    onError: (e: Error) => setError(e.message),
  });

  const inputCls = 'w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1';

  if (step === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-9 h-9 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Reservation Confirmed!</h2>
          <p className="text-gray-500 text-sm mb-6">
            We've received your reservation for <strong>{form.partySize} guest{parseInt(form.partySize) !== 1 ? 's' : ''}</strong> on{' '}
            <strong>{form.reservationTime ? new Date(form.reservationTime).toLocaleString() : '—'}</strong>.
            We'll send a confirmation to <strong>{form.customerPhone}</strong>.
          </p>
          <button onClick={() => { setStep('form'); setForm({ customerName: '', customerPhone: '', partySize: '2', reservationTime: '', notes: '', depositAmount: '' }); setError(''); }}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm">
            Make Another Reservation
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-6 max-w-md w-full">
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Calendar className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-800">Make a Reservation</h1>
          <p className="text-sm text-gray-500 mt-1">Book your table online</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
        )}

        <div className="space-y-4">
          <div>
            <label className={labelCls}><User className="w-3.5 h-3.5 inline mr-1" />Full Name *</label>
            <input className={inputCls} placeholder="John Doe" value={form.customerName}
              onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}><Phone className="w-3.5 h-3.5 inline mr-1" />Phone *</label>
            <input className={inputCls} placeholder="+254 7XX XXX XXX" type="tel" value={form.customerPhone}
              onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}><Users className="w-3.5 h-3.5 inline mr-1" />Party Size *</label>
              <select className={inputCls} value={form.partySize}
                onChange={e => setForm(f => ({ ...f, partySize: e.target.value }))}>
                {[1,2,3,4,5,6,7,8,9,10,12,15,20].map(n => (
                  <option key={n} value={n}>{n} {n === 1 ? 'guest' : 'guests'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}><Clock className="w-3.5 h-3.5 inline mr-1" />Date & Time *</label>
              <input className={inputCls} type="datetime-local" value={form.reservationTime}
                min={new Date().toISOString().slice(0, 16)}
                onChange={e => setForm(f => ({ ...f, reservationTime: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className={labelCls}><MessageSquare className="w-3.5 h-3.5 inline mr-1" />Special Requests</label>
            <textarea className={inputCls} rows={3} placeholder="Dietary requirements, occasion, seating preferences…"
              value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>

        <button
          onClick={() => mutation.mutate()}
          disabled={!form.customerName || !form.customerPhone || !form.reservationTime || mutation.isPending}
          className="mt-6 w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2 transition-colors"
        >
          {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
          Confirm Reservation
        </button>

        <p className="text-center text-xs text-gray-400 mt-4">
          Powered by Faida POS
        </p>
      </div>
    </div>
  );
}
