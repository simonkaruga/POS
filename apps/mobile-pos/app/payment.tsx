import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Alert, ActivityIndicator, KeyboardAvoidingView,
  Platform, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { mobileApi, formatKES } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useActiveStore } from '../lib/useActiveStore';
import { useCartStore } from '../stores/cart';
import { queueSale } from '../lib/db';
import { saleTypeFor } from '../lib/saleType';
import { toCheckoutLines } from '../lib/checkoutLines';
import {
  orderPayable, billFromOrder, unitPriceOf, buildOrderCheckout, methodsForOrder, serviceChargeFor, AFTER_ORDER_PAYMENT_ROUTE,
  type PayableOrder,
} from '../lib/orderPayment';
import { loadPrinterSettings, printReceipt, type PrintableReceipt } from '../lib/receiptPrint';
import type { PrinterSettings } from '../lib/printerConfig';
import { Colors } from '../constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

type PaymentMethod = 'CASH' | 'MPESA_STK' | 'MPESA_MANUAL' | 'CARD' | 'BANK_TRANSFER' | 'GIFT_CARD' | 'CREDIT' | 'SPLIT';
type StkStatus = 'idle' | 'sending' | 'waiting' | 'paid' | 'failed';

interface SaleResult { id: string; receiptNumber: string; totalCents: number; }

interface SalePayload {
  offlineId: string; businessId: string; storeId: string; cashierId: string;
  customerId?: string; type: 'NORMAL' | 'CREDIT'; priceLevel: 'RETAIL' | 'WHOLESALE' | 'VIP';
  items: Array<{ itemId: string; quantity: number; unitPriceCents?: number; discountPercent?: number }>;
  payments: Array<{ method: string; amountCents: number; reference?: string }>;
  discountCents?: number; serviceChargeCents?: number; promotionId?: string;
  /** Set when paying a table: the server bills the order itself and closes it. */
  orderId?: string; expectedTotalCents?: number;
}

interface GiftCard { code: string; balanceCents: number; status: string; }
interface CustomerCredit { creditLimitCents: number; balanceCents: number; creditApprovalStatus: string; }

const PAYMENT_METHODS: Array<{ key: PaymentMethod; label: string; icon: string; color: string }> = [
  { key: 'CASH',         label: 'Cash',       icon: 'cash-outline',           color: Colors.success },
  { key: 'MPESA_STK',    label: 'M-Pesa STK', icon: 'phone-portrait-outline', color: '#00A651' },
  { key: 'MPESA_MANUAL', label: 'M-Pesa Code',icon: 'chatbubble-outline',     color: '#00A651' },
  { key: 'CARD',         label: 'Card',        icon: 'card-outline',           color: Colors.indigo },
  { key: 'BANK_TRANSFER',label: 'Bank',        icon: 'business-outline',       color: Colors.primary },
  { key: 'GIFT_CARD',    label: 'Gift Card',   icon: 'gift-outline',           color: '#7C3AED' },
  { key: 'CREDIT',       label: 'Credit',      icon: 'book-outline',           color: Colors.warning },
  { key: 'SPLIT',        label: 'Split',       icon: 'shuffle-outline',        color: Colors.error },
];

function calculateTax(cents: number, taxType: string) {
  if (taxType === 'VAT') { const t = Math.round((cents * 16) / 116); return { taxCents: t, exTaxCents: cents - t, label: 'VAT (16%)' }; }
  if (taxType === 'TOT') { const t = Math.round((cents * 3) / 103);  return { taxCents: t, exTaxCents: cents - t, label: 'TOT (3%)' }; }
  return { taxCents: 0, exTaxCents: cents, label: '' };
}

function generateOfflineId() {
  return Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
}

// ─── M-Pesa STK panel ─────────────────────────────────────────────────────────

function MpesaSTKPanel({ totalCents, businessId, onComplete }: {
  totalCents: number; businessId: string;
  onComplete: (payments: Array<{ method: string; amountCents: number; reference?: string }>) => void;
}) {
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<StkStatus>('idle');
  const [error, setError] = useState('');
  const [reqId, setReqId] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPoll() { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }

  function startPoll(id: string) {
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const res = await mobileApi.get<{ status: string; resultDesc: string }>(`/payments/mpesa/stk-status/${id}`);
        if (res.status === 'paid') {
          stopPoll(); setStatus('paid');
          setTimeout(() => onComplete([{ method: 'MPESA_STK', amountCents: totalCents, reference: id }]), 800);
        } else if (res.status === 'failed') {
          stopPoll(); setStatus('failed'); setError(res.resultDesc || 'Payment declined or timed out');
        }
      } catch { /* keep polling on network error */ }
      if (attempts >= 40) { stopPoll(); setStatus('failed'); setError('Payment timed out. Please try again.'); }
    }, 3000);
  }

  async function handleSend() {
    const cleaned = phone.replace(/\s/g, '');
    if (cleaned.length < 9) return;
    setStatus('sending'); setError('');
    try {
      const res = await mobileApi.post<{ checkoutRequestId: string }>('/payments/mpesa/stk-push', {
        phone: cleaned, amountCents: totalCents, reference: `POS-${Date.now()}`,
      });
      setReqId(res.checkoutRequestId);
      setStatus('waiting');
      startPoll(res.checkoutRequestId);
    } catch (err: any) {
      setStatus('failed'); setError(err?.message ?? 'Failed to send STK push');
    }
  }

  function handleCancel() { stopPoll(); setStatus('idle'); setError(''); setReqId(''); }

  useEffect(() => () => stopPoll(), []);

  if (status === 'idle') return (
    <View style={pStyles.panel}>
      <Text style={pStyles.fieldLabel}>Customer Phone Number</Text>
      <View style={pStyles.inputWrap}>
        <Ionicons name="call-outline" size={16} color={Colors.textSecondary} />
        <TextInput style={pStyles.input} value={phone} onChangeText={setPhone}
          placeholder="0712 345 678" keyboardType="phone-pad" placeholderTextColor={Colors.textSecondary} autoFocus />
      </View>
      <View style={pStyles.infoBox}>
        <Text style={pStyles.infoText}>Amount: <Text style={{ fontWeight: '700' }}>{formatKES(totalCents)}</Text></Text>
        <Text style={pStyles.infoText}>Customer will receive an STK push prompt on their phone.</Text>
      </View>
      <TouchableOpacity
        style={[pStyles.actionBtn, { backgroundColor: '#00A651' }, phone.replace(/\s/g,'').length < 9 && { opacity: 0.4 }]}
        onPress={() => void handleSend()} disabled={phone.replace(/\s/g,'').length < 9}>
        <Text style={pStyles.actionBtnText}>Send M-Pesa Request</Text>
      </TouchableOpacity>
    </View>
  );

  if (status === 'sending') return (
    <View style={[pStyles.panel, { alignItems: 'center', paddingVertical: 32 }]}>
      <ActivityIndicator size="large" color="#00A651" />
      <Text style={[pStyles.fieldLabel, { marginTop: 12 }]}>Sending STK Push…</Text>
    </View>
  );

  if (status === 'waiting') return (
    <View style={[pStyles.panel, { alignItems: 'center', gap: 12 }]}>
      <ActivityIndicator size="large" color="#00A651" />
      <Text style={pStyles.waitTitle}>Waiting for payment</Text>
      <Text style={pStyles.waitSub}>Check: <Text style={{ fontWeight: '600' }}>{phone}</Text></Text>
      <View style={pStyles.infoBox}>
        <Text style={pStyles.infoText}>Customer should enter their M-Pesa PIN to complete payment.</Text>
      </View>
      <TouchableOpacity onPress={handleCancel}>
        <Text style={{ color: Colors.textSecondary, fontSize: 13, textDecorationLine: 'underline' }}>Cancel request</Text>
      </TouchableOpacity>
    </View>
  );

  if (status === 'paid') return (
    <View style={[pStyles.panel, { alignItems: 'center', gap: 10 }]}>
      <Ionicons name="checkmark-circle" size={56} color={Colors.success} />
      <Text style={pStyles.waitTitle}>Payment Received!</Text>
      <Text style={pStyles.waitSub}>{formatKES(totalCents)} via M-Pesa</Text>
    </View>
  );

  // failed
  return (
    <View style={pStyles.panel}>
      <View style={pStyles.errorBox}>
        <Ionicons name="alert-circle-outline" size={16} color={Colors.error} />
        <Text style={pStyles.errorText}>{error}</Text>
      </View>
      <TouchableOpacity style={[pStyles.actionBtn, { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border }]} onPress={handleCancel}>
        <Text style={[pStyles.actionBtnText, { color: Colors.text }]}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Gift Card panel ──────────────────────────────────────────────────────────

function GiftCardPanel({ totalCents, onComplete }: {
  totalCents: number;
  onComplete: (payments: Array<{ method: string; amountCents: number; reference?: string }>) => void;
}) {
  const [code, setCode] = useState('');
  const [card, setCard] = useState<GiftCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function lookup() {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setLoading(true); setError(''); setCard(null);
    try {
      const res = await mobileApi.get<GiftCard | null>(`/gift-cards/${c}`);
      if (!res) { setError('Gift card not found.'); return; }
      if (res.status !== 'ACTIVE') { setError('This gift card is not active.'); return; }
      setCard(res);
    } catch (err: any) {
      setError(err?.message ?? 'Gift card not found');
    } finally { setLoading(false); }
  }

  return (
    <View style={pStyles.panel}>
      <Text style={pStyles.fieldLabel}>Gift Card Code</Text>
      <View style={pStyles.inputRow}>
        <View style={[pStyles.inputWrap, { flex: 1 }]}>
          <Ionicons name="gift-outline" size={16} color={Colors.textSecondary} />
          <TextInput style={pStyles.input} value={code}
            onChangeText={(t) => { setCode(t.toUpperCase()); setCard(null); setError(''); }}
            onSubmitEditing={() => void lookup()}
            placeholder="GC-XXXX-XXXX" autoCapitalize="characters" autoCorrect={false}
            placeholderTextColor={Colors.textSecondary} />
        </View>
        <TouchableOpacity style={[pStyles.actionBtn, { paddingHorizontal: 16, paddingVertical: 0, height: 44, justifyContent: 'center' }]}
          onPress={() => void lookup()} disabled={loading || !code.trim()}>
          {loading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={pStyles.actionBtnText}>Check</Text>}
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={pStyles.errorBox}>
          <Ionicons name="alert-circle-outline" size={14} color={Colors.error} />
          <Text style={pStyles.errorText}>{error}</Text>
        </View>
      ) : null}

      {card && (
        <View style={pStyles.gcCard}>
          <View style={pStyles.gcRow}>
            <Text style={pStyles.gcLabel}>Card Balance</Text>
            <Text style={pStyles.gcValue}>{formatKES(card.balanceCents)}</Text>
          </View>
          <View style={pStyles.gcRow}>
            <Text style={pStyles.gcLabel}>Sale Total</Text>
            <Text style={pStyles.gcValue}>{formatKES(totalCents)}</Text>
          </View>
          {card.balanceCents < totalCents && (
            <View style={[pStyles.gcRow, { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 8 }]}>
              <Text style={[pStyles.gcLabel, { color: Colors.warning }]}>Remaining to pay</Text>
              <Text style={[pStyles.gcValue, { color: Colors.warning }]}>{formatKES(totalCents - card.balanceCents)}</Text>
            </View>
          )}
          {card.balanceCents >= totalCents && (
            <View style={[pStyles.gcRow, { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 8 }]}>
              <Text style={[pStyles.gcLabel, { color: Colors.success }]}>Balance after</Text>
              <Text style={[pStyles.gcValue, { color: Colors.success }]}>{formatKES(card.balanceCents - totalCents)}</Text>
            </View>
          )}
          {card.balanceCents < totalCents && (
            <View style={pStyles.infoBox}>
              <Text style={pStyles.infoText}>Partial payment of {formatKES(card.balanceCents)} will be applied. Pay the remainder via another method.</Text>
            </View>
          )}
          <TouchableOpacity
            style={[pStyles.actionBtn, { backgroundColor: '#7C3AED' }]}
            onPress={() => onComplete([{ method: 'GIFT_CARD', amountCents: Math.min(card.balanceCents, totalCents), reference: code.trim().toUpperCase() }])}>
            <Text style={pStyles.actionBtnText}>
              {card.balanceCents >= totalCents ? 'Pay with Gift Card' : `Apply ${formatKES(card.balanceCents)}`}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Credit Sale panel ────────────────────────────────────────────────────────

function CreditPanel({ totalCents, customerId, customerName, businessId, onComplete }: {
  totalCents: number; customerId: string | null; customerName: string | null;
  businessId: string;
  onComplete: (payments: Array<{ method: string; amountCents: number; reference?: string }>) => void;
}) {
  const [reqLoading, setReqLoading] = useState(false);
  const [reqSent, setReqSent] = useState(false);
  const [reqError, setReqError] = useState('');

  const { data: credit, isLoading } = useQuery<CustomerCredit>({
    queryKey: ['customer-credit', customerId, businessId],
    queryFn: () => mobileApi.get<CustomerCredit>(`/businesses/${businessId}/customers/${customerId}`),
    enabled: !!customerId && !!businessId,
  });

  if (!customerId) return (
    <View style={pStyles.panel}>
      <View style={pStyles.infoBox}>
        <Ionicons name="alert-circle-outline" size={16} color={Colors.warning} />
        <Text style={pStyles.infoText}>Select a customer first before recording a credit sale.</Text>
      </View>
    </View>
  );

  if (isLoading) return (
    <View style={[pStyles.panel, { alignItems: 'center', paddingVertical: 24 }]}>
      <ActivityIndicator color={Colors.primary} />
    </View>
  );

  const outstanding = credit ? Math.max(0, -credit.balanceCents) : 0;
  const limit = credit?.creditLimitCents ?? 0;
  const available = Math.max(0, limit - outstanding);
  const noLimit = limit === 0;
  const wouldExceed = !noLimit && (outstanding + totalCents) > limit;

  async function requestIncrease() {
    if (!customerId || !credit) return;
    setReqLoading(true); setReqError('');
    try {
      await mobileApi.patch(`/businesses/${businessId}/customers/${customerId}/request-credit`, {
        requestedLimitCents: outstanding + totalCents,
      });
      setReqSent(true);
    } catch (err: any) {
      setReqError(err?.message ?? 'Failed to send request.');
    } finally { setReqLoading(false); }
  }

  return (
    <View style={pStyles.panel}>
      {credit && (
        <View style={pStyles.creditGrid}>
          <View style={pStyles.creditCell}>
            <Text style={pStyles.creditCellLabel}>Limit</Text>
            <Text style={pStyles.creditCellValue}>{noLimit ? '∞' : formatKES(limit)}</Text>
          </View>
          <View style={pStyles.creditCell}>
            <Text style={pStyles.creditCellLabel}>Outstanding</Text>
            <Text style={[pStyles.creditCellValue, outstanding > 0 && { color: Colors.error }]}>{formatKES(outstanding)}</Text>
          </View>
          <View style={[pStyles.creditCell, wouldExceed && { backgroundColor: Colors.error + '12' }]}>
            <Text style={pStyles.creditCellLabel}>Available</Text>
            <Text style={[pStyles.creditCellValue, { color: wouldExceed ? Colors.error : Colors.success }]}>
              {noLimit ? '∞' : formatKES(available)}
            </Text>
          </View>
        </View>
      )}

      {wouldExceed && (
        <View style={pStyles.errorBox}>
          <Ionicons name="alert-circle-outline" size={14} color={Colors.error} />
          <Text style={pStyles.errorText}>
            Credit limit exceeded by {formatKES(outstanding + totalCents - limit)}.
          </Text>
        </View>
      )}

      {wouldExceed && !reqSent && (
        <>
          {reqError ? <Text style={[pStyles.errorText, { marginBottom: 4 }]}>{reqError}</Text> : null}
          <TouchableOpacity
            style={[pStyles.actionBtn, { backgroundColor: Colors.warning }]}
            onPress={() => void requestIncrease()} disabled={reqLoading}>
            {reqLoading ? <ActivityIndicator size="small" color="#FFFFFF" /> :
              <Text style={pStyles.actionBtnText}>Request Credit Increase from Manager</Text>}
          </TouchableOpacity>
        </>
      )}

      {wouldExceed && reqSent && (
        <View style={pStyles.infoBox}>
          <Ionicons name="checkmark-circle-outline" size={14} color={Colors.success} />
          <Text style={pStyles.infoText}>Request sent. Proceed once manager approves.</Text>
        </View>
      )}

      {!wouldExceed && (
        <View style={pStyles.infoBox}>
          <Text style={pStyles.infoText}>Sale recorded as unpaid. Collect payment later via Reports → Credit Book.</Text>
        </View>
      )}

      <TouchableOpacity
        style={[pStyles.actionBtn, { backgroundColor: Colors.primary }, wouldExceed && { opacity: 0.4 }]}
        onPress={() => onComplete([{ method: 'CREDIT', amountCents: totalCents }])}
        disabled={wouldExceed}>
        <Text style={pStyles.actionBtnText}>Record Credit Sale · {formatKES(totalCents)}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── PaymentScreen ────────────────────────────────────────────────────────────

export default function PaymentScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const {
    items: cartItems, subtotalCents, promoDiscountCents,
    clearCart, customerId: cartCustomerId, customerName: cartCustomerName, priceLevel, appliedPromotion,
  } = useCartStore();

  // Opened from a table's order screen: the bill is that order, not the cart.
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();
  const orderMode = !!orderId;
  const orderQ = useQuery<PayableOrder>({
    queryKey: ['order', orderId],
    queryFn: () => mobileApi.get<PayableOrder>(`/hospitality/orders/${orderId}`),
    enabled: orderMode,
    // Always the bill as it is now: a line may have been added or voided since the waiter last looked.
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const order = orderQ.data;
  // The cart's customer, loyalty and promotion belong to a counter sale and do not follow a table.
  const customerId = orderMode ? null : cartCustomerId;
  const customerName = orderMode ? null : cartCustomerName;
  const { businessId, storeId } = useActiveStore();
  const cashierId = user?.id ?? '';

  const { data: bizSettings } = useQuery<{
    taxType?: string; serviceChargeRate?: number;
    serviceChargeDefault?: boolean; name?: string;
  }>({
    queryKey: ['mobile-biz-settings', businessId],
    queryFn: () => mobileApi.get(`/business/${businessId}/settings`),
    enabled: !!businessId,
    staleTime: 60_000,
    refetchOnMount: 'always',
  });

  // Loyalty — points balance + program value (only when a customer is selected)
  const { data: loyalty } = useQuery<{ points?: number; loyaltyPoints?: number }>({
    queryKey: ['loyalty-customer', customerId],
    queryFn: () => mobileApi.get(`/loyalty/customer/${customerId}`),
    enabled: !!customerId,
    staleTime: 30_000,
  });
  const { data: loyaltyProgram } = useQuery<{ pointValueCents?: number; minRedemption?: number }>({
    queryKey: ['loyalty-program', businessId],
    queryFn: () => mobileApi.get(`/loyalty/program?businessId=${businessId}`),
    enabled: !!businessId && !!customerId,
    staleTime: 5 * 60_000,
  });
  const [redeemLoyalty, setRedeemLoyalty] = useState(false);

  const taxType = (bizSettings?.taxType as string | undefined) ?? 'NONE';
  const orderBill = billFromOrder(order);
  const billLines = orderMode
    ? orderBill.lines
    : cartItems.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, totalCents: i.unitPriceCents * i.quantity }));
  const subtotal = orderMode ? orderBill.subtotalCents : subtotalCents();
  const promoDiscount = orderMode ? 0 : promoDiscountCents();
  const subtotalAfterPromo = Math.max(0, subtotal - promoDiscount);

  // Loyalty redeem: use as many points as possible without over-discounting.
  const pointValueCents = loyaltyProgram?.pointValueCents ?? 0;
  const availablePoints = loyalty?.points ?? loyalty?.loyaltyPoints ?? 0;
  const maxRedeemPoints = pointValueCents > 0 ? Math.min(availablePoints, Math.floor(subtotalAfterPromo / pointValueCents)) : 0;
  const redeemPoints = redeemLoyalty ? maxRedeemPoints : 0;
  const loyaltyDiscountCents = redeemPoints * pointValueCents;
  const { taxCents, exTaxCents, label: taxLabel } = calculateTax(subtotalAfterPromo, taxType);
  // A table is paid with no service charge added, as on the web till; a counter sale follows the setting.
  const serviceChargeCents = serviceChargeFor(
    orderMode,
    bizSettings?.serviceChargeDefault
      ? Math.round((subtotalAfterPromo * (bizSettings?.serviceChargeRate ?? 0)) / 100)
      : 0,
  );

  // ── UI state ────────────────────────────────────────────────────────────────
  const [payMethod, setPayMethod] = useState<PaymentMethod>('CASH');
  const [amountTendered, setAmountTendered] = useState('');
  const [mpesaRef, setMpesaRef] = useState('');
  const [bankRef, setBankRef] = useState('');
  const [discountInput, setDiscountInput] = useState('');
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [splitCash, setSplitCash] = useState('');
  const [splitMpesa, setSplitMpesa] = useState('');
  const [splitMpesaRef, setSplitMpesaRef] = useState('');
  const [splitCard, setSplitCard] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [completedSale, setCompletedSale] = useState<SaleResult | null>(null);
  const [printSettings, setPrintSettings] = useState<PrinterSettings | null>(null);
  const [receiptSnap, setReceiptSnap] = useState<PrintableReceipt | null>(null);
  const [printError, setPrintError] = useState('');
  const printOn = printSettings?.enabled === true;

  useEffect(() => { void loadPrinterSettings().then(setPrintSettings); }, []);

  /** How many times each receipt has been sent to a printer; every print after the first is a marked copy. */
  const printsRef = useRef<Record<string, number>>({});

  /** Print with the saved settings. The OS print dialog can be cancelled, so only silent transports report failures. */
  async function printNow(snap: PrintableReceipt) {
    setPrintError('');
    const copies = printsRef.current[snap.receiptNumber] ?? 0;
    try {
      await printReceipt(copies > 0 ? { ...snap, copyNumber: copies } : snap, printSettings ?? undefined);
      printsRef.current[snap.receiptNumber] = copies + 1;
    } catch (e) {
      if (printSettings?.method === 'system') return;
      setPrintError(e instanceof Error ? e.message : 'The printer did not respond.');
    }
  }

  // ── Discount ────────────────────────────────────────────────────────────────
  const discountVal = parseFloat(discountInput || '0') || 0;
  const rawDiscount = discountType === 'percent'
    ? Math.round((subtotalAfterPromo * discountVal) / 100)
    : Math.round(discountVal * 100);
  const effectiveDiscount = Math.min(rawDiscount + loyaltyDiscountCents, subtotalAfterPromo);
  const goodsAfterDiscount = subtotalAfterPromo - effectiveDiscount;
  const totalAfterDiscount = goodsAfterDiscount + serviceChargeCents;
  // The server prices lines from the catalog, so per-item markdowns ride along in the sale discount.
  const checkoutLines = toCheckoutLines(cartItems);
  const saleDiscountCents = effectiveDiscount + checkoutLines.lineDiscountCents;
  const { taxCents: finalTax } = calculateTax(goodsAfterDiscount, taxType);

  const tendered = Math.round((parseFloat(amountTendered || '0') || 0) * 100);
  const change = Math.max(0, tendered - totalAfterDiscount);

  const splitTotal =
    Math.round((parseFloat(splitCash || '0') || 0) * 100) +
    Math.round((parseFloat(splitMpesa || '0') || 0) * 100) +
    Math.round((parseFloat(splitCard || '0') || 0) * 100);

  // ── buildPayments ───────────────────────────────────────────────────────────
  function buildPayments(): Array<{ method: string; amountCents: number; reference?: string }> | null {
    if (payMethod === 'SPLIT') {
      const cash  = Math.round((parseFloat(splitCash  || '0') || 0) * 100);
      const mpesa = Math.round((parseFloat(splitMpesa || '0') || 0) * 100);
      const card  = Math.round((parseFloat(splitCard  || '0') || 0) * 100);
      if (cash + mpesa + card < totalAfterDiscount) {
        Alert.alert('Insufficient', `Split total is less than ${formatKES(totalAfterDiscount)}.`);
        return null;
      }
      const p: Array<{ method: string; amountCents: number; reference?: string }> = [];
      if (cash  > 0) p.push({ method: 'CASH',  amountCents: cash });
      if (mpesa > 0) p.push({ method: 'MPESA', amountCents: mpesa, reference: splitMpesaRef || undefined });
      if (card  > 0) p.push({ method: 'CARD',  amountCents: card });
      return p;
    }
    if (payMethod === 'MPESA_MANUAL' && !mpesaRef.trim()) {
      Alert.alert('Required', 'Please enter the M-Pesa transaction code.');
      return null;
    }
    if (payMethod === 'BANK_TRANSFER' && !bankRef.trim()) {
      Alert.alert('Required', 'Please enter the bank transfer reference.');
      return null;
    }
    if (payMethod === 'CASH' && tendered < totalAfterDiscount) {
      Alert.alert('Insufficient', 'Amount tendered is less than the total.');
      return null;
    }
    const p: { method: string; amountCents: number; reference?: string } = {
      method: payMethod === 'MPESA_MANUAL' ? 'MPESA' : payMethod,
      amountCents: totalAfterDiscount,
    };
    if (payMethod === 'MPESA_MANUAL') p.reference = mpesaRef.trim();
    if (payMethod === 'BANK_TRANSFER') p.reference = bankRef.trim();
    return [p];
  }

  /** KRA eTIMS registration for a finished sale. Never throws: a failure means "pending", not "no receipt". */
  async function submitToEtims(saleId: string): Promise<Pick<PrintableReceipt, 'etimsSubmitted' | 'etimsControlNumber' | 'kraQRCode' | 'etimsTestMode'>> {
    try {
      const res = await Promise.race([
        mobileApi.post<{ success: boolean; controlNumber?: string; intrlData?: string; qrUrl?: string; testMode?: boolean }>(`/etims/submit/${saleId}`, {}),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
      ]);
      return {
        etimsSubmitted: res.success,
        etimsControlNumber: res.controlNumber,
        kraQRCode: res.qrUrl ?? res.intrlData ?? res.controlNumber,
        etimsTestMode: res.testMode === true,
      };
    } catch {
      return { etimsSubmitted: false };
    }
  }

  // ── completeSale mutation ───────────────────────────────────────────────────
  const { mutate: completeSale, isPending } = useMutation({
    mutationFn: async (payload: SalePayload) => {
      try {
        return await mobileApi.post<SaleResult>('/sales/checkout', payload);
      } catch (err) {
        const msg = (err as Error)?.message ?? '';
        if (msg.includes('Network request failed')) {
          // A table cannot be paid offline: the order has to be closed on the server, and a
          // queued sale would leave the table open for someone else to bill again.
          if (payload.orderId) throw new Error('No connection. The table is still open. Check your signal and try again.');
          await queueSale(payload.offlineId, payload);
          throw new Error('__OFFLINE__');
        }
        throw err;
      }
    },
    onSuccess: (result: SaleResult) => {
      attemptRef.current = null;
      qc.invalidateQueries({ queryKey: ['sales'] });
      if (orderMode) {
        qc.invalidateQueries({ queryKey: ['tables'] });
        qc.invalidateQueries({ queryKey: ['order'] });
        qc.invalidateQueries({ queryKey: ['kitchen'] });
      }
      // Deduct redeemed loyalty points against the created sale.
      if (customerId && redeemPoints > 0) {
        void mobileApi.post('/loyalty/redeem', { customerId, points: redeemPoints, saleId: result.id }).catch(() => {});
      }
      const snap: PrintableReceipt = {
        businessName: bizSettings?.name ?? 'Faida POS',
        receiptNumber: result.receiptNumber,
        dateISO: new Date().toISOString(),
        lines: billLines.map((l) => ({ name: l.name, quantity: l.quantity, unitPriceCents: unitPriceOf(l) })),
        subtotalCents: subtotal,
        taxLabel,
        taxCents: finalTax,
        totalCents: totalAfterDiscount,
        paymentMethod: payMethod,
        changeCents: payMethod === 'CASH' ? change : 0,
        cashierName: user?.name,
        etimsSubmitted: false,
      };
      setReceiptSnap(snap);
      setPrintError('');
      // Register the sale with KRA first, as the web till does, so the receipt carries the control
      // number and QR code. If KRA cannot be reached it prints a PENDING banner instead and the
      // batch submit picks the sale up later; the cashier is never held up for more than a few seconds.
      const autoPrint = printSettings?.enabled && printSettings.autoPrint && printSettings.method !== 'system';
      void submitToEtims(result.id).then((etims) => {
        const withEtims: PrintableReceipt = { ...snap, ...etims };
        setReceiptSnap(withEtims);
        if (autoPrint) void printNow(withEtims);
      });
      // A table payment must not wipe an unrelated sale the cashier has open in the cart.
      if (!orderMode) clearCart();
      setCompletedSale(result);
      setShowSuccess(true);
    },
    onError: (err: any) => {
      if (err?.message === '__OFFLINE__') {
        attemptRef.current = null; // the queued copy carries the key; the next sale starts fresh
        Alert.alert('Saved Offline', 'Sale saved to offline queue and will sync when back online.', [
          { text: 'OK', onPress: () => { clearCart(); router.replace('/(tabs)/pos' as any); } },
        ]);
      } else {
        Alert.alert('Sale Failed', err?.message ?? 'Could not complete the sale. Please try again.');
      }
    },
  });

  /**
   * One idempotency key per checkout ATTEMPT, reused while the cashier retries the same sale (the response may
   * have been lost after the server recorded it) and replaced as soon as the sale changes or completes.
   */
  const attemptRef = useRef<{ key: string; signature: string } | null>(null);
  function offlineIdFor(signature: string): string {
    if (!attemptRef.current || attemptRef.current.signature !== signature) {
      attemptRef.current = { key: generateOfflineId(), signature };
    }
    return attemptRef.current.key;
  }

  function handleCompleteSale(
    overridePayments?: Array<{ method: string; amountCents: number; reference?: string }>
  ) {
    if (orderMode) {
      const payable = orderPayable(order);
      if (!payable.ok) { Alert.alert('Cannot take payment', payable.reason); return; }
    } else if (cartItems.length === 0) { Alert.alert('Empty Cart', 'No items in cart.'); return; }
    const payments = overridePayments ?? buildPayments();
    if (!payments) return;
    const signature = JSON.stringify([orderMode ? orderId : cartItems.map((i) => [i.id, i.quantity, i.unitPriceCents]), payments, totalAfterDiscount]);
    if (orderMode && orderId) {
      completeSale(buildOrderCheckout({
        offlineId: offlineIdFor(signature),
        businessId, storeId, cashierId, orderId, payments,
        discountCents: effectiveDiscount,
        serviceChargeCents,
        expectedTotalCents: totalAfterDiscount,
      }));
      return;
    }
    completeSale({
      offlineId: offlineIdFor(signature),
      businessId, storeId, cashierId,
      customerId: customerId ?? undefined,
      type: saleTypeFor(payments), priceLevel,
      items: checkoutLines.lines,
      payments,
      discountCents: saleDiscountCents > 0 ? saleDiscountCents : undefined,
      serviceChargeCents,
      promotionId: appliedPromotion?.id,
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  // A table's bill is only shown once it has loaded and is still payable: the amounts below
  // would otherwise read zero and invite a payment against nothing.
  const payable = orderPayable(order);
  const orderBlock = orderMode && !showSuccess
    ? (orderQ.isLoading ? 'loading' : payable.ok ? null : payable.reason)
    : null;
  if (orderBlock) {
    return (
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="arrow-back" size={22} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Checkout</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 12 }}>
          {orderBlock === 'loading'
            ? <ActivityIndicator size="large" color={Colors.primary} />
            : <Text style={{ fontSize: 15, color: Colors.textSecondary, textAlign: 'center' }}>{orderBlock}</Text>}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="arrow-back" size={22} color={Colors.text} />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>Checkout</Text>
            {orderMode && order?.table?.number
              ? <Text style={styles.headerSub}>Table {order.table.number}</Text>
              : customerName ? <Text style={styles.headerSub}>{customerName}</Text> : null}
          </View>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          {/* Order Summary */}
          <Text style={styles.sectionTitle}>Order Summary</Text>
          <View style={styles.card}>
            {billLines.map((item) => (
              <View key={item.id} style={styles.cartRow}>
                <Text style={styles.cartItemName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.cartItemQty}>{item.quantity}x</Text>
                <Text style={styles.cartItemTotal}>{formatKES(item.totalCents)}</Text>
              </View>
            ))}
            <View style={styles.divider} />
            {promoDiscount > 0 && (
              <View style={styles.summaryLine}>
                <Text style={[styles.summaryLabel, { color: Colors.success }]}>
                  Promo: {appliedPromotion?.name}
                </Text>
                <Text style={[styles.summaryValue, { color: Colors.success }]}>-{formatKES(promoDiscount)}</Text>
              </View>
            )}
            {taxType !== 'NONE' && taxCents > 0 && (
              <>
                <View style={styles.summaryLine}>
                  <Text style={styles.summaryLabel}>Subtotal (ex-tax)</Text>
                  <Text style={styles.summaryValue}>{formatKES(exTaxCents)}</Text>
                </View>
                <View style={styles.summaryLine}>
                  <Text style={styles.summaryLabel}>{taxLabel}</Text>
                  <Text style={styles.summaryValue}>{formatKES(taxCents)}</Text>
                </View>
              </>
            )}
            {serviceChargeCents > 0 && (
              <View style={styles.summaryLine}>
                <Text style={styles.summaryLabel}>Service charge ({bizSettings?.serviceChargeRate ?? 0}%)</Text>
                <Text style={styles.summaryValue}>{formatKES(serviceChargeCents)}</Text>
              </View>
            )}
          </View>

          {/* Loyalty redeem */}
          {customerId && availablePoints > 0 && pointValueCents > 0 && maxRedeemPoints > 0 && (
            <>
              <Text style={styles.sectionTitle}>Loyalty Points</Text>
              <TouchableOpacity style={styles.card} activeOpacity={0.8} onPress={() => setRedeemLoyalty((v) => !v)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Ionicons name={redeemLoyalty ? 'checkbox' : 'square-outline'} size={22} color={Colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.text }}>
                      Redeem {maxRedeemPoints} pts → −{formatKES(loyaltyDiscountCents || maxRedeemPoints * pointValueCents)}
                    </Text>
                    <Text style={{ fontSize: 12, color: Colors.textSecondary, marginTop: 1 }}>
                      {availablePoints} points available{customerName ? ` · ${customerName}` : ''}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            </>
          )}

          {/* Sale-level Discount */}
          <Text style={styles.sectionTitle}>Discount (Optional)</Text>
          <View style={styles.card}>
            <View style={styles.discountTypeRow}>
              {(['amount', 'percent'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.discountTypeBtn, discountType === t && styles.discountTypeBtnActive]}
                  onPress={() => setDiscountType(t)}>
                  <Text style={[styles.discountTypeBtnText, discountType === t && styles.discountTypeBtnTextActive]}>
                    {t === 'amount' ? 'KES Amount' : 'Percentage %'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.inputWrapper}>
              <Ionicons name="pricetag-outline" size={16} color={Colors.textSecondary} />
              <TextInput style={styles.input} value={discountInput} onChangeText={setDiscountInput}
                placeholder={discountType === 'amount' ? '0.00' : '0'}
                keyboardType="decimal-pad" placeholderTextColor={Colors.textSecondary} />
              <Text style={styles.inputSuffix}>{discountType === 'percent' ? '%' : 'KES'}</Text>
            </View>
            {effectiveDiscount > 0 && (
              <Text style={styles.discountPreview}>Discount: -{formatKES(effectiveDiscount)}</Text>
            )}
          </View>

          {/* Total */}
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatKES(totalAfterDiscount)}</Text>
          </View>

          {/* Payment Method tabs */}
          <Text style={styles.sectionTitle}>Payment Method</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 0 }}>
            {(orderMode ? methodsForOrder(PAYMENT_METHODS) : PAYMENT_METHODS).map((m) => (
              <TouchableOpacity
                key={m.key}
                style={[styles.methodBtn, payMethod === m.key && { borderColor: m.color, borderWidth: 2, backgroundColor: m.color + '12' }]}
                onPress={() => setPayMethod(m.key)}>
                <Ionicons name={m.icon as any} size={20} color={payMethod === m.key ? m.color : Colors.textSecondary} />
                <Text style={[styles.methodText, payMethod === m.key && { color: m.color, fontWeight: '700' }]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* ── CASH ── */}
          {payMethod === 'CASH' && (
            <View style={styles.card}>
              <Text style={styles.fieldLabel}>Amount Tendered (KES)</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="cash-outline" size={16} color={Colors.textSecondary} />
                <TextInput style={styles.input} value={amountTendered} onChangeText={setAmountTendered}
                  placeholder="0.00" keyboardType="decimal-pad" placeholderTextColor={Colors.textSecondary} />
              </View>
              {tendered >= totalAfterDiscount && tendered > 0 && (
                <View style={styles.changeRow}>
                  <Text style={styles.changeLabel}>Change</Text>
                  <Text style={styles.changeValue}>{formatKES(change)}</Text>
                </View>
              )}
              <View style={styles.quickAmounts}>
                {[totalAfterDiscount, 50000, 100000, 200000, 500000]
                  .filter((a) => a >= totalAfterDiscount).slice(0, 4)
                  .map((a) => (
                    <TouchableOpacity key={a} style={styles.quickBtn}
                      onPress={() => setAmountTendered((a / 100).toFixed(2))}>
                      <Text style={styles.quickBtnText}>{formatKES(a)}</Text>
                    </TouchableOpacity>
                  ))}
              </View>
            </View>
          )}

          {/* ── M-PESA STK ── */}
          {payMethod === 'MPESA_STK' && (
            <MpesaSTKPanel
              totalCents={totalAfterDiscount}
              businessId={businessId}
              onComplete={(payments) => handleCompleteSale(payments)}
            />
          )}

          {/* ── M-PESA MANUAL ── */}
          {payMethod === 'MPESA_MANUAL' && (
            <View style={styles.card}>
              <Text style={styles.fieldLabel}>M-Pesa Transaction Code *</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="phone-portrait-outline" size={16} color={Colors.textSecondary} />
                <TextInput style={styles.input} value={mpesaRef} onChangeText={setMpesaRef}
                  placeholder="e.g. QJ12345XYZ" autoCapitalize="characters" autoCorrect={false}
                  placeholderTextColor={Colors.textSecondary} />
              </View>
              <Text style={styles.fieldHint}>Ask customer for the M-Pesa SMS confirmation code.</Text>
            </View>
          )}

          {/* ── CARD ── */}
          {payMethod === 'CARD' && (
            <View style={styles.card}>
              <View style={styles.infoNotice}>
                <Ionicons name="information-circle-outline" size={18} color={Colors.primary} />
                <Text style={styles.infoNoticeText}>
                  Process card payment on terminal. Full amount: {formatKES(totalAfterDiscount)}
                </Text>
              </View>
            </View>
          )}

          {/* ── BANK TRANSFER ── */}
          {payMethod === 'BANK_TRANSFER' && (
            <View style={styles.card}>
              <Text style={styles.fieldLabel}>Bank Transfer Reference *</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="business-outline" size={16} color={Colors.textSecondary} />
                <TextInput style={styles.input} value={bankRef} onChangeText={setBankRef}
                  placeholder="Transfer reference / slip no." autoCorrect={false}
                  placeholderTextColor={Colors.textSecondary} />
              </View>
            </View>
          )}

          {/* ── GIFT CARD ── */}
          {payMethod === 'GIFT_CARD' && (
            <GiftCardPanel
              totalCents={totalAfterDiscount}
              onComplete={(payments) => handleCompleteSale(payments)}
            />
          )}

          {/* ── CREDIT ── */}
          {payMethod === 'CREDIT' && (
            <CreditPanel
              totalCents={totalAfterDiscount}
              customerId={customerId}
              customerName={customerName}
              businessId={businessId}
              onComplete={(payments) => handleCompleteSale(payments)}
            />
          )}

          {/* ── SPLIT ── */}
          {payMethod === 'SPLIT' && (
            <View style={styles.card}>
              <Text style={styles.fieldLabel}>Split Payment Amounts</Text>
              <Text style={styles.fieldHint}>Total to cover: {formatKES(totalAfterDiscount)}</Text>
              {[
                { label: 'Cash', value: splitCash, setter: setSplitCash },
                { label: 'M-Pesa', value: splitMpesa, setter: setSplitMpesa },
                { label: 'Card', value: splitCard, setter: setSplitCard },
              ].map(({ label, value, setter }) => (
                <View key={label} style={styles.splitField}>
                  <Text style={styles.splitLabel}>{label}</Text>
                  <View style={[styles.inputWrapper, { flex: 1 }]}>
                    <TextInput style={styles.input} value={value} onChangeText={setter}
                      placeholder="0.00" keyboardType="decimal-pad" placeholderTextColor={Colors.textSecondary} />
                    <Text style={styles.inputSuffix}>KES</Text>
                  </View>
                </View>
              ))}
              {parseFloat(splitMpesa || '0') > 0 && (
                <View style={styles.splitField}>
                  <Text style={styles.splitLabel}>M-Pesa Code</Text>
                  <View style={[styles.inputWrapper, { flex: 1 }]}>
                    <TextInput style={styles.input} value={splitMpesaRef} onChangeText={setSplitMpesaRef}
                      placeholder="Transaction code" autoCapitalize="characters"
                      placeholderTextColor={Colors.textSecondary} />
                  </View>
                </View>
              )}
              <View style={styles.changeRow}>
                <Text style={styles.changeLabel}>
                  {splitTotal >= totalAfterDiscount ? 'Covered' : 'Remaining'}
                </Text>
                <Text style={[styles.changeValue, { color: splitTotal >= totalAfterDiscount ? Colors.success : Colors.error }]}>
                  {splitTotal >= totalAfterDiscount
                    ? formatKES(splitTotal)
                    : `-${formatKES(totalAfterDiscount - splitTotal)}`}
                </Text>
              </View>
            </View>
          )}

        </ScrollView>

        {/* Complete Sale button — hidden for STK/Gift Card/Credit (they self-complete) */}
        {!['MPESA_STK', 'GIFT_CARD', 'CREDIT'].includes(payMethod) && (
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.completeBtn, isPending && { opacity: 0.7 }]}
              onPress={() => handleCompleteSale()}
              disabled={isPending}
              activeOpacity={0.85}>
              {isPending ? <ActivityIndicator color="#FFFFFF" /> : (
                <>
                  <Ionicons name="checkmark-circle" size={22} color="#FFFFFF" />
                  <Text style={styles.completeBtnText}>
                    Complete Sale · {formatKES(totalAfterDiscount)}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

      </KeyboardAvoidingView>

      {/* ── Success Modal ── */}
      <Modal visible={showSuccess} animationType="fade" transparent>
        <View style={styles.successOverlay}>
          <View style={styles.successCard}>
            <Ionicons name="checkmark-circle" size={72} color={Colors.success} />
            <Text style={styles.successTitle}>Sale Complete!</Text>
            {completedSale && (
              <>
                <Text style={styles.successReceipt}>Receipt #{completedSale.receiptNumber}</Text>
                <Text style={styles.successTotal}>{formatKES(completedSale.totalCents)}</Text>
              </>
            )}
            {payMethod === 'CASH' && change > 0 && (
              <View style={styles.changeCard}>
                <Text style={styles.changeCardLabel}>Change to give customer</Text>
                <Text style={styles.changeCardValue}>{formatKES(change)}</Text>
              </View>
            )}
            {printOn && printError !== '' && (
              <Text style={styles.printErrorText} accessibilityRole="alert">Receipt did not print: {printError}</Text>
            )}
            {printOn && receiptSnap && (
              <TouchableOpacity
                style={styles.printReceiptBtn}
                onPress={() => { void printNow(receiptSnap); }}
                activeOpacity={0.85}>
                <Ionicons name="print-outline" size={20} color={Colors.primary} />
                <Text style={styles.printReceiptBtnText}>Print Receipt</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.newSaleBtn}
              onPress={() => { setShowSuccess(false); setCompletedSale(null); router.replace((orderMode ? AFTER_ORDER_PAYMENT_ROUTE : '/(tabs)/pos') as any); }}
              activeOpacity={0.85}>
              <Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />
              <Text style={styles.newSaleBtnText}>{orderMode ? 'Back to tables' : 'New Sale'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: Colors.card, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  headerSub: { fontSize: 12, color: Colors.primary, marginTop: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 20 },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4,
  },
  card: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 14, gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  cartRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  cartItemName: { flex: 1, fontSize: 13, color: Colors.text },
  cartItemQty: { fontSize: 12, color: Colors.textSecondary, width: 24, textAlign: 'center' },
  cartItemTotal: { fontSize: 13, fontWeight: '700', color: Colors.text },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 4 },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  summaryLabel: { fontSize: 13, color: Colors.textSecondary },
  summaryValue: { fontSize: 13, fontWeight: '600', color: Colors.text },
  totalCard: {
    backgroundColor: Colors.primary, borderRadius: 14, padding: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  totalLabel: { fontSize: 16, color: '#FFFFFF99', fontWeight: '600' },
  totalValue: { fontSize: 28, fontWeight: '900', color: '#FFFFFF' },
  discountTypeRow: { flexDirection: 'row', gap: 8 },
  discountTypeBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center',
  },
  discountTypeBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '12' },
  discountTypeBtnText: { fontSize: 13, color: Colors.textSecondary },
  discountTypeBtnTextActive: { color: Colors.primary, fontWeight: '700' },
  discountPreview: { fontSize: 12, color: Colors.error, fontWeight: '600' },
  methodBtn: {
    alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card,
  },
  methodText: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500' },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.text },
  fieldHint: { fontSize: 11, color: Colors.textSecondary },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, gap: 8, backgroundColor: Colors.background,
  },
  input: { flex: 1, paddingVertical: 11, fontSize: 15, color: Colors.text },
  inputSuffix: { fontSize: 13, color: Colors.textSecondary },
  changeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  changeLabel: { fontSize: 14, color: Colors.textSecondary },
  changeValue: { fontSize: 18, fontWeight: '800', color: Colors.success },
  quickAmounts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  quickBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    backgroundColor: Colors.primary + '12', borderWidth: 1, borderColor: Colors.primary + '30',
  },
  quickBtnText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  infoNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.primary + '10', padding: 12, borderRadius: 10,
  },
  infoNoticeText: { flex: 1, fontSize: 13, color: Colors.primary },
  splitField: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  splitLabel: { fontSize: 12, color: Colors.textSecondary, width: 64 },
  footer: {
    padding: 16, backgroundColor: Colors.card,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  completeBtn: {
    backgroundColor: Colors.success, borderRadius: 14, paddingVertical: 16,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10,
    shadowColor: Colors.success, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 5,
  },
  completeBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  successOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  successCard: {
    backgroundColor: Colors.card, borderRadius: 24, padding: 32,
    width: '100%', alignItems: 'center', gap: 10,
  },
  successTitle: { fontSize: 24, fontWeight: '900', color: Colors.text },
  successReceipt: { fontSize: 14, color: Colors.textSecondary },
  successTotal: { fontSize: 30, fontWeight: '900', color: Colors.primary },
  changeCard: {
    backgroundColor: Colors.success + '12', borderRadius: 12, padding: 14,
    width: '100%', alignItems: 'center', gap: 4, marginTop: 4,
  },
  changeCardLabel: { fontSize: 13, color: Colors.textSecondary },
  changeCardValue: { fontSize: 26, fontWeight: '900', color: Colors.success },
  newSaleBtn: {
    backgroundColor: Colors.primary, borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 32,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 8, width: '100%', justifyContent: 'center',
  },
  newSaleBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  printReceiptBtn: {
    backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.primary,
    borderRadius: 12, paddingVertical: 13, paddingHorizontal: 32,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 12, width: '100%', justifyContent: 'center',
  },
  printErrorText: { color: Colors.error, fontSize: 13, fontWeight: '600', textAlign: 'center', marginBottom: 8, lineHeight: 18 },
  printReceiptBtnText: { color: Colors.primary, fontSize: 16, fontWeight: '700' },
});

// ─── Panel shared styles (used by MpesaSTKPanel, GiftCardPanel, CreditPanel) ──

const pStyles = StyleSheet.create({
  panel: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 14, gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.text },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, gap: 8, backgroundColor: Colors.background, height: 44,
  },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, fontSize: 15, color: Colors.text },
  actionBtn: {
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  actionBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.primary + '10', padding: 10, borderRadius: 10,
  },
  infoText: { flex: 1, fontSize: 12, color: Colors.text },
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.error + '10', padding: 10, borderRadius: 10,
  },
  errorText: { flex: 1, fontSize: 12, color: Colors.error },
  waitTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  waitSub: { fontSize: 13, color: Colors.textSecondary },
  gcCard: {
    backgroundColor: '#F5F3FF', borderRadius: 12, padding: 14, gap: 8,
    borderWidth: 1, borderColor: '#DDD6FE',
  },
  gcRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gcLabel: { fontSize: 13, color: Colors.textSecondary },
  gcValue: { fontSize: 14, fontWeight: '700', color: '#5B21B6' },
  creditGrid: { flexDirection: 'row', gap: 8 },
  creditCell: {
    flex: 1, backgroundColor: Colors.background, borderRadius: 10,
    padding: 10, alignItems: 'center', gap: 2,
    borderWidth: 1, borderColor: Colors.border,
  },
  creditCellLabel: { fontSize: 11, color: Colors.textSecondary },
  creditCellValue: { fontSize: 14, fontWeight: '800', color: Colors.text },
});
