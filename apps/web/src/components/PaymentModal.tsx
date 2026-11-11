import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, LayoutGrid, Delete, DollarSign, SmartphoneNfc, QrCode, Smartphone, CreditCard, Scissors, AlertCircle, Loader2, CheckCircle, Gift, BedDouble, Building2, Camera, Nfc, Terminal, BookOpen } from 'lucide-react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { api } from '../lib/api';
import IncomingPaymentsPanel from './pos/IncomingPaymentsPanel';
import { PaymentMethodPicker } from './pos/PaymentMethodPicker';
import { IconButton, PaidCheck } from './ui';
import { NFCPaymentReader } from '../lib/nfc';
import { cardTerminalSale, connectCardTerminal, isCardTerminalConnected, isSerialAvailable, type CardTerminalConfig } from '../lib/cardTerminal';

function formatKES(cents: number): string {
  return `KES ${(cents / 100).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

type PaymentMethod = 'CASH' | 'MPESA_STK' | 'MPESA_QR' | 'MPESA_C2B' | 'SPLIT' | 'GIFT_CARD' | 'ROOM_CHARGE' | 'CARD' | 'BANK_TRANSFER' | 'NFC' | 'CARD_TERMINAL' | 'CREDIT';

interface GiftCard {
  code: string;
  balanceCents: number;
  status: string;
}
type StkStatus = 'idle' | 'sending' | 'waiting' | 'paid' | 'failed';

interface PaymentEntry {
  method: string;
  amountCents: number;
  reference?: string;
  /** For ROOM_CHARGE: the room whose guest is billed. */
  roomNumber?: string;
}

// Paystack Inline type declaration
declare global {
  interface Window {
    PaystackPop: {
      setup: (config: {
        key: string; email: string; amount: number; currency: string; ref: string;
        onSuccess: (txn: { reference: string }) => void;
        onCancel: () => void;
      }) => { openIframe: () => void };
    };
  }
}

interface PaymentModalProps {
  totalCents: number;
  onComplete: (payments: PaymentEntry[]) => void;
  onCancel: () => void;
  isProcessing?: boolean;
  error?: string | null;
  businessId?: string;
  customerName?: string | null;
  customerId?: string | null;
}

const QUICK_CASH = [50, 100, 200, 500, 1000, 2000, 5000] as const;

// ─── Credit Sale Panel ─────────────────────────────────────────────────────

interface CustomerCredit {
  creditLimitCents: number;
  balanceCents: number; // negative = owes money
  creditApprovalStatus: string;
}

function CreditSalePanel({
  totalCents, customerId, customerName, businessId, isProcessing, onComplete,
}: {
  totalCents: number;
  customerId?: string | null;
  customerName?: string | null;
  businessId: string;
  isProcessing: boolean;
  onComplete: (payments: PaymentEntry[]) => void;
}) {
  const [creditInfo, setCreditInfo] = useState<CustomerCredit | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestError, setRequestError] = useState('');

  useEffect(() => {
    if (!customerId || !businessId) return;
    setLoading(true);
    api.get<CustomerCredit>(`/businesses/${businessId}/customers/${customerId}`)
      .then((c) => { setCreditInfo(c); setRequestSent(c.creditApprovalStatus === 'PENDING'); })
      .catch(() => setCreditInfo(null))
      .finally(() => setLoading(false));
  }, [customerId, businessId]);

  function handleRequestIncrease() {
    if (!customerId || !creditInfo) return;
    const requested = outstanding + totalCents; // request exactly what's needed
    setRequestLoading(true);
    setRequestError('');
    api.patch(`/businesses/${businessId}/customers/${customerId}/request-credit`, { requestedLimitCents: requested })
      .then(() => setRequestSent(true))
      .catch(() => setRequestError('Failed to send request. Try again.'))
      .finally(() => setRequestLoading(false));
  }

  if (!customerId) {
    return (
      <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-300 rounded-xl">
        <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-amber-800 text-sm">Customer required</p>
          <p className="text-xs text-amber-700 mt-0.5">
            Select a customer first (F2) before recording a credit sale.
          </p>
        </div>
      </div>
    );
  }

  const outstanding = creditInfo ? Math.max(0, -creditInfo.balanceCents) : 0;
  const limit = creditInfo?.creditLimitCents ?? 0;
  const available = Math.max(0, limit - outstanding);
  const wouldExceed = limit > 0 && (outstanding + totalCents) > limit;
  const noLimit = limit === 0;

  return (
    <div className="space-y-3">
      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500 p-3">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading credit info…
        </div>
      )}

      {!loading && creditInfo && (
        <div className="p-4 rounded-xl space-y-2 border border-blue-200 bg-blue-50">
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="w-4 h-4 text-blue-600" />
            <p className="text-sm font-semibold text-blue-800">{customerName}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-white rounded-lg p-2 text-center border border-blue-100">
              <p className="text-gray-500">Credit Limit</p>
              <p className="font-bold text-gray-800">{noLimit ? '—' : formatKES(limit)}</p>
            </div>
            <div className="bg-white rounded-lg p-2 text-center border border-blue-100">
              <p className="text-gray-500">Outstanding</p>
              <p className={`font-bold ${outstanding > 0 ? 'text-red-600' : 'text-gray-800'}`}>{formatKES(outstanding)}</p>
            </div>
            <div className={`rounded-lg p-2 text-center border ${wouldExceed ? 'bg-red-50 border-red-200' : 'bg-white border-blue-100'}`}>
              <p className="text-gray-500">Available</p>
              <p className={`font-bold ${wouldExceed ? 'text-red-600' : noLimit ? 'text-green-600' : 'text-blue-700'}`}>
                {noLimit ? '∞' : formatKES(available)}
              </p>
            </div>
          </div>
        </div>
      )}

      {wouldExceed && (
        <div className="space-y-2">
          <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-300 rounded-xl">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-800 text-sm">Credit limit exceeded</p>
              <p className="text-xs text-red-700 mt-0.5">
                This sale of {formatKES(totalCents)} would bring outstanding to {formatKES(outstanding + totalCents)},
                exceeding the {formatKES(limit)} limit by {formatKES(outstanding + totalCents - limit)}.
              </p>
            </div>
          </div>
          {requestSent ? (
            <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-300 rounded-xl">
              <CheckCircle className="w-4 h-4 text-yellow-600 flex-shrink-0" />
              <p className="text-xs text-yellow-800 font-medium">
                Credit increase request sent to manager. Proceed once approved.
              </p>
            </div>
          ) : (
            <div>
              {requestError && <p className="text-xs text-red-600 mb-1">{requestError}</p>}
              <button
                onClick={handleRequestIncrease}
                disabled={requestLoading}
                className="w-full py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-xl disabled:opacity-50 transition-colors"
              >
                {requestLoading ? 'Sending…' : 'Request Credit Increase from Manager'}
              </button>
            </div>
          )}
        </div>
      )}

      {!wouldExceed && (
        <p className="text-xs text-gray-500 px-1">
          Sale recorded as unpaid. Collect payment later via Reports → Credit Book.
        </p>
      )}

      <button
        onClick={() => onComplete([{ method: 'CREDIT', amountCents: totalCents }])}
        disabled={isProcessing || wouldExceed}
        className={`w-full py-3.5 font-bold rounded-xl disabled:opacity-40 transition-colors text-white ${
          wouldExceed ? 'bg-red-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {isProcessing ? 'Processing…' : wouldExceed ? 'Limit Exceeded — Cannot Proceed' : `Record Credit — ${formatKES(totalCents)}`}
      </button>
    </div>
  );
}

export default function PaymentModal({
  totalCents,
  onComplete,
  onCancel,
  isProcessing = false,
  error,
  businessId = '',
  customerName,
  customerId,
}: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [cashInput, setCashInput] = useState('');
  const [mpesaPhone, setMpesaPhone] = useState('');
  const [stkStatus, setStkStatus] = useState<StkStatus>('idle');
  const [stkError, setStkError] = useState('');
  const [checkoutRequestId, setCheckoutRequestId] = useState('');
  const [splitLegs, setSplitLegs] = useState<PaymentEntry[]>([]);
  const [splitMethod, setSplitMethod] = useState<'CASH' | 'MPESA_STK'>('CASH');
  const [splitAmount, setSplitAmount] = useState('');
  const [splitPhone, setSplitPhone] = useState('');
  const [gcCode, setGcCode] = useState('');
  const [gcCard, setGcCard] = useState<GiftCard | null>(null);
  const [gcError, setGcError] = useState('');
  const [gcLookingUp, setGcLookingUp] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrDemoMode, setQrDemoMode] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [roomGuestName, setRoomGuestName] = useState('');
  const [cardStatus, setCardStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [cardError, setCardError] = useState('');
  const [bankRef, setBankRef] = useState('');
  const [bankDetails, setBankDetails] = useState<{ bankName?: string; bankAccountNumber?: string; bankAccountName?: string; bankBranch?: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gcVideoRef = useRef<HTMLVideoElement>(null);
  const [showGcCamera, setShowGcCamera] = useState(false);
  const [gcCameraError, setGcCameraError] = useState('');
  const [c2bSelected, setC2bSelected] = useState<{ id: string; transactionId: string; amountCents: number; customerName: string } | null>(null);
  // NFC
  const [nfcStatus, setNfcStatus] = useState<'idle' | 'scanning' | 'read' | 'error'>('idle');
  const [nfcError, setNfcError] = useState('');
  const [nfcUid, setNfcUid] = useState('');
  const nfcReaderRef = useRef<NFCPaymentReader | null>(null);
  // Card terminal (Web Serial)
  const [ctStatus, setCtStatus] = useState<'idle' | 'connecting' | 'waiting' | 'approved' | 'declined' | 'error'>('idle');
  const [ctError, setCtError] = useState('');
  const [ctBrand, setCtBrand] = useState<CardTerminalConfig['brand']>('PAX');
  const [ctRef, setCtRef] = useState('');

  const cashCents = Math.round(parseFloat(cashInput || '0') * 100);
  const changeCents = cashCents - totalCents;
  const splitPaidCents = splitLegs.reduce((s, l) => s + l.amountCents, 0);
  const splitRemainingCents = totalCents - splitPaidCents;
  const splitLegCents = Math.round(parseFloat(splitAmount || '0') * 100);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling(reqId: string) {
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const res = await api.get<{ status: 'pending' | 'paid' | 'failed'; resultDesc: string }>(
          `/payments/mpesa/stk-status/${reqId}`,
        );
        if (res.status === 'paid') {
          stopPolling();
          setStkStatus('paid');
          // Brief pause so user sees "Paid" before completing
          setTimeout(() => {
            onComplete([{ method: 'MPESA_STK', amountCents: totalCents, reference: reqId }]);
          }, 800);
        } else if (res.status === 'failed') {
          stopPolling();
          setStkStatus('failed');
          setStkError(res.resultDesc || 'Payment declined or timed out');
        }
      } catch {
        // Network error — keep polling
      }
      // Give up after 2 minutes (40 × 3s)
      if (attempts >= 40) {
        stopPolling();
        setStkStatus('failed');
        setStkError('Payment timed out. Please try again.');
      }
    }, 3000);
  }

  async function handleMpesa() {
    const phone = mpesaPhone.replace(/\s/g, '');
    if (phone.length < 9) return;
    setStkStatus('sending');
    setStkError('');
    try {
      const res = await api.post<{ checkoutRequestId: string }>('/payments/mpesa/stk-push', {
        phone,
        amountCents: totalCents,
        reference: `POS-${Date.now()}`,
      });
      setCheckoutRequestId(res.checkoutRequestId);
      setStkStatus('waiting');
      startPolling(res.checkoutRequestId);
    } catch (err) {
      setStkStatus('failed');
      setStkError(err instanceof Error ? err.message : 'Failed to send STK push');
    }
  }

  function cancelMpesa() {
    stopPolling();
    setStkStatus('idle');
    setStkError('');
    setCheckoutRequestId('');
  }

  function handleCash() {
    if (cashCents < totalCents) return;
    onComplete([{ method: 'CASH', amountCents: totalCents }]);
  }

  async function handleQR() {
    setQrLoading(true);
    setQrError('');
    setQrImage(null);
    setQrDemoMode(false);
    try {
      const res = await api.post<{ qrCode: string | null; demoMode: boolean }>('/payments/mpesa/qr', {
        amountCents: totalCents,
        reference: `POS-${Date.now()}`,
        merchantName: 'POS',
      });
      if (res.demoMode) {
        setQrDemoMode(true);
      } else {
        setQrImage(res.qrCode);
      }
    } catch (err) {
      setQrError(err instanceof Error ? err.message : 'Failed to generate QR code');
    } finally {
      setQrLoading(false);
    }
  }

  const lookupGiftCard = useCallback(async (codeOverride?: string) => {
    const code = (codeOverride ?? gcCode).trim().toUpperCase();
    if (!code) return;
    setGcLookingUp(true);
    setGcError('');
    setGcCard(null);
    try {
      const card = await api.get<GiftCard>(`/gift-cards/${code}`);
      if (card.status !== 'ACTIVE') { setGcError('This gift card is not active'); return; }
      setGcCard(card);
    } catch (err) {
      setGcError(err instanceof Error ? err.message : 'Gift card not found');
    } finally {
      setGcLookingUp(false);
    }
  }, [gcCode]);

  const startGcCamera = useCallback(async () => {
    setGcCameraError('');
    setShowGcCamera(true);
    await new Promise<void>(resolve => setTimeout(resolve, 100));
    if (!gcVideoRef.current) return;
    try {
      const reader = new BrowserMultiFormatReader();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      gcVideoRef.current.srcObject = stream;
      await gcVideoRef.current.play();
      reader.decodeFromStream(stream, gcVideoRef.current, (result) => {
        if (result) {
          const text = result.getText();
          stream.getTracks().forEach(t => t.stop());
          setShowGcCamera(false);
          setGcCode(text.toUpperCase());
          setGcCard(null);
          setGcError('');
          void lookupGiftCard(text.toUpperCase());
        }
      });
    } catch (e) {
      setGcCameraError(e instanceof Error ? e.message : 'Camera access denied');
    }
  }, [lookupGiftCard]);

  function handleGiftCard() {
    if (!gcCard) return;
    const payAmount = Math.min(gcCard.balanceCents, totalCents);
    onComplete([{ method: 'GIFT_CARD', amountCents: payAmount, reference: gcCode.trim().toUpperCase() }]);
  }

  function addSplitLeg() {
    if (splitLegCents <= 0 || splitLegCents > splitRemainingCents) return;
    if (splitMethod === 'MPESA_STK' && splitPhone.replace(/\s/g, '').length < 9) return;
    setSplitLegs([
      ...splitLegs,
      {
        method: splitMethod,
        amountCents: splitLegCents,
        reference: splitMethod === 'MPESA_STK' ? splitPhone : undefined,
      },
    ]);
    setSplitAmount('');
    setSplitPhone('');
  }

  function removeSplitLeg(idx: number) {
    setSplitLegs(splitLegs.filter((_, i) => i !== idx));
  }

  const tabGroups: Array<{
    label: string;
    Icon: typeof DollarSign;
    methods: Array<{ id: PaymentMethod; label: string; Icon: typeof DollarSign }>;
  }> = [
    {
      label: 'Cash',
      Icon: DollarSign,
      methods: [
        { id: 'CASH', label: 'Cash', Icon: DollarSign },
      ],
    },
    {
      label: 'M-Pesa',
      Icon: Smartphone,
      methods: [
        { id: 'MPESA_STK', label: 'STK Push', Icon: Smartphone },
        { id: 'MPESA_C2B', label: 'Paybill', Icon: Smartphone },
        { id: 'MPESA_QR', label: 'QR Code', Icon: QrCode },
      ],
    },
    {
      label: 'Card',
      Icon: CreditCard,
      methods: [
        { id: 'CARD', label: 'Paystack', Icon: CreditCard },
        { id: 'CARD_TERMINAL', label: 'Terminal', Icon: Terminal },
        { id: 'NFC', label: 'NFC', Icon: Nfc },
      ],
    },
    {
      label: 'Other',
      Icon: LayoutGrid,
      methods: [
        { id: 'BANK_TRANSFER', label: 'Bank Transfer', Icon: Building2 },
        { id: 'GIFT_CARD', label: 'Gift Card', Icon: Gift },
        { id: 'ROOM_CHARGE', label: 'Room Charge', Icon: BedDouble },
        { id: 'CREDIT', label: 'Credit Sale', Icon: BookOpen },
        { id: 'SPLIT', label: 'Split Pay', Icon: Scissors },
      ],
    },
  ];

  // Fetch bank details when bank transfer tab is selected
  useEffect(() => {
    if (method === 'BANK_TRANSFER' && businessId && !bankDetails) {
      api.get<{ bankName?: string; bankAccountNumber?: string; bankAccountName?: string; bankBranch?: string }>(
        `/business/${businessId}/settings`,
      ).then((s) => setBankDetails(s)).catch(() => setBankDetails({}));
    }
  }, [method, businessId, bankDetails]);

  async function handleCardPayment(businessId: string) {
    setCardStatus('loading');
    setCardError('');
    try {
      // Public key + the address Paystack should bill and send the receipt to.
      const config = await api.get<{ publicKey: string | null; payerEmail: string }>(
        `/payments/paystack/config?businessId=${businessId}` +
        (customerId ? `&customerId=${encodeURIComponent(customerId)}` : ''),
      );

      if (!config.publicKey) {
        setCardError('Card payments not configured. Add your Paystack public key in Settings → Payments.');
        setCardStatus('idle');
        return;
      }

      // Load Paystack inline script if needed
      if (!window.PaystackPop) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://js.paystack.co/v1/inline.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Paystack'));
          document.head.appendChild(script);
        });
      }

      const reference = `POS-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      window.PaystackPop.setup({
        key: config.publicKey ?? 'pk_test_placeholder',
        // Resolved server-side: the customer's own address when we have one,
        // otherwise a per-business fallback. This was hardcoded to
        // customer@pos.local, so receipts bounced and every card sale in the
        // Paystack dashboard belonged to the same fictional person.
        email: config.payerEmail,
        amount: totalCents,
        currency: 'KES',
        ref: reference,
        onSuccess: async (transaction: { reference: string }) => {
          // This callback comes from Paystack's popup, which runs in the browser
          // and can be invoked from devtools. It is a hint that payment MIGHT
          // have happened, not proof. The server's verification decides.
          //
          // Previously the sale was marked successful before verifying, the
          // verify error was swallowed, and the response was never read — so the
          // sale completed no matter what the server said, and goods left the
          // counter unpaid.
          try {
            const result = await api.post<{ verified: boolean; status: string; reason?: string }>(
              '/payments/paystack/verify',
              { reference: transaction.reference, businessId },
            );

            if (!result.verified) {
              setCardStatus('error');
              setCardError(
                result.reason ??
                `Payment could not be confirmed (${result.status}). Do not release goods — ` +
                'check the Paystack dashboard before retrying.',
              );
              return;
            }
          } catch (err) {
            setCardStatus('error');
            setCardError(
              'Could not confirm this payment with Paystack. Do not release goods until you have ' +
              'checked the dashboard.',
            );
            return;
          }

          setCardStatus('success');
          setTimeout(() => {
            onComplete([{ method: 'CARD', amountCents: totalCents, reference: transaction.reference }]);
          }, 800);
        },
        onCancel: () => {
          setCardStatus('idle');
        },
      }).openIframe();
    } catch (err) {
      setCardStatus('error');
      setCardError(err instanceof Error ? err.message : 'Card payment failed');
    }
  }

  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-2 sm:p-4" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: 'calc(100dvh - 1rem)' }}>
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-xs font-bold uppercase tracking-wide text-gray-600">Amount due</h2>
            <div className="text-3xl font-black text-brand-700 tabular-nums leading-tight">{formatKES(totalCents)}</div>
            {customerName && <p className="text-xs text-gray-600 mt-0.5 truncate">{customerName}</p>}
          </div>
          <IconButton label="Close" onClick={onCancel}><X className="w-5 h-5" /></IconButton>
        </div>

        <PaymentMethodPicker
          groups={tabGroups}
          value={method}
          onChange={(id) => { setMethod(id); cancelMpesa(); }}
        />

        <div className="p-5 flex-1 overflow-y-auto">
          {error && (
            <div className="mb-4 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* ── CASH ── */}
          {method === 'CASH' && (
            <div className="space-y-3">
              {/* Amount display */}
              <div className="bg-gray-900 rounded-xl px-4 py-3 text-right">
                <p className="text-xs text-slate-300 mb-0.5">Cash Received</p>
                <p className={`text-3xl font-black tabular-nums ${cashCents > 0 ? 'text-white' : 'text-slate-400'}`}>
                  {cashCents > 0 ? `KES ${(cashCents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}` : 'Enter amount'}
                </p>
              </div>

              {/* Summary row */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-gray-50 rounded-lg p-2">
                  <p className="text-xs text-gray-500">Total Due</p>
                  <p className="text-sm font-bold text-gray-800">{formatKES(totalCents)}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2">
                  <p className="text-xs text-gray-500">Received</p>
                  <p className="text-sm font-bold text-gray-800">{cashCents > 0 ? formatKES(cashCents) : '—'}</p>
                </div>
                <div className={`rounded-lg p-2 ${changeCents >= 0 && cashCents > 0 ? 'bg-green-50' : 'bg-gray-50'}`}>
                  <p className="text-xs text-gray-500">Change</p>
                  <p className={`text-sm font-bold ${changeCents >= 0 && cashCents > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                    {cashCents > 0 && changeCents >= 0 ? formatKES(changeCents) : '—'}
                  </p>
                </div>
              </div>

              {/* Quick denomination buttons */}
              <div className="grid grid-cols-4 gap-1.5">
                {QUICK_CASH.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setCashInput(String(amt))}
                    className={`h-11 rounded-lg text-sm font-semibold border transition-colors ${
                      cashCents === amt * 100
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-blue-400 hover:bg-blue-50'
                    }`}
                  >
                    {amt >= 1000 ? `${amt / 1000}K` : amt}
                  </button>
                ))}
                <button
                  onClick={() => setCashInput(String(totalCents / 100))}
                  className={`h-11 rounded-lg text-sm font-semibold border transition-colors col-span-1 ${
                    cashCents === totalCents
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100'
                  }`}
                >
                  Exact
                </button>
              </div>

              {/* Numpad */}
              <div className="grid grid-cols-3 gap-1.5">
                {['7','8','9','4','5','6','1','2','3'].map((k) => (
                  <button
                    key={k}
                    onClick={() => setCashInput((prev) => {
                      const s = prev === '0' ? k : prev + k;
                      return s;
                    })}
                    className="h-14 bg-gray-100 hover:bg-gray-200 rounded-xl text-gray-800 font-bold text-xl transition-colors active:scale-95"
                  >
                    {k}
                  </button>
                ))}
                <button
                  onClick={() => setCashInput((prev) => prev.includes('.') ? prev : prev + '.')}
                  className="h-14 bg-gray-100 hover:bg-gray-200 rounded-xl text-gray-800 font-bold text-xl transition-colors active:scale-95"
                >
                  .
                </button>
                <button
                  onClick={() => setCashInput((prev) => prev === '0' ? '0' : prev + '0')}
                  className="h-14 bg-gray-100 hover:bg-gray-200 rounded-xl text-gray-800 font-bold text-xl transition-colors active:scale-95"
                >
                  0
                </button>
                <button
                  onClick={() => setCashInput((prev) => prev.slice(0, -1) || '')}
                  className="h-14 bg-gray-100 hover:bg-gray-200 rounded-xl text-gray-600 font-bold text-xl transition-colors active:scale-95 flex items-center justify-center"
                >
                  <Delete className="w-6 h-6" aria-label="Backspace" />
                </button>
              </div>

              {/* Short input field for keyboard entry */}
              <input
                type="number"
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value)}
                placeholder="Or type amount here…"
                className="w-full px-3 py-2 border rounded-lg text-sm text-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />

              {cashCents > 0 && cashCents < totalCents && (
                <div className="flex items-center gap-2 p-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  Short by {formatKES(totalCents - cashCents)}
                </div>
              )}

              {/* The confirm button stays in view: the keypad above can scroll on a small screen, this does not. */}
              <div className="sticky bottom-0 -mx-5 -mb-5 px-5 pt-3 pb-4 bg-white border-t border-gray-100">
                <button
                  onClick={handleCash}
                  disabled={cashCents < totalCents || isProcessing}
                  className="w-full py-4 bg-green-600 hover:bg-green-700 text-white font-black text-lg rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {isProcessing
                    ? 'Processing…'
                    : cashCents >= totalCents
                      ? `Confirm · Change ${formatKES(changeCents)}`
                      : 'Enter Cash Amount'}
                </button>
              </div>
            </div>
          )}

          {/* ── M-PESA STK ── */}
          {method === 'MPESA_STK' && (
            <div className="space-y-4">
              {stkStatus === 'idle' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Customer Phone Number
                    </label>
                    <input
                      type="tel"
                      value={mpesaPhone}
                      onChange={(e) => setMpesaPhone(e.target.value)}
                      placeholder="0712 345 678"
                      className="w-full px-4 py-3 border rounded-xl text-lg font-semibold focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      autoFocus
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Customer will receive an STK push on their phone
                    </p>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-800">
                    Amount: <span className="font-bold">{formatKES(totalCents)}</span>
                  </div>
                  <button
                    onClick={() => void handleMpesa()}
                    disabled={mpesaPhone.replace(/\s/g, '').length < 9}
                    className="w-full py-3.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl disabled:opacity-40 transition-colors"
                  >
                    Send M-Pesa Request
                  </button>
                </>
              )}

              {stkStatus === 'sending' && (
                <div className="text-center py-8">
                  <Loader2 className="w-10 h-10 text-green-500 animate-spin mx-auto mb-3" />
                  <p className="font-semibold text-gray-700">Sending STK Push...</p>
                </div>
              )}

              {stkStatus === 'waiting' && (
                <div className="text-center py-6 space-y-4">
                  <div className="relative">
                    <Loader2 className="w-12 h-12 text-green-500 animate-spin mx-auto" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800 text-lg">Waiting for payment</p>
                    <p className="text-sm text-gray-500 mt-1">
                      Check: <span className="font-medium">{mpesaPhone}</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      Ref: {checkoutRequestId.slice(0, 20)}...
                    </p>
                  </div>
                  <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
                    Customer should enter their M-Pesa PIN to complete payment
                  </p>
                  <button
                    onClick={cancelMpesa}
                    className="text-sm text-gray-500 underline hover:text-gray-700"
                  >
                    Cancel request
                  </button>
                </div>
              )}

              {stkStatus === 'paid' && (
                <div className="text-center py-8 space-y-3">
                  <PaidCheck size={64} className="text-green-600 mx-auto block" />
                  <p className="font-bold text-green-700 text-xl">Payment Received!</p>
                  <p className="text-sm text-gray-500">{formatKES(totalCents)} via M-Pesa</p>
                </div>
              )}

              {stkStatus === 'failed' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {stkError}
                  </div>
                  <button
                    onClick={cancelMpesa}
                    className="w-full py-3 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50"
                  >
                    Try Again
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── M-PESA QR ── */}
          {method === 'MPESA_QR' && (
            <div className="space-y-4 text-center">
              <div className="bg-teal-50 border-2 border-dashed border-teal-300 rounded-xl p-4 min-h-[160px] flex flex-col items-center justify-center">
                {qrLoading && (
                  <>
                    <Loader2 className="w-10 h-10 text-teal-500 animate-spin mb-2" />
                    <p className="text-sm text-teal-600">Generating QR code…</p>
                  </>
                )}
                {qrImage && !qrLoading && (
                  <>
                    <img
                      src={`data:image/png;base64,${qrImage}`}
                      alt="M-Pesa QR Code"
                      className="w-48 h-48 mx-auto"
                    />
                    <p className="text-xs text-teal-600 mt-2">Customer scans with M-Pesa app</p>
                  </>
                )}
                {qrDemoMode && !qrLoading && (
                  <div className="flex flex-col items-center gap-2 py-2">
                    <SmartphoneNfc className="w-10 h-10 text-amber-600" aria-hidden />
                    <p className="text-sm font-semibold text-amber-700">Demo Mode — No M-Pesa Credentials</p>
                    <p className="text-xs text-amber-600 max-w-[220px]">
                      Configure your Safaricom Daraja credentials in Settings → M-Pesa to generate real scannable QR codes.
                    </p>
                  </div>
                )}
                {!qrImage && !qrDemoMode && !qrLoading && (
                  <>
                    <QrCode className="w-12 h-12 mb-3 text-teal-600 mx-auto" aria-hidden />
                    <p className="text-sm text-teal-700 font-medium">QR code will display here</p>
                    <p className="text-xs text-teal-600 mt-1">Customer scans with M-Pesa app</p>
                  </>
                )}
              </div>
              {qrError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {qrError}
                </div>
              )}
              <div className="text-lg font-bold text-gray-800">{formatKES(totalCents)}</div>
              {!qrImage && !qrDemoMode && (
                <button
                  onClick={() => void handleQR()}
                  disabled={qrLoading}
                  className="w-full py-3.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl disabled:opacity-40 transition-colors"
                >
                  {qrLoading ? 'Generating…' : 'Generate QR Code'}
                </button>
              )}
              {(qrImage || qrDemoMode) && (
                <div className="space-y-2">
                  <button
                    onClick={() => onComplete([{ method: 'MPESA_QR', amountCents: totalCents }])}
                    disabled={isProcessing}
                    className="w-full py-3.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl disabled:opacity-40 transition-colors"
                  >
                    {isProcessing ? 'Processing…' : qrDemoMode ? 'Simulate payment' : 'Payment received'}
                  </button>
                  <button
                    onClick={() => void handleQR()}
                    disabled={qrLoading}
                    className="w-full py-2 text-sm text-teal-600 hover:text-teal-800 underline disabled:opacity-40"
                  >
                    {qrDemoMode ? 'Retry' : 'Regenerate QR'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── GIFT CARD ── */}
          {method === 'GIFT_CARD' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Gift Card Code</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={gcCode}
                    onChange={(e) => { setGcCode(e.target.value.toUpperCase()); setGcCard(null); setGcError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') void lookupGiftCard(); }}
                    placeholder="GC-XXXX-XXXX"
                    className="flex-1 px-4 py-3 border rounded-xl text-lg font-mono uppercase tracking-wider focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => void startGcCamera()}
                    className="px-3 py-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-xl text-gray-600 dark:text-gray-300 transition-colors"
                    title="Scan barcode"
                  >
                    <Camera className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => void lookupGiftCard()}
                    disabled={gcLookingUp || !gcCode.trim()}
                    className="px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-medium disabled:opacity-40"
                  >
                    {gcLookingUp ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Check'}
                  </button>
                </div>
              </div>

              {gcError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {gcError}
                </div>
              )}

              {gcCard && (
                <div className="space-y-3">
                  <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Card Balance</span>
                      <span className="font-bold text-purple-700 text-base">{formatKES(gcCard.balanceCents)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Sale Total</span>
                      <span className="font-medium">{formatKES(totalCents)}</span>
                    </div>
                    {gcCard.balanceCents < totalCents && (
                      <div className="flex justify-between text-sm border-t pt-2">
                        <span className="text-orange-600 font-medium">Remaining to pay</span>
                        <span className="text-orange-600 font-bold">{formatKES(totalCents - gcCard.balanceCents)}</span>
                      </div>
                    )}
                    {gcCard.balanceCents >= totalCents && (
                      <div className="flex justify-between text-sm border-t pt-2">
                        <span className="text-green-600 font-medium">Remaining balance after</span>
                        <span className="text-green-600 font-bold">{formatKES(gcCard.balanceCents - totalCents)}</span>
                      </div>
                    )}
                  </div>

                  {gcCard.balanceCents < totalCents ? (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      Insufficient balance. Partial payment of {formatKES(gcCard.balanceCents)} will be applied — pay the remainder via another method.
                    </p>
                  ) : null}

                  <button
                    onClick={handleGiftCard}
                    disabled={isProcessing}
                    className="w-full py-3.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl disabled:opacity-40 transition-colors"
                  >
                    {isProcessing
                      ? 'Processing…'
                      : gcCard.balanceCents >= totalCents
                        ? 'Pay with Gift Card'
                        : `Apply ${formatKES(gcCard.balanceCents)} from Gift Card`}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── ROOM CHARGE ── */}
          {method === 'ROOM_CHARGE' && (
            <div className="space-y-4">
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-sm text-indigo-800">
                Amount to charge: <span className="font-bold">{formatKES(totalCents)}</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Room Number *</label>
                <input
                  type="text"
                  value={roomNumber}
                  onChange={(e) => setRoomNumber(e.target.value)}
                  placeholder="e.g. 101, 202A"
                  className="w-full px-4 py-3 border rounded-xl text-lg font-semibold focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Guest Name (optional)</label>
                <input
                  type="text"
                  value={roomGuestName}
                  onChange={(e) => setRoomGuestName(e.target.value)}
                  placeholder="Guest name for confirmation"
                  className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
                This is added to the folio of the guest checked in to that room and paid at check-out. Ensure the guest has authorised room charges.
              </div>
              <button
                onClick={() =>
                  onComplete([{
                    method: 'ROOM_CHARGE',
                    amountCents: totalCents,
                    roomNumber: roomNumber.trim(),
                    reference: roomGuestName
                      ? `Room ${roomNumber} — ${roomGuestName}`
                      : `Room ${roomNumber}`,
                  }])
                }
                disabled={!roomNumber.trim() || isProcessing}
                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl disabled:opacity-40 transition-colors"
              >
                {isProcessing ? 'Processing…' : `Charge to Room ${roomNumber || '—'}`}
              </button>
            </div>
          )}

          {/* ── NFC Tap-to-Pay ── */}
          {method === 'NFC' && (
            <div className="space-y-4 text-center">
              {!NFCPaymentReader.isAvailable() && (
                <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  Web NFC requires Chrome on Android or ChromeOS.
                </div>
              )}
              <div className={`p-8 rounded-xl border-2 border-dashed flex flex-col items-center gap-3 ${
                nfcStatus === 'scanning' ? 'border-blue-400 bg-blue-50 animate-pulse'
                : nfcStatus === 'read' ? 'border-green-400 bg-green-50'
                : nfcStatus === 'error' ? 'border-red-300 bg-red-50'
                : 'border-gray-300'
              }`}>
                <Nfc className={`w-14 h-14 ${
                  nfcStatus === 'scanning' ? 'text-blue-500'
                  : nfcStatus === 'read' ? 'text-green-500'
                  : nfcStatus === 'error' ? 'text-red-400'
                  : 'text-gray-400'
                }`} />
                <p className="font-semibold text-gray-700">
                  {nfcStatus === 'idle' && 'Tap card or device to pay'}
                  {nfcStatus === 'scanning' && 'Hold card near reader…'}
                  {nfcStatus === 'read' && `Card read: ${nfcUid}`}
                  {nfcStatus === 'error' && nfcError}
                </p>
                <p className="text-sm font-bold text-blue-600">{formatKES(totalCents)}</p>
              </div>
              {nfcStatus === 'idle' && NFCPaymentReader.isAvailable() && (
                <button
                  onClick={() => {
                    setNfcStatus('scanning');
                    setNfcError('');
                    const reader = new NFCPaymentReader();
                    nfcReaderRef.current = reader;
                    reader.read(30000)
                      .then((result) => {
                        setNfcUid(result.uid);
                        setNfcStatus('read');
                      })
                      .catch((err: Error) => {
                        setNfcError(err.message);
                        setNfcStatus('error');
                      });
                  }}
                  className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors"
                >
                  Start NFC Scan
                </button>
              )}
              {nfcStatus === 'scanning' && (
                <button
                  onClick={() => { nfcReaderRef.current?.stop(); setNfcStatus('idle'); }}
                  className="w-full py-3 border border-gray-300 rounded-xl text-gray-600 text-sm"
                >
                  Cancel
                </button>
              )}
              {nfcStatus === 'read' && (
                <button
                  onClick={() => onComplete([{ method: 'NFC', amountCents: totalCents, reference: nfcUid }])}
                  disabled={isProcessing}
                  className="w-full py-3.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl disabled:opacity-40 transition-colors"
                >
                  {isProcessing ? 'Processing…' : 'Confirm NFC Payment'}
                </button>
              )}
              {nfcStatus === 'error' && (
                <button onClick={() => setNfcStatus('idle')} className="w-full py-3 border border-gray-300 rounded-xl text-gray-600 text-sm">
                  Try Again
                </button>
              )}
            </div>
          )}

          {/* ── Card Terminal (Web Serial — PAX / Ingenico / Verifone) ── */}
          {method === 'CARD_TERMINAL' && (
            <div className="space-y-4">
              {!isSerialAvailable() && (
                <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  Web Serial requires Chrome 89+ or Edge 89+. Enable at chrome://flags/#enable-experimental-web-platform-features if needed.
                </div>
              )}
              <div className="flex gap-2">
                {(['PAX', 'INGENICO', 'VERIFONE'] as const).map((b) => (
                  <button
                    key={b}
                    onClick={() => setCtBrand(b)}
                    disabled={ctStatus !== 'idle'}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${
                      ctBrand === b ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
              <div className={`p-6 rounded-xl border-2 flex flex-col items-center gap-3 ${
                ctStatus === 'waiting' ? 'border-blue-400 bg-blue-50 animate-pulse'
                : ctStatus === 'approved' ? 'border-green-400 bg-green-50'
                : ctStatus === 'declined' || ctStatus === 'error' ? 'border-red-300 bg-red-50'
                : 'border-gray-200'
              }`}>
                <Terminal className={`w-12 h-12 ${
                  ctStatus === 'waiting' ? 'text-blue-500'
                  : ctStatus === 'approved' ? 'text-green-500'
                  : ctStatus === 'declined' || ctStatus === 'error' ? 'text-red-400'
                  : 'text-gray-400'
                }`} />
                <p className="font-semibold text-gray-700 text-center">
                  {ctStatus === 'idle' && `${ctBrand} terminal — ${isCardTerminalConnected() ? 'Connected' : 'Not connected'}`}
                  {ctStatus === 'connecting' && 'Connecting to terminal…'}
                  {ctStatus === 'waiting' && 'Waiting for customer — tap, insert or swipe card'}
                  {ctStatus === 'approved' && `Approved · Auth: ${ctRef}`}
                  {ctStatus === 'declined' && 'Declined — please try another payment method'}
                  {ctStatus === 'error' && ctError}
                </p>
                <p className="text-sm font-bold text-blue-600">{formatKES(totalCents)}</p>
              </div>
              {ctStatus === 'idle' && isSerialAvailable() && (
                <button
                  onClick={async () => {
                    setCtStatus('connecting');
                    setCtError('');
                    try {
                      const config: CardTerminalConfig = { brand: ctBrand };
                      if (!isCardTerminalConnected()) await connectCardTerminal(config);
                      setCtStatus('waiting');
                      const result = await cardTerminalSale(totalCents, config);
                      if (result.approved) {
                        setCtRef(result.authCode ?? result.reference);
                        setCtStatus('approved');
                        setTimeout(() => onComplete([{ method: 'CARD_TERMINAL', amountCents: totalCents, reference: result.reference }]), 800);
                      } else {
                        setCtStatus('declined');
                      }
                    } catch (err: any) {
                      setCtError(err.message ?? 'Terminal error');
                      setCtStatus('error');
                    }
                  }}
                  className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors"
                >
                  {isCardTerminalConnected() ? 'Charge Terminal' : 'Connect & Charge'}
                </button>
              )}
              {(ctStatus === 'declined' || ctStatus === 'error') && (
                <button onClick={() => setCtStatus('idle')} className="w-full py-3 border border-gray-300 rounded-xl text-gray-600 text-sm">
                  Try Again
                </button>
              )}
            </div>
          )}

          {/* ── CARD (Paystack Inline) ── */}
          {method === 'CARD' && (
            <div className="space-y-4 text-center">
              <div className="p-6 bg-gray-50 rounded-xl">
                <CreditCard className="w-12 h-12 mx-auto mb-3 text-blue-600" />
                <p className="font-semibold text-gray-800 text-lg mb-1">{formatKES(totalCents)}</p>
                <p className="text-sm text-gray-500">Pay securely via card using Paystack</p>
              </div>

              {cardStatus === 'success' && (
                <div className="flex items-center gap-2 justify-center text-green-600 font-medium">
                  <CheckCircle className="w-5 h-5" /> Payment successful!
                </div>
              )}
              {cardStatus === 'error' && (
                <div className="flex items-center gap-2 justify-center text-red-600 text-sm">
                  <AlertCircle className="w-4 h-4" /> {cardError}
                </div>
              )}

              <button
                onClick={() => handleCardPayment(businessId)}
                disabled={cardStatus === 'loading' || cardStatus === 'success' || isProcessing}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
              >
                {cardStatus === 'loading' ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Opening payment…</>
                ) : cardStatus === 'success' ? (
                  <><CheckCircle className="w-4 h-4" /> Paid</>
                ) : (
                  <><CreditCard className="w-4 h-4" /> Pay with Card</>
                )}
              </button>
              <p className="text-xs text-gray-400">Powered by Paystack. Requires Paystack key in Settings.</p>
            </div>
          )}

          {/* ── MPESA C2B (Paybill/Till incoming payments) ── */}
          {method === 'MPESA_C2B' && (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                <p className="text-sm font-semibold text-green-800 mb-0.5">Paybill / Till Payments</p>
                <p className="text-xs text-green-700">
                  Select a payment below that matches this sale ({formatKES(totalCents)}).
                  Payments appear in real-time as customers pay to your Paybill/Till number.
                </p>
              </div>

              {c2bSelected ? (
                <div className="space-y-3">
                  <div className="bg-green-50 border border-green-300 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <span className="font-semibold text-green-800">Payment Selected</span>
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">From</span>
                        <span className="font-medium">{c2bSelected.customerName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Amount</span>
                        <span className="font-bold text-green-700">{formatKES(c2bSelected.amountCents)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Ref</span>
                        <span className="font-mono text-xs">{c2bSelected.transactionId}</span>
                      </div>
                    </div>
                  </div>

                  {c2bSelected.amountCents !== totalCents && (
                    <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      {c2bSelected.amountCents < totalCents
                        ? `Short by ${formatKES(totalCents - c2bSelected.amountCents)} — partial payment`
                        : `Overpayment by ${formatKES(c2bSelected.amountCents - totalCents)}`}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => setC2bSelected(null)}
                      className="flex-1 py-2.5 border border-gray-300 rounded-xl text-gray-700 text-sm font-medium hover:bg-gray-50"
                    >
                      Change
                    </button>
                    <button
                      onClick={() =>
                        onComplete([{
                          method: 'MPESA_C2B',
                          amountCents: c2bSelected.amountCents,
                          reference: c2bSelected.transactionId,
                        }])
                      }
                      disabled={isProcessing}
                      className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl disabled:opacity-40 transition-colors text-sm"
                    >
                      {isProcessing ? 'Processing…' : 'Confirm Payment'}
                    </button>
                  </div>
                </div>
              ) : (
                <IncomingPaymentsPanel
                  businessId={businessId}
                  onApply={(payment) => setC2bSelected({
                    id: payment.id,
                    transactionId: payment.transactionId,
                    amountCents: payment.amountCents,
                    customerName: payment.customerName,
                  })}
                />
              )}
            </div>
          )}

          {/* ── BANK TRANSFER ── */}
          {method === 'BANK_TRANSFER' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Building2 className="w-5 h-5 text-blue-600" />
                  <span className="font-semibold text-blue-800">Bank Transfer Details</span>
                </div>
                {bankDetails === null ? (
                  <div className="flex justify-center py-2"><Loader2 className="w-5 h-5 text-blue-400 animate-spin" /></div>
                ) : bankDetails.bankName ? (
                  <div className="space-y-2 text-sm">
                    {bankDetails.bankAccountName && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Account Name</span>
                        <span className="font-semibold text-gray-800">{bankDetails.bankAccountName}</span>
                      </div>
                    )}
                    {bankDetails.bankAccountNumber && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Account No.</span>
                        <span className="font-mono font-bold text-gray-800 tracking-wider">{bankDetails.bankAccountNumber}</span>
                      </div>
                    )}
                    {bankDetails.bankName && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Bank</span>
                        <span className="font-medium text-gray-800">{bankDetails.bankName}</span>
                      </div>
                    )}
                    {bankDetails.bankBranch && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Branch</span>
                        <span className="text-gray-700">{bankDetails.bankBranch}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t pt-2 mt-2">
                      <span className="text-gray-600">Amount to Transfer</span>
                      <span className="font-bold text-blue-700 text-base">{formatKES(totalCents)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-blue-700">No bank details configured. Add them in Settings → General.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Transaction Reference (optional)</label>
                <input
                  type="text"
                  value={bankRef}
                  onChange={(e) => setBankRef(e.target.value)}
                  placeholder="e.g. REF123456 or bank slip number"
                  className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Confirm the transfer has been received in your bank account before completing the sale.
              </div>
              <button
                onClick={() => onComplete([{ method: 'BANK_TRANSFER', amountCents: totalCents, reference: bankRef || undefined }])}
                disabled={isProcessing}
                className="w-full py-3.5 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-xl disabled:opacity-40 transition-colors"
              >
                {isProcessing ? 'Processing…' : 'Confirm Transfer Received'}
              </button>
            </div>
          )}

          {/* ── CREDIT SALE ── */}
          {method === 'CREDIT' && (
            <CreditSalePanel
              totalCents={totalCents}
              customerId={customerId}
              customerName={customerName}
              businessId={businessId}
              isProcessing={isProcessing}
              onComplete={onComplete}
            />
          )}

          {/* ── SPLIT ── */}
          {method === 'SPLIT' && (
            <div className="space-y-4">
              <div className="flex justify-between text-sm font-medium">
                <span className="text-gray-600">Total: {formatKES(totalCents)}</span>
                <span className={splitRemainingCents <= 0 ? 'text-green-600' : 'text-orange-600'}>
                  Remaining: {formatKES(Math.max(0, splitRemainingCents))}
                </span>
              </div>
              {splitLegs.map((leg, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm"
                >
                  <span className="font-medium">{leg.method}</span>
                  {leg.reference && (
                    <span className="text-gray-500 text-xs">{leg.reference}</span>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{formatKES(leg.amountCents)}</span>
                    <button
                      onClick={() => removeSplitLeg(idx)}
                      className="text-red-400 hover:text-red-600" aria-label="Remove">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              {splitRemainingCents > 0 && (
                <div className="border rounded-xl p-4 space-y-3">
                  <div className="flex gap-2">
                    {(['CASH', 'MPESA_STK'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setSplitMethod(m)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                          splitMethod === m
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-700'
                        }`}
                      >
                        {m === 'CASH' ? 'Cash' : 'M-Pesa'}
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    value={splitAmount}
                    onChange={(e) => setSplitAmount(e.target.value)}
                    placeholder={`Amount (max ${(splitRemainingCents / 100).toFixed(0)})`}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                  {splitMethod === 'MPESA_STK' && (
                    <input
                      type="tel"
                      value={splitPhone}
                      onChange={(e) => setSplitPhone(e.target.value)}
                      placeholder="Phone: 0712345678"
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                    />
                  )}
                  <button
                    onClick={addSplitLeg}
                    disabled={splitLegCents <= 0 || splitLegCents > splitRemainingCents}
                    className="w-full py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-lg text-sm font-medium disabled:opacity-40"
                  >
                    Add Payment
                  </button>
                </div>
              )}
              <button
                onClick={() => onComplete(splitLegs)}
                disabled={splitPaidCents < totalCents || isProcessing}
                className="w-full py-3.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl disabled:opacity-40 transition-colors"
              >
                {isProcessing ? 'Processing…' : 'Complete Split Payment'}
              </button>
            </div>
          )}
        </div>
      </div>

      {showGcCamera && (
        <div className="fixed inset-0 bg-black/90 flex flex-col items-center justify-center z-[60] p-4">
          <button onClick={() => setShowGcCamera(false)} className="absolute top-4 right-4 text-white p-2 hover:bg-gray-700 rounded" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
          <div className="w-full max-w-md aspect-video bg-black rounded-lg border-2 border-purple-400 overflow-hidden">
            <video ref={gcVideoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          {gcCameraError && <p className="text-red-400 text-sm mt-2">{gcCameraError}</p>}
          <p className="text-white text-sm mt-3">Scan gift card barcode</p>
        </div>
      )}
    </div>,
    document.body,
  );
}
