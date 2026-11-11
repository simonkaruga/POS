import { useState, useCallback, useEffect, useRef } from 'react';
import { computeTaxes } from '@pos/shared';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Trash2, Plus, Minus, PauseCircle, PlayCircle, X,
  User, Star, Camera, AlertTriangle, Monitor, Zap, Hash,
  ShoppingCart, CreditCard, Smartphone, ChevronUp,
  RotateCcw, Package, Clock, CheckCircle2,
} from 'lucide-react';
import { BrowserMultiFormatReader as _unused } from '@zxing/browser'; // camera logic moved to CameraModal
import { api } from '../lib/api';
import { usePOSStore, type ApiItem, type PriceLevel } from '../stores/pos';
import { useAuthStore } from '../stores/auth';
import PaymentModal from '../components/PaymentModal';
import CameraModal from '../components/pos/CameraModal';
import HeldSalesModal from '../components/HeldSalesModal';
import CustomerSelectModal from '../components/CustomerSelectModal';
import PrintModal from '../components/PrintModal';
import type { ReceiptData } from '../lib/printer';
import { autoPrintReceipt, printErrorMessage } from '../lib/receiptPrint';
import { createAttemptKeys } from '../lib/checkoutKey';
import { canQueueOffline, submitSaleOrQueue } from '../lib/offlineSales';

// ─── Types ────────────────────────────────────────────────────

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
  payments: Array<{ method: string; amountCents: number; reference?: string }>;
  discountCents?: number;
  promotionId?: string;
  serviceChargeCents?: number;
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
}

interface Category {
  id: string;
  name: string;
  color?: string;
}

// ─── Helpers ─────────────────────────────────────────────────

/** The quantity typed before a scan ("3" then scan; "0.5" for half a kilo). Anything unusable means one. */
function scanQty(typed: string | undefined | null): number {
  const n = typed ? Math.round(parseFloat(typed) * 1000) / 1000 : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function fmt(cents: number): string {
  return (cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatKES(cents: number): string {
  return `KES ${fmt(cents)}`;
}

const PRICE_LEVEL_LABELS: Record<PriceLevel, string> = {
  RETAIL: 'Retail',
  WHOLESALE: 'Wholesale',
  VIP: 'VIP',
};

// Department icon map (category name → colour)
const DEPT_COLORS: Record<string, string> = {
  fresh: '#22c55e', dairy: '#5A91FF', beverages: '#f59e0b',
  bread: '#f97316', household: '#a78bfa', frozen: '#06b6d4',
  snacks: '#ec4899', cleaning: '#14b8a6', pharmacy: '#ef4444',
  electronics: '#8b5cf6', default: '#6b7280',
};

function deptColor(name: string | { id?: string; name?: string; color?: string } | null | undefined): string {
  const str = typeof name === 'object' ? (name?.name ?? '') : (name ?? '');
  const key = str.toLowerCase().split(' ')[0];
  return DEPT_COLORS[key] ?? DEPT_COLORS.default;
}

// ─── Component ───────────────────────────────────────────────

export default function SupermarketPOSPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const {
    cart, addToCart, removeFromCart, updateQuantity, updateDiscount, clearCart,
    priceLevel, setPriceLevel,
    customerId, customerName, setCustomer,
    heldSales, holdCurrentSale, resumeHeldSale, discardHeldSale,
  } = usePOSStore();

  const [scan, setScan] = useState('');
  const [qtyMultiplier, setQtyMultiplier] = useState('');   // typed on numpad before scan
  const [numpadBuffer, setNumpadBuffer] = useState('');      // numpad display buffer
  const [numpadMode, setNumpadMode] = useState<'qty' | 'plu'>('qty');
  const [showPayment, setShowPayment] = useState(false);
  const [showHeld, setShowHeld] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printNotice, setPrintNotice] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [_lastReceipt, setLastReceipt] = useState<SaleResult | null>(null);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [lastScanned, setLastScanned] = useState<ApiItem | null>(null);
  const [flashItem, setFlashItem] = useState<string | null>(null);   // itemId that just changed
  const [loyaltyDiscountApplied, setLoyaltyDiscountApplied] = useState(false);
  const [loyaltyDiscountCents, setLoyaltyDiscountCents] = useState(0);
  const [manualDiscountCents, setManualDiscountCents] = useState(0);
  const [customerPhone, setCustomerPhone] = useState<string | null>(null);
  const [customerKraPin, setCustomerKraPin] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [cartOpen, setCartOpen] = useState(false);   // phones: cart is a full-screen sheet
  const [now, setNow] = useState(new Date());

  const scanRef = useRef<HTMLInputElement>(null);

  const businessId = user?.businessId ?? '';
  const storeId = user?.storeId ?? '';

  // Clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Keep scan input focused
  useEffect(() => {
    if (!showPayment && !showHeld && !showCustomerModal && !showCamera) {
      scanRef.current?.focus();
    }
  }, [showPayment, showHeld, showCustomerModal, showCamera]);

  // ─── Data ───────────────────────────────────────────────────

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
    queryKey: ['items', businessId, effectiveStoreId, scan.length > 1 ? scan : ''],
    queryFn: () =>
      api.get<ApiItem[]>(
        `/items?businessId=${businessId}${effectiveStoreId ? `&storeId=${effectiveStoreId}` : ''}${
          scan.length > 1 ? `&search=${encodeURIComponent(scan)}` : ''
        }`,
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

  const { data: businessSettings } = useQuery<{ name?: string; serviceChargeRate?: number; taxType?: string }>({
    queryKey: ['biz-settings', businessId],
    queryFn: () => api.get(`/business/${businessId}/settings`),
    enabled: !!businessId,
    staleTime: 5 * 60_000,
    select: (d: any) => ({ name: d.name, serviceChargeRate: d.serviceChargeRate ?? 10, taxType: d.taxType ?? 'VAT' }),
  });

  const { data: loyaltyData } = useQuery<{ loyaltyPoints: number; balanceCents: number; program?: { redemptionRate: number; minRedemption: number } } | null>({
    queryKey: ['loyalty-customer', customerId],
    queryFn: async () => {
      if (!customerId) return null;
      try {
        const [customer, program] = await Promise.all([
          api.get<{ id: string; phone?: string; kraPin?: string; loyaltyPoints: number; balanceCents: number }>(`/businesses/${businessId}/customers/${customerId}`),
          api.get<{ pointsPerCent: number; redemptionRate: number; minRedemption: number } | null>(`/loyalty/program?businessId=${businessId}`).catch(() => null),
        ]);
        if (customer?.phone) setCustomerPhone(customer.phone);
        if (customer?.kraPin) setCustomerKraPin(customer.kraPin); else setCustomerKraPin(null);
        return { loyaltyPoints: customer.loyaltyPoints ?? 0, balanceCents: customer.balanceCents ?? 0, program: program ?? undefined };
      } catch { return null; }
    },
    enabled: !!customerId && !!businessId,
  });

  // ─── Totals ─────────────────────────────────────────────────

  const subtotalCents = cart.reduce((s, i) => s + i.totalCents, 0);

  const cartItemIds = cart.map((i) => i.id);
  const appliedPromotion = activePromotions.find((p) => {
    if (p.minPurchaseCents && subtotalCents < p.minPurchaseCents) return false;
    const applicableItems: string[] = (() => { try { return JSON.parse(p.applicableItems) as string[]; } catch { return []; } })();
    if (applicableItems.length > 0 && !cartItemIds.some((id) => applicableItems.includes(id))) return false;
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
  // VAT line by line from each item's tax class (flour is exempt, milk standard-rated), the discount shared across
  // the lines: the same function the server uses, so the receipt matches what is recorded and sent to KRA.
  const vatCents = computeTaxes(
    cart.map((i) => ({ totalCents: i.totalCents, taxClass: i.taxClass })),
    Math.max(0, totalDiscountCents),
    { vatRegistered: (businessSettings?.taxType ?? 'VAT') === 'VAT' },
  ).vatCents;
  const totalCents = Math.max(0, taxBase);
  const totalItems = cart.reduce((s, i) => s + i.quantity, 0);

  useEffect(() => { if (cart.length === 0) setCartOpen(false); }, [cart.length]);

  // ─── Scan / Add item ─────────────────────────────────────────

  const addItemById = useCallback((item: ApiItem, qty = 1) => {
    const isOos = item.trackStock && (item.currentStock ?? 0) <= 0;
    const canOversell = !item.negativeStockPolicy || item.negativeStockPolicy !== 'BLOCK';
    if (isOos && canOversell) {
      toast.warning(`${item.name} is out of stock — added with negative stock`, { duration: 3000 });
    }
    for (let i = 0; i < qty; i++) addToCart(item);
    setLastScanned(item);
    setFlashItem(item.id);
    setTimeout(() => setFlashItem(null), 800);
    setScan('');
    setQtyMultiplier('');
    setNumpadBuffer('');
    scanRef.current?.focus();
  }, [addToCart]);

  const handleScanEnter = useCallback(() => {
    if (!scan.trim()) return;

    // "3×ItemName" or "3xItemName" syntax
    const multiMatch = scan.match(/^(\d+)[×x](.+)$/i);
    if (multiMatch) {
      const qty = parseInt(multiMatch[1], 10);
      const term = multiMatch[2].trim().toLowerCase();
      const found = items.find(
        (i) => i.name.toLowerCase().includes(term) || i.barcode === term || (i as any).sku === term,
      );
      if (found) { addItemById(found, qty); return; }
    }

    // Barcode exact match first
    const byBarcode = items.find((i) => i.barcode?.toLowerCase() === scan.trim().toLowerCase());
    if (byBarcode) {
      const qty = scanQty(qtyMultiplier);
      addItemById(byBarcode, qty);
      return;
    }

    // SKU exact match (ApiItem may not have sku, use barcode fallback)
    const bySku = items.find((i) => (i as any).sku?.toLowerCase() === scan.trim().toLowerCase());
    if (bySku) {
      const qty = scanQty(qtyMultiplier);
      addItemById(bySku, qty);
      return;
    }

    // Partial name match (first result)
    const byName = items.find((i) => i.name.toLowerCase().includes(scan.toLowerCase()));
    if (byName) {
      const qty = scanQty(qtyMultiplier);
      addItemById(byName, qty);
    }
  }, [scan, items, qtyMultiplier, addItemById]);

  // Numpad logic
  const numpadPress = (val: string) => {
    if (val === '⌫') {
      setNumpadBuffer((b) => b.slice(0, -1));
    } else if (val === 'CLR') {
      setNumpadBuffer('');
      setQtyMultiplier('');
    } else if (val === '×') {
      // confirm qty multiplier
      setQtyMultiplier(numpadBuffer);
      setNumpadBuffer('');
      scanRef.current?.focus();
    } else if (val === 'ENTER') {
      if (numpadMode === 'plu') {
        setScan(numpadBuffer);
        handleScanEnter();
        setNumpadBuffer('');
      }
      scanRef.current?.focus();
    } else {
      setNumpadBuffer((b) => (b.length < 8 ? b + val : b));
    }
  };

  // Camera barcode scanner
  const startCamera = useCallback(() => setShowCamera(true), []);

  // ─── Checkout ────────────────────────────────────────────────

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
        serviceChargeCents: 0,
        ...(totalDiscountCents > 0 && { discountCents: totalDiscountCents, promotionId: appliedPromotion?.id }),
      };
      payload.offlineId = attemptKeys.current.keyFor(
        JSON.stringify([payload.items, payload.payments, payload.type, payload.customerId, payload.discountCents, payload.serviceChargeCents]),
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

      // Broadcast sale complete to pole display
      try {
        const cashPayment = (checkoutMutation.variables ?? []).find((p) => p.method === 'CASH');
        const changeCents = cashPayment ? Math.max(0, cashPayment.amountCents - totalCents) : 0;
        const ch = new BroadcastChannel('pos-pole-display');
        ch.postMessage({
          businessName: businessSettings?.name ?? 'Faida POS',
          items: [],
          subtotalCents: 0,
          discountCents: 0,
          vatCents: 0,
          totalCents,
          status: 'complete',
          changeCents,
        });
        ch.close();
        // Return to idle after 4 seconds
        setTimeout(() => {
          try {
            const ch2 = new BroadcastChannel('pos-pole-display');
            ch2.postMessage({ businessName: businessSettings?.name ?? 'Faida POS', items: [], subtotalCents: 0, discountCents: 0, vatCents: 0, totalCents: 0, status: 'idle' });
            ch2.close();
          } catch { /* ignore */ }
        }, 4000);
      } catch { /* BroadcastChannel not supported */ }

      const gcPayment = (checkoutMutation.variables ?? []).find((p) => p.method === 'GIFT_CARD');
      if (gcPayment?.reference) {
        void api.post(`/gift-cards/${gcPayment.reference}/redeem`, { amountCents: gcPayment.amountCents, saleId: result.id });
      }

      if (customerId) {
        void qc.invalidateQueries({ queryKey: ['loyalty-customer', customerId] });
      }

      const pointsEarned = result.pointsEarned ?? 0;
      const loyaltyBalance = result.loyaltyBalance ?? 0;

      const receipt: ReceiptData = {
        receiptNumber: result.receiptNumber,
        businessName: businessSettings?.name ?? 'Faida POS',
        storeName: effectiveStoreName,
        date: new Date().toISOString(),
        cashierName: user?.name ?? 'Cashier',
        customerName: customerName ?? undefined,
        customerPhone: customerPhone ?? undefined,
        customerKraPin: customerKraPin ?? undefined,
        items: cart.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          totalCents: item.totalCents,
          discountPercent: item.discountPercent,
        })),
        subtotalCents,
        serviceChargeCents: 0,
        vatCents,
        totalCents,
        payments: checkoutMutation.variables ?? [],
        etimsSubmitted: false,
        saleId: offline ? undefined : result.id,
        ...(offline && { offlineSale: true }),
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
          // Print to the printer configured in Settings; show the picker only when none is set or it fails.
          void autoPrintReceipt(printReceipt)
            .then((printed) => { if (!printed) setShowPrintModal(true); })
            .catch((err) => {
              setPrintNotice(`Auto-print failed: ${printErrorMessage(err)}`);
              setReceiptData(printReceipt);
              setShowPrintModal(true);
            });
        });

      clearCart();
      setLastScanned(null);
      setCustomer(null, null);
      setLoyaltyDiscountApplied(false);
      setLoyaltyDiscountCents(0);
      setManualDiscountCents(0);
      setShowPayment(false);
      qc.invalidateQueries({ queryKey: ['items', businessId] });
    },
  });

  // ─── Pole Display Broadcast ───────────────────────────────────
  const businessNameForPole = businessSettings?.name ?? 'Faida POS';

  // Store businessId so PoleDisplayPage can fetch its config
  useEffect(() => {
    if (businessId) {
      try { sessionStorage.setItem('pos-business-id', businessId); } catch { /* ignore */ }
    }
  }, [businessId]);

  // Broadcast cart state whenever cart / totals change
  useEffect(() => {
    try {
      const ch = new BroadcastChannel('pos-pole-display');
      ch.postMessage({
        businessName: businessNameForPole,
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
        status: cart.length > 0 ? 'cart' : 'idle',
        customerName: customerName ?? undefined,
      });
      ch.close();
    } catch { /* BroadcastChannel not supported */ }
  }, [cart, subtotalCents, totalDiscountCents, vatCents, totalCents, customerName, businessNameForPole]);

  // Broadcast payment screen when modal opens
  useEffect(() => {
    if (!showPayment) return;
    try {
      const ch = new BroadcastChannel('pos-pole-display');
      ch.postMessage({
        businessName: businessNameForPole,
        items: cart.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, unitPriceCents: i.unitPriceCents, totalCents: i.totalCents })),
        subtotalCents,
        discountCents: totalDiscountCents,
        vatCents,
        totalCents,
        status: 'payment',
        customerName: customerName ?? undefined,
      });
      ch.close();
    } catch { /* BroadcastChannel not supported */ }
  }, [showPayment]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showPayment || showHeld || showCustomerModal) return;
      if (e.key === 'F1') { e.preventDefault(); if (cart.length > 0) setShowPayment(true); }
      if (e.key === 'F2') { e.preventDefault(); setShowCustomerModal(true); }
      if (e.key === 'F5') { e.preventDefault(); if (cart.length > 0) holdCurrentSale(); }
      if (e.key === 'F6') { e.preventDefault(); setShowHeld(true); }
      if (e.key === 'Escape') { e.preventDefault(); setScan(''); setNumpadBuffer(''); setQtyMultiplier(''); scanRef.current?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showPayment, showHeld, showCustomerModal, cart, holdCurrentSale]);

  useEffect(() => {
    setLoyaltyDiscountApplied(false);
    setLoyaltyDiscountCents(0);
    setCustomerPhone(null);
  }, [customerId]);

  // Session number
  const sessionNum = String(Date.now()).slice(-6);

  // Filtered items for department view
  const filteredItems = activeCategory === 'all' ? items : items.filter((i) => {
    const catId = typeof i.category === 'object' ? i.category?.id : i.category;
    return catId === activeCategory;
  });

  // ─── Render ──────────────────────────────────────────────────

  return (
    <div className="h-full w-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none">

      {/* ══════════════ TOP BAR ══════════════ */}
      <header className="flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-700 shrink-0 gap-2">
        {/* Left: brand + store */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-black text-white tracking-wide text-sm hidden sm:inline">Faida</span>
          </div>
          <div className="h-4 w-px bg-slate-700 hidden sm:block" />
          <span className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded font-mono shrink-0">
            #{sessionNum}
          </span>
        </div>

        {/* Centre: clock. The app header already shows the time from md up, so this is for phones only. */}
        <div className="flex md:hidden items-center gap-1.5 text-slate-300 shrink-0">
          <Clock className="w-3.5 h-3.5 text-slate-400 hidden sm:inline" />
          <span className="font-mono text-sm tabular-nums">
            {now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>

        {/* Right: cashier + held sales + pole display + nav */}
        <div className="flex items-center gap-1.5 shrink-0">
          {heldSales.length > 0 && (
            <button
              onClick={() => setShowHeld(true)}
              className="relative flex items-center gap-1 px-2 py-1.5 bg-amber-500/20 border border-amber-500/40 text-amber-400 rounded-lg text-xs font-medium hover:bg-amber-500/30 transition-colors"
            >
              <PauseCircle className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{heldSales.length} Held</span>
            </button>
          )}
          <button
            onClick={() => window.open('/pole-display', '_blank', 'width=1024,height=600')}
            className="hidden md:flex p-1.5 text-slate-400 hover:text-blue-400 rounded-lg transition-colors"
            title="Open pole display"
          >
            <Monitor className="w-4 h-4" />
          </button>
          <div className="flex md:hidden items-center gap-1.5 px-2 py-1.5 bg-slate-800 rounded-lg border border-slate-700">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-slate-300 hidden sm:inline">{user?.name ?? 'Cashier'}</span>
          </div>
          <button
            onClick={() => navigate('/sales-list')}
            className="hidden sm:block px-2 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
          >
            Sales
          </button>
        </div>
      </header>

      {/* ══════════════ MAIN BODY ══════════════ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ════ LEFT PANEL ════ */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden border-r border-slate-800">

          {/* ── Scan bar ── */}
          <div className="px-4 py-3 bg-slate-900 border-b border-slate-800">
            <div className="flex items-center gap-2">
              {/* Qty multiplier badge */}
              {qtyMultiplier && (
                <div className="flex items-center gap-1 bg-blue-600 px-3 py-2 rounded-lg text-sm font-bold shrink-0">
                  <span className="text-blue-200 text-xs">QTY</span>
                  <span>{qtyMultiplier}</span>
                  <span className="text-blue-300">×</span>
                </div>
              )}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  ref={scanRef}
                  type="text"
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleScanEnter(); }}
                  placeholder={qtyMultiplier ? `Scan item — QTY ${qtyMultiplier}× set` : 'Scan barcode, enter PLU code, or type item name…'}
                  className="w-full bg-slate-800 border border-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 rounded-xl pl-10 pr-12 py-2.5 text-sm text-slate-100 placeholder-slate-400 outline-none transition-all"
                  autoFocus
                />
                <button
                  onClick={() => void startCamera()}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-blue-400 transition-colors"
                  title="Camera scan"
                >
                  <Camera className="w-4 h-4" />
                </button>
              </div>
              {/* Price level selector */}
              <div className="flex rounded-lg overflow-hidden border border-slate-700 shrink-0">
                {(Object.entries(PRICE_LEVEL_LABELS) as [PriceLevel, string][]).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setPriceLevel(val)}
                    className={`px-2.5 py-2 text-xs font-semibold transition-colors ${
                      priceLevel === val
                        ? val === 'RETAIL'    ? 'bg-blue-600 text-white'
                        : val === 'WHOLESALE' ? 'bg-emerald-600 text-white'
                        :                      'bg-purple-600 text-white'
                        : 'text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Last scanned item flash */}
            {lastScanned && (
              <div className="mt-2.5 flex items-center gap-3 px-3 py-2 bg-emerald-950 border border-emerald-800 rounded-lg">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-emerald-300 text-sm font-medium truncate block">{lastScanned.name}</span>
                  {lastScanned.barcode && (
                    <span className="text-emerald-600 text-xs font-mono">{lastScanned.barcode}</span>
                  )}
                </div>
                <span className="text-emerald-400 text-sm font-bold shrink-0">
                  {formatKES(
                    priceLevel === 'WHOLESALE' && lastScanned.wholesalePriceCents
                      ? lastScanned.wholesalePriceCents
                      : priceLevel === 'VIP' && lastScanned.vipPriceCents
                      ? lastScanned.vipPriceCents
                      : lastScanned.retailPriceCents,
                  )}
                </span>
              </div>
            )}
          </div>

          {/* ── Department quick keys ── */}
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
              <button
                onClick={() => setActiveCategory('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border transition-all shrink-0 ${
                  activeCategory === 'all'
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                }`}
              >
                ALL DEPTS
              </button>
              {categories.filter((cat) => cat.name?.trim()).map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border transition-all shrink-0 ${
                    activeCategory === cat.id
                      ? 'text-white border-current'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                  }`}
                  style={activeCategory === cat.id ? { backgroundColor: deptColor(cat.name), borderColor: deptColor(cat.name) } : {}}
                >
                  {cat.name.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* ── Item grid (department browse) ── */}
          <div className="flex-1 overflow-y-auto p-2 lg:p-3">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
              {filteredItems.map((item) => {
                const price = priceLevel === 'WHOLESALE' && item.wholesalePriceCents
                  ? item.wholesalePriceCents
                  : priceLevel === 'VIP' && item.vipPriceCents
                  ? item.vipPriceCents
                  : item.retailPriceCents;
                const outOfStock = item.trackStock && (item.currentStock ?? 0) <= 0;
                const inCart = cart.find((c) => c.id === item.id);
                const isFlashing = flashItem === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (outOfStock) return;
                      const qty = scanQty(qtyMultiplier);
                      addItemById(item, qty);
                    }}
                    disabled={outOfStock}
                    className={`relative p-2.5 rounded-xl border text-left transition-all duration-150 ${
                      isFlashing
                        ? 'border-emerald-400 bg-emerald-900/50 scale-95'
                        : outOfStock
                        ? 'border-slate-800 bg-slate-900/30 opacity-40 cursor-not-allowed'
                        : inCart
                        ? 'border-blue-500/60 bg-blue-900/30 hover:bg-blue-900/50'
                        : 'border-slate-700 bg-slate-800/50 hover:bg-slate-700/60 hover:border-slate-500'
                    }`}
                  >
                    {inCart && (
                      <div className="absolute top-1.5 right-1.5 bg-blue-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                        {inCart.quantity}
                      </div>
                    )}
                    <div
                      className="w-full h-10 rounded-lg mb-2 flex items-center justify-center"
                      style={{ backgroundColor: deptColor(item.category ?? '') + '33', border: `1px solid ${deptColor(item.category ?? '')}44` }}
                    >
                      <Package className="w-5 h-5" style={{ color: deptColor(item.category ?? '') }} />
                    </div>
                    <p className="text-xs font-medium text-slate-200 leading-tight line-clamp-2 mb-1">{item.name}</p>
                    <p className="text-sm font-bold text-blue-400">{fmt(price)}</p>
                    {item.trackStock && (
                      <p className={`text-xs mt-0.5 ${outOfStock ? 'text-red-500' : 'text-slate-400'}`}>
                        {outOfStock ? 'Out of stock' : `${item.currentStock ?? 0} left`}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
            {filteredItems.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Package className="w-12 h-12 mb-3 opacity-20" />
                <p className="text-sm">No items in this department</p>
              </div>
            )}
          </div>

          {/* ── Numpad + shortcuts ── */}
          <div className="border-t border-slate-800 p-2 lg:p-3 bg-slate-900/80">
            <div className="flex gap-2 lg:gap-3">
              {/* Numpad — hidden on narrow screens */}
              <div className="hidden lg:block w-44 xl:w-48 shrink-0">
                {/* Display */}
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 font-mono text-right text-slate-200 text-sm min-h-[32px]">
                    {qtyMultiplier ? (
                      <span className="text-blue-400">{qtyMultiplier}× </span>
                    ) : null}
                    {numpadBuffer || <span className="text-slate-400">0</span>}
                  </div>
                  <div className="flex gap-1">
                    {(['qty', 'plu'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setNumpadMode(m)}
                        className={`px-2 py-1 text-xs rounded font-semibold transition-colors ${
                          numpadMode === m ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                        }`}
                      >
                        {m.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Keys */}
                <div className="grid grid-cols-3 gap-1">
                  {['7','8','9','4','5','6','1','2','3'].map((k) => (
                    <button key={k} onClick={() => numpadPress(k)}
                      className="py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-200 font-mono font-semibold text-sm transition-colors active:scale-95">
                      {k}
                    </button>
                  ))}
                  <button onClick={() => numpadPress('.')}
                    className="py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-200 font-mono font-semibold text-sm transition-colors active:scale-95">
                    .
                  </button>
                  <button onClick={() => numpadPress('0')}
                    className="py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-200 font-mono font-semibold text-sm transition-colors active:scale-95">
                    0
                  </button>
                  <button onClick={() => numpadPress('⌫')}
                    className="py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-400 font-mono text-sm transition-colors active:scale-95">
                    ⌫
                  </button>
                  <button onClick={() => numpadPress('×')}
                    className="col-span-2 py-2 bg-blue-700 hover:bg-blue-600 rounded-lg text-white font-bold text-xs tracking-wide transition-colors active:scale-95">
                    × SET QTY
                  </button>
                  <button onClick={() => numpadPress('CLR')}
                    className="py-2 bg-slate-600 hover:bg-slate-500 rounded-lg text-slate-300 font-mono text-xs transition-colors active:scale-95">
                    CLR
                  </button>
                </div>
              </div>

              {/* Quick action buttons */}
              <div className="flex-1 grid grid-cols-5 lg:grid-cols-2 gap-1 lg:gap-1.5 [&>button]:min-w-0 [&>button]:overflow-hidden [&>button]:px-0.5 [&>button]:py-1.5 lg:[&>button]:py-2.5 [&>button]:text-[10px] [&>button]:leading-tight [&>button]:text-center lg:[&>button]:text-xs">
                <button
                  onClick={() => { if (cart.length > 0) holdCurrentSale(); }}
                  disabled={cart.length === 0}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-slate-400 hover:text-amber-400 transition-colors disabled:opacity-30 text-xs font-medium"
                >
                  <PauseCircle className="w-5 h-5" />
                  Hold (F5)
                </button>
                <button
                  onClick={() => setShowHeld(true)}
                  className="relative flex flex-col items-center justify-center gap-1 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-slate-400 hover:text-emerald-400 transition-colors text-xs font-medium"
                >
                  {heldSales.length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                      {heldSales.length}
                    </span>
                  )}
                  <PlayCircle className="w-5 h-5" />
                  Resume (F6)
                </button>
                <button
                  onClick={() => {
                    const last = cart[cart.length - 1];
                    if (last) removeFromCart(last.id);
                  }}
                  disabled={cart.length === 0}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-slate-400 hover:text-red-400 transition-colors disabled:opacity-30 text-xs font-medium"
                >
                  <RotateCcw className="w-5 h-5" />
                  Void Last
                </button>
                <button
                  onClick={() => { if (cart.length > 0) { clearCart(); toast.info('Cart cleared'); } }}
                  disabled={cart.length === 0}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-slate-400 hover:text-red-500 transition-colors disabled:opacity-30 text-xs font-medium"
                >
                  <Trash2 className="w-5 h-5" />
                  Clear All
                </button>
                <button
                  onClick={() => setShowCustomerModal(true)}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-slate-400 hover:text-blue-400 transition-colors text-xs font-medium col-span-2"
                >
                  <User className="w-5 h-5" />
                  {customerName ? customerName : 'Customer (F2)'}
                </button>
              </div>
            </div>

            {/* Keyboard hints — desktop only */}
            <div className="hidden lg:flex gap-3 mt-2 text-xs text-slate-400 overflow-x-auto">
              <span><kbd className="bg-slate-700 text-slate-300 px-1 rounded">F1</kbd> Charge</span>
              <span><kbd className="bg-slate-700 text-slate-300 px-1 rounded">F2</kbd> Customer</span>
              <span><kbd className="bg-slate-700 text-slate-300 px-1 rounded">F5</kbd> Hold</span>
              <span><kbd className="bg-slate-700 text-slate-300 px-1 rounded">F6</kbd> Held</span>
              <span><kbd className="bg-slate-700 text-slate-300 px-1 rounded">Esc</kbd> Clear scan</span>
            </div>
          </div>
        </div>

        {/* ════ RIGHT PANEL — TRANSACTION ════ */}
        <div className={`${cartOpen ? 'flex' : 'hidden'} md:flex flex-col fixed inset-0 z-40 md:static md:inset-auto md:z-auto md:w-80 lg:w-96 xl:w-[420px] shrink-0 bg-slate-900 overflow-hidden`}>

          {/* Transaction header */}
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button onClick={() => setCartOpen(false)} aria-label="Back to products" className="md:hidden -ml-1 p-1.5 text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
              <ShoppingCart className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-semibold text-slate-300">TRANSACTION</span>
              <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
                {totalItems} item{totalItems !== 1 ? 's' : ''}
              </span>
              {appliedPromotion && (
                <span className="text-xs bg-emerald-900 text-emerald-400 border border-emerald-700 px-2 py-0.5 rounded font-semibold animate-pulse">
                  PROMO APPLIED
                </span>
              )}
            </div>
            {/* Customer chip */}
            {customerName ? (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-900/50 border border-blue-700/50 rounded-lg text-xs">
                <User className="w-3 h-3 text-blue-400" />
                <span className="text-blue-300 font-medium max-w-[100px] truncate">{customerName}</span>
                {loyaltyData && loyaltyData.loyaltyPoints > 0 && (
                  <span className="text-yellow-400 font-bold ml-1">{loyaltyData.loyaltyPoints}pts</span>
                )}
                <button onClick={() => setCustomer(null, null)} className="text-blue-600 hover:text-blue-400 ml-0.5" aria-label="Close">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : null}
          </div>

          {/* Cart — transaction tape */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 py-16">
                <ShoppingCart className="w-16 h-16 mb-4 opacity-20" />
                <p className="text-sm font-medium">No items scanned</p>
                <p className="text-xs mt-1">Scan a barcode to begin</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {/* Column headers */}
                <div className="hidden md:grid grid-cols-12 px-4 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider bg-slate-900 sticky top-0 z-10">
                  <div className="col-span-3">Item</div>
                  <div className="col-span-2 text-center">Qty</div>
                  <div className="col-span-4 text-center">Discount</div>
                  <div className="col-span-2 text-right">Unit</div>
                  <div className="col-span-1" />
                </div>
                {cart.map((item, idx) => {
                  const isNew = flashItem === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`grid grid-cols-12 gap-y-2 md:gap-y-0 items-center px-4 py-2.5 transition-all duration-300 ${
                        isNew ? 'bg-emerald-900/30' : idx % 2 === 0 ? 'bg-transparent' : 'bg-slate-800/20'
                      } hover:bg-slate-800/40 group`}
                    >
                      {/* Item name + SKU */}
                      <div className="col-span-7 md:col-span-3 order-1 md:order-none pr-1 min-w-0">
                        <p className="text-xs text-slate-200 font-medium leading-tight truncate">{item.name}</p>
                        {(item as any).sku && (
                          <p className="text-xs text-slate-400 font-mono truncate">{(item as any).sku}</p>
                        )}
                      </div>
                      {/* Qty controls */}
                      <div className="col-span-5 md:col-span-2 order-4 md:order-none flex items-center justify-start md:justify-center gap-1">
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="w-5 h-5 rounded bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-slate-400 hover:text-red-400 transition-colors" aria-label="Decrease">
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-sm font-bold text-slate-200 w-6 text-center tabular-nums">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          className="w-5 h-5 rounded bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-slate-400 hover:text-emerald-400 transition-colors" aria-label="Add">
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      {/* Item discount — bidirectional % ↔ KES */}
                      <div className="col-span-7 md:col-span-4 order-5 md:order-none flex items-center gap-0.5 px-0.5">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={item.discountPercent ? parseFloat(item.discountPercent.toFixed(1)) : ''}
                          onChange={(e) => updateDiscount(item.id, Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                          placeholder="0"
                          className="w-11 px-1 py-0.5 text-xs bg-slate-800 border border-slate-700 rounded text-orange-300 placeholder-slate-400 focus:ring-1 focus:ring-orange-500 outline-none text-right"
                        />
                        <span className="text-slate-400 text-[10px]">%</span>
                        <span className="text-slate-400 text-[10px]">/</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={item.discountPercent && item.discountPercent > 0
                            ? Math.round(item.unitPriceCents * item.quantity * item.discountPercent / 100 / 100)
                            : ''}
                          onChange={(e) => {
                            const amt = Math.max(0, parseFloat(e.target.value) || 0);
                            const base = item.unitPriceCents * item.quantity;
                            const pct = base > 0 ? Math.min(100, (amt * 100 / base) * 100) : 0;
                            updateDiscount(item.id, Math.round(pct * 10) / 10);
                          }}
                          placeholder="0"
                          className="w-12 px-1 py-0.5 text-xs bg-slate-800 border border-slate-700 rounded text-orange-300 placeholder-slate-400 focus:ring-1 focus:ring-orange-500 outline-none text-right"
                        />
                        <span className="text-slate-400 text-[10px]">K</span>
                      </div>
                      {/* Unit price */}
                      <div className="col-span-4 md:col-span-2 order-2 md:order-none text-right">
                        <span className="text-xs text-slate-400 tabular-nums">{fmt(item.unitPriceCents)}</span>
                        {item.discountPercent && item.discountPercent > 0 && (
                          <div className="text-emerald-400 text-[10px]">-{item.discountPercent}%</div>
                        )}
                      </div>
                      {/* Void */}
                      <div className="col-span-1 order-3 md:order-none flex justify-end">
                        <button
                          onClick={() => removeFromCart(item.id)}
                          className="w-5 h-5 rounded text-slate-400 hover:text-red-500 hover:bg-red-900/30 flex items-center justify-center opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-all" aria-label="Remove">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Totals panel ── */}
          <div className="border-t border-slate-700/60 px-4 pt-4 pb-3 bg-slate-900/80 space-y-2">
            <div className="flex justify-between text-[13px] text-slate-400">
              <span>Subtotal ({cart.length} line{cart.length !== 1 ? 's' : ''})</span>
              <span className="font-mono tabular-nums text-slate-400">KES {fmt(subtotalCents)}</span>
            </div>
            {promoDiscountCents > 0 && (
              <div className="flex justify-between text-[13px] text-emerald-400">
                <span className="flex items-center gap-1">
                  <ChevronUp className="w-3.5 h-3.5" />
                  {appliedPromotion?.name ?? 'Promo'}
                </span>
                <span className="font-mono tabular-nums">− KES {fmt(promoDiscountCents)}</span>
              </div>
            )}
            {/* Manual sale discount — bidirectional % ↔ KES */}
            <div className="space-y-1 py-1 border-y border-slate-800/60">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 text-xs whitespace-nowrap w-14">Discount</span>
                <div className="flex items-center gap-1 flex-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={subtotalCents > 0 ? parseFloat(((manualDiscountCents / subtotalCents) * 100).toFixed(1)) || '' : ''}
                    onChange={(e) => {
                      const pct = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0));
                      setManualDiscountCents(Math.round(subtotalCents * pct / 100));
                    }}
                    placeholder="0"
                    className="w-14 px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded text-orange-300 placeholder-slate-400 focus:ring-1 focus:ring-orange-500 focus:border-orange-500 outline-none text-right"
                  />
                  <span className="text-slate-400 text-xs">%</span>
                  <span className="text-slate-400 text-xs">/</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={manualDiscountCents > 0 ? (manualDiscountCents / 100).toFixed(0) : ''}
                    onChange={(e) => {
                      const amt = Math.max(0, parseFloat(e.target.value) || 0);
                      setManualDiscountCents(Math.min(Math.round(amt * 100), subtotalCents));
                    }}
                    placeholder="0"
                    className="w-16 px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded text-orange-300 placeholder-slate-400 focus:ring-1 focus:ring-orange-500 focus:border-orange-500 outline-none text-right"
                  />
                  <span className="text-slate-400 text-xs">KES</span>
                  {manualDiscountCents > 0 && (
                    <button onClick={() => setManualDiscountCents(0)} className="text-slate-400 hover:text-red-400 ml-auto" aria-label="Close">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {manualDiscountCents > 0 && (
                <div className="flex justify-between text-orange-400 text-[12px] font-semibold">
                  <span>Sale discount</span>
                  <span>− KES {fmt(manualDiscountCents)}</span>
                </div>
              )}
            </div>
            <div className="flex justify-between text-[12px] text-slate-400">
              <span>VAT (16% incl.)</span>
              <span className="font-mono tabular-nums">KES {fmt(vatCents)}</span>
            </div>
            <div className="flex justify-between items-center pt-3 border-t border-slate-700/60 mt-1">
              <span className="text-slate-400 text-[13px] font-bold uppercase tracking-widest">Total</span>
              <div className="text-right">
                <span className="text-[26px] font-black text-white tabular-nums leading-none">
                  KES {fmt(totalCents)}
                </span>
              </div>
            </div>

            {/* Loyalty redeem */}
            {loyaltyData && loyaltyData.loyaltyPoints > 0 && loyaltyData.program && (
              <button
                onClick={async () => {
                  if (loyaltyDiscountApplied) {
                    setLoyaltyDiscountApplied(false);
                    setLoyaltyDiscountCents(0);
                  } else {
                    try {
                      const result = await api.post<{ discountCents: number }>('/loyalty/redeem', {
                        customerId, points: loyaltyData.loyaltyPoints, saleId: 'preview',
                      });
                      setLoyaltyDiscountCents(result.discountCents);
                      setLoyaltyDiscountApplied(true);
                    } catch { /* no points */ }
                  }
                }}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors mt-1 ${
                  loyaltyDiscountApplied
                    ? 'bg-yellow-600 text-white'
                    : 'bg-yellow-900/30 border border-yellow-700/50 text-yellow-400 hover:bg-yellow-900/50'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5" />
                  {loyaltyDiscountApplied ? 'Loyalty applied' : `Redeem ${loyaltyData.loyaltyPoints} pts`}
                </div>
                {loyaltyDiscountApplied
                  ? <span>− KES {fmt(loyaltyDiscountCents)}</span>
                  : <span>= KES {fmt(Math.round((loyaltyData.loyaltyPoints * (loyaltyData.program?.redemptionRate ?? 0)) / 100))}</span>
                }
              </button>
            )}
          </div>

          {/* ── Payment buttons ── */}
          <div className="px-4 pb-4 pt-2 space-y-2.5 bg-slate-900/80">
            {/* Primary charge button */}
            <button
              onClick={() => { if (cart.length > 0) setShowPayment(true); }}
              disabled={cart.length === 0 || checkoutMutation.isPending}
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:opacity-40 rounded-xl text-white font-black text-lg uppercase tracking-widest transition-all active:scale-[0.98] shadow-xl shadow-blue-900/50 flex items-center justify-center gap-3"
            >
              {checkoutMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Processing…
                </span>
              ) : (
                <>
                  <Hash className="w-5 h-5" />
                  {cart.length > 0 ? `Charge  KES ${fmt(totalCents)}` : 'Charge Customer'}
                  <span className="text-blue-300 text-sm font-normal ml-1">F1</span>
                </>
              )}
            </button>

            {/* Quick digital-only shortcuts (exact amount — no change calc needed) */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  if (cart.length === 0) return;
                  checkoutMutation.mutate([{ method: 'MPESA', amountCents: totalCents }]);
                }}
                disabled={cart.length === 0 || checkoutMutation.isPending}
                className="flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-green-900/60 border border-slate-700 hover:border-green-600 disabled:opacity-40 rounded-xl text-slate-300 hover:text-green-400 font-semibold text-sm transition-all active:scale-95"
              >
                <Smartphone className="w-4 h-4" />
                Quick M-Pesa
              </button>
              <button
                onClick={() => {
                  if (cart.length === 0) return;
                  checkoutMutation.mutate([{ method: 'CARD', amountCents: totalCents }]);
                }}
                disabled={cart.length === 0 || checkoutMutation.isPending}
                className="flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-blue-900/60 border border-slate-700 hover:border-blue-600 disabled:opacity-40 rounded-xl text-slate-300 hover:text-blue-400 font-semibold text-sm transition-all active:scale-95"
              >
                <CreditCard className="w-4 h-4" />
                Quick Card
              </button>
            </div>

            {checkoutMutation.isError && (
              <div className="flex items-center gap-2 p-2 bg-red-900/40 border border-red-700 rounded-lg text-xs text-red-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {(checkoutMutation.error as Error).message}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Phone cart bar: opens the transaction sheet */}
      <button
        onClick={() => setCartOpen(true)}
        className="md:hidden shrink-0 flex items-center justify-between gap-3 px-4 py-3 bg-blue-600 active:bg-blue-700 text-white font-bold"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      >
        <span className="flex items-center gap-2">
          <ShoppingCart className="w-5 h-5" />
          {totalItems} item{totalItems !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1.5">
          KES {fmt(totalCents)}
          <ChevronUp className="w-4 h-4" />
        </span>
      </button>

      {/* ══════════════ CAMERA MODAL ══════════════ */}
      {showCamera && (
        <CameraModal
          onScan={(barcode) => { setScan(barcode); setShowCamera(false); }}
          onClose={() => setShowCamera(false)}
        />
      )}

      {/* ══════════════ MODALS ══════════════ */}
      {showPayment && (
        <PaymentModal
          totalCents={totalCents}
          onComplete={(payments) => checkoutMutation.mutate(payments)}
          onCancel={() => setShowPayment(false)}
          isProcessing={checkoutMutation.isPending}
          businessId={businessId}
          customerName={customerName}
          customerId={customerId}
        />
      )}

      {showHeld && (
        <HeldSalesModal
          heldSales={heldSales}
          onResume={(id) => { resumeHeldSale(id); setShowHeld(false); }}
          onDiscard={(id) => discardHeldSale(id)}
          onClose={() => setShowHeld(false)}
        />
      )}

      {showCustomerModal && (
        <CustomerSelectModal
          businessId={businessId}
          onSelect={(id, name) => { setCustomer(id, name); setShowCustomerModal(false); }}
          onClose={() => setShowCustomerModal(false)}
        />
      )}

      {showPrintModal && receiptData && (
        <PrintModal
          receipt={receiptData}
          onClose={() => { setShowPrintModal(false); setPrintNotice(''); setLastReceipt(null); setReceiptData(null); }}
          notice={printNotice || undefined}
        />
      )}
    </div>
  );
}
