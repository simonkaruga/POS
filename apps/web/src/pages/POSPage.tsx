import { useState, useCallback, useEffect, useRef } from 'react';
import { computeTaxes } from '@pos/shared';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MessageSquare, X, ShoppingCart, Clock, Printer, Rocket } from 'lucide-react';
import { PaidCheck } from '../components/ui/PaidCheck';
import { BrowserMultiFormatReader as _BrowserMultiFormatReader } from '@zxing/browser'; // kept for HW scanner
import { api } from '../lib/api';
import { usePOSStore, type ApiItem, type PriceLevel, type CartItem, type ItemUOM } from '../stores/pos';
import { useAuthStore } from '../stores/auth';
import PaymentModal from '../components/PaymentModal';
import HeldSalesModal from '../components/HeldSalesModal';
import CustomerSelectModal from '../components/CustomerSelectModal';
import PrintModal from '../components/PrintModal';
import ItemGrid from '../components/pos/ItemGrid';
import CartPanel from '../components/pos/CartPanel';
import AgeGateModal from '../components/pos/AgeGateModal';
import PriceOverrideModal from '../components/pos/PriceOverrideModal';
import ExpiryWarningModal from '../components/pos/ExpiryWarningModal';
import CameraModal from '../components/pos/CameraModal';
import type { ReceiptData } from '../lib/printer';
import { autoPrintReceipt, printErrorMessage, printWithPreferredPrinter } from '../lib/receiptPrint';
import { subscribeToEvent, SocketEvents } from '../lib/socket';
import { createAttemptKeys } from '../lib/checkoutKey';
import { canQueueOffline, submitSaleOrQueue } from '../lib/offlineSales';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SalePayload {
  /** Idempotency key: a retry of the same checkout never records a second sale. */
  offlineId?: string;
  storeId: string;
  businessId: string;
  cashierId: string;
  type: 'NORMAL' | 'CREDIT';
  priceLevel: PriceLevel;
  customerId?: string;
  items: Array<{ itemId: string; quantity: number }>;
  payments: Array<{ method: string; amountCents: number; reference?: string; roomNumber?: string }>;
  discountCents?: number;
  promotionId?: string;
  serviceChargeCents?: number;
  tipCents?: number;
}

interface Promotion {
  id: string;
  name: string;
  type: string;
  discountType: string;
  discountValue: number;
  minPurchaseCents?: number;
  maxDiscountCents?: number;
  applicableItems: string;
}

interface SaleResult {
  /** Empty for a sale saved offline: the server has not recorded it yet. */
  id: string;
  /** True when the sale was saved on this device and uploads when the connection is back. */
  queued?: boolean;
  receiptNumber: string;
  totalCents: number;
  pointsEarned?: number;
  loyaltyBalance?: number;
  monthlyTxCount?: number | null;
  freeTxLimit?: number | null;
}

interface Category {
  id: string;
  name: string;
  color?: string;
}

/**
 * GS1-128 EAN-13 weight/price embedded barcodes start with '2'.
 * Format: 2PPPPPWWWWWC (13 digits) — PPPPP=PLU, WWWWW=weight/price, C=check digit
 */
function parseGS1Weight(barcode: string): { plu: string; weightGrams: number; priceCents: number | null } | null {
  if (barcode.length !== 13 || !barcode.startsWith('2')) return null;
  const plu = barcode.slice(1, 6);
  const raw = barcode.slice(6, 11);
  const prefix = parseInt(barcode.slice(0, 2));
  if (prefix >= 20 && prefix <= 24) return { plu, weightGrams: parseInt(raw), priceCents: null };
  if (prefix >= 25 && prefix <= 29) return { plu, weightGrams: 0, priceCents: parseInt(raw) };
  return null;
}

function formatKES(cents: number) {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function POSPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const {
    cart, addToCart, addWeightedToCart, removeFromCart, updateQuantity, updateDiscount, updateUnitPrice, clearCart,
    priceLevel, setPriceLevel,
    customerId, customerName, setCustomer,
    heldSales, holdCurrentSale, resumeHeldSale, discardHeldSale,
  } = usePOSStore();

  // ─── UI state ─────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [showPayment, setShowPayment] = useState(false);
  const [showHeld, setShowHeld] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printNotice, setPrintNotice] = useState('');
  /** How many times each receipt has reached a printer on this terminal; the second print is a marked copy. */
  const printsRef = useRef<Record<string, number>>({});

  /** Print button: use the printer configured in Settings; only show the picker when none is set or it fails. */
  async function handlePrintClick() {
    if (!receiptData) return;
    try {
      // A second print of the same sale is a copy: marked as such, and it never opens the cash drawer.
      const copies = printsRef.current[receiptData.receiptNumber] ?? 0;
      const toPrint = copies > 0 ? { ...receiptData, copyNumber: copies } : receiptData;
      if (await printWithPreferredPrinter(toPrint, enableCashDrawer)) {
        printsRef.current[receiptData.receiptNumber] = copies + 1;
        return;
      }
    } catch (err) {
      setPrintNotice(`Could not print: ${printErrorMessage(err)}`);
    }
    setShowPrintModal(true);
  }
  const [showCartMobile, setShowCartMobile] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<SaleResult | null>(null);
  const [freeTxCount, setFreeTxCount] = useState<number | null>(null);
  const [showFreeLimitModal, setShowFreeLimitModal] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [serviceChargeEnabled, setServiceChargeEnabled] = useState(false);
  const [loyaltyDiscountApplied, setLoyaltyDiscountApplied] = useState(false);
  const [loyaltyDiscountCents, setLoyaltyDiscountCents] = useState(0);
  const [manualDiscountCents, setManualDiscountCents] = useState(0);
  const [customerPhone, setCustomerPhone] = useState<string | null>(null);
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [barcodeToast, setBarcodeToast] = useState<string | null>(null);
  const [uomPickerItem, setUomPickerItem] = useState<ApiItem | null>(null);
  const [tipInput, setTipInput] = useState('');
  const [expiryWarnings, setExpiryWarnings] = useState<Array<{ itemId: string; name: string; status: string; expiryDate?: string }>>([]);
  const [showExpiryWarning, setShowExpiryWarning] = useState(false);
  // Age gate
  const [pendingAgeItem, setPendingAgeItem] = useState<ApiItem | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  // Price override
  const [priceOverrideItem, setPriceOverrideItem] = useState<CartItem | null>(null);
  const [pendingC2BCount, setPendingC2BCount] = useState(0);
  // NPS
  const [showNPS, setShowNPS] = useState(false);
  const [lastSaleId, setLastSaleId] = useState('');
  const [pendingAutoLogout, setPendingAutoLogout] = useState(false);
  // Save as Invoice modal
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceCustomerName, setInvoiceCustomerName] = useState('');
  const [invoiceCustomerPhone, setInvoiceCustomerPhone] = useState('');
  const [invoiceValidUntil, setInvoiceValidUntil] = useState('');
  const [invoiceNotes, setInvoiceNotes] = useState('');

  const searchRef = useRef<HTMLInputElement>(null);

  const businessId = user?.businessId ?? '';
  const storeId = user?.storeId ?? '';

  // ─── Data queries ─────────────────────────────────────────────────────────

  const { data: firstStore } = useQuery<{ id: string; name: string }>({
    queryKey: ['first-store', businessId],
    queryFn: () =>
      api.get<Array<{ id: string; name: string }>>(`/business/${businessId}/stores`).then((s) => s[0] ?? null),
    enabled: !!businessId && !storeId,
    staleTime: Infinity,
  });
  const effectiveStoreId = storeId || firstStore?.id || '';
  const effectiveStoreName = firstStore?.name ?? 'Main Store';

  const { data: items = [] } = useQuery<ApiItem[]>({
    queryKey: ['items', businessId, effectiveStoreId],
    queryFn: () =>
      api.get<ApiItem[]>(
        `/items?businessId=${businessId}${effectiveStoreId ? `&storeId=${effectiveStoreId}` : ''}&activeOnly=true`,
      ),
    enabled: !!businessId,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories', businessId],
    queryFn: () => api.get<Category[]>(`/items/categories?businessId=${businessId}`),
    enabled: !!businessId,
  });

  const { data: activePromotions = [] } = useQuery<Promotion[]>({
    queryKey: ['active-promotions', businessId],
    queryFn: () => api.get<Promotion[]>(`/promotions/active?businessId=${businessId}`),
    enabled: !!businessId,
    staleTime: 60_000,
  });

  const { data: businessSettings } = useQuery<{
    displayCurrencies?: string;
    serviceChargeRate?: number;
    serviceChargeDefault?: boolean;
    taxType?: 'VAT' | 'TOT' | 'NONE';
    totRate?: number;
    name?: string;
    enableCashDrawer?: boolean;
    enableBarcodeScanner?: boolean;
    enablePoleDisplay?: boolean;
  }>({
    queryKey: ['business-settings-fx', businessId],
    queryFn: () => api.get(`/business/${businessId}/settings`),
    enabled: !!businessId,
    staleTime: 5 * 60_000,
    select: (d: any) => ({
      displayCurrencies: d.displayCurrencies,
      serviceChargeRate: typeof d.serviceChargeRate === 'number' ? d.serviceChargeRate : 10,
      serviceChargeDefault: d.serviceChargeDefault ?? false,
      taxType: d.taxType ?? 'VAT',
      totRate: typeof d.totRate === 'number' ? d.totRate : 3,
      name: d.name,
      enableCashDrawer: d.enableCashDrawer ?? false,
      enableBarcodeScanner: d.enableBarcodeScanner ?? true,
      enablePoleDisplay: d.enablePoleDisplay ?? false,
    }),
  });
  const serviceChargeRate = businessSettings?.serviceChargeRate ?? 10;
  const taxType = businessSettings?.taxType ?? 'VAT';
  const totRate = businessSettings?.totRate ?? 3;
  const enableCashDrawer = businessSettings?.enableCashDrawer ?? false;
  const enableBarcodeScanner = businessSettings?.enableBarcodeScanner ?? true;
  const enablePoleDisplay = businessSettings?.enablePoleDisplay ?? false;

  // ─── Clock In/Out ─────────────────────────────────────────────────────────

  const { data: clockStatus, refetch: refetchClock } = useQuery<{ isClockedIn: boolean; clockedInSince: string | null }>({
    queryKey: ['clock-status', businessId, user?.id],
    queryFn: () => api.get(`/hr/time-entries/status?businessId=${businessId}&userId=${user?.id}`),
    enabled: !!businessId && !!user?.id,
    refetchInterval: 60000,
  });

  const clockMut = useMutation({
    mutationFn: () => clockStatus?.isClockedIn
      ? api.post('/hr/time-entries/clock-out', { userId: user?.id, businessId })
      : api.post('/hr/time-entries/clock-in', { userId: user?.id, businessId, storeId: effectiveStoreId }),
    onSuccess: () => { void refetchClock(); },
  });

  function clockedInDuration(since: string | null): string {
    if (!since) return '';
    const mins = Math.floor((Date.now() - new Date(since).getTime()) / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // Sync service charge toggle from business default when settings first load
  const serviceChargeDefaultRef = useRef(false);
  useEffect(() => {
    if (businessSettings?.serviceChargeDefault !== undefined &&
        businessSettings.serviceChargeDefault !== serviceChargeDefaultRef.current) {
      serviceChargeDefaultRef.current = businessSettings.serviceChargeDefault;
      setServiceChargeEnabled(businessSettings.serviceChargeDefault);
    }
  }, [businessSettings?.serviceChargeDefault]);

  // C2B incoming payment badge
  useEffect(() => {
    if (!businessId) return;
    api.get<{ pendingCount: number }>(`/payments/mpesa/c2b/stats?businessId=${businessId}`)
      .then((s) => setPendingC2BCount(s.pendingCount))
      .catch(() => {});
    return subscribeToEvent(SocketEvents.MPESA_C2B_PAYMENT, () => {
      setPendingC2BCount((n) => n + 1);
    });
  }, [businessId]);

  const { data: fefoSuggestions = [] } = useQuery<Array<{ itemId: string; itemName: string; daysLeft: number | null; lotNumber: string; status: string }>>({
    queryKey: ['fefo-suggestions', effectiveStoreId, cart.map((c) => c.id).join(',')],
    queryFn: () => {
      const ids = cart.map((c) => c.id).join(',');
      return api.get(`/items/fefo-suggestions?storeId=${effectiveStoreId}&itemIds=${ids}`);
    },
    enabled: !!effectiveStoreId && cart.length > 0,
    staleTime: 30_000,
  });
  const fefoAlerts = fefoSuggestions.filter((s) => s.status !== 'OK' && s.daysLeft !== null && s.daysLeft >= 0);

  const { data: exchangeRateData } = useQuery<{ rates: Record<string, number>; displayCurrencies: string[] }>({
    queryKey: ['exchange-rates', businessId],
    queryFn: () => api.get(`/business/${businessId}/exchange-rates`),
    enabled: !!businessId,
    staleTime: 30 * 60_000,
    retry: false,
  });
  const fxRates: Record<string, number> = exchangeRateData?.rates ?? {};
  const activeCurrencies = (exchangeRateData?.displayCurrencies?.length ?? 0) > 0
    ? exchangeRateData!.displayCurrencies
    : (() => {
        try { return businessSettings?.displayCurrencies ? JSON.parse(businessSettings.displayCurrencies) : []; } catch { return []; }
      })();

  const { data: loyaltyData } = useQuery<{ loyaltyPoints: number; balanceCents: number; program?: { pointValueCents: number; minRedemption: number } } | null>({
    queryKey: ['loyalty-customer', customerId],
    queryFn: async () => {
      if (!customerId) return null;
      try {
        const [customer, program] = await Promise.all([
          api.get<{ id: string; phone?: string; loyaltyPoints: number; balanceCents: number }>(`/businesses/${businessId}/customers/${customerId}`),
          api.get<{ kesPerPoint: number; pointValueCents: number; minRedemption: number } | null>(`/loyalty/program?businessId=${businessId}`).catch(() => null),
        ]);
        if (customer?.phone) setCustomerPhone(customer.phone);
        return { loyaltyPoints: customer.loyaltyPoints ?? 0, balanceCents: customer.balanceCents ?? 0, program: program ?? undefined };
      } catch {
        return null;
      }
    },
    enabled: !!customerId && !!businessId,
  });

  useEffect(() => {
    setLoyaltyDiscountApplied(false);
    setLoyaltyDiscountCents(0);
    setCustomerPhone(null);
  }, [customerId]);

  // ─── Totals ───────────────────────────────────────────────────────────────

  const filteredItems = search
    ? items.filter(i => 
        i.name.toLowerCase().includes(search.toLowerCase()) || 
        i.barcode?.toLowerCase().includes(search.toLowerCase()) ||
        (i as any).sku?.toLowerCase().includes(search.toLowerCase())
      )
    : activeCategory === 'all' ? items : items.filter((i) => {
        const catId = typeof i.category === 'object' ? i.category?.id : i.category;
        return catId === activeCategory;
      });
  const subtotalCents = cart.reduce((s, i) => s + i.totalCents, 0);
  const serviceChargeCents = serviceChargeEnabled ? Math.round(subtotalCents * serviceChargeRate / 100) : 0;
  const cartItemIds = cart.map((i) => i.id);
  const appliedPromotion = activePromotions.find((p) => {
    if (p.minPurchaseCents && subtotalCents < p.minPurchaseCents) return false;
    const ids: string[] = (() => { try { return JSON.parse(p.applicableItems) as string[]; } catch { return []; } })();
    if (ids.length > 0 && !cartItemIds.some(id => ids.includes(id))) return false;
    return true;
  });
  const promoDiscountCents = (() => {
    if (!appliedPromotion || subtotalCents === 0) return 0;
    let d = appliedPromotion.discountType === 'PERCENTAGE'
      ? Math.round((subtotalCents * appliedPromotion.discountValue) / 100)
      : appliedPromotion.discountValue;
    if (appliedPromotion.maxDiscountCents && d > appliedPromotion.maxDiscountCents) d = appliedPromotion.maxDiscountCents;
    return d;
  })();
  const totalDiscountCents = promoDiscountCents + (loyaltyDiscountApplied ? loyaltyDiscountCents : 0) + manualDiscountCents;
  const taxBase = subtotalCents - totalDiscountCents;
  // VAT line by line from each item's tax class, the discount shared across the lines. This is the function the
  // server uses, so the receipt printed here is the same figure that is recorded and sent to KRA. A business that
  // is not VAT-registered has none.
  const vatCents = computeTaxes(
    cart.map((i) => ({ totalCents: i.totalCents, taxClass: i.taxClass })),
    Math.max(0, totalDiscountCents),
    { vatRegistered: taxType === 'VAT' },
  ).vatCents;
  const totCentsDisplay = taxType === 'TOT' ? Math.round(Math.max(taxBase, 0) * totRate / (100 + totRate)) : 0;
  const tipCents = Math.round(parseFloat(tipInput || '0') * 100);
  const totalCents = Math.max(0, taxBase) + serviceChargeCents + tipCents;

  // ─── Pole Display broadcast ───────────────────────────────────────────────
  useEffect(() => {
    try {
      const ch = new BroadcastChannel('pos-pole-display');
      ch.postMessage({
        businessName: businessSettings?.name ?? 'Faida POS',
        items: cart.map((i) => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents,
          totalCents: i.totalCents,
        })),
        subtotalCents,
        discountCents: totalDiscountCents,
        vatCents,
        totalCents,
        status: cart.length === 0 ? 'idle' : 'cart',
      });
      ch.close();
    } catch { /* non-critical */ }
  }, [cart, subtotalCents, vatCents, totalCents, totalDiscountCents, businessSettings?.name]);

  // Broadcast 'payment' status when payment modal opens
  useEffect(() => {
    if (!showPayment) return;
    try {
      const ch = new BroadcastChannel('pos-pole-display');
      ch.postMessage({
        businessName: businessSettings?.name ?? 'Faida POS',
        items: cart.map((i) => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents,
          totalCents: i.totalCents,
        })),
        subtotalCents,
        discountCents: totalDiscountCents,
        vatCents,
        totalCents,
        status: 'payment',
      });
      ch.close();
    } catch { /* non-critical */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPayment]);

  // ─── Save as Invoice ──────────────────────────────────────────────────────

  const saveAsInvoiceMutation = useMutation({
    mutationFn: () =>
      api.post('/sales/proformas', {
        businessId,
        storeId: effectiveStoreId,
        customerName: invoiceCustomerName || 'Walk-in',
        customerPhone: invoiceCustomerPhone || undefined,
        priceLevel,
        validUntil: invoiceValidUntil || undefined,
        notes: invoiceNotes || undefined,
        items: cart.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents,
          discountPercent: i.discountPercent ?? 0,
        })),
      }),
    onSuccess: () => {
      toast.success('Invoice saved as proforma — view it under Sales > Proformas');
      setShowInvoiceModal(false);
      setInvoiceCustomerName('');
      setInvoiceCustomerPhone('');
      setInvoiceValidUntil('');
      setInvoiceNotes('');
    },
    onError: (e: Error) => toast.error(`Failed to save invoice: ${e.message}`),
  });

  const handleOpenInvoiceModal = () => {
    setInvoiceCustomerName(customerName ?? '');
    setInvoiceCustomerPhone(customerPhone ?? '');
    setShowInvoiceModal(true);
  };

  // ─── Checkout ─────────────────────────────────────────────────────────────

  const attemptKeys = useRef(createAttemptKeys());

  const checkoutMutation = useMutation<SaleResult, Error, Array<{ method: string; amountCents: number; reference?: string }>>({
    // Run even with no connection. TanStack Query's default ('online') PAUSES a mutation while the browser is offline,
    // so this function never started, the till sat on "Processing..." and the offline queue in submitSaleOrQueue was
    // never reached. The sale then went out as a plain request after reconnect, with no OFF- receipt and nothing in
    // the offline-sales panel. submitSaleOrQueue decides what to do with no connection, so it has to run.
    networkMode: 'always',
    mutationFn: async (payments) => {
      const isCredit = payments.some((p) => p.method === 'CREDIT');
      const payload: SalePayload = {
        storeId: effectiveStoreId,
        businessId,
        cashierId: user?.id ?? '',
        type: isCredit ? 'CREDIT' : 'NORMAL',
        priceLevel,
        customerId: customerId ?? undefined,
        items: cart.map((i) => ({ itemId: i.id, quantity: i.quantity })),
        payments,
        serviceChargeCents,
        ...(tipCents > 0 && { tipCents }),
        ...(totalDiscountCents > 0 && { discountCents: totalDiscountCents, promotionId: appliedPromotion?.id }),
      };
      payload.offlineId = attemptKeys.current.keyFor(
        JSON.stringify([payload.items, payload.payments, payload.type, payload.customerId, payload.discountCents, payload.serviceChargeCents, payload.tipCents]),
      );
      const outcome = await submitSaleOrQueue<SaleResult, SalePayload & { offlineId: string }>(
        { ...payload, offlineId: payload.offlineId },
        {
          canQueue: canQueueOffline({ payments, loyaltyRedeemed: loyaltyDiscountApplied }),
          user: { id: user?.id ?? '', name: user?.name },
          totalCents,
          customerName: customerName ?? undefined,
        },
      );
      // A sale saved offline has no server id or receipt number yet: the till shows a provisional one.
      return outcome.queued
        ? { id: '', receiptNumber: outcome.provisionalNumber, totalCents, queued: true }
        : outcome.result;
    },
    onSuccess: (result) => {
      attemptKeys.current.reset();
      const offline = result.queued === true;
      if (offline) {
        toast.info(`Sale saved offline as ${result.receiptNumber}. It uploads by itself when the connection is back.`, { duration: 9000 });
      }

      const gcPayment = (checkoutMutation.variables ?? []).find((p) => p.method === 'GIFT_CARD');
      if (gcPayment?.reference) {
        void api.post(`/gift-cards/${gcPayment.reference}/redeem`, { amountCents: gcPayment.amountCents, saleId: result.id });
      }
      if (customerId) {
        void qc.invalidateQueries({ queryKey: ['loyalty-customer', customerId] });
      }

      const pointsEarned = result.pointsEarned ?? 0;
      const loyaltyBalance = result.loyaltyBalance ?? 0;
      console.log('[POS onSuccess] pointsEarned:', pointsEarned, 'loyaltyBalance:', loyaltyBalance, 'raw result.pointsEarned:', result.pointsEarned);
      if (result.monthlyTxCount != null) {
        setFreeTxCount(result.monthlyTxCount);
        if (result.freeTxLimit != null && result.monthlyTxCount >= result.freeTxLimit) {
          setShowFreeLimitModal(true);
        }
      }

      const receipt: ReceiptData = {
        receiptNumber: result.receiptNumber,
        businessName: businessSettings?.name ?? 'Faida POS',
        storeName: effectiveStoreName,
        date: new Date().toISOString(),
        cashierName: user?.name ?? 'Cashier',
        customerName: customerName ?? undefined,
        customerPhone: customerPhone ?? undefined,
        items: cart.map(item => ({
          name: item.name, quantity: item.quantity,
          unitPriceCents: item.unitPriceCents, totalCents: item.totalCents,
          discountPercent: item.discountPercent,
        })),
        subtotalCents, serviceChargeCents,
        vatCents,
        ...(totCentsDisplay > 0 && { totCents: totCentsDisplay }),
        ...(tipCents > 0 && { tipCents }),
        totalCents,
        payments: checkoutMutation.variables ?? [],
        etimsSubmitted: false,
        saleId: offline ? undefined : result.id,
        ...(offline && { offlineSale: true }),
        receiptHeader: (businessSettings as any)?.receiptHeader ?? undefined,
        receiptFooter: (businessSettings as any)?.receiptFooter ?? undefined,
        // Include loyalty data directly from API response — never depends on store state
        pointsEarned,
        loyaltyBalance,
        ...(checkoutMutation.variables?.some((p) => p.method === 'CREDIT') && {
          isCreditSale: true,
          previousBalanceCents: loyaltyData?.balanceCents ?? 0,
          newBalanceCents: (loyaltyData?.balanceCents ?? 0) - result.totalCents,
        }),
      };
      setReceiptData(receipt);

      // Keep a local copy so the auto-print includes the eTIMS QR once it resolves.
      let printReceipt: ReceiptData = receipt;

      (offline
        ? Promise.reject<{ success: boolean; controlNumber?: string; intrlData?: string; qrUrl?: string; testMode?: boolean }>(new Error('offline'))
        : api.post<{ success: boolean; controlNumber?: string; intrlData?: string; qrUrl?: string; testMode?: boolean }>(`/etims/submit/${result.id}`))
        .then((res) => {
          const etims = {
            etimsSubmitted: res.success,
            kraQRCode: res.qrUrl ?? res.intrlData ?? res.controlNumber,
            etimsControlNumber: res.controlNumber,
            etimsTestMode: res.testMode === true,
          };
          printReceipt = { ...printReceipt, ...etims };
          setReceiptData((prev) => prev ? { ...prev, ...etims } : prev);
        })
        .catch(() => {
          printReceipt = { ...printReceipt, etimsSubmitted: false };
          setReceiptData((prev) => prev ? { ...prev, etimsSubmitted: false } : prev);
        })
        .finally(() => {
          setLastReceipt(result);
          // Enterprise flow: print silently to the printer configured for this
          // terminal (Settings → Printers). Falls back to the picker only if the
          // device is unavailable, so a receipt is never silently lost.
          void autoPrintReceipt(printReceipt, enableCashDrawer).then((printed) => {
            if (printed) printsRef.current[printReceipt.receiptNumber] = 1;
          }).catch((err) => {
            setPrintNotice(`Auto-print failed: ${printErrorMessage(err)}`);
            setReceiptData(printReceipt);
            setShowPrintModal(true);
          });
        });

      try {
        const bizName = businessSettings?.name ?? 'Faida POS';
        const ch = new BroadcastChannel('pos-pole-display');
        ch.postMessage({ businessName: bizName, items: [], subtotalCents: 0, discountCents: 0, vatCents: 0, totalCents: result.totalCents, status: 'complete' });
        ch.close();
        setTimeout(() => {
          try {
            const ch2 = new BroadcastChannel('pos-pole-display');
            ch2.postMessage({ businessName: bizName, items: [], subtotalCents: 0, discountCents: 0, vatCents: 0, totalCents: 0, status: 'idle' });
            ch2.close();
          } catch { /* non-critical */ }
        }, 4000);
      } catch { /* non-critical */ }

      setLastSaleId(result.id);
      clearCart();
      setLoyaltyDiscountApplied(false);
      setLoyaltyDiscountCents(0);
      setManualDiscountCents(0);
      setTipInput('');
      setAgeConfirmed(false);
      setShowPayment(false);
      if (localStorage.getItem('pos-auto-logout-sale') === 'true') setPendingAutoLogout(true);
      setShowNPS(true);
      void qc.invalidateQueries({ queryKey: ['items'] });
    },
  });

  // ─── Expiry check ─────────────────────────────────────────────────────────

  const handlePayClick = async () => {
    if (cart.length === 0) return;
    const trackExpiry = cart.filter((i) => i.itemType === 'PRODUCT' || i.itemType === 'WEIGHTED');
    if (trackExpiry.length > 0 && effectiveStoreId) {
      try {
        const results = await api.post<Array<{ itemId: string; name: string; status: string; expiryDate?: string }>>(
          '/items/check-expiry',
          { itemIds: trackExpiry.map((i) => i.id), storeId: effectiveStoreId, businessId },
        );
        const issues = results.filter((r) => r.status !== 'OK');
        if (issues.length > 0) { setExpiryWarnings(issues); setShowExpiryWarning(true); return; }
      } catch { /* proceed if check fails */ }
    }
    setShowPayment(true);
  };

  // ─── Barcode / quick-entry ────────────────────────────────────────────────

  const handleBarcodeSearch = useCallback((raw: string) => {
    const qkMatch = raw.match(/^(\d+)[x×*](\d+)$/i);
    if (qkMatch) {
      const qty = parseInt(qkMatch[1]);
      const priceCents = parseInt(qkMatch[2]) * 100;
      const hit = items.find(i => i.retailPriceCents === priceCents);
      if (hit) { for (let k = 0; k < qty; k++) addToCart(hit); setSearch(''); return; }
    }
    const gs1 = parseGS1Weight(raw);
    if (gs1) {
      const hit = items.find(i => i.barcode?.toLowerCase() === gs1.plu.toLowerCase() || i.barcode?.toLowerCase().startsWith(gs1.plu.toLowerCase()) || (i.sku as any)?.toLowerCase() === gs1.plu.toLowerCase());
      if (hit) {
        const tareGrams = hit.tareWeightGrams ?? 0;
        if (gs1.weightGrams > 0) {
          const netGrams = Math.max(0, gs1.weightGrams - tareGrams);
          addWeightedToCart(hit, netGrams);
          const netKg = (netGrams / 1000).toFixed(3);
          const msg = tareGrams > 0 ? `Scanned: ${hit.name} — Net: ${netKg} kg (tare: ${(tareGrams / 1000).toFixed(3)} kg deducted)` : `Scanned: ${hit.name} — ${netKg} kg`;
          setBarcodeToast(msg); setTimeout(() => setBarcodeToast(null), 3500);
        } else if (gs1.priceCents !== null) {
          addWeightedToCart(hit, 0, gs1.priceCents);
          setBarcodeToast(`Scanned: ${hit.name} — KES ${(gs1.priceCents / 100).toFixed(2)}`);
          setTimeout(() => setBarcodeToast(null), 3500);
        }
        setSearch(''); return;
      }
    }
    // Case-insensitive barcode match (item-level barcode)
    const item = items.find(i => i.barcode?.toLowerCase() === raw.toLowerCase());
    if (item) { addToCart(item); setSearch(''); return; }
    // UOM-level barcode match (carton/bale/pack barcode)
    for (const apiItem of items) {
      if (apiItem.uoms) {
        const uomMatch = apiItem.uoms.find(u => u.barcode?.toLowerCase() === raw.toLowerCase());
        if (uomMatch) {
          addToCart(apiItem, uomMatch);
          setBarcodeToast(`Scanned: ${apiItem.name} (${uomMatch.unitName} — ${uomMatch.conversionFactor} units)`);
          setTimeout(() => setBarcodeToast(null), 3000);
          setSearch(''); return;
        }
      }
    }
    // No match — show the barcode in the search box so cashier can see what was scanned
    setSearch(raw);
    setBarcodeToast(`No item found for barcode: ${raw}`);
    setTimeout(() => setBarcodeToast(null), 3000);
  }, [items, addToCart, addWeightedToCart]);

  // ─── Camera barcode scanner ───────────────────────────────────────────────

  const startCamera = useCallback(() => setShowCamera(true), []);

  // ─── Hardware barcode scanner (keyboard-wedge) ────────────────────────────
  // Scanners type very fast (<50ms between chars) then send Enter.
  // Buffer keystrokes and flush on Enter if typed quickly enough.

  const barcodeBuffer = useRef('');
  const barcodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKeyTime = useRef(0);

  useEffect(() => {
    function onScanKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      // If user is typing in an input let it through normally
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const now = Date.now();
      const gap = now - lastKeyTime.current;
      lastKeyTime.current = now;

      // Scanners type chars with < 50ms gap; humans are > 100ms
      if (e.key === 'Enter' && barcodeBuffer.current.length >= 3) {
        // Flush buffer as barcode search
        const code = barcodeBuffer.current;
        barcodeBuffer.current = '';
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current);
        setSearch(code);
        searchRef.current?.focus();
        return;
      }

      if (e.key.length === 1 && gap < 80) {
        barcodeBuffer.current += e.key;
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current);
        // Auto-flush if no Enter comes within 200ms (some scanners omit Enter)
        barcodeTimer.current = setTimeout(() => {
          if (barcodeBuffer.current.length >= 3) {
            setSearch(barcodeBuffer.current);
            searchRef.current?.focus();
          }
          barcodeBuffer.current = '';
        }, 200);
      } else if (e.key.length === 1) {
        // Slow keystroke — not a scanner, reset buffer
        barcodeBuffer.current = '';
      }
    }
    window.addEventListener('keydown', onScanKey);
    return () => window.removeEventListener('keydown', onScanKey);
  }, []);

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    // "/" is a character a person can type, so it only jumps to the search box from outside a field.
    if (e.key === '/') {
      if (typing) return;
      e.preventDefault(); searchRef.current?.focus();
      return;
    }
    // Escape and the function keys type nothing, so they work from inside a field too. A cashier is usually in the
    // search box (scanning), and these used to do nothing there; Escape also could not close the customer picker.
    if (e.key === 'Escape') {
      setShowPayment(false); setShowHeld(false); setShowCustomerModal(false);
      setShowCamera(false); setLastReceipt(null);
      return;
    }
    if (!/^F[1-8]$/.test(e.key)) return;
    e.preventDefault(); // always: F1 is the browser's help, F3 find, F5 reload
    if (e.repeat) return; // holding a key down must not fire it again and again
    if (showPayment || showHeld || showCustomerModal || showCamera || lastReceipt) return; // a dialog is open
    if (e.key === 'F1') { if (cart.length > 0) void handlePayClick(); }
    else if (e.key === 'F2') setShowCustomerModal(true);
    else if (e.key === 'F3') setServiceChargeEnabled((v) => !v);
    else if (e.key === 'F4') { if (cart.length > 0) void handlePayClick(); }
    else if (e.key === 'F5') holdCurrentSale();
    else if (e.key === 'F6') setShowHeld(true);
    else if (e.key === 'F7') navigate('/proforma');
    else if (e.key === 'F8') navigate('/layaway');
  }, [cart.length, holdCurrentSale, navigate, showPayment, showHeld, showCustomerModal, showCamera, lastReceipt]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ─── Auto-logout after sale (when NPS modal closes) ─────────────────────
  useEffect(() => {
    if (pendingAutoLogout && !showNPS) {
      setPendingAutoLogout(false);
      logout();
    }
  }, [showNPS, pendingAutoLogout, logout]);

  // ─── Store businessId + Pole display broadcast ───────────────────────────

  useEffect(() => {
    if (businessId) { try { sessionStorage.setItem('pos-business-id', businessId); } catch { /* ignore */ } }
  }, [businessId]);

  useEffect(() => {
    if (!enablePoleDisplay) return;
    try {
      const channel = new BroadcastChannel('pos-pole-display');
      channel.postMessage({
        businessName: businessSettings?.name ?? 'Faida POS',
        items: cart.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, unitPriceCents: i.unitPriceCents, totalCents: i.totalCents })),
        subtotalCents, discountCents: totalDiscountCents, vatCents, totalCents,
        status: cart.length > 0 ? 'cart' : 'idle',
        customerName: customerName ?? undefined,
      });
      channel.close();
    } catch { /* BroadcastChannel not supported */ }
  }, [cart, subtotalCents, totalDiscountCents, vatCents, totalCents, customerName, enablePoleDisplay]);

  // ─── Loyalty toggle ───────────────────────────────────────────────────────

  const handleToggleLoyalty = async () => {
    if (loyaltyDiscountApplied) {
      setLoyaltyDiscountApplied(false);
      setLoyaltyDiscountCents(0);
    } else {
      try {
        const result = await api.post<{ discountCents: number }>('/loyalty/redeem', {
          customerId, points: loyaltyData?.loyaltyPoints, saleId: 'preview',
        });
        setLoyaltyDiscountCents(result.discountCents);
        setLoyaltyDiscountApplied(true);
      } catch { /* insufficient points */ }
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden flex-col md:flex-row relative bg-slate-950 text-slate-100">
      {/* GS1 barcode scan toast */}
      {barcodeToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-green-700 text-white px-6 py-3 rounded-xl shadow-lg text-sm font-medium max-w-sm text-center">
          {barcodeToast}
        </div>
      )}

      {/* Clock In/Out widget — top-right corner of item grid area */}
      <div className="fixed top-2 right-[224px] lg:right-[256px] xl:right-[288px] 2xl:right-[320px] z-40 hidden md:flex">
        <button
          onClick={() => clockMut.mutate()}
          disabled={clockMut.isPending}
          title={clockStatus?.isClockedIn ? 'Clock out' : 'Clock in'}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold shadow-lg transition-colors disabled:opacity-50 ${
            clockStatus?.isClockedIn
              ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
              : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          {clockStatus?.isClockedIn ? (
            <span>● Clocked In{clockStatus.clockedInSince ? ` · ${clockedInDuration(clockStatus.clockedInSince)}` : ''}</span>
          ) : (
            <span>○ Clock In</span>
          )}
        </button>
      </div>

      {/* Free tier transaction usage banner */}
      {freeTxCount !== null && (
        <div className={`fixed top-0 left-0 right-[224px] lg:right-[256px] xl:right-[288px] 2xl:right-[320px] z-30 flex items-center justify-between gap-3 px-4 py-1.5 text-xs font-semibold ${
          freeTxCount >= 200 ? 'bg-red-700 text-white' :
          freeTxCount >= 160 ? 'bg-amber-600 text-white' :
                               'bg-slate-700 text-slate-200'
        }`}>
          <span>
            Free plan: {freeTxCount}/200 transactions used this month
            {freeTxCount >= 160 && freeTxCount < 200 && ' — running low'}
            {freeTxCount >= 200 && ' — limit reached, upgrade to continue'}
          </span>
          <button onClick={() => setShowFreeLimitModal(true)} className="underline underline-offset-2 whitespace-nowrap hover:opacity-80">
            Upgrade to Starter →
          </button>
        </div>
      )}

      {/* Free tier limit reached modal */}
      {showFreeLimitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 max-w-md w-full shadow-2xl text-center">
            <Rocket className="w-12 h-12 text-blue-400 mx-auto mb-4" aria-hidden="true" />
            <h2 className="text-xl font-bold text-white mb-2">You've reached your free limit</h2>
            <p className="text-slate-400 text-sm mb-2">
              Your business has completed <span className="text-white font-semibold">200 transactions</span> this month — the maximum on the Free plan.
            </p>
            <p className="text-slate-400 text-sm mb-6">
              Upgrade to <span className="text-white font-semibold">Starter at KES 999/month</span> for unlimited transactions, M-Pesa payments, KRA eTIMS compliance, full reports, and more.
            </p>
            <div className="flex flex-col gap-3">
              <a
                href="/settings?tab=subscription"
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors"
              >
                Upgrade Now — KES 999/month
              </a>
              <button
                onClick={() => setShowFreeLimitModal(false)}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition-colors"
              >
                Continue (this month's sales are saved)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Left: Item Grid */}
      <ItemGrid
        items={filteredItems}
        categories={categories}
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
        priceLevel={priceLevel}
        setPriceLevel={setPriceLevel}
        search={search}
        setSearch={setSearch}
        searchRef={searchRef}
        ageConfirmed={ageConfirmed}
        heldSalesCount={heldSales.length}
        customerName={customerName}
        loyaltyData={loyaltyData}
        loyaltyDiscountApplied={loyaltyDiscountApplied}
        loyaltyDiscountCents={loyaltyDiscountCents}
        onAddItem={(item) => {
          const isOos = item.trackStock && (item.currentStock ?? 0) <= 0;
          const canOversell = !item.negativeStockPolicy || item.negativeStockPolicy !== 'BLOCK';
          if (isOos && canOversell) {
            toast.success(`${item.name} added (stock: ${item.currentStock ?? 0})`, { duration: 2000 });
          }
          // If item has multiple UOM options, show picker
          if (item.uoms && item.uoms.length > 1) {
            setUomPickerItem(item);
          } else {
            addToCart(item);
          }
        }}
        onBarcodeSearch={handleBarcodeSearch}
        onOpenCamera={() => void startCamera()}
        enableBarcodeScanner={enableBarcodeScanner}
        onSelectCustomer={() => setShowCustomerModal(true)}
        onClearCustomer={() => setCustomer(null, null)}
        onToggleLoyalty={() => void handleToggleLoyalty()}
        onAgeRestrictedItem={setPendingAgeItem}
      />

      {/* Right: Cart */}
      <CartPanel
        cart={cart}
        priceLevel={priceLevel}
        showCartMobile={showCartMobile}
        setShowCartMobile={setShowCartMobile}
        heldSalesCount={heldSales.length}
        onHold={() => holdCurrentSale()}
        onShowHeld={() => setShowHeld(true)}
        onClear={clearCart}
        onRemoveItem={removeFromCart}
        onUpdateQuantity={updateQuantity}
        onUpdateDiscount={updateDiscount}
        onOpenPriceOverride={setPriceOverrideItem}
        fefoAlerts={fefoAlerts}
        subtotalCents={subtotalCents}
        vatCents={vatCents}
        totCents={totCentsDisplay}
        taxType={taxType}
        promoDiscountCents={promoDiscountCents}
        appliedPromotion={appliedPromotion}
        serviceChargeEnabled={serviceChargeEnabled}
        setServiceChargeEnabled={setServiceChargeEnabled}
        serviceChargeRate={serviceChargeRate}
        serviceChargeCents={serviceChargeCents}
        tipInput={tipInput}
        setTipInput={setTipInput}
        tipCents={tipCents}
        totalCents={totalCents}
        fxRates={fxRates}
        activeCurrencies={activeCurrencies}
        manualDiscountCents={manualDiscountCents}
        setManualDiscountCents={setManualDiscountCents}
        isPaying={checkoutMutation.isPending}
        payError={checkoutMutation.error?.message}
        onPay={() => void handlePayClick()}
        onSaveAsInvoice={handleOpenInvoiceModal}
      />

      {/* Mobile bottom bar — sits above the MobileNav bottom tab bar */}
      <div className="md:hidden fixed left-0 right-0 z-40 shadow-2xl" style={{ bottom: 'calc(57px + env(safe-area-inset-bottom))' }}>
        {/* Cart summary strip */}
        {cart.length > 0 && (
          <div
            className="flex items-center justify-between px-4 py-2 bg-slate-800 border-t border-slate-700 cursor-pointer"
            onClick={() => setShowCartMobile(true)}
          >
            <div className="flex items-center gap-2">
              <span className="bg-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{cart.length} item{cart.length !== 1 ? 's' : ''}</span>
              <span className="text-slate-400 text-xs truncate" style={{ maxWidth: 'calc(100vw - 200px)' }}>
                {cart.slice(0, 2).map(i => i.name.split(' ')[0]).join(', ')}{cart.length > 2 ? ` +${cart.length - 2} more` : ''}
              </span>
            </div>
            <span className="text-slate-400 text-xs">View cart ›</span>
          </div>
        )}
        {/* Action bar */}
        <div className="flex border-t border-slate-800 bg-slate-900">
          <button
            onClick={() => setShowCartMobile(true)}
            className="flex items-center gap-2 px-3 py-3 bg-slate-800 border-r border-slate-700 min-w-[84px]"
          >
            <div className="relative">
              <ShoppingCart className="w-6 h-6 text-slate-300" />
              {cart.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-blue-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                  {cart.length}
                </span>
              )}
            </div>
            <div className="text-left">
              <p className="text-[10px] text-slate-400 leading-none">Cart</p>
              <p className="text-sm font-bold text-slate-100 leading-tight mt-0.5">{formatKES(totalCents)}</p>
            </div>
          </button>
          <button
            onClick={() => void handlePayClick()}
            disabled={cart.length === 0 || checkoutMutation.isPending}
            className="relative flex-1 py-3 font-bold text-sm xs:text-base transition-colors disabled:opacity-40"
            style={{ background: cart.length === 0 ? '#1e293b' : '#1F6BFF' }}
          >
            <span className="text-white">
              {checkoutMutation.isPending ? 'Processing…' : cart.length > 0 ? `Charge ${formatKES(totalCents)}` : 'Add items to pay'}
            </span>
            {pendingC2BCount > 0 && (
              <span className="absolute top-1 right-2 bg-green-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full animate-pulse">
                {pendingC2BCount} M-Pesa
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Modals ── */}
      {showPayment && (
        <PaymentModal
          totalCents={totalCents}
          onComplete={(payments) => {
            checkoutMutation.mutate(payments);
            setPendingC2BCount(0);
          }}
          onCancel={() => setShowPayment(false)}
          isProcessing={checkoutMutation.isPending}
          error={checkoutMutation.error?.message}
          businessId={businessId}
          customerName={customerName}
          customerId={customerId}
        />
      )}

      {showHeld && (
        <HeldSalesModal
          heldSales={heldSales}
          onResume={(id) => { resumeHeldSale(id); setShowHeld(false); }}
          onDiscard={discardHeldSale}
          onClose={() => setShowHeld(false)}
        />
      )}

      {showCustomerModal && (
        <CustomerSelectModal
          businessId={businessId}
          onSelect={(id, name) => setCustomer(id, name)}
          onClose={() => setShowCustomerModal(false)}
        />
      )}

      {/* Sale complete toast */}
      {lastReceipt && receiptData && (
        <div className="fixed inset-x-4 z-50 bg-green-600 text-white px-5 py-4 rounded-2xl shadow-2xl"
          style={{ bottom: 'calc(130px + env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <div className="font-bold text-base inline-flex items-center gap-2"><PaidCheck key={lastReceipt.receiptNumber} size={34} className="text-white" />{lastReceipt.queued ? 'Sale saved offline' : 'Sale Complete!'}</div>
              <div className="text-sm opacity-90 mt-0.5">{lastReceipt.queued ? 'Provisional receipt' : 'Receipt'} #{lastReceipt.receiptNumber}</div>
              {lastReceipt.queued && <div className="text-xs opacity-90 mt-0.5">It uploads by itself when the connection is back.</div>}
              <div className="text-sm font-bold mt-0.5">{formatKES(lastReceipt.totalCents)}</div>
            </div>
            <button
              onClick={() => { setLastReceipt(null); setReceiptData(null); }}
              className="p-1.5 bg-green-700 rounded-lg hover:bg-green-800 flex-shrink-0" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
          {receiptData && (receiptData.pointsEarned ?? 0) > 0 && (
            <div className="text-sm font-medium text-yellow-200 mb-2">
              +{receiptData.pointsEarned} pts earned · Balance: {(receiptData.loyaltyBalance ?? 0).toLocaleString()} pts
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => void handlePrintClick()}
              className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] py-2.5 bg-white text-green-600 rounded-xl text-sm font-bold hover:bg-green-50"
            >
              <Printer className="w-4 h-4" />
              Print Receipt
            </button>
            {customerPhone && (
              <button
                onClick={async () => {
                  setSendingWhatsApp(true);
                  try {
                    await api.post('/notifications/send-receipt', {
                      businessId, phone: customerPhone,
                      receiptNumber: lastReceipt.receiptNumber, totalCents: lastReceipt.totalCents,
                      channel: 'whatsapp',
                    });
                  } finally { setSendingWhatsApp(false); }
                }}
                disabled={sendingWhatsApp}
                className="px-4 py-2.5 bg-teal-500 rounded-xl hover:bg-teal-400 disabled:opacity-50 text-sm font-bold"
                title="Send WhatsApp receipt"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {showPrintModal && receiptData && (
        <PrintModal receipt={receiptData} onClose={() => { setShowPrintModal(false); setPrintNotice(''); }} enableCashDrawer={enableCashDrawer} notice={printNotice || undefined} />
      )}

      {pendingAgeItem && (
        <AgeGateModal
          item={pendingAgeItem}
          onConfirm={() => {
            setAgeConfirmed(true);
            addToCart(pendingAgeItem);
            setPendingAgeItem(null);
          }}
          onCancel={() => setPendingAgeItem(null)}
        />
      )}

      {priceOverrideItem && (
        <PriceOverrideModal
          item={priceOverrideItem}
          userRole={user?.role}
          businessId={businessId}
          onApply={(itemId, priceCents) => { updateUnitPrice(itemId, priceCents); setPriceOverrideItem(null); }}
          onCancel={() => setPriceOverrideItem(null)}
        />
      )}

      {showCamera && (
        <CameraModal
          onScan={(barcode) => { handleBarcodeSearch(barcode); setShowCamera(false); }}
          onClose={() => setShowCamera(false)}
        />
      )}

      {/* ── UOM / Packaging picker ─────────────────────────────────────────── */}
      {uomPickerItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-gray-900 dark:text-white text-base">Select Packaging</h3>
              <button onClick={() => setUomPickerItem(null)} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{uomPickerItem.name}</p>
            <div className="space-y-2">
              {(uomPickerItem.uoms ?? []).sort((a, b) => a.conversionFactor - b.conversionFactor).map((uom: ItemUOM) => {
                const basePrice = uomPickerItem.retailPriceCents;
                const displayPrice = uom.priceCents ?? Math.round(basePrice * uom.conversionFactor);
                const stock = uomPickerItem.currentStock ?? 0;
                const availableQty = uom.isBaseUnit ? stock : Math.floor(stock / uom.conversionFactor);
                return (
                  <button
                    key={uom.id}
                    onClick={() => {
                      addToCart(uomPickerItem, uom);
                      setUomPickerItem(null);
                    }}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 border-gray-200 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all group"
                  >
                    <div className="text-left">
                      <p className="font-semibold text-gray-900 dark:text-white group-hover:text-blue-700 dark:group-hover:text-blue-300">
                        {uom.unitName}
                        {uom.isBaseUnit && <span className="ml-1.5 text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-medium">base</span>}
                      </p>
                      <p className="text-xs text-gray-500">
                        {uom.isBaseUnit ? '1 unit' : `= ${uom.conversionFactor} base units`}
                        {uomPickerItem.trackStock && <span className={`ml-2 font-medium ${availableQty === 0 ? 'text-red-500' : 'text-green-600'}`}>{availableQty} in stock</span>}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-blue-600 dark:text-blue-400">KES {(displayPrice / 100).toLocaleString()}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => { addToCart(uomPickerItem); setUomPickerItem(null); }}
              className="mt-3 w-full py-2 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-50"
            >
              Add as single unit (base price)
            </button>
          </div>
        </div>
      )}

      {showExpiryWarning && expiryWarnings.length > 0 && (
        <ExpiryWarningModal
          warnings={expiryWarnings}
          onClose={() => setShowExpiryWarning(false)}
          onProceed={() => { setShowExpiryWarning(false); setShowPayment(true); }}
        />
      )}

      {/* ── Save as Invoice Modal ─────────────────────────────────────────── */}
      {showInvoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-gray-900 dark:text-white text-lg">Save as Proforma Invoice</h3>
              <button onClick={() => setShowInvoiceModal(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>

            {/* Line items preview */}
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 mb-4 max-h-40 overflow-y-auto">
              {cart.map((item) => (
                <div key={item.id} className="flex justify-between text-sm py-1">
                  <span className="text-gray-700 dark:text-gray-300 truncate mr-2">{item.quantity}× {item.name}</span>
                  <span className="text-gray-900 dark:text-white font-medium whitespace-nowrap">{formatKES(item.totalCents)}</span>
                </div>
              ))}
              <div className="border-t border-gray-200 dark:border-gray-700 mt-2 pt-2 flex justify-between font-bold text-sm">
                <span className="text-gray-900 dark:text-white">Total</span>
                <span className="text-blue-600">{formatKES(totalCents)}</span>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Customer Name *</label>
                <input
                  type="text"
                  value={invoiceCustomerName}
                  onChange={(e) => setInvoiceCustomerName(e.target.value)}
                  placeholder="e.g. Acme Ltd"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Customer Phone</label>
                <input
                  type="tel"
                  value={invoiceCustomerPhone}
                  onChange={(e) => setInvoiceCustomerPhone(e.target.value)}
                  placeholder="e.g. 0712345678"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Valid Until (optional)</label>
                <input
                  type="date"
                  value={invoiceValidUntil}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setInvoiceValidUntil(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" aria-label="Date" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes (optional)</label>
                <textarea
                  value={invoiceNotes}
                  onChange={(e) => setInvoiceNotes(e.target.value)}
                  rows={2}
                  placeholder="e.g. Delivery included, 30-day payment terms..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowInvoiceModal(false)}
                className="flex-1 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => saveAsInvoiceMutation.mutate()}
                disabled={!invoiceCustomerName.trim() || saveAsInvoiceMutation.isPending}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-sm disabled:opacity-40 transition-colors"
              >
                {saveAsInvoiceMutation.isPending ? 'Saving…' : 'Save Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNPS && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 max-w-sm w-full text-center">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">How was your experience?</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Rate from 0 (worst) to 10 (best)</p>
            <div className="flex gap-1 justify-center flex-wrap mb-4">
              {Array.from({ length: 11 }, (_, i) => i).map(score => (
                <button
                  key={score}
                  onClick={() => {
                    // Use plain fetch — NPS is a public endpoint, api.post would redirect on any 401
                    void fetch('/api/v1/nps', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ businessId, saleId: lastSaleId, score }),
                    }).catch(() => {});
                    setShowNPS(false);
                  }}
                  className={`w-9 h-9 rounded-lg text-sm font-bold transition-colors ${
                    score <= 6 ? 'bg-red-100 hover:bg-red-500 hover:text-white text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : score <= 8 ? 'bg-yellow-100 hover:bg-yellow-500 hover:text-white text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                    : 'bg-green-100 hover:bg-green-500 hover:text-white text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  }`}
                >
                  {score}
                </button>
              ))}
            </div>
            <button onClick={() => setShowNPS(false)} className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
