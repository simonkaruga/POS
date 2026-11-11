import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Receipt, Ban, Eye, RotateCcw, Printer, MessageSquare, MessageCircle, TrendingUp, CheckCircle2, Clock, Calendar, X, Search, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { openWhatsApp, buildReceiptMessage, normalisePhone } from '../lib/whatsapp';
import VoidModal from '../components/VoidModal';
import ReturnModal from '../components/ReturnModal';
import PrintModal from '../components/PrintModal';
import type { ReceiptData } from '../lib/printer';
import { printErrorMessage, printWithPreferredPrinter } from '../lib/receiptPrint';

interface Sale {
  id: string;
  receiptNumber: string;
  status: string;
  totalCents: number;
  createdAt: string;
  cashier: { name: string };
  customer?: { id: string; name: string; phone?: string };
  etimsSubmitted?: boolean;
  etimsControlNumber?: string;
}

interface VoidRecord {
  id: string;
  type: string;          // FULL_VOID | LINE_ITEM_VOID | RETURN
  authorizedBy: string;
  reason: string;
  voidedItemIds: string; // comma-separated SaleItem IDs
  refundAmountCents: number;
  createdAt: string;
}

interface SaleDetail extends Sale {
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
  }>;
  payments: Array<{
    method: string;
    amountCents: number;
    reference?: string;
  }>;
  subtotalCents: number;
  serviceChargeCents: number;
  discountCents: number;
  vatCents: number;
  totCents: number;
  voidRecords?: VoidRecord[];
}

type SalesRange = 'today' | 'week' | 'month' | 'custom';
type StatusFilter = 'ALL' | 'PAID' | 'VOIDED' | 'CANCELLED' | 'AMENDED';

function getSalesDateRange(range: SalesRange, from: string, to: string): { startDate: string; endDate: string } {
  const now = new Date();
  if (range === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }
  if (range === 'week') {
    const day = now.getDay();
    const start = new Date(now); start.setDate(now.getDate() - day); start.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }
  if (range === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }
  return { startDate: new Date(from).toISOString(), endDate: new Date(to + 'T23:59:59').toISOString() };
}

function SaleDetailModal({ saleId, businessId, onClose }: { saleId: string; businessId: string; onClose: () => void }) {
  const { data: sale, isLoading } = useQuery<SaleDetail>({
    queryKey: ['sale-detail', saleId],
    queryFn: () => api.get<SaleDetail>(`/sales/${saleId}?businessId=${businessId}`),
  });

  const formatKES = (cents: number) =>
    `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Sale Details</h2>
            {sale && <p className="text-sm text-gray-500 dark:text-gray-400">Receipt #{sale.receiptNumber}</p>}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors" aria-label="Close">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : sale ? (
            <div className="space-y-6">
              {/* Sale Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Date</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {new Date(sale.createdAt).toLocaleString('en-KE')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Cashier</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{sale.cashier?.name ?? 'N/A'}</p>
                </div>
                {sale.customer && (
                  <div className="col-span-2">
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Customer</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {sale.customer.name}
                      {sale.customer.phone && <span className="text-gray-500 ml-2">({sale.customer.phone})</span>}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Status</p>
                  <span className={`inline-flex px-2.5 py-1 text-xs font-semibold rounded-full ${
                    sale.status === 'PAID' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                    sale.status === 'VOIDED' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                    'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                  }`}>
                    {sale.status}
                  </span>
                </div>
                {sale.etimsControlNumber && (
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">KRA Control #</p>
                    <p className="text-sm font-mono font-medium text-gray-900 dark:text-white">{sale.etimsControlNumber}</p>
                  </div>
                )}
              </div>

              {/* Items */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Items</h3>
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Item</th>
                        <th className="px-4 py-2 text-center text-xs font-semibold text-gray-500 dark:text-gray-400">Qty</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Price</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {sale.items.map((item, i) => (
                        <tr key={i}>
                          <td className="px-4 py-3 text-gray-900 dark:text-white">{item.name}</td>
                          <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-300">{item.quantity}</td>
                          <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{formatKES(item.unitPriceCents)}</td>
                          <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">{formatKES(item.totalCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Subtotal</span>
                  <span className="font-medium text-gray-900 dark:text-white">{formatKES(sale.subtotalCents)}</span>
                </div>
                {sale.discountCents > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Discount</span>
                    <span className="font-medium text-green-600 dark:text-green-400">-{formatKES(sale.discountCents)}</span>
                  </div>
                )}
                {sale.vatCents > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">VAT (16% inclusive)</span>
                    <span className="font-medium text-gray-500 dark:text-gray-400">{formatKES(sale.vatCents)}</span>
                  </div>
                )}
                {sale.serviceChargeCents > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Service Charge (10%)</span>
                    <span className="font-medium text-gray-900 dark:text-white">{formatKES(sale.serviceChargeCents)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold border-t border-gray-200 dark:border-gray-700 pt-2">
                  <span className="text-gray-900 dark:text-white">Total</span>
                  <span className="text-blue-600 dark:text-blue-400">{formatKES(sale.totalCents)}</span>
                </div>
              </div>

              {/* Payments */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Payments</h3>
                <div className="space-y-2">
                  {sale.payments.map((payment, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{payment.method}</p>
                        {payment.reference && <p className="text-xs text-gray-500 dark:text-gray-400">Ref: {payment.reference}</p>}
                      </div>
                      <span className="text-sm font-bold text-gray-900 dark:text-white">{formatKES(payment.amountCents)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-center text-gray-500 dark:text-gray-400 py-12">Sale not found</p>
          )}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-medium rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SalesListPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printNotice, setPrintNotice] = useState('');
  const [reprintData, setReprintData] = useState<ReceiptData | null>(null);
  const [reprintLoading, setReprintLoading] = useState<string | null>(null);
  const [sendingWhatsApp, setSendingWhatsApp] = useState<string | null>(null);
  const [sendingSms, setSendingSms] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [expandedVoid, setExpandedVoid] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<SalesRange>('month');
  const [searchQuery, setSearchQuery] = useState('');
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().substring(0, 10);
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().substring(0, 10));

  const businessId = user?.businessId ?? '';
  const storeId = user?.storeId ?? '';

  const { startDate, endDate } = useMemo(
    () => getSalesDateRange(dateRange, customFrom, customTo),
    [dateRange, customFrom, customTo],
  );

  const { data: allSales = [], isLoading } = useQuery<Sale[]>({
    queryKey: ['sales', businessId, storeId, startDate, endDate, searchQuery],
    queryFn: () => {
      const params = new URLSearchParams({ businessId, limit: '500', startDate, endDate });
      if (storeId) params.append('storeId', storeId);
      if (searchQuery.trim()) params.append('receiptNumber', searchQuery.trim());
      return api.get<{ data: Sale[] }>(`/sales?${params.toString()}`).then(r => r.data);
    },
    enabled: !!businessId,
  });

  const { data: voidedReturns = [], isLoading: voidedLoading } = useQuery<SaleDetail[]>({
    queryKey: ['voided-returns', businessId, storeId, startDate, endDate],
    queryFn: () => {
      const params = new URLSearchParams({ businessId, startDate, endDate });
      if (storeId) params.append('storeId', storeId);
      return api.get<SaleDetail[]>(`/sales/voided-returns?${params.toString()}`);
    },
    enabled: !!businessId && statusFilter === 'VOIDED',
  });

  const sales = useMemo(() => {
    if (statusFilter === 'VOIDED') return [];
    if (statusFilter === 'ALL') return allSales;
    return allSales.filter(s => s.status === statusFilter);
  }, [allSales, statusFilter]);

  const formatKES = (cents: number) =>
    `KES ${(cents / 100).toLocaleString('en-KE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const STATUS_COLORS: Record<string, string> = {
    PAID: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    VOIDED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    AMENDED: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    CREDIT: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  };

  const handleReprint = async (sale: Sale) => {
    setReprintLoading(sale.id);
    try {
      const [detail, biz] = await Promise.all([
        api.get<SaleDetail>(`/sales/${sale.id}?businessId=${businessId}`),
        api.get<{ name?: string; storeName?: string }>(`/business/${businessId}/settings`).catch(() => ({})),
      ]);
      // Use customerId FK field — always present without needing the relation include
      const customerId = (detail as any).customerId ?? detail.customer?.id ?? sale.customer?.id;
      const loyaltyData = customerId
        ? await api.get<{ balance: number; transactions: Array<{ points: number; type: string; saleId?: string }> }>(`/loyalty/customer/${customerId}`).catch(() => null)
        : null;
      const isVoided = sale.status === 'VOIDED';
      // Submitting is idempotent: a sale KRA already accepted returns its control number and QR code, and one
      // that is still pending gets another attempt, so a reprint carries the same fiscal proof as the original.
      const etims = isVoided
        ? null
        : await api.post<{ success: boolean; controlNumber?: string; intrlData?: string; qrUrl?: string; testMode?: boolean }>(`/etims/submit/${sale.id}`).catch(() => null);
      const earnedTx = loyaltyData?.transactions.find(t => t.type === 'EARN' && t.saleId === sale.id);
      const receipt: ReceiptData = {
        receiptNumber: detail.receiptNumber,
        businessName: (biz as any)?.name ?? 'Faida POS',
        storeName: (biz as any)?.storeName ?? '',
        date: detail.createdAt,
        cashierName: detail.cashier?.name ?? 'Cashier',
        customerName: detail.customer?.name ?? (detail as any).customerName ?? undefined,
        customerPhone: detail.customer?.phone ?? (detail as any).customerPhone ?? undefined,
        items: detail.items.map(item => ({
          name: item.name,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          totalCents: item.totalCents,
        })),
        subtotalCents: detail.subtotalCents,
        serviceChargeCents: detail.serviceChargeCents,
        // Print the tax that was actually charged at checkout. This used to
        // re-derive VAT as 16/116 of the subtotal whenever totCents was 0,
        // which has no NONE branch — so a business with tax turned off
        // reprinted receipts showing VAT it never charged (KES 20 → 2.76).
        vatCents: detail.vatCents,
        totCents: detail.totCents,
        totalCents: detail.totalCents,
        payments: detail.payments,
        kraControlNumber: detail.etimsControlNumber,
        etimsControlNumber: etims?.controlNumber ?? detail.etimsControlNumber,
        etimsTestMode: etims?.testMode === true,
        kraQRCode: etims?.success ? (etims.qrUrl ?? etims.intrlData ?? etims.controlNumber) : undefined,
        etimsSubmitted: isVoided ? undefined : (etims ? etims.success : detail.etimsSubmitted),
        voided: isVoided,
        saleId: detail.id,
        pointsEarned: earnedTx?.points ?? 0,
        loyaltyBalance: loyaltyData?.balance ?? 0,
        // A receipt printed from the sales list is never the original.
        copyNumber: 1,
      };
      // Reprint to the printer configured in Settings; fall back to the picker when none is set or it fails.
      try {
        if (await printWithPreferredPrinter(receipt)) return;
      } catch (err) {
        setPrintNotice(`Could not print: ${printErrorMessage(err)}`);
      }
      setReprintData(receipt);
      setShowPrintModal(true);
    } catch (err) {
      console.error('Failed to load sale for reprint:', err);
    } finally {
      setReprintLoading(null);
    }
  };

  /** Africa's Talking, i.e. an actual SMS — its WhatsApp channel needs a Meta
   *  business approval the account does not have, so it silently falls back to SMS.
   *  Labelled SMS here so nobody thinks a WhatsApp message went out. */
  const handleSendSms = async (sale: Sale) => {
    if (!sale.customer?.phone) return;
    setSendingSms(sale.id);
    try {
      const res = await api.post<{ success?: boolean; error?: string }>('/notifications/send-receipt', {
        businessId,
        phone: sale.customer.phone,
        receiptNumber: sale.receiptNumber,
        totalCents: sale.totalCents,
        channel: 'sms',
      });
      // The endpoint answers 200 with success:false when messaging is unconfigured,
      // so a silent "sent" would be a lie.
      if (res?.success === false) {
        toast.error(res.error === 'Messaging not configured'
          ? 'SMS is not set up — add Africa’s Talking credentials in Settings.'
          : res.error ?? 'Could not send the SMS.');
      } else {
        toast.success(`Receipt sent to ${sale.customer.phone}`);
      }
    } catch (err) {
      toast.error((err as Error).message || 'Could not send the SMS.');
    } finally {
      setSendingSms(null);
    }
  };

  /** Opens the till's own WhatsApp with the receipt filled in — the cashier taps send.
   *  Nothing to configure, and it arrives from the number the customer already knows. */
  const handleSendWhatsApp = async (sale: Sale) => {
    const phone = sale.customer?.phone;
    if (!phone) return;
    setSendingWhatsApp(sale.id);
    try {
      const [detail, biz] = await Promise.all([
        api.get<SaleDetail>(`/sales/${sale.id}?businessId=${businessId}`),
        api.get<{ name?: string }>(`/business/${businessId}/settings`).catch(() => ({})),
      ]);
      const message = buildReceiptMessage({
        businessName: (biz as { name?: string })?.name ?? 'Faida POS',
        receiptNumber: detail.receiptNumber,
        date: detail.createdAt,
        customerName: detail.customer?.name ?? sale.customer?.name,
        items: detail.items.map((i) => ({ name: i.name, quantity: i.quantity, totalCents: i.totalCents })),
        discountCents: detail.discountCents,
        taxCents: (detail.vatCents ?? 0) + (detail.totCents ?? 0),
        totalCents: detail.totalCents,
      });
      if (!openWhatsApp(phone, message)) {
        toast.error('Could not open WhatsApp — allow pop-ups for this site, or check the customer’s number.');
      }
    } catch (err) {
      toast.error((err as Error).message || 'Could not build the receipt.');
    } finally {
      setSendingWhatsApp(null);
    }
  };

  const totalRevenue = allSales.reduce((s, sale) => s + (sale.status === 'PAID' ? sale.totalCents : 0), 0);
  const paidCount = allSales.filter((s) => s.status === 'PAID').length;
  const voidedCount = allSales.filter((s) => s.status === 'VOIDED').length;
  const returnedCount = allSales.filter((s) => s.status === 'CANCELLED').length;
  const amendedCount = allSales.filter((s) => s.status === 'AMENDED').length;
  const pendingKraCount = allSales.filter((s) => s.etimsSubmitted === false && s.status === 'PAID').length;
  const totalVoidedAmount = allSales.filter(s => s.status === 'VOIDED').reduce((s, sale) => s + sale.totalCents, 0);
  const totalReturnedAmount = allSales.filter(s => s.status === 'CANCELLED').reduce((s, sale) => s + sale.totalCents, 0);

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Page Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 md:px-6 py-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
            <Receipt className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">Sales History</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">{sales.length} transactions</p>
          </div>
          {pendingKraCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-semibold rounded-full flex-shrink-0">
              <Clock className="w-3 h-3" />{pendingKraCount} KRA
            </span>
          )}
        </div>
        {/* Date range + search */}
        <div className="flex items-center gap-2 overflow-x-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap pb-1 scrollbar-none">
          <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
          {(['today', 'week', 'month', 'custom'] as SalesRange[]).map((r) => (
            <button key={r} onClick={() => setDateRange(r)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                dateRange === r ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}>
              {r === 'today' ? 'Today' : r === 'week' ? 'Week' : r === 'month' ? 'Month' : 'Custom'}
            </button>
          ))}
          {dateRange === 'custom' && (
            <>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                className="border px-2 py-1.5 rounded-lg text-xs dark:bg-gray-700 dark:border-gray-600 dark:text-white flex-shrink-0" aria-label="Date" />
              <span className="text-gray-400 text-xs flex-shrink-0">to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                className="border px-2 py-1.5 rounded-lg text-xs dark:bg-gray-700 dark:border-gray-600 dark:text-white flex-shrink-0" aria-label="End date" />
            </>
          )}
        </div>
        {/* Search */}
        <div className="mt-3 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search by receipt number..."
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm" />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-full" aria-label="Close">
              <X className="w-3 h-3 text-gray-400" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">

        {/* Status filter tabs */}
        <div className="flex gap-2 flex-wrap">
          {([
            { key: 'ALL',       label: 'All Sales',   count: allSales.length,  color: 'blue' },
            { key: 'PAID',      label: 'Completed',   count: paidCount,        color: 'green' },
            { key: 'VOIDED',    label: 'Voided',      count: voidedCount,      color: 'red' },
            { key: 'CANCELLED', label: 'Returns',     count: returnedCount,    color: 'orange' },
            { key: 'AMENDED',   label: 'Amended',     count: amendedCount,     color: 'yellow' },
          ] as Array<{ key: StatusFilter; label: string; count: number; color: string }>).map(({ key, label, count, color }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                statusFilter === key
                  ? color === 'blue'   ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : color === 'green'  ? 'bg-green-600 text-white border-green-600 shadow-sm'
                  : color === 'red'    ? 'bg-red-600 text-white border-red-600 shadow-sm'
                  : color === 'orange' ? 'bg-orange-500 text-white border-orange-500 shadow-sm'
                  :                     'bg-yellow-500 text-white border-yellow-500 shadow-sm'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              {label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                statusFilter === key ? 'bg-white/20' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
              }`}>{count}</span>
            </button>
          ))}
        </div>

        {/* Summary stat cards */}
        {!isLoading && allSales.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Total Revenue', value: formatKES(totalRevenue), icon: TrendingUp, iconColor: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20', valueColor: 'text-green-700 dark:text-green-400' },
              { label: 'Transactions', value: allSales.length.toLocaleString(), icon: Receipt, iconColor: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20', valueColor: 'text-blue-700 dark:text-blue-400' },
              { label: 'Voided', value: `${voidedCount} · ${formatKES(totalVoidedAmount)}`, icon: Ban, iconColor: 'text-red-500 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', valueColor: 'text-red-600 dark:text-red-400' },
              { label: 'Returns', value: `${returnedCount} · ${formatKES(totalReturnedAmount)}`, icon: RotateCcw, iconColor: 'text-orange-500 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/20', valueColor: 'text-orange-600 dark:text-orange-400' },
            ].map(({ label, value, icon: Icon, iconColor, bg, valueColor }) => (
              <div key={label} className={`${bg} rounded-xl p-4`}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
                  <Icon className={`w-4 h-4 ${iconColor}`} />
                </div>
                <p className={`text-sm font-bold ${valueColor}`}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Voided / Returns detailed view ── */}
        {statusFilter === 'VOIDED' && (
          voidedLoading ? (
            <div className="flex items-center justify-center py-20 gap-3">
              <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-400">Loading voided & returns...</p>
            </div>
          ) : voidedReturns.length === 0 ? (
            <div className="text-center py-20 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-400" />
              <p className="text-gray-600 dark:text-gray-300 font-semibold">No voided sales or returns</p>
              <p className="text-sm text-gray-400 mt-1">All sales in this period are intact</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400">
                <AlertTriangle className="w-4 h-4" />
                {voidedReturns.length} voided/returned transactions — {formatKES(voidedReturns.reduce((s, v) => s + v.totalCents, 0))} total value
              </div>
              {voidedReturns.map((sale) => {
                const isExpanded = expandedVoid === sale.id;
                const vr = sale.voidRecords ?? [];
                const voidedItemIdSet = new Set(vr.flatMap(r => r.voidedItemIds.split(',').filter(Boolean)));
                return (
                  <div key={sale.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-red-200 dark:border-red-900/40 shadow-sm overflow-hidden">
                    <button
                      className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-red-50/40 dark:hover:bg-red-900/10 transition-colors"
                      onClick={() => setExpandedVoid(isExpanded ? null : sale.id)}
                    >
                      {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-semibold text-sm text-gray-900 dark:text-white">{sale.receiptNumber}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                            sale.status === 'VOIDED'    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                            sale.status === 'CANCELLED' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
                            'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                          }`}>{sale.status === 'CANCELLED' ? 'RETURNED' : sale.status}</span>
                          {sale.customer?.name && <span className="text-xs text-gray-500 dark:text-gray-400">{sale.customer.name}</span>}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-gray-500 dark:text-gray-400">
                          <span>{new Date(sale.createdAt).toLocaleString('en-KE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                          <span>{sale.cashier?.name ?? 'N/A'}</span>
                          {vr[0] && <span className="text-red-500 dark:text-red-400">Reason: {vr[0].reason}</span>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-gray-900 dark:text-white">{formatKES(sale.totalCents)}</p>
                        {vr[0] && <p className="text-xs text-red-500 dark:text-red-400">Refund: {formatKES(vr[0].refundAmountCents)}</p>}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-gray-100 dark:border-gray-700 px-5 pb-5 pt-4 space-y-4">
                        {/* Items table */}
                        <div>
                          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Items</p>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700">
                                <th className="pb-1.5 text-left font-medium">Item</th>
                                <th className="pb-1.5 text-center font-medium">Qty</th>
                                <th className="pb-1.5 text-right font-medium">Amount</th>
                                <th className="pb-1.5 text-center font-medium">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                              {sale.items?.map(item => {
                                const wasVoided = voidedItemIdSet.has(item.id) || sale.status === 'VOIDED';
                                return (
                                  <tr key={item.id} className={wasVoided ? 'opacity-60' : ''}>
                                    <td className="py-2 text-gray-800 dark:text-gray-200">
                                      <span className={wasVoided ? 'line-through' : ''}>{item.name}</span>
                                    </td>
                                    <td className="py-2 text-center text-gray-500 dark:text-gray-400">{item.quantity}</td>
                                    <td className="py-2 text-right text-gray-700 dark:text-gray-300">{formatKES(item.totalCents)}</td>
                                    <td className="py-2 text-center">
                                      {wasVoided
                                        ? <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full font-medium">{sale.status === 'CANCELLED' ? 'Returned' : 'Voided'}</span>
                                        : <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 px-2 py-0.5 rounded-full font-medium">Kept</span>
                                      }
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Void records */}
                        {vr.length > 0 && (
                          <div className="bg-red-50 dark:bg-red-900/10 rounded-xl p-4 space-y-2">
                            <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wide">Void / Return Record</p>
                            {vr.map(record => (
                              <div key={record.id} className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                                <div><span className="text-gray-500 dark:text-gray-400 text-xs">Type:</span> <span className="font-medium text-gray-800 dark:text-gray-200">{record.type.replace('_', ' ')}</span></div>
                                <div><span className="text-gray-500 dark:text-gray-400 text-xs">Refund:</span> <span className="font-bold text-red-600 dark:text-red-400">{formatKES(record.refundAmountCents)}</span></div>
                                <div className="col-span-2"><span className="text-gray-500 dark:text-gray-400 text-xs">Reason:</span> <span className="font-medium text-gray-800 dark:text-gray-200"> {record.reason}</span></div>
                                <div><span className="text-gray-500 dark:text-gray-400 text-xs">Authorized by:</span> <span className="font-medium text-gray-800 dark:text-gray-200"> {record.authorizedBy}</span></div>
                                <div><span className="text-gray-500 dark:text-gray-400 text-xs">Date:</span> <span className="text-gray-600 dark:text-gray-300"> {new Date(record.createdAt).toLocaleString('en-KE')}</span></div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Reprint button */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => void handleReprint(sale as Sale)}
                            disabled={reprintLoading === sale.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 rounded-lg transition-colors disabled:opacity-50"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            {reprintLoading === sale.id ? 'Loading...' : 'Reprint Receipt'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* ── Regular sales list ── */}
        {statusFilter !== 'VOIDED' && (isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-400 dark:text-gray-500">Loading sales...</p>
          </div>
        ) : sales.length === 0 ? (
          <div className="text-center py-20 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
              <Receipt className="w-8 h-8 text-gray-400 dark:text-gray-500" />
            </div>
            <p className="text-gray-600 dark:text-gray-300 font-semibold text-lg">No sales yet</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Sales will appear here after checkout</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Receipt</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Date</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Cashier</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Customer</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Amount</th>
                  <th className="px-6 py-3.5 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {sales.map((sale) => (
                  <tr key={sale.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-sm font-mono font-semibold text-gray-900 dark:text-white">{sale.receiptNumber}</p>
                      {sale.etimsSubmitted === false && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium mt-0.5">
                          <Clock className="w-3 h-3" />Pending KRA
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {new Date(sale.createdAt).toLocaleString('en-KE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{sale.cashier?.name ?? 'N/A'}</td>
                    <td className="px-6 py-4 text-sm">
                      {sale.customer?.name
                        ? <span className="font-medium text-gray-800 dark:text-gray-200">{sale.customer.name}</span>
                        : <span className="text-gray-400 dark:text-gray-500">Walk-in</span>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-sm font-bold text-gray-900 dark:text-white">{formatKES(sale.totalCents)}</span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-flex px-2.5 py-1 text-xs font-semibold rounded-full ${
                        STATUS_COLORS[sale.status] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                      }`}>{sale.status}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => { setSelectedSale(sale); setShowViewModal(true); }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors">
                          <Eye className="w-3.5 h-3.5" />View
                        </button>
                        {sale.status === 'PAID' && (
                          <>
                            <button onClick={() => void handleReprint(sale)} disabled={reprintLoading === sale.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors disabled:opacity-50">
                              <Printer className="w-3.5 h-3.5" />{reprintLoading === sale.id ? '...' : 'Print'}
                            </button>
                            {sale.customer?.phone && normalisePhone(sale.customer.phone) && (
                              <button onClick={() => void handleSendWhatsApp(sale)} disabled={sendingWhatsApp === sale.id}
                                title="Open WhatsApp with the receipt ready to send"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors disabled:opacity-50">
                                <MessageCircle className="w-3.5 h-3.5" />{sendingWhatsApp === sale.id ? '...' : 'WhatsApp'}
                              </button>
                            )}
                            {sale.customer?.phone && (
                              <button onClick={() => void handleSendSms(sale)} disabled={sendingSms === sale.id}
                                title="Text the receipt to the customer"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 rounded-lg transition-colors disabled:opacity-50">
                                <MessageSquare className="w-3.5 h-3.5" />{sendingSms === sale.id ? '...' : 'SMS'}
                              </button>
                            )}
                            <button onClick={() => { setSelectedSale(sale); setShowReturnModal(true); }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg transition-colors">
                              <RotateCcw className="w-3.5 h-3.5" />Return
                            </button>
                            <button onClick={() => { setSelectedSale(sale); setShowVoidModal(true); }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                              <Ban className="w-3.5 h-3.5" />Void
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {sales.map((sale) => (
                <div key={sale.id} className="p-4 space-y-3">
                  {/* Top row: receipt + amount + status */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono font-bold text-sm text-gray-900 dark:text-white truncate">{sale.receiptNumber}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {new Date(sale.createdAt).toLocaleString('en-KE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {sale.cashier?.name ? ` · ${sale.cashier.name}` : ''}
                      </p>
                      {sale.customer?.name && (
                        <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">{sale.customer.name}</p>
                      )}
                      {sale.etimsSubmitted === false && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium mt-0.5">
                          <Clock className="w-3 h-3" />Pending KRA
                        </span>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold text-base text-gray-900 dark:text-white">{formatKES(sale.totalCents)}</p>
                      <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full mt-1 ${
                        STATUS_COLORS[sale.status] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                      }`}>{sale.status}</span>
                    </div>
                  </div>
                  {/* Action buttons — full width, easy to tap */}
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => { setSelectedSale(sale); setShowViewModal(true); }}
                      className="flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-xl transition-colors">
                      <Eye className="w-4 h-4" />View Details
                    </button>
                    {sale.status === 'PAID' && (
                      <>
                        <button onClick={() => void handleReprint(sale)} disabled={reprintLoading === sale.id}
                          className="flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl transition-colors disabled:opacity-50">
                          <Printer className="w-4 h-4" />{reprintLoading === sale.id ? 'Loading...' : 'Print'}
                        </button>
                        <button onClick={() => { setSelectedSale(sale); setShowReturnModal(true); }}
                          className="flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 rounded-xl transition-colors">
                          <RotateCcw className="w-4 h-4" />Return
                        </button>
                        <button onClick={() => { setSelectedSale(sale); setShowVoidModal(true); }}
                          className="flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl transition-colors">
                          <Ban className="w-4 h-4" />Void Sale
                        </button>
                        {sale.customer?.phone && (
                          <button onClick={() => void handleSendWhatsApp(sale)} disabled={sendingWhatsApp === sale.id}
                            className="flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/20 rounded-xl transition-colors disabled:opacity-50">
                            <MessageSquare className="w-4 h-4" />{sendingWhatsApp === sale.id ? 'Sending...' : 'WhatsApp'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* View Sale Modal */}
      {showViewModal && selectedSale && (
        <SaleDetailModal
          saleId={selectedSale.id}
          businessId={businessId}
          onClose={() => {
            setShowViewModal(false);
            setSelectedSale(null);
          }}
        />
      )}

      {showVoidModal && selectedSale && (
        <VoidModal
          saleId={selectedSale.id}
          receiptNumber={selectedSale.receiptNumber}
          totalCents={selectedSale.totalCents}
          businessId={businessId}
          userRole={user?.role}
          userId={user?.id}
          userName={user?.name}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['sales'] });
          }}
          onClose={() => {
            setShowVoidModal(false);
            setSelectedSale(null);
          }}
        />
      )}

      {showReturnModal && selectedSale && (
        <ReturnModal
          saleId={selectedSale.id}
          receiptNumber={selectedSale.receiptNumber}
          totalCents={selectedSale.totalCents}
          customerId={selectedSale.customer?.id}
          businessId={businessId}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['sales'] });
          }}
          onClose={() => {
            setShowReturnModal(false);
            setSelectedSale(null);
          }}
        />
      )}

      {showPrintModal && reprintData && (
        <PrintModal
          receipt={reprintData}
          onClose={() => {
            setShowPrintModal(false);
            setPrintNotice('');
            setReprintData(null);
          }}
          notice={printNotice || undefined}
        />
      )}
    </div>
  );
}
