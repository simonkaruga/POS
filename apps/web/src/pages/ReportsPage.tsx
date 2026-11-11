import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, Area, AreaChart,
  ReferenceLine,
} from 'recharts';
import {
  DollarSign, ShoppingBag, TrendingUp, Package, FileText,
  BarChart3, Calendar, Download, RefreshCw, AlertCircle,
  ChefHat, Truck, Layers, CreditCard, History, BookOpen,
  ClipboardList, Hash, Flag, Shield, AlertTriangle, DatabaseBackup,
  Users, Smartphone, X, Pencil, Printer, BarChart2, ArrowRightLeft, MapPin,
} from 'lucide-react';
import { api, openPdfReport } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { printHtml as printInFrame } from '../lib/printHtml';
import { Button, Input, PageHeader, Segmented, Select, StatTile, Tabs } from '../components/ui';

// ─── Types ────────────────────────────────────────────────────

interface SalesSummary {
  summary: {
    totalSales: number;
    totalRevenueCents: number;
    totalVatCents: number;
    totalTotCents: number;
  };
  sales: Array<{
    id: string;
    receiptNumber: string | null;
    createdAt: string;
    totalCents: number;
    vatCents: number;
    totCents: number;
    subtotalCents: number;
    discountCents: number;
    serviceChargeCents: number;
    etimsSubmitted?: boolean;
    etimsControlNumber?: string | null;
  }>;
}

interface PaymentMethod {
  method: string;
  totalCents: number;
  count: number;
}

interface ProfitLoss {
  revenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  expensesCents: number;
  netProfitCents: number;
}

interface StockValuation {
  totalValueCents: number;
  items: Array<{
    itemId: string;
    name: string;
    quantity: number;
    costPriceCents: number;
    valueCents: number;
  }>;
}

interface VatReport {
  totalVatCents: number;
  totalSalesCents: number;
  totalNetCents?: number;
  sales: Array<{
    receiptNumber: string | null;
    createdAt: string;
    subtotalCents: number;
    discountCents: number;
    vatCents: number;
    netCents: number;
    totalCents: number;
  }>;
}

interface VatReturnData {
  period: { startDate: string; endDate: string };
  outputVat: {
    totalCents: number;
    totalSalesCents: number;
    salesCount: number;
    sales: Array<{ id: string; receiptNumber: string | null; createdAt: string; subtotalCents: number; discountCents: number; totalCents: number; vatCents: number }>;
  };
  inputVat: {
    totalCents: number;
    expensesCount: number;
    expenses: Array<{ id: string; description: string; category: string; amountCents: number; createdAt: string; vatCents: number }>;
  };
  netVatPayableCents: number;
}

interface ExpenseReport {
  totalCents: number;
  byCategory: Record<string, number>;
  expenses: Array<{
    id: string;
    category: string;
    description: string;
    amountCents: number;
    createdAt: string;
  }>;
}

interface XReport {
  session: { id: string; openingBalanceCents: number; openedAt: string } | null;
  salesCount: number;
  totalSalesCents: number;
  totalVatCents: number;
  openingBalanceCents: number;
  expectedCashCents: number;
  paymentBreakdown: Array<{ method: string; amountCents: number; count: number }>;
  generatedAt: string;
  error?: string;
}

interface RecipeVarianceRow {
  ingredientName: string;
  plannedGrams: number;
  actualGrams: number;
  varianceGrams: number;
  variancePct: number;
}

interface BundleProfitabilityRow {
  bundleId: string;
  bundleName: string;
  sold: number;
  revenueCents: number;
  totalCostCents: number;
  profitCents: number;
  marginPct: number;
}

interface SupplierLedgerRow {
  supplierId: string;
  supplierName: string;
  poCount: number;
  totalValueCents: number;
  pendingCount: number;
  receivedCount: number;
}

interface SupplierPerformanceRow {
  supplierId: string;
  supplierName: string;
  onTimeRate: number;
  avgLeadTimeDays: number;
  fillRate: number;
}

interface SupplierAgeingRow {
  supplierId: string;
  supplierName: string;
  contact: string;
  paymentTerms?: string;
  totalOutstandingCents: number;
  currentCents: number;
  days1to30Cents: number;
  days31to60Cents: number;
  days61to90Cents: number;
  days90plusCents: number;
  overdueOrderCount: number;
  totalOrderCount: number;
}

interface SupplierAgeingData {
  rows: SupplierAgeingRow[];
  summary: {
    totalSuppliers: number;
    totalOutstandingCents: number;
    currentCents: number;
    days1to30Cents: number;
    days31to60Cents: number;
    days61to90Cents: number;
    days90plusCents: number;
  };
  asOfDate: string;
}

interface CreditBookData {
  rows: Array<{
    saleId: string;
    receiptNumber: string | null;
    date: string;
    customerName: string;
    customerPhone?: string;
    totalCents: number;
    paidCents: number;
    outstandingCents: number;
    daysSince: number;
    agingBucket: string;
  }>;
  summary: {
    totalOutstandingCents: number;
    uniqueDebtors: number;
    totalCreditSales: number;
  };
}

interface DeadStockItem {
  itemId: string;
  name: string;
  category: string;
  stock: number;
  costPriceCents: number;
  stockValueCents: number;
  daysSinceLastSale: number | null;
  lastSaleDate: string | null;
}

interface DeadStockData {
  items: DeadStockItem[];
  totalItems: number;
  totalValueCents: number;
  daysThreshold: number;
}

interface StockTransferItem {
  itemId: string;
  itemName: string;
  quantity: number;
}

interface StockTransfer {
  id: string;
  status: string;
  fromStoreId: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreName: string;
  items: StockTransferItem[];
  initiatedBy: string | null;
  initiatedByName: string | null;
  receivedBy: string | null;
  receivedByName: string | null;
  createdAt: string;
  completedAt: string | null;
  notes: string | null;
}

interface StockTransfersData {
  transfers: StockTransfer[];
  summary: {
    total: number;
    pending: number;
    completed: number;
    cancelled: number;
    inTransitToStore: number;
  };
}

interface GrossMarginItem {
  name: string;
  qty: number;
  revenueCents: number;
  costCents: number;
  grossProfitCents: number;
  marginPct: number;
}

interface GrossMarginCategory {
  name: string;
  revenueCents: number;
  costCents: number;
  grossProfitCents: number;
  marginPct: number;
  qty: number;
  items: GrossMarginItem[];
}

interface GrossMarginData {
  categories: GrossMarginCategory[];
  totalRevenueCents: number;
  totalCostCents: number;
  totalGrossProfitCents: number;
  overallMarginPct: number;
}

interface ShrinkageItem { itemId: string; name: string; sku: string; totalUnitsLost: number; totalValueCents: number; incidents: number; }
interface ShrinkageData { items: ShrinkageItem[]; totalValueCents: number; totalIncidents: number; }
interface DeptPnlRow { category: string; revenueCents: number; cogsCents: number; grossProfitCents: number; marginPct: number; units: number; }
interface DeptPnlData { departments: DeptPnlRow[]; totals: { revenueCents: number; cogsCents: number; grossProfitCents: number; marginPct: number }; }
interface RecipeComponent { name: string; quantity: number; costPriceCents: number; totalCostCents: number; }
interface RecipeCostItem { itemId: string; name: string; category: string; sellingPriceCents: number; totalIngredientCostCents: number; foodCostPct: number | null; grossMarginPct: number | null; status: 'HIGH_COST' | 'ACCEPTABLE' | 'LOW_COST' | 'NO_PRICE'; components: RecipeComponent[]; }
interface RecipeCostData { items: RecipeCostItem[]; summary: { totalItems: number; avgFoodCostPct: number; highCostItems: number }; }

interface MenuEngineeringItem {
  id: string;
  name: string;
  category: string;
  qty: number;
  revenueCents: number;
  marginCents: number;
  marginPct: number;
  quadrant: 'STAR' | 'PLOWHORSE' | 'PUZZLE' | 'DOG';
}
interface MenuEngineeringData {
  items: MenuEngineeringItem[];
  avgQty: number;
  avgMarginPct: number;
}

interface BasketPair { item1: string; item2: string; count: number; name1: string; name2: string; }
interface BasketAnalysisData { pairs: BasketPair[]; totalSales: number; }

interface ClvRow {
  id: string;
  name: string;
  phone: string;
  visitCount: number;
  totalSpendCents: number;
  avgOrderCents: number;
  firstVisit: string;
  lastVisit: string;
  daysSinceLast: number;
  visitFrequencyDays: number;
  churnRisk: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface NpsSummary {
  total: number;
  avg: number;
  npsScore: number;
  promoters: number;
  passives: number;
  detractors: number;
  trend: Array<{ date: string; avg: number; count: number }>;
  recent: Array<{ score: number; comment: string; createdAt: string }>;
}

type Tab = 'overview' | 'sales' | 'customer-analytics' | 'forecasting' | 'item-summary' | 'tax' | 'vat-return' | 'pl' | 'inventory' | 'fiscal' | 'attendance' | 'commissions' | 'employee-sales' | 'recipes' | 'bundles' | 'suppliers' | 'supplier-ageing' | 'credit' | 'layaway' | 'proforma' | 'serials' | 'kra' | 'audit' | 'grn' | 'export' | 'dead-stock' | 'gross-margin' | 'shrinkage' | 'dept-pnl' | 'recipe-costing' | 'transfers' | 'menu-engineering' | 'basket-analysis' | 'clv' | 'nps' | 'route-analytics' | 'invoice-ageing';
type TabGroup = 'financial' | 'inventory' | 'customers' | 'hr' | 'suppliers' | 'compliance' | 'field-sales';
type Range = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
type ComparisonPeriod = 'none' | 'previous' | 'yoy' | 'mom';

// ─── Helpers ─────────────────────────────────────────────────

function formatKES(cents: number): string {
  return `KES ${(cents / 100).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getDateRange(range: Range, from: string, to: string): { startDate: string; endDate: string } {
  const now = new Date();
  if (range === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }
  if (range === 'week') {
    const day = now.getDay();
    const start = new Date(now);
    start.setDate(now.getDate() - day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }
  if (range === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }
  if (range === 'quarter') {
    const quarter = Math.floor(now.getMonth() / 3);
    const start = new Date(now.getFullYear(), quarter * 3, 1);
    const end = new Date(now.getFullYear(), quarter * 3 + 3, 0, 23, 59, 59);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }
  if (range === 'year') {
    const start = new Date(now.getFullYear(), 0, 1);
    const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }
  return { startDate: new Date(from).toISOString(), endDate: new Date(to + 'T23:59:59').toISOString() };
}

function getComparisonDateRange(_range: Range, comparison: ComparisonPeriod, startDate: string, endDate: string): { startDate: string; endDate: string } | null {
  if (comparison === 'none') return null;
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMs = end.getTime() - start.getTime();
  
  if (comparison === 'previous') {
    const compStart = new Date(start.getTime() - diffMs - 24 * 60 * 60 * 1000);
    const compEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    return { startDate: compStart.toISOString(), endDate: compEnd.toISOString() };
  }
  
  if (comparison === 'yoy') {
    const compStart = new Date(start.getFullYear() - 1, start.getMonth(), start.getDate());
    const compEnd = new Date(end.getFullYear() - 1, end.getMonth(), end.getDate(), 23, 59, 59);
    return { startDate: compStart.toISOString(), endDate: compEnd.toISOString() };
  }
  
  if (comparison === 'mom') {
    const compStart = new Date(start.getFullYear() - 1, start.getMonth(), start.getDate());
    const compEnd = new Date(end.getFullYear() - 1, end.getMonth(), end.getDate(), 23, 59, 59);
    return { startDate: compStart.toISOString(), endDate: compEnd.toISOString() };
  }
  
  return null;
}

const CHART_COLORS = ['#3B7DFF', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'];

const RANGE_LABELS: Record<Range, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  quarter: 'This Quarter',
  year: 'This Year',
  custom: 'Custom',
};

const COMPARISON_LABELS: Record<ComparisonPeriod, string> = {
  none: 'No Comparison',
  previous: 'vs Previous Period',
  yoy: 'vs Same Period Last Year',
  mom: 'vs Same Month Last Year',
};

// ─── Stat Card ────────────────────────────────────────────────

/**
 * A report figure. It renders the shared StatTile, so every report has the same tile. `color` is accepted so the many
 * call sites need not change, but it is ignored: the icon is always the brand colour, and the figure is red only when
 * the caller marks it as a bad number (a red `valueColor`).
 */
function StatCard({
  label, value, icon: Icon, sub, valueColor,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  color?: string;
  sub?: string;
  valueColor?: string;
}) {
  return <StatTile label={label} value={value} note={sub} icon={<Icon className="w-4 h-4" />} tone={valueColor?.includes('red') ? 'danger' : 'neutral'} />;
}

// ─── CSV Export Utility ───────────────────────────────────────

function downloadCsv(filename: string, rows: string[][]): void {
  const content = rows
    .map((row) =>
      row.map((cell) => {
        const s = String(cell ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      }).join(',')
    )
    .join('\r\n');
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Print Utility ────────────────────────────────────────────

function printHtml(title: string, bodyHtml: string): void {
  printInFrame(`<!DOCTYPE html><html><head>
<meta charset="utf-8"/><title>${title}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;font-size:11pt;color:#111;padding:20px 30px}
  h1{font-size:16pt;margin-bottom:2px}
  .sub{font-size:9pt;color:#666;margin-bottom:12px}
  h2{font-size:12pt;background:#f0f0f0;padding:5px 8px;margin:14px 0 4px;border-left:4px solid #1F6BFF}
  table{width:100%;border-collapse:collapse;margin-bottom:8px}
  th{text-align:left;padding:5px 8px;border-bottom:2px solid #ccc;font-size:9pt;white-space:nowrap}
  th.r,td.r{text-align:right}
  td{padding:4px 8px;border-bottom:1px solid #eee;font-size:10pt}
  tfoot td{font-weight:bold;border-top:2px solid #ccc;border-bottom:none}
  .grand{font-size:12pt;font-weight:bold;padding:10px 8px;border-top:3px solid #1F6BFF;margin-top:8px}
  @media print{@page{margin:15mm}}
</style>
</head><body>
${bodyHtml}
</body></html>`);
}

// ─── Main Component ───────────────────────────────────────────

export default function ReportsPage() {
  const user = useAuthStore((s) => s.user);
  const businessId = user?.businessId ?? 'default';
  const isOwner = user?.role === 'OWNER';

  // Owner/Manager can switch branches; others are locked to their assigned store
  const [selectedStoreId, setSelectedStoreId] = useState<string>(user?.storeId ?? '');
  const storeId = selectedStoreId;

  const { data: stores = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['stores', businessId],
    queryFn: () => api.get(`/business/${businessId}/stores`),
    enabled: !!businessId && isOwner,
    staleTime: 5 * 60_000,
  });

  const [tab, setTab] = useState<Tab>('overview');
  const [range, setRange] = useState<Range>('month');
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().substring(0, 10);
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().substring(0, 10));
  const [showZReportModal, setShowZReportModal] = useState(false);
  const [closingBalance, setClosingBalance] = useState('');
  const [empSalesFilter, setEmpSalesFilter] = useState('');
  const [salesViewMode, setSalesViewMode] = useState<'transactions' | 'by-date'>('by-date');
  const [expandedSaleDate, setExpandedSaleDate] = useState<string | null>(null);
  const [writeOffItem, setWriteOffItem] = useState<{ itemId: string; name: string; qty: number } | null>(null);
  const [writeOffQty, setWriteOffQty] = useState('');
  const [writeOffReason, setWriteOffReason] = useState('WRITE_OFF');
  const [writeOffNotes, setWriteOffNotes] = useState('');
  const [historyAsOf, setHistoryAsOf] = useState(() => new Date().toISOString().substring(0, 10));
  const [stockViewMode, setStockViewMode] = useState<'live' | 'historical'>('live');
  const [tabGroup, setTabGroup] = useState<TabGroup>('financial');
  const [reportSearch, setReportSearch] = useState('');
  const [layawayStatus, setLayawayStatus] = useState('');
  const [deadStockDays, setDeadStockDays] = useState(90);
  const [expandedGrossMarginCategory, setExpandedGrossMarginCategory] = useState<string | null>(null);
  const [comparisonPeriod, setComparisonPeriod] = useState<ComparisonPeriod>('none');
  const [chartType, setChartType] = useState<'bar' | 'line' | 'area'>('bar');
  const [showTrendlines, setShowTrendlines] = useState(false);
  const [_selectedMetrics, _setSelectedMetrics] = useState<string[]>(['revenue', 'transactions']);

  const { startDate, endDate } = getDateRange(range, customFrom, customTo);
  const comparisonRange = getComparisonDateRange(range, comparisonPeriod, startDate, endDate);

  const baseQs = useMemo(() => {
    const p = new URLSearchParams({ businessId });
    if (storeId) p.set('storeId', storeId);
    p.set('startDate', startDate);
    p.set('endDate', endDate);
    return p.toString();
  }, [businessId, storeId, startDate, endDate]);

  const comparisonQs = useMemo(() => {
    if (!comparisonRange) return null;
    const p = new URLSearchParams({ businessId });
    if (storeId) p.set('storeId', storeId);
    p.set('startDate', comparisonRange.startDate);
    p.set('endDate', comparisonRange.endDate);
    return p.toString();
  }, [businessId, storeId, comparisonRange]);

  const taxQs = useMemo(() => {
    const p = new URLSearchParams({ businessId, startDate, endDate });
    if (storeId) p.set('storeId', storeId);
    return p.toString();
  }, [businessId, storeId, startDate, endDate]);

  // ── Queries ───────────────────────────────────────────────────

  const {
    data: salesData,
    isLoading: salesLoading,
    isFetching: salesFetching,
    dataUpdatedAt: salesUpdatedAt,
    refetch: refetchSales,
  } = useQuery<SalesSummary>({
    queryKey: ['report-sales', baseQs],
    queryFn: () => api.get<SalesSummary>(`/reports/sales?${baseQs}`),
    enabled: !!businessId,
    staleTime: 0,                   // always consider stale → refetch on focus/nav
    refetchInterval: 10_000,        // poll every 10 s while tab is open
    refetchIntervalInBackground: false,
  });

  // Comparison data for period-over-period analysis
  const { data: comparisonSalesData } = useQuery<SalesSummary>({
    queryKey: ['report-sales-comparison', comparisonQs],
    queryFn: () => api.get<SalesSummary>(`/reports/sales?${comparisonQs}`),
    enabled: !!businessId && !!comparisonQs && comparisonPeriod !== 'none',
    staleTime: 5 * 60 * 1000, // 5 minutes for comparison data
  });

  // Customer analytics data
  const { data: customerAnalytics } = useQuery<{
    totalCustomers: number;
    newCustomers: number;
    returningCustomers: number;
    avgOrderValue: number;
    customerLifetimeValue: number;
    topCustomers: Array<{
      id: string;
      name: string;
      totalSpent: number;
      orderCount: number;
      lastVisit: string;
    }>;
    rfmSegments: Array<{
      segment: string;
      count: number;
      avgSpend: number;
    }>;
  }>({
    queryKey: ['customer-analytics', baseQs],
    queryFn: () => api.get(`/reports/customer-analytics?${baseQs}`),
    enabled: !!businessId && (tab === 'overview' || tab === 'customer-analytics'),
  });

  // Advanced forecasting data
  const { data: forecastData } = useQuery<{
    items: Array<{
      itemId: string;
      itemName: string;
      currentStock: number;
      forecastedDemand: number;
      confidence: 'HIGH' | 'MEDIUM' | 'LOW';
      trend: number;
      seasonality: number;
      reorderPoint: number;
      suggestedOrderQty: number;
    }>;
    demandPatterns: Array<{
      date: string;
      predicted: number;
      actual?: number;
      confidence: number;
    }>;
  }>({
    queryKey: ['forecast-data', businessId, storeId],
    queryFn: () => api.get(`/reports/forecast?businessId=${businessId}${storeId ? `&storeId=${storeId}` : ''}`),
    enabled: !!businessId && tab === 'forecasting',
  });

  const { data: paymentMethods = [], refetch: refetchPayments } = useQuery<PaymentMethod[]>({
    queryKey: ['report-payments', baseQs],
    queryFn: () => api.get<PaymentMethod[]>(`/reports/payment-methods?${baseQs}`),
    enabled: !!businessId,
    staleTime: 0,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  const { data: vatData, refetch: refetchVat } = useQuery<VatReport>({
    queryKey: ['report-vat', taxQs],
    queryFn: () => api.get<VatReport>(`/reports/vat?${taxQs}`),
    enabled: !!businessId && (tab === 'tax' || tab === 'overview'),
    staleTime: 0,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  const { data: vatReturnData, isLoading: vatReturnLoading } = useQuery<VatReturnData>({
    queryKey: ['report-vat-return-itax', taxQs],
    queryFn: () => api.get<VatReturnData>(`/reports/vat-return-itax?${taxQs}`),
    enabled: !!businessId && tab === 'vat-return',
  });

  const { data: plData } = useQuery<ProfitLoss>({
    queryKey: ['report-pl', taxQs],
    queryFn: () => api.get<ProfitLoss>(`/reports/profit-loss?${taxQs}`),
    enabled: !!businessId && (tab === 'pl' || tab === 'overview'),
    staleTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const { data: stockData, refetch: refetchStock } = useQuery<StockValuation>({
    queryKey: ['report-stock', businessId, storeId],
    queryFn: () =>
      api.get<StockValuation>(
        `/reports/stock-valuation?businessId=${businessId}${storeId ? `&storeId=${storeId}` : ''}`,
      ),
    enabled: !!businessId && tab === 'inventory' && stockViewMode === 'live',
    staleTime: 0,                   // always consider stale → refetch on focus/nav
    refetchInterval: 15_000,        // poll every 15 s while tab is open
    refetchIntervalInBackground: false,
  });

  const { data: expenseData } = useQuery<ExpenseReport>({
    queryKey: ['report-expenses', baseQs],
    queryFn: () => api.get<ExpenseReport>(`/reports/expenses?${baseQs}`),
    enabled: !!businessId && (tab === 'pl' || tab === 'overview'),
  });

  const { data: xReport, refetch: refetchXReport, isFetching: xLoading } = useQuery<XReport>({
    queryKey: ['x-report', businessId, storeId, user?.id],
    queryFn: () =>
      api.get<XReport>(
        `/reports/x-report?businessId=${businessId}&storeId=${storeId}&cashierId=${user?.id ?? ''}`,
      ),
    enabled: false,
  });

  const { data: attendanceReport = [] } = useQuery<Array<{
    id: string;
    shiftDate: string;
    clockIn: string;
    clockOut?: string;
    isLate: boolean;
    employee?: { user: { name: string; role: string } };
  }>>({
    queryKey: ['report-attendance', businessId, startDate, endDate],
    queryFn: () =>
      api.get(`/reports/attendance?businessId=${businessId}${storeId ? `&storeId=${storeId}` : ''}&startDate=${startDate}&endDate=${endDate}`),
    enabled: !!businessId && tab === 'attendance',
  });

  const { data: commissionReport = [] } = useQuery<Array<{
    employeeId: string;
    employeeName: string;
    commissionRate: number;
    commissionBasis: string;
    salesCount: number;
    totalSalesCents: number;
    commissionCents: number;
  }>>({
    queryKey: ['report-commissions', businessId, startDate, endDate],
    queryFn: () =>
      api.get(`/reports/commissions?businessId=${businessId}${storeId ? `&storeId=${storeId}` : ''}&startDate=${startDate}&endDate=${endDate}`),
    enabled: !!businessId && tab === 'commissions',
  });

  const { data: recipeVariance = [] } = useQuery<RecipeVarianceRow[]>({
    queryKey: ['report-recipe-variance', businessId, startDate, endDate],
    queryFn: () =>
      api.get<RecipeVarianceRow[]>(`/reports/recipe-variance?businessId=${businessId}&startDate=${startDate}&endDate=${endDate}`),
    enabled: !!businessId && tab === 'recipes',
  });

  const { data: bundleProfitability = [] } = useQuery<BundleProfitabilityRow[]>({
    queryKey: ['report-bundle-profitability', businessId, startDate, endDate],
    queryFn: () =>
      api.get<BundleProfitabilityRow[]>(`/reports/bundle-profitability?businessId=${businessId}&startDate=${startDate}&endDate=${endDate}`),
    enabled: !!businessId && tab === 'bundles',
  });

  const { data: supplierLedger = [] } = useQuery<SupplierLedgerRow[]>({
    queryKey: ['report-supplier-ledger', businessId, startDate, endDate],
    queryFn: () =>
      api.get<SupplierLedgerRow[]>(`/reports/supplier-ledger?businessId=${businessId}&startDate=${startDate}&endDate=${endDate}`),
    enabled: !!businessId && tab === 'suppliers',
  });

  const { data: supplierPerformance = [] } = useQuery<SupplierPerformanceRow[]>({
    queryKey: ['report-supplier-performance', businessId, startDate, endDate],
    queryFn: () =>
      api.get<SupplierPerformanceRow[]>(`/reports/supplier-performance?businessId=${businessId}&startDate=${startDate}&endDate=${endDate}`),
    enabled: !!businessId && tab === 'suppliers',
  });

  const { data: supplierAgeing } = useQuery<SupplierAgeingData>({
    queryKey: ['report-supplier-ageing', businessId],
    queryFn: () => api.get<SupplierAgeingData>(`/reports/supplier-ageing?businessId=${businessId}`),
    enabled: !!businessId && tab === 'supplier-ageing',
  });

  const { data: creditBook } = useQuery<CreditBookData>({
    queryKey: ['report-credit-book', businessId, storeId, startDate, endDate],
    queryFn: () =>
      api.get<CreditBookData>(
        `/reports/credit-book?businessId=${businessId}${storeId ? `&storeId=${storeId}` : ''}&startDate=${startDate}&endDate=${endDate}`,
      ),
    enabled: !!businessId && tab === 'credit',
  });

  const { data: historicalStock } = useQuery<{
    asOfDate: string;
    items: Array<{ itemId: string; name: string; category: string; barcode: string; quantity: number; costPriceCents: number; valueCents: number; retailPriceCents: number; retailValueCents: number }>;
    totalValueCents: number;
    totalRetailValueCents: number;
    totalItems: number;
  }>({
    queryKey: ['report-historical-stock', businessId, storeId, historyAsOf],
    queryFn: () => {
      // Send end-of-day so the selected date is fully included (not just midnight start)
      const endOfDay = new Date(historyAsOf);
      endOfDay.setHours(23, 59, 59, 999);
      return api.get(`/reports/historical-stock?businessId=${businessId}${storeId ? `&storeId=${storeId}` : ''}&asOfDate=${endOfDay.toISOString()}`);
    },
    enabled: !!businessId && tab === 'inventory' && stockViewMode === 'historical',
  });

  const { data: layawayBook } = useQuery<{
    rows: Array<{ id: string; customerName: string; customerPhone: string; status: string; totalCents: number; paidCents: number; remainingCents: number; paymentCount: number; createdAt: string; daysSinceCreated: number; receiptNumber: string | null }>;
    summary: { totalValueCents: number; totalPaidCents: number; totalRemainingCents: number; activeCount: number; completedCount: number; count: number };
  }>({
    queryKey: ['report-layaway-book', businessId, storeId, startDate, endDate, layawayStatus],
    queryFn: () => api.get(`/reports/layaway-book?businessId=${businessId}${storeId ? `&storeId=${storeId}` : ''}&startDate=${startDate}&endDate=${endDate}${layawayStatus ? `&status=${layawayStatus}` : ''}`),
    enabled: !!businessId && tab === 'layaway',
  });

  const { data: proformaPipeline } = useQuery<{
    rows: Array<{ id: string; receiptNumber: string | null; status: string; customerName: string; customerPhone: string; totalCents: number; itemCount: number; createdAt: string; validUntil: string | null; daysRemaining: number | null; isExpired: boolean; isUrgent: boolean }>;
    summary: { total: number; active: number; expired: number; converted: number; totalValueCents: number; pipelineValueCents: number };
  }>({
    queryKey: ['report-proforma-pipeline', businessId, storeId],
    queryFn: () => api.get(`/reports/proforma-pipeline?businessId=${businessId}${storeId ? `&storeId=${storeId}` : ''}`),
    enabled: !!businessId && tab === 'proforma',
  });

  const { data: serialRegistry } = useQuery<{
    rows: Array<{ id: string; serialNumber: string; status: string; itemId: string; itemName: string; category: string; saleReceiptNumber: string | null; soldAt: string | null; customerName: string | null; createdAt: string }>;
    summary: { total: number; available: number; sold: number; reserved: number };
  }>({
    queryKey: ['report-serial-registry', businessId, storeId],
    queryFn: () => api.get(`/reports/serial-registry?businessId=${businessId}${storeId ? `&storeId=${storeId}` : ''}`),
    enabled: !!businessId && tab === 'serials',
  });

  const { data: grnDiscrepancy } = useQuery<{
    rows: Array<{ grnId: string; receivedAt: string; poNumber: string; supplierName: string; quantityOrdered: number; quantityReceived: number; variance: number; variancePct: number; hasDiscrepancy: boolean; discrepancyType: string; batchLotNumber: string | null; varianceValueCents: number }>;
    summary: { totalLines: number; discrepancyCount: number; shortDeliveries: number; overDeliveries: number; totalVarianceValueCents: number; discrepancyRate: number };
  }>({
    queryKey: ['report-grn-discrepancy', businessId, startDate, endDate],
    queryFn: () => api.get(`/reports/grn-discrepancy?businessId=${businessId}&startDate=${startDate}&endDate=${endDate}`),
    enabled: !!businessId && tab === 'grn',
  });

  const { data: employeeSalesData } = useQuery<{
    rows: Array<{
      employeeId: string;
      employeeName: string;
      role: string;
      salesCount: number;
      totalCents: number;
      totalItemsSold: number;
      avgItemsPerTransaction: number;
      categories: Array<{ name: string; subtotalCents: number; items: Array<{ itemName: string; qty: number; totalCents: number }> }>;
      mpesaPayments: Array<{ saleReceiptNumber: string | null; amountCents: number; mpesaRef: string | null; createdAt: string }>;
      mpesaTotalCents: number;
    }>;
    summary: { totalEmployees: number; totalSales: number; totalRevenueCents: number; totalMpesaCents: number; totalItemsSold: number; avgItemsPerTransaction: number };
  }>({
    queryKey: ['report-employee-sales', businessId, storeId, startDate, endDate, empSalesFilter],
    queryFn: () =>
      api.get(
        `/reports/employee-sales?businessId=${businessId}${storeId ? `&storeId=${storeId}` : ''}` +
        `&startDate=${startDate}&endDate=${endDate}` +
        (empSalesFilter ? `&employeeId=${empSalesFilter}` : ''),
      ),
    enabled: !!businessId && tab === 'employee-sales',
  });

  const { data: businessUsers = [] } = useQuery<Array<{ id: string; name: string; role: string }>>({
    queryKey: ['business-users', businessId],
    queryFn: () => api.get<Array<{ id: string; name: string; role: string }>>(`/business/${businessId}/users`),
    enabled: !!businessId && tab === 'employee-sales',
  });

  const { data: itemSummaryData } = useQuery<{
    categories: Array<{
      name: string;
      totalCents: number;
      totalQty: number;
      items: Array<{ name: string; qty: number; totalCents: number }>;
    }>;
    grandTotalCents: number;
    grandTotalQty: number;
  }>({
    queryKey: ['report-item-summary', businessId, storeId, startDate, endDate],
    queryFn: () =>
      api.get(
        `/reports/item-summary?businessId=${businessId}${storeId ? `&storeId=${storeId}` : ''}&startDate=${startDate}&endDate=${endDate}`,
      ),
    enabled: !!businessId && tab === 'item-summary',
  });

  const { data: deadStockData } = useQuery<DeadStockData>({
    queryKey: ['report-dead-stock', businessId, storeId, deadStockDays],
    queryFn: () =>
      api.get<DeadStockData>(
        `/reports/dead-stock?businessId=${businessId}${storeId ? `&storeId=${storeId}` : ''}&days=${deadStockDays}`,
      ),
    enabled: !!businessId && tab === 'dead-stock',
  });

  const { data: grossMarginData } = useQuery<GrossMarginData>({
    queryKey: ['report-gross-margin', businessId, storeId, startDate, endDate],
    queryFn: () =>
      api.get<GrossMarginData>(
        `/reports/gross-margin?businessId=${businessId}${storeId ? `&storeId=${storeId}` : ''}&startDate=${startDate}&endDate=${endDate}`,
      ),
    enabled: !!businessId && tab === 'gross-margin',
  });

  const { data: shrinkageData } = useQuery<ShrinkageData>({
    queryKey: ['report-shrinkage', businessId, storeId, startDate, endDate],
    queryFn: () =>
      api.get<ShrinkageData>(
        `/reports/shrinkage?businessId=${businessId}${storeId ? `&storeId=${storeId}` : ''}&startDate=${startDate}&endDate=${endDate}`,
      ),
    enabled: !!businessId && tab === 'shrinkage',
  });

  const { data: deptPnlData } = useQuery<DeptPnlData>({
    queryKey: ['report-dept-pnl', businessId, storeId, startDate, endDate],
    queryFn: () =>
      api.get<DeptPnlData>(
        `/reports/department-pnl?businessId=${businessId}${storeId ? `&storeId=${storeId}` : ''}&startDate=${startDate}&endDate=${endDate}`,
      ),
    enabled: !!businessId && tab === 'dept-pnl',
  });

  const { data: recipeCostData } = useQuery<RecipeCostData>({
    queryKey: ['recipe-costing', businessId],
    queryFn: () => api.get<RecipeCostData>(`/reports/recipe-costing?businessId=${businessId}`),
    enabled: !!businessId && tab === 'recipe-costing',
  });

  const [transferStatusFilter, setTransferStatusFilter] = useState('');

  const { data: transfersData } = useQuery<StockTransfersData>({
    queryKey: ['report-transfers', businessId, storeId, startDate, endDate, transferStatusFilter],
    queryFn: () =>
      api.get<StockTransfersData>(
        `/reports/stock-transfers?businessId=${businessId}${storeId ? `&storeId=${storeId}` : ''}&startDate=${startDate}&endDate=${endDate}${transferStatusFilter ? `&status=${transferStatusFilter}` : ''}`,
      ),
    enabled: !!businessId && tab === 'transfers',
  });

  // ── New analytics tab state ───────────────────────────────────
  const [menuEngDays, setMenuEngDays] = useState(30);
  const [basketDays, setBasketDays] = useState(30);

  const { data: menuEngineeringData } = useQuery<MenuEngineeringData>({
    queryKey: ['report-menu-engineering', businessId, storeId, menuEngDays],
    queryFn: () =>
      api.get<MenuEngineeringData>(
        `/reports/menu-engineering?businessId=${businessId}${storeId ? `&storeId=${storeId}` : ''}&days=${menuEngDays}`,
      ),
    enabled: !!businessId && tab === 'menu-engineering',
  });

  const { data: basketAnalysisData } = useQuery<BasketAnalysisData>({
    queryKey: ['report-basket-analysis', businessId, storeId, basketDays],
    queryFn: () =>
      api.get<BasketAnalysisData>(
        `/reports/basket-analysis?businessId=${businessId}${storeId ? `&storeId=${storeId}` : ''}&days=${basketDays}`,
      ),
    enabled: !!businessId && tab === 'basket-analysis',
  });

  const { data: clvData = [] } = useQuery<ClvRow[]>({
    queryKey: ['report-clv', businessId],
    queryFn: () => api.get<ClvRow[]>(`/reports/clv?businessId=${businessId}`),
    enabled: !!businessId && tab === 'clv',
  });

  const { data: npsData } = useQuery<NpsSummary>({
    queryKey: ['report-nps', businessId],
    queryFn: () => api.get<NpsSummary>(`/reports/nps-summary?businessId=${businessId}`),
    enabled: !!businessId && tab === 'nps',
  });

  const { data: routeProfitability = [] } = useQuery<Array<{
    routeId: string; routeName: string; deliveryDays: string[];
    totalOrdersCents: number; deliveredOrdersCents: number;
    expensesCents: number; netProfitCents: number; ordersCount: number;
    topItems: Array<{ itemName: string; totalQty: number }>;
  }>>({
    queryKey: ['route-profitability', businessId, startDate, endDate],
    queryFn: () => api.get(`/delivery-routes/profitability?businessId=${businessId}&startDate=${startDate}&endDate=${endDate}`),
    enabled: !!businessId && tab === 'route-analytics',
  });

  const { data: invoiceAgeing } = useQuery<{
    rows: Array<{
      orderId: string; orderNumber: string; invoiceNumber: string; invoicedAt: string;
      customerName: string; customerPhone: string; agentName: string;
      totalCents: number; paidAmountCents: number; outstandingCents: number;
      daysOutstanding: number; paymentStatus: string; bucket: string;
    }>;
    summary: { '0-30d': number; '31-60d': number; '61-90d': number; '90+d': number; totalOutstanding: number };
  }>({
    queryKey: ['invoice-ageing', businessId],
    queryFn: () => api.get(`/reports/field-invoice-ageing?businessId=${businessId}`),
    enabled: !!businessId && tab === 'invoice-ageing',
  });

  const writeOffMutation = useMutation({
    mutationFn: (vars: { itemId: string; qty: number; reason: string; notes: string }) =>
      api.post('/inventory/adjustment', {
        itemId: vars.itemId,
        storeId,
        quantity: -vars.qty,
        type: vars.reason,
        notes: vars.notes,
        businessId,
      }),
    onSuccess: () => {
      setWriteOffItem(null);
      setWriteOffQty('');
      setWriteOffNotes('');
    },
  });

  const zReportMutation = useMutation({
    mutationFn: () =>
      api.post<{ zReportNumber: string; totalSalesCents: number }>('/reports/z-report', {
        businessId,
        storeId,
        cashierId: user?.id ?? '',
        closingBalanceCents: Math.round(Number(closingBalance) * 100),
      }),
    onSuccess: () => {
      setShowZReportModal(false);
      setClosingBalance('');
    },
  });

  // ── Derived data ──────────────────────────────────────────────

  const summary = salesData?.summary;
  const avgSale = summary && summary.totalSales > 0
    ? Math.round(summary.totalRevenueCents / summary.totalSales)
    : 0;

  const dailyData = useMemo(() => {
    if (!salesData?.sales) return [];
    const map: Record<string, number> = {};
    for (const sale of salesData.sales) {
      const day = new Date(sale.createdAt).toLocaleDateString('en-KE', { month: 'short', day: 'numeric' });
      map[day] = (map[day] ?? 0) + sale.totalCents;
    }
    return Object.entries(map)
      .map(([date, totalCents]) => ({ date, totalKES: totalCents / 100 }))
      .slice(-14);
  }, [salesData?.sales]);

  const hourlyBuckets = useMemo(() => {
    const buckets = new Array(24).fill(0) as number[];
    (salesData?.sales ?? []).forEach((s) => {
      buckets[new Date(s.createdAt).getHours()] += s.totalCents;
    });
    return buckets;
  }, [salesData?.sales]);

  const discountTotal = useMemo(
    () => (salesData?.sales ?? []).reduce((sum, s) => sum + (s.discountCents ?? 0), 0),
    [salesData?.sales],
  );

  const serviceChargeTotal = useMemo(
    () => (salesData?.sales ?? []).reduce((sum, s) => sum + (s.serviceChargeCents ?? 0), 0),
    [salesData?.sales],
  );

  const peakHour = useMemo(() => {
    const max = Math.max(...hourlyBuckets);
    if (max === 0) return null;
    const h = hourlyBuckets.indexOf(max);
    return h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
  }, [hourlyBuckets]);

  const maxHourlyBucket = useMemo(() => Math.max(...hourlyBuckets, 1), [hourlyBuckets]);

  // ── Tab config (grouped) ──────────────────────────────────────

  type TabDef = { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> };
  type GroupDef = { id: TabGroup; label: string; icon: React.ComponentType<{ className?: string }>; tabs: TabDef[] };

  const TAB_GROUPS: GroupDef[] = [
    {
      id: 'financial', label: 'Financial', icon: DollarSign,
      tabs: [
        { id: 'overview', label: 'Overview', icon: BarChart3 },
        { id: 'sales', label: 'Sales', icon: ShoppingBag },
        { id: 'tax', label: 'Tax Report', icon: FileText },
        { id: 'vat-return', label: 'VAT Return', icon: FileText },
        { id: 'pl', label: 'P & L', icon: TrendingUp },
        { id: 'gross-margin', label: 'Gross Margin', icon: TrendingUp },
        { id: 'dept-pnl', label: 'Dept P&L', icon: BarChart3 },
        { id: 'menu-engineering', label: 'Menu Engineering', icon: BarChart2 },
        { id: 'fiscal', label: 'X / Z Report', icon: DollarSign },
      ],
    },
    {
      id: 'inventory', label: 'Inventory', icon: Package,
      tabs: [
        { id: 'inventory', label: 'Stock', icon: Package },
        { id: 'transfers', label: 'Transfers', icon: ArrowRightLeft },
        { id: 'dead-stock', label: 'Dead Stock', icon: Package },
        { id: 'shrinkage', label: 'Shrinkage', icon: AlertTriangle },
        { id: 'grn', label: 'GRN Discrepancy', icon: AlertTriangle },
        { id: 'serials', label: 'Serials', icon: Hash },
        { id: 'recipes', label: 'Recipe Variance', icon: ChefHat },
        { id: 'bundles', label: 'Bundles', icon: Layers },
        { id: 'recipe-costing', label: 'Food Cost', icon: ChefHat },
      ],
    },
    {
      id: 'customers', label: 'Customers', icon: Users,
      tabs: [
        { id: 'customer-analytics', label: 'Analytics', icon: BarChart2 },
        { id: 'item-summary', label: 'Item Summary', icon: Package },
        { id: 'forecasting', label: 'Forecasting', icon: TrendingUp },
        { id: 'credit', label: 'Credit Book', icon: CreditCard },
        { id: 'layaway', label: 'Layaway', icon: BookOpen },
        { id: 'proforma', label: 'Proforma', icon: ClipboardList },
        { id: 'basket-analysis', label: 'Basket Analysis', icon: ShoppingBag },
        { id: 'clv', label: 'Customer LTV', icon: Users },
        { id: 'nps', label: 'NPS', icon: TrendingUp },
      ],
    },
    {
      id: 'hr', label: 'HR & Staff', icon: Users,
      tabs: [
        { id: 'attendance', label: 'Attendance', icon: BarChart3 },
        { id: 'commissions', label: 'Commissions', icon: TrendingUp },
        { id: 'employee-sales', label: 'Sales by Staff', icon: Smartphone },
      ],
    },
    {
      id: 'suppliers', label: 'Suppliers', icon: Truck,
      tabs: [
        { id: 'suppliers', label: 'Performance', icon: Truck },
        { id: 'supplier-ageing', label: 'Ageing', icon: Calendar },
      ],
    },
    {
      id: 'compliance', label: 'Compliance', icon: Shield,
      tabs: [
        { id: 'kra', label: 'KRA Export', icon: Flag },
        { id: 'audit', label: 'Audit Log', icon: Shield },
        { id: 'export', label: 'Full Export', icon: DatabaseBackup },
      ],
    },
    {
      id: 'field-sales', label: 'Field Sales', icon: MapPin,
      tabs: [
        { id: 'route-analytics', label: 'Route Analytics', icon: MapPin },
        { id: 'invoice-ageing', label: 'Invoice Ageing', icon: Calendar },
      ],
    },
  ];

  const allTabs = TAB_GROUPS.flatMap((g) => g.tabs.map((t) => ({ ...t, group: g.label })));
  const searchResults = reportSearch.trim()
    ? allTabs.filter((t) => t.label.toLowerCase().includes(reportSearch.toLowerCase()) || t.group.toLowerCase().includes(reportSearch.toLowerCase()))
    : [];
  const visibleTabs = reportSearch.trim() ? [] : (TAB_GROUPS.find((g) => g.id === tabGroup)?.tabs ?? TAB_GROUPS[0].tabs);

  function handleTabClick(t: Tab) {
    setTab(t);
    setReportSearch('');
    const grp = TAB_GROUPS.find((g) => g.tabs.some((x) => x.id === t));
    if (grp) setTabGroup(grp.id);
  }

  function handleGroupClick(gid: TabGroup) {
    setTabGroup(gid);
    setReportSearch('');
    const grp = TAB_GROUPS.find((g) => g.id === gid);
    if (grp && !grp.tabs.some((t) => t.id === tab)) {
      setTab(grp.tabs[0].id);
    }
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-4 sm:px-6 py-4">
        <div className="space-y-4 mb-4">
          <PageHeader title="Reports & Analytics" icon={<BarChart3 className="w-5 h-5" />} />

          <div className="flex flex-col lg:flex-row lg:items-end gap-3 lg:flex-wrap">
            {/* Branch / Store selector: Owner only */}
            {isOwner && stores.length > 0 && (
              <Select label="Branch" hideLabel className="w-full sm:w-52" value={selectedStoreId} onChange={(e) => setSelectedStoreId(e.target.value)} title="Filter reports by branch">
                <option value="">All Branches</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            )}

            {/* Date range */}
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-500 flex-shrink-0" aria-hidden />
              <Segmented size="sm" value={range} onChange={(r) => setRange(r as Range)} items={(['today', 'week', 'month', 'quarter', 'year', 'custom'] as Range[]).map((r) => ({ id: r, label: RANGE_LABELS[r] }))} />
            </div>

            {/* Comparison period */}
            <Select label="Compare with" hideLabel className="w-full sm:w-48" value={comparisonPeriod} onChange={(e) => setComparisonPeriod(e.target.value as ComparisonPeriod)}>
              {Object.entries(COMPARISON_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>

            {/* Chart controls */}
            {(tab === 'overview' || tab === 'sales') && (
              <div className="flex flex-wrap items-center gap-2 max-w-full">
                <Segmented size="sm" value={chartType} onChange={(t) => setChartType(t as typeof chartType)} items={(['bar', 'line', 'area'] as const).map((t) => ({ id: t, label: t[0].toUpperCase() + t.slice(1) }))} />
                <Button size="sm" variant={showTrendlines ? 'primary' : 'secondary'} aria-pressed={showTrendlines} onClick={() => setShowTrendlines(!showTrendlines)}>Trends</Button>
              </div>
            )}
          </div>
        </div>

        {/* Custom date inputs */}
        {range === 'custom' && (
          <div className="flex items-end gap-2 mb-4">
            <Input label="From" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <Input label="To" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        )}

        {/* ── Report search + group nav ── */}
        <div className="mt-4 space-y-2">
          {/* Search bar */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search reports… (e.g. sales, stock, VAT)"
              value={reportSearch}
              onChange={(e) => setReportSearch(e.target.value)}
              className="w-full sm:w-72 border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
            />
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx={11} cy={11} r={8}/><path d="m21 21-4.35-4.35"/></svg>
            {reportSearch && (
              <button onClick={() => setReportSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" aria-label="Close">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            {/* Search dropdown */}
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1 max-h-72 overflow-y-auto">
                {searchResults.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      onClick={() => handleTabClick(t.id)}
                      className="flex items-center gap-3 w-full px-3 py-2 text-sm hover:bg-blue-50 text-left"
                    >
                      <Icon className="w-4 h-4 text-gray-400 shrink-0" />
                      <div>
                        <div className="font-medium text-gray-800">{t.label}</div>
                        <div className="text-xs text-gray-400">{t.group}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {reportSearch && searchResults.length === 0 && (
              <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-50 px-4 py-3 text-sm text-gray-400">
                No reports found for "{reportSearch}"
              </div>
            )}
          </div>

          {/* Report groups, then the reports inside the chosen group */}
          <Segmented
            size="sm"
            value={reportSearch ? '' : tabGroup}
            onChange={(g) => handleGroupClick(g as TabGroup)}
            items={TAB_GROUPS.map((g) => { const GIcon = g.icon; return { id: g.id, label: g.label, icon: <GIcon className="w-3.5 h-3.5" /> }; })}
            className="pb-1"
          />

          {!reportSearch && (
            <Tabs
              value={tab}
              onChange={(t) => handleTabClick(t as Tab)}
              tabs={visibleTabs.map((t) => { const Icon = t.icon; return { id: t.id as string, label: t.label, icon: <Icon className="w-3.5 h-3.5" /> }; })}
            />
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {salesLoading && (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <RefreshCw className="w-6 h-6 animate-spin mr-2" />
            Loading report data…
          </div>
        )}

        {!salesLoading && (
          <>
            {/* ── OVERVIEW ── */}
            {tab === 'overview' && (
              <div className="space-y-6">
                {/* Enhanced KPI cards with comparison */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <StatCard
                    label="Total Revenue"
                    value={formatKES(summary?.totalRevenueCents ?? 0)}
                    icon={DollarSign}
                    color="bg-blue-500"
                    sub={`${summary?.totalSales ?? 0} transactions`}
                    valueColor="text-green-600"
                  />
                  <StatCard
                    label="Avg Sale Value"
                    value={formatKES(avgSale)}
                    icon={TrendingUp}
                    color="bg-green-500"
                    valueColor="text-green-600"
                  />
                  <StatCard
                    label="VAT Collected"
                    value={formatKES(summary?.totalVatCents ?? 0)}
                    icon={FileText}
                    color="bg-purple-500"
                  />
                  <StatCard
                    label="Net Profit"
                    value={plData ? formatKES(plData.netProfitCents) : '—'}
                    icon={BarChart3}
                    color={plData && plData.netProfitCents >= 0 ? 'bg-emerald-500' : 'bg-red-500'}
                    valueColor={plData ? (plData.netProfitCents >= 0 ? 'text-green-600' : 'text-red-600') : undefined}
                  />
                </div>

                {/* Comparison metrics */}
                {comparisonSalesData && comparisonPeriod !== 'none' && (
                  <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                    <h3 className="text-base font-semibold text-gray-800 mb-4">
                      Period Comparison - {COMPARISON_LABELS[comparisonPeriod]}
                    </h3>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      {[
                        {
                          label: 'Revenue Change',
                          current: summary?.totalRevenueCents ?? 0,
                          previous: comparisonSalesData.summary?.totalRevenueCents ?? 0,
                          format: formatKES,
                        },
                        {
                          label: 'Transaction Change',
                          current: summary?.totalSales ?? 0,
                          previous: comparisonSalesData.summary?.totalSales ?? 0,
                          format: (v: number) => v.toString(),
                        },
                        {
                          label: 'Avg Sale Change',
                          current: avgSale,
                          previous: comparisonSalesData.summary && comparisonSalesData.summary.totalSales > 0
                            ? Math.round(comparisonSalesData.summary.totalRevenueCents / comparisonSalesData.summary.totalSales)
                            : 0,
                          format: formatKES,
                        },
                        {
                          label: 'VAT Change',
                          current: summary?.totalVatCents ?? 0,
                          previous: comparisonSalesData.summary?.totalVatCents ?? 0,
                          format: formatKES,
                        },
                      ].map((metric) => {
                        const change = metric.previous > 0 ? ((metric.current - metric.previous) / metric.previous) * 100 : 0;
                        const isPositive = change >= 0;
                        return (
                          <div key={metric.label} className="text-center">
                            <p className="text-xs text-gray-500 mb-1">{metric.label}</p>
                            <p className={`text-lg font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                              {isPositive ? '+' : ''}{change.toFixed(1)}%
                            </p>
                            <p className="text-xs text-gray-400">
                              {metric.format(metric.current)} vs {metric.format(metric.previous)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Enhanced daily revenue chart */}
                {dailyData.length > 0 && (
                  <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                      <h2 className="text-base font-semibold text-gray-800">Revenue Trend</h2>
                      <div className="flex items-center gap-2">
                        <span className="hidden sm:inline text-xs text-gray-400">Chart Type:</span>
                        <div className="flex rounded border border-gray-200 overflow-hidden">
                          {(['bar', 'line', 'area'] as const).map((type) => (
                            <button
                              key={type}
                              onClick={() => setChartType(type)}
                              className={`px-2 py-1 text-xs capitalize ${chartType === type ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                            >
                              {type}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={280}>
                      {chartType === 'bar' ? (
                        <BarChart data={dailyData} margin={{ left: 0, right: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`} />
                          <Tooltip formatter={(v: number) => [`KES ${v.toLocaleString('en-KE')}`, 'Revenue']} />
                          <Bar dataKey="totalKES" fill="#3B7DFF" radius={[4, 4, 0, 0]} />
                          {showTrendlines && (
                            <ReferenceLine
                              stroke="#EF4444"
                              strokeDasharray="5 5"
                              segment={[
                                { x: dailyData[0]?.date, y: dailyData[0]?.totalKES },
                                { x: dailyData[dailyData.length - 1]?.date, y: dailyData[dailyData.length - 1]?.totalKES }
                              ]}
                            />
                          )}
                        </BarChart>
                      ) : chartType === 'line' ? (
                        <LineChart data={dailyData} margin={{ left: 0, right: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`} />
                          <Tooltip formatter={(v: number) => [`KES ${v.toLocaleString('en-KE')}`, 'Revenue']} />
                          <Line type="monotone" dataKey="totalKES" stroke="#3B7DFF" strokeWidth={2} dot={{ r: 4 }} />
                        </LineChart>
                      ) : (
                        <AreaChart data={dailyData} margin={{ left: 0, right: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`} />
                          <Tooltip formatter={(v: number) => [`KES ${v.toLocaleString('en-KE')}`, 'Revenue']} />
                          <Area type="monotone" dataKey="totalKES" stroke="#3B7DFF" fill="#3B7DFF" fillOpacity={0.3} />
                        </AreaChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Customer insights */}
                {customerAnalytics && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                      <h3 className="text-base font-semibold text-gray-800 mb-4">Customer Insights</h3>
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Total Customers</span>
                          <span className="font-semibold">{customerAnalytics.totalCustomers}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">New Customers</span>
                          <span className="font-semibold text-green-600">+{customerAnalytics.newCustomers}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Returning Customers</span>
                          <span className="font-semibold text-blue-600">{customerAnalytics.returningCustomers}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Avg Order Value</span>
                          <span className="font-semibold">{formatKES(customerAnalytics.avgOrderValue)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Customer LTV</span>
                          <span className="font-semibold">{formatKES(customerAnalytics.customerLifetimeValue)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                      <h3 className="text-base font-semibold text-gray-800 mb-4">Top Customers</h3>
                      <div className="space-y-2">
                        {customerAnalytics.topCustomers.slice(0, 5).map((customer, i) => (
                          <div key={customer.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-xs font-bold text-blue-700">
                                {i + 1}
                              </div>
                              <div>
                                <p className="font-medium text-sm">{customer.name}</p>
                                <p className="text-xs text-gray-500">{customer.orderCount} orders</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold text-sm">{formatKES(customer.totalSpent)}</p>
                              <p className="text-xs text-gray-500">
                                {new Date(customer.lastVisit).toLocaleDateString('en-KE', { month: 'short', day: 'numeric' })}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Enhanced payment methods and P&L sections remain the same but with mobile responsiveness */}
                {paymentMethods.length > 0 && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                      <h2 className="text-base font-semibold text-gray-800 mb-4">Payment Methods</h2>
                      <div className="space-y-3">
                        {paymentMethods.map((pm, i) => {
                          const total = paymentMethods.reduce((s, p) => s + p.totalCents, 0);
                          const pct = total > 0 ? Math.round((pm.totalCents / total) * 100) : 0;
                          return (
                            <div key={pm.method}>
                              <div className="flex justify-between text-sm mb-1">
                                <span className="font-medium text-gray-700">{pm.method}</span>
                                <span className="text-gray-500">
                                  {formatKES(pm.totalCents)} · {pm.count} txns
                                </span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-2">
                                <div
                                  className="h-2 rounded-full transition-all"
                                  style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                      <h2 className="text-base font-semibold text-gray-800 mb-4">Payment Split</h2>
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie
                            data={paymentMethods}
                            dataKey="totalCents"
                            nameKey="method"
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={80}
                            paddingAngle={2}
                          >
                            {paymentMethods.map((_, i) => (
                              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: number) => formatKES(v)} />
                          <Legend iconSize={10} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {plData && (
                  <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                    <h2 className="text-base font-semibold text-gray-800 mb-4">P&L Quick View</h2>
                    <div className="space-y-2 max-w-sm">
                      {[
                        { label: 'Revenue', value: plData.revenueCents, color: 'text-green-600' },
                        { label: 'Cost of Goods', value: -plData.cogsCents, color: 'text-red-500' },
                        { label: 'Gross Profit', value: plData.grossProfitCents, color: plData.grossProfitCents >= 0 ? 'text-green-600' : 'text-red-600', bold: true },
                        { label: 'Expenses', value: -plData.expensesCents, color: 'text-red-500' },
                        { label: 'Net Profit', value: plData.netProfitCents, color: plData.netProfitCents >= 0 ? 'text-green-600' : 'text-red-600', bold: true, border: true },
                      ].map((row) => (
                        <div
                          key={row.label}
                          className={`flex justify-between py-2 text-sm ${row.bold ? 'font-bold text-base' : ''} ${row.border ? 'border-t pt-3' : ''}`}
                        >
                          <span className="text-gray-600">{row.label}</span>
                          <span className={row.color}>{formatKES(Math.abs(row.value))}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── CUSTOMER ANALYTICS ── */}
            {tab === 'customer-analytics' && (
              <div className="space-y-6">
                {customerAnalytics ? (
                  <>
                    {/* Customer KPIs */}
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                      <StatCard
                        label="Total Customers"
                        value={customerAnalytics.totalCustomers}
                        icon={Users}
                        color="bg-blue-500"
                      />
                      <StatCard
                        label="New Customers"
                        value={customerAnalytics.newCustomers}
                        icon={TrendingUp}
                        color="bg-green-500"
                        sub="This period"
                      />
                      <StatCard
                        label="Returning Rate"
                        value={`${customerAnalytics.totalCustomers > 0 ? Math.round((customerAnalytics.returningCustomers / customerAnalytics.totalCustomers) * 100) : 0}%`}
                        icon={RefreshCw}
                        color="bg-purple-500"
                      />
                      <StatCard
                        label="Avg Order Value"
                        value={formatKES(customerAnalytics.avgOrderValue)}
                        icon={DollarSign}
                        color="bg-emerald-500"
                      />
                      <StatCard
                        label="Customer LTV"
                        value={formatKES(customerAnalytics.customerLifetimeValue)}
                        icon={BarChart3}
                        color="bg-orange-500"
                      />
                    </div>

                    {/* Top Customers Table */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-5 py-4 border-b flex justify-between items-center">
                        <h2 className="font-semibold text-gray-800">Top Customers by Value</h2>
                        <button
                          onClick={() => {
                            const rows = customerAnalytics.topCustomers.map((c) => [
                              c.name,
                              String(c.orderCount),
                              (c.totalSpent / 100).toFixed(2),
                              new Date(c.lastVisit).toLocaleDateString('en-KE'),
                            ]);
                            downloadCsv('top-customers.csv', [
                              ['Customer Name', 'Orders', 'Total Spent (KES)', 'Last Visit'],
                              ...rows,
                            ]);
                          }}
                          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <Download className="w-4 h-4" /> Export
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Customer</th>
                              <th className="text-center px-5 py-3 font-medium text-gray-600">Orders</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Total Spent</th>
                              <th className="text-center px-5 py-3 font-medium text-gray-600">Last Visit</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {customerAnalytics.topCustomers.map((customer, i) => (
                              <tr key={customer.id} className="hover:bg-gray-50">
                                <td className="px-5 py-3">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-xs font-bold text-blue-700">
                                      {i + 1}
                                    </div>
                                    <span className="font-medium">{customer.name}</span>
                                  </div>
                                </td>
                                <td className="px-5 py-3 text-center">{customer.orderCount}</td>
                                <td className="px-5 py-3 text-right font-semibold">{formatKES(customer.totalSpent)}</td>
                                <td className="px-5 py-3 text-center text-gray-500">
                                  {new Date(customer.lastVisit).toLocaleDateString('en-KE')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center py-16 text-gray-400">
                    <RefreshCw className="w-6 h-6 animate-spin mr-2" />
                    Loading customer analytics…
                  </div>
                )}
              </div>
            )}

            {/* ── FORECASTING ── */}
            {tab === 'forecasting' && (
              <div className="space-y-6">
                {forecastData ? (
                  <>
                    {/* Forecast Summary */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <StatCard
                        label="Items Tracked"
                        value={forecastData.items.length}
                        icon={Package}
                        color="bg-blue-500"
                      />
                      <StatCard
                        label="Low Stock Items"
                        value={forecastData.items.filter(i => i.currentStock < i.reorderPoint).length}
                        icon={AlertCircle}
                        color="bg-red-500"
                      />
                      <StatCard
                        label="High Confidence"
                        value={forecastData.items.filter(i => i.confidence === 'HIGH').length}
                        icon={TrendingUp}
                        color="bg-green-500"
                      />
                      <StatCard
                        label="Reorder Needed"
                        value={forecastData.items.filter(i => i.suggestedOrderQty > 0).length}
                        icon={ShoppingBag}
                        color="bg-orange-500"
                      />
                    </div>

                    {/* Forecast Table */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-5 py-4 border-b flex justify-between items-center">
                        <h2 className="font-semibold text-gray-800">Inventory Forecast & Recommendations</h2>
                        <button
                          onClick={() => {
                            const rows = forecastData.items.map((item) => [
                              item.itemName,
                              String(item.currentStock),
                              String(item.forecastedDemand),
                              String(item.reorderPoint),
                              String(item.suggestedOrderQty),
                              item.confidence,
                              item.trend.toFixed(3),
                            ]);
                            downloadCsv('inventory-forecast.csv', [
                              ['Item', 'Current Stock', 'Forecasted Demand', 'Reorder Point', 'Suggested Order', 'Confidence', 'Trend'],
                              ...rows,
                            ]);
                          }}
                          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <Download className="w-4 h-4" /> Export
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Item</th>
                              <th className="text-center px-5 py-3 font-medium text-gray-600">Current Stock</th>
                              <th className="text-center px-5 py-3 font-medium text-gray-600">Forecasted Demand</th>
                              <th className="text-center px-5 py-3 font-medium text-gray-600">Confidence</th>
                              <th className="text-center px-5 py-3 font-medium text-gray-600">Trend</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {forecastData.items
                              .sort((a, b) => b.suggestedOrderQty - a.suggestedOrderQty)
                              .map((item) => {
                                const needsReorder = item.currentStock < item.reorderPoint;
                                const trendDirection = item.trend > 0.1 ? 'up' : item.trend < -0.1 ? 'down' : 'stable';
                                const trendColor = trendDirection === 'up' ? 'text-green-600' : trendDirection === 'down' ? 'text-red-600' : 'text-gray-600';
                                
                                return (
                                  <tr key={item.itemId} className={`hover:bg-gray-50 ${needsReorder ? 'bg-red-50/30' : ''}`}>
                                    <td className="px-5 py-3 font-medium">{item.itemName}</td>
                                    <td className={`px-5 py-3 text-center ${needsReorder ? 'text-red-600 font-semibold' : ''}`}>
                                      {item.currentStock}
                                    </td>
                                    <td className="px-5 py-3 text-center">{item.forecastedDemand}</td>
                                    <td className="px-5 py-3 text-center">
                                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                                        item.confidence === 'HIGH' ? 'bg-green-100 text-green-700' :
                                        item.confidence === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' :
                                        'bg-red-100 text-red-700'
                                      }`}>
                                        {item.confidence}
                                      </span>
                                    </td>
                                    <td className={`px-5 py-3 text-center font-semibold ${trendColor}`}>
                                      {trendDirection === 'up' ? '↗' : trendDirection === 'down' ? '↘' : '→'}
                                      {Math.abs(item.trend * 100).toFixed(1)}%
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center py-16 text-gray-400">
                    <RefreshCw className="w-6 h-6 animate-spin mr-2" />
                    Loading forecasting data…
                  </div>
                )}
              </div>
            )}

            {/* ── SALES ── */}
            {tab === 'sales' && (
              <div className="space-y-4">
                {/* KPI row */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <StatCard label="Transactions" value={summary?.totalSales ?? 0} icon={ShoppingBag} color="bg-blue-500" />
                  <StatCard label="Total Revenue" value={formatKES(summary?.totalRevenueCents ?? 0)} icon={DollarSign} color="bg-green-500" />
                  <StatCard label="Avg Sale" value={formatKES(avgSale)} icon={TrendingUp} color="bg-purple-500" />
                  <StatCard label="VAT Collected" value={formatKES(summary?.totalVatCents ?? 0)} icon={FileText} color="bg-orange-500" />
                </div>

                {/* Analytics row: discounts + service charges */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    { label: 'Total Discounts', value: formatKES(discountTotal), sub: discountTotal > 0 && summary?.totalRevenueCents ? `${((discountTotal / (summary.totalRevenueCents + discountTotal)) * 100).toFixed(1)}% of gross` : 'No discounts', color: 'text-red-500', bg: 'bg-red-50' },
                    { label: 'Service Charges', value: formatKES(serviceChargeTotal), sub: 'Collected', color: 'text-amber-600', bg: 'bg-amber-50' },
                    { label: 'Peak Hour', value: peakHour ?? '—', sub: peakHour ? 'Highest revenue hour' : 'No data', color: 'text-indigo-600', bg: 'bg-indigo-50' },
                    { label: 'Net (ex-VAT/TOT)', value: formatKES(Math.max(0, (summary?.totalRevenueCents ?? 0) - (summary?.totalVatCents ?? 0) - (summary?.totalTotCents ?? 0))), sub: 'Excl. all taxes', color: 'text-emerald-600', bg: 'bg-emerald-50' },
                  ].map(({ label, value, sub, color, bg }) => (
                    <div key={label} className={`${bg} rounded-xl p-4 border border-white`}>
                      <p className={`text-lg font-black ${color} tabular-nums`}>{value}</p>
                      <p className="text-xs font-semibold text-gray-600 mt-0.5">{label}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>
                    </div>
                  ))}
                </div>

                {/* Hourly revenue chart */}
                {(salesData?.sales?.length ?? 0) > 0 && (
                  <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="font-semibold text-gray-800">Revenue by Hour of Day</h2>
                      <span className="text-xs text-gray-400">Based on {salesData?.sales?.length} transactions</span>
                    </div>
                    <div className="flex items-end gap-[2px] h-24">
                      {hourlyBuckets.map((v, h) => {
                        const frac = v / maxHourlyBucket;
                        const lbl = h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;
                        return (
                          <div key={h} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                            <div
                              title={`${lbl}: ${formatKES(v)}`}
                              className={`w-full rounded-t transition-all ${v > 0 ? 'bg-blue-400 hover:bg-blue-600' : 'bg-gray-100'}`}
                              style={{ height: `${Math.max(frac * 88, v > 0 ? 3 : 2)}px` }}
                            />
                            {h % 4 === 0 && <span className="text-[9px] text-gray-400">{lbl}</span>}
                            {v > 0 && (
                              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10">
                                {lbl}: {formatKES(v)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-5 py-4 border-b">
                    <h2 className="font-semibold text-gray-800">Payment Method Breakdown</h2>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-5 py-3 font-medium text-gray-600">Method</th>
                        <th className="text-right px-5 py-3 font-medium text-gray-600">Transactions</th>
                        <th className="text-right px-5 py-3 font-medium text-gray-600">Total</th>
                        <th className="text-right px-5 py-3 font-medium text-gray-600">Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {paymentMethods.map((pm) => {
                        const total = paymentMethods.reduce((s, p) => s + p.totalCents, 0);
                        const pct = total > 0 ? ((pm.totalCents / total) * 100).toFixed(1) : '0.0';
                        return (
                          <tr key={pm.method} className="hover:bg-gray-50">
                            <td className="px-5 py-3 font-medium">{pm.method}</td>
                            <td className="px-5 py-3 text-right">{pm.count}</td>
                            <td className="px-5 py-3 text-right font-semibold">{formatKES(pm.totalCents)}</td>
                            <td className="px-5 py-3 text-right text-gray-500">{pct}%</td>
                          </tr>
                        );
                      })}
                      {paymentMethods.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-5 py-8 text-center text-gray-400">No sales data</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-5 py-4 border-b flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <h2 className="font-semibold text-gray-800">
                        Sales ({salesData?.sales?.length ?? 0})
                      </h2>
                      <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                        <button
                          onClick={() => setSalesViewMode('by-date')}
                          className={`px-3 py-1 ${salesViewMode === 'by-date' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                        >
                          By Date
                        </button>
                        <button
                          onClick={() => setSalesViewMode('transactions')}
                          className={`px-3 py-1 border-l ${salesViewMode === 'transactions' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                        >
                          All Transactions
                        </button>
                      </div>
                      {/* Live indicator */}
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <span className={`inline-block w-2 h-2 rounded-full ${salesFetching ? 'bg-amber-400 animate-pulse' : 'bg-green-400'}`} />
                        {salesFetching ? 'Updating…' : salesUpdatedAt
                          ? `Updated ${Math.round((Date.now() - salesUpdatedAt) / 1000)}s ago`
                          : 'Live'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => { void refetchSales(); void refetchPayments(); void refetchVat(); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                        title="Refresh now"
                      >
                        <RefreshCw size={13} className={salesFetching ? 'animate-spin' : ''} />
                        Refresh
                      </button>
                      <button
                        onClick={() => {
                          if (!salesData?.sales?.length) return;
                          const byDate: Record<string, NonNullable<typeof salesData>['sales']> = {};
                          for (const s of salesData.sales) {
                            const d = new Date(s.createdAt).toLocaleDateString('en-KE', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
                            if (!byDate[d]) byDate[d] = [];
                            byDate[d].push(s);
                          }
                          const rows = Object.entries(byDate).map(([date, daySales]) => {
                            const dayTotal = daySales.reduce((s, x) => s + x.totalCents, 0);
                            const dayVat = daySales.reduce((s, x) => s + x.vatCents, 0);
                            const dayNet = daySales.reduce((s, x) => s + (x.subtotalCents - x.vatCents), 0);
                            return `<h2>${date} &mdash; ${daySales.length} sales &mdash; ${formatKES(dayTotal)}</h2>
                            <table><thead><tr><th>Receipt #</th><th>Time</th><th class="r">Net (ex-VAT)</th><th class="r">VAT (incl.)</th><th class="r">Total</th></tr></thead><tbody>
                            ${daySales.map((s) => `<tr><td>${s.receiptNumber ?? '—'}</td><td>${new Date(s.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</td><td class="r">${formatKES(s.subtotalCents - s.vatCents)}</td><td class="r">${formatKES(s.vatCents)}</td><td class="r">${formatKES(s.totalCents)}</td></tr>`).join('')}
                            </tbody><tfoot><tr><td colspan="2">Day Total</td><td class="r">${formatKES(dayNet)}</td><td class="r">${formatKES(dayVat)}</td><td class="r">${formatKES(dayTotal)}</td></tr></tfoot></table>`;
                          }).join('');
                          const grandTotal = salesData.sales.reduce((s, x) => s + x.totalCents, 0);
                          printHtml('Sales Report', `<h1>Sales Report</h1><p class="sub">${startDate.substring(0,10)} to ${endDate.substring(0,10)} &bull; ${salesData.sales.length} transactions</p>${rows}<div class="grand">Grand Total: ${formatKES(grandTotal)}</div>`);
                        }}
                        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-800"
                      >
                        <Printer className="w-4 h-4" /> Print
                      </button>
                      <button
                        onClick={() => {
                          if (!salesData?.sales?.length) return;
                          downloadCsv(`sales-${startDate.substring(0,10)}-${endDate.substring(0,10)}.csv`, [
                            ['Receipt #', 'Date', 'Time', 'Net ex-VAT (KES)', 'VAT incl. (KES)', 'Total (KES)'],
                            ...salesData.sales.map((s) => [
                              s.receiptNumber ?? '',
                              new Date(s.createdAt).toLocaleDateString('en-KE'),
                              new Date(s.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }),
                              ((s.subtotalCents - s.vatCents) / 100).toFixed(2),
                              (s.vatCents / 100).toFixed(2),
                              (s.totalCents / 100).toFixed(2),
                            ]),
                          ]);
                        }}
                        className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                      >
                        <Download className="w-4 h-4" /> Export CSV
                      </button>
                    </div>
                  </div>

                  {/* By Date view */}
                  {salesViewMode === 'by-date' && (() => {
                    const byDate: Record<string, NonNullable<typeof salesData>['sales']> = {};
                    for (const s of (salesData?.sales ?? [])) {
                      const d = new Date(s.createdAt).toLocaleDateString('en-KE', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
                      if (!byDate[d]) byDate[d] = [];
                      byDate[d].push(s);
                    }
                    const dateEntries = Object.entries(byDate);
                    return (
                      <div>
                        {dateEntries.length === 0 && (
                          <p className="px-5 py-8 text-center text-gray-400">No sales in this period</p>
                        )}
                        {dateEntries.map(([date, daySales]) => {
                          const dayTotal = daySales.reduce((s, x) => s + x.totalCents, 0);
                          const dayVat = daySales.reduce((s, x) => s + x.vatCents, 0);
                          const isExpanded = expandedSaleDate === date;
                          return (
                            <div key={date} className="border-b last:border-b-0">
                              {/* Date header row — clickable */}
                              <button
                                onClick={() => setExpandedSaleDate(isExpanded ? null : date)}
                                className="w-full flex items-center justify-between px-5 py-3 hover:bg-blue-50 transition-colors text-left"
                              >
                                <div className="flex items-center gap-3">
                                  <div className={`w-2 h-2 rounded-full ${isExpanded ? 'bg-blue-500' : 'bg-gray-300'}`} />
                                  <span className="font-semibold text-gray-800">{date}</span>
                                  <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{daySales.length} sales</span>
                                </div>
                                <div className="flex items-center gap-6 text-sm">
                                  <span className="text-gray-500 hidden sm:block">VAT: <span className="font-medium text-purple-600">{formatKES(dayVat)}</span></span>
                                  <span className="font-bold text-gray-900">{formatKES(dayTotal)}</span>
                                  <span className="text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
                                </div>
                              </button>
                              {/* Expanded transactions for this date */}
                              {isExpanded && (
                                <div className="bg-gray-50 border-t">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="text-xs text-gray-400">
                                        <th className="text-left px-8 py-2 font-medium">Receipt #</th>
                                        <th className="text-left px-3 py-2 font-medium">Time</th>
                                        <th className="text-right px-3 py-2 font-medium">Net (ex-VAT)</th>
                                        <th className="text-right px-3 py-2 font-medium">VAT (incl.)</th>
                                        <th className="text-right px-5 py-2 font-medium">Total</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                      {daySales.map((sale) => (
                                        <tr key={sale.id} className="hover:bg-white">
                                          <td className="px-8 py-2 font-mono text-xs text-blue-600">{sale.receiptNumber ?? '—'}</td>
                                          <td className="px-3 py-2 text-gray-500 text-xs">
                                            {new Date(sale.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
                                          </td>
                                          <td className="px-3 py-2 text-right">{formatKES(sale.subtotalCents - sale.vatCents)}</td>
                                          <td className="px-3 py-2 text-right text-purple-600">{formatKES(sale.vatCents)}</td>
                                          <td className="px-5 py-2 text-right font-semibold">{formatKES(sale.totalCents)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot className="bg-blue-50">
                                      <tr className="font-semibold text-sm">
                                        <td colSpan={2} className="px-8 py-2 text-blue-700">Day Total ({daySales.length} sales)</td>
                                        <td className="px-3 py-2 text-right">{formatKES(daySales.reduce((s,x)=>s+x.subtotalCents - x.vatCents,0))}</td>
                                        <td className="px-3 py-2 text-right text-purple-600">{formatKES(dayVat)}</td>
                                        <td className="px-5 py-2 text-right text-blue-700">{formatKES(dayTotal)}</td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* All transactions view */}
                  {salesViewMode === 'transactions' && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="text-left px-5 py-3 font-medium text-gray-600">Receipt #</th>
                            <th className="text-left px-5 py-3 font-medium text-gray-600">Date & Time</th>
                            <th className="text-right px-5 py-3 font-medium text-gray-600">Net (ex-VAT)</th>
                            <th className="text-right px-5 py-3 font-medium text-gray-600">VAT (incl.)</th>
                            <th className="text-right px-5 py-3 font-medium text-gray-600">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {salesData?.sales?.map((sale) => (
                            <tr key={sale.id} className="hover:bg-gray-50">
                              <td className="px-5 py-3 font-mono text-xs text-blue-600">{sale.receiptNumber ?? '—'}</td>
                              <td className="px-5 py-3 text-gray-500">
                                {new Date(sale.createdAt).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'short' })}
                              </td>
                              <td className="px-5 py-3 text-right">{formatKES(sale.subtotalCents - sale.vatCents)}</td>
                              <td className="px-5 py-3 text-right text-purple-600">{formatKES(sale.vatCents)}</td>
                              <td className="px-5 py-3 text-right font-semibold">{formatKES(sale.totalCents)}</td>
                            </tr>
                          ))}
                          {(!salesData?.sales || salesData.sales.length === 0) && (
                            <tr>
                              <td colSpan={5} className="px-5 py-8 text-center text-gray-400">No sales in this period</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── ITEM SUMMARY ── */}
            {tab === 'item-summary' && (
              <div className="space-y-4">
                {!itemSummaryData && (
                  <div className="flex items-center justify-center py-16 text-gray-400">
                    <RefreshCw className="w-6 h-6 animate-spin mr-2" /> Loading…
                  </div>
                )}
                {itemSummaryData && (
                  <>
                    {/* Summary cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                      <StatCard label="Departments" value={itemSummaryData.categories.length} icon={Package} color="bg-blue-500" />
                      <StatCard label="Total Items Sold" value={itemSummaryData.grandTotalQty} icon={ShoppingBag} color="bg-indigo-500" />
                      <StatCard label="Total Revenue" value={formatKES(itemSummaryData.grandTotalCents)} icon={DollarSign} color="bg-green-500" />
                    </div>

                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-5 py-4 border-b flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="font-semibold text-gray-800">Item Summary by Department</h2>
                          <p className="text-xs text-gray-500 mt-0.5">{startDate.substring(0,10)} to {endDate.substring(0,10)}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => {
                              const deptRows = itemSummaryData.categories.map((cat) =>
                                `<h2>${cat.name} &mdash; ${cat.totalQty} items &mdash; ${formatKES(cat.totalCents)}</h2>
                                <table><thead><tr><th>Item Name</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead><tbody>
                                ${cat.items.map((i) => `<tr><td>${i.name}</td><td class="r">${i.qty}</td><td class="r">${formatKES(i.totalCents)}</td></tr>`).join('')}
                                </tbody><tfoot><tr><td>Subtotal</td><td class="r">${cat.totalQty}</td><td class="r">${formatKES(cat.totalCents)}</td></tr></tfoot></table>`
                              ).join('');
                              printHtml('Item Summary Report', `<h1>Item Summary Report</h1><p class="sub">${startDate.substring(0,10)} to ${endDate.substring(0,10)}</p>${deptRows}<div class="grand">Grand Total &mdash; ${itemSummaryData.grandTotalQty} items &mdash; ${formatKES(itemSummaryData.grandTotalCents)}</div>`);
                            }}
                            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-800"
                          >
                            <Printer className="w-4 h-4" /> Print
                          </button>
                          <button
                            onClick={() => {
                              const rows: string[][] = [['Department', 'Item Name', 'Qty Sold', 'Revenue (KES)']];
                              for (const cat of itemSummaryData.categories) {
                                for (const item of cat.items) {
                                  rows.push([cat.name, item.name, String(item.qty), (item.totalCents / 100).toFixed(2)]);
                                }
                                rows.push(['', `SUBTOTAL — ${cat.name}`, String(cat.totalQty), (cat.totalCents / 100).toFixed(2)]);
                                rows.push(['', '', '', '']);
                              }
                              rows.push(['GRAND TOTAL', '', String(itemSummaryData.grandTotalQty), (itemSummaryData.grandTotalCents / 100).toFixed(2)]);
                              downloadCsv(`item-summary-${startDate.substring(0,10)}-${endDate.substring(0,10)}.csv`, rows);
                            }}
                            className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                          >
                            <Download className="w-4 h-4" /> Export CSV
                          </button>
                        </div>
                      </div>

                      {/* Table */}
                      <div>
                        {itemSummaryData.categories.length === 0 && (
                          <p className="px-5 py-10 text-center text-gray-400">No sales data for this period</p>
                        )}
                        {itemSummaryData.categories.map((cat, ci) => (
                          <div key={cat.name} className={ci > 0 ? 'border-t border-gray-100' : ''}>
                            {/* Department header */}
                            <div className="flex items-center justify-between px-5 py-3 bg-gray-50">
                              <div className="flex items-center gap-2">
                                <span
                                  className="w-2.5 h-2.5 rounded-full"
                                  style={{ backgroundColor: CHART_COLORS[ci % CHART_COLORS.length] }}
                                />
                                <span className="font-semibold text-gray-800 uppercase text-sm tracking-wide">{cat.name}</span>
                                <span className="text-xs text-gray-400 bg-white border border-gray-200 rounded-full px-2 py-0.5">{cat.totalQty} items</span>
                              </div>
                              <span className="font-bold text-gray-800">{formatKES(cat.totalCents)}</span>
                            </div>
                            {/* Item rows */}
                            <table className="w-full text-sm">
                              <tbody className="divide-y divide-gray-50">
                                {cat.items.map((item) => {
                                  const pct = cat.totalCents > 0 ? (item.totalCents / cat.totalCents) * 100 : 0;
                                  return (
                                    <tr key={item.name} className="hover:bg-gray-50">
                                      <td className="px-8 py-2.5 text-gray-800">{item.name}</td>
                                      <td className="px-5 py-2.5 text-right text-gray-500 w-20">{item.qty}</td>
                                      <td className="px-5 py-2.5 text-right font-medium w-36">{formatKES(item.totalCents)}</td>
                                      <td className="px-5 py-2.5 w-32">
                                        <div className="flex items-center gap-2">
                                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                            <div
                                              className="h-full rounded-full"
                                              style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[ci % CHART_COLORS.length] }}
                                            />
                                          </div>
                                          <span className="text-xs text-gray-400 w-8 text-right">{pct.toFixed(0)}%</span>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                              {/* Department subtotal */}
                              <tfoot>
                                <tr className="bg-gray-50 border-t border-gray-200">
                                  <td className="px-8 py-2 text-xs font-semibold text-gray-500 uppercase">Subtotal</td>
                                  <td className="px-5 py-2 text-right text-sm font-semibold text-gray-700">{cat.totalQty}</td>
                                  <td className="px-5 py-2 text-right text-sm font-bold text-gray-800">{formatKES(cat.totalCents)}</td>
                                  <td />
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        ))}

                        {/* Grand total row */}
                        {itemSummaryData.categories.length > 0 && (
                          <div className="flex items-center justify-between px-5 py-4 border-t-2 border-blue-200 bg-blue-50">
                            <span className="font-bold text-blue-800 text-base">GRAND TOTAL</span>
                            <div className="flex items-center gap-8">
                              <span className="font-bold text-blue-700">{itemSummaryData.grandTotalQty} items</span>
                              <span className="font-bold text-blue-900 text-base">{formatKES(itemSummaryData.grandTotalCents)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── TAX ── */}
            {tab === 'tax' && vatData && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  <StatCard
                    label="Total Sales (VAT incl.)"
                    value={formatKES(vatData.totalSalesCents)}
                    icon={DollarSign}
                    color="bg-blue-500"
                  />
                  <StatCard
                    label="VAT Collected (16%)"
                    value={formatKES(vatData.totalVatCents)}
                    icon={FileText}
                    color="bg-purple-500"
                  />
                  <StatCard
                    label="Net of VAT"
                    value={formatKES(vatData.totalSalesCents - vatData.totalVatCents)}
                    icon={TrendingUp}
                    color="bg-green-500"
                  />
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-5 py-4 border-b flex justify-between items-center">
                    <h2 className="font-semibold text-gray-800">VAT Register</h2>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          openPdfReport(`/reports/pdf/vat?businessId=${encodeURIComponent(businessId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
                        }}
                        className="flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700"
                      >
                        <FileText className="w-4 h-4" />
                        PDF
                      </button>
                      <button
                        onClick={() => {
                          if (!vatData?.sales?.length) return;
                          const rows = vatData.sales.map((s) =>
                            `<tr><td>${s.receiptNumber ?? '—'}</td><td>${new Date(s.createdAt).toLocaleDateString('en-KE')}</td><td class="r">${formatKES(s.netCents)}</td><td class="r">${formatKES(s.vatCents)}</td><td class="r">${formatKES(s.totalCents)}</td></tr>`
                          ).join('');
                          printHtml('VAT Register', `<h1>VAT Register</h1><p class="sub">${startDate.substring(0,10)} to ${endDate.substring(0,10)}</p><table><thead><tr><th>Receipt #</th><th>Date</th><th class="r">Net ex-VAT</th><th class="r">VAT 16%</th><th class="r">Total</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="2">TOTAL</td><td class="r">${formatKES(vatData.totalNetCents ?? vatData.totalSalesCents - vatData.totalVatCents)}</td><td class="r">${formatKES(vatData.totalVatCents)}</td><td class="r">${formatKES(vatData.totalSalesCents)}</td></tr></tfoot></table>`);
                        }}
                        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-800"
                      >
                        <Printer className="w-4 h-4" /> Print
                      </button>
                      <button
                        onClick={() => {
                          if (!vatData?.sales?.length) return;
                          downloadCsv(`vat-register-${startDate}-${endDate}.csv`, [
                            ['Receipt #', 'Date', 'Net ex-VAT (KES)', 'VAT 16% incl. (KES)', 'Total (KES)'],
                            ...vatData.sales.map((s) => [
                              s.receiptNumber ?? '',
                              new Date(s.createdAt).toLocaleDateString('en-KE'),
                              (s.netCents / 100).toFixed(2),
                              (s.vatCents / 100).toFixed(2),
                              (s.totalCents / 100).toFixed(2),
                            ]),
                          ]);
                        }}
                        className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                      >
                        <Download className="w-4 h-4" />
                        Export CSV
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">Receipt #</th>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">Date</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">Net (ex-VAT)</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">VAT 16% (incl.)</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {vatData.sales?.slice(0, 100).map((sale, i) => (
                          <tr key={sale.receiptNumber ?? i} className="hover:bg-gray-50">
                            <td className="px-5 py-3 font-mono text-xs text-blue-600">{sale.receiptNumber ?? '—'}</td>
                            <td className="px-5 py-3 text-gray-500">
                              {new Date(sale.createdAt).toLocaleDateString('en-KE')}
                            </td>
                            <td className="px-5 py-3 text-right">{formatKES(sale.netCents)}</td>
                            <td className="px-5 py-3 text-right text-purple-600 font-medium">{formatKES(sale.vatCents)}</td>
                            <td className="px-5 py-3 text-right font-semibold">{formatKES(sale.totalCents)}</td>
                          </tr>
                        ))}
                        {(!vatData.sales || vatData.sales.length === 0) && (
                          <tr>
                            <td colSpan={5} className="px-5 py-8 text-center text-gray-400">
                              No VAT records in this period
                            </td>
                          </tr>
                        )}
                      </tbody>
                      <tfoot className="bg-gray-50 font-bold">
                        <tr>
                          <td colSpan={2} className="px-5 py-3">TOTAL</td>
                          <td className="px-5 py-3 text-right">
                            {formatKES(vatData.totalNetCents ?? (vatData.totalSalesCents - vatData.totalVatCents))}
                          </td>
                          <td className="px-5 py-3 text-right text-purple-600">
                            {formatKES(vatData.totalVatCents)}
                          </td>
                          <td className="px-5 py-3 text-right">{formatKES(vatData.totalSalesCents)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── P&L ── */}
            {tab === 'pl' && (
              <div className="space-y-4">
                {plData && (
                  <div className="max-w-2xl bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-6 py-4 border-b flex justify-between items-center">
                      <h2 className="font-semibold text-gray-800">Profit & Loss Statement</h2>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            if (!plData) return;
                            const margin = plData.revenueCents > 0 ? ((plData.netProfitCents / plData.revenueCents) * 100).toFixed(1) : '0.0';
                            printHtml('Profit & Loss Statement', `<h1>Profit &amp; Loss Statement</h1><p class="sub">${startDate.substring(0,10)} to ${endDate.substring(0,10)}</p><table><tbody><tr><td>Revenue</td><td class="r" style="color:#16a34a">${formatKES(plData.revenueCents)}</td></tr><tr><td style="padding-left:20px">Cost of Goods Sold</td><td class="r" style="color:#dc2626">(${formatKES(plData.cogsCents)})</td></tr><tr style="font-weight:bold;border-top:2px solid #ccc"><td>Gross Profit</td><td class="r" style="color:${plData.grossProfitCents>=0?'#16a34a':'#dc2626'}">${formatKES(plData.grossProfitCents)}</td></tr><tr><td style="padding-left:20px">Operating Expenses</td><td class="r" style="color:#dc2626">(${formatKES(plData.expensesCents)})</td></tr><tr style="font-weight:bold;border-top:2px solid #1F6BFF"><td>Net Profit</td><td class="r" style="color:${plData.netProfitCents>=0?'#16a34a':'#dc2626'}">${formatKES(plData.netProfitCents)}</td></tr></tbody></table><p style="text-align:right;color:#888;font-size:9pt;margin-top:8px">Net Margin: ${margin}%</p>`);
                          }}
                          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-800"
                        >
                          <Printer className="w-4 h-4" /> Print
                        </button>
                        <button
                          onClick={() => {
                            if (!plData) return;
                            downloadCsv(`profit-loss-${startDate}-${endDate}.csv`, [
                              ['Line Item', 'Amount (KES)'],
                              ['Revenue', (plData.revenueCents / 100).toFixed(2)],
                              ['Cost of Goods Sold', (-plData.cogsCents / 100).toFixed(2)],
                              ['Gross Profit', (plData.grossProfitCents / 100).toFixed(2)],
                              ['Expenses', (-plData.expensesCents / 100).toFixed(2)],
                              ['Net Profit', (plData.netProfitCents / 100).toFixed(2)],
                            ]);
                          }}
                          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <Download className="w-4 h-4" />
                          Export CSV
                        </button>
                      </div>
                    </div>
                    <div className="px-6 py-4 space-y-1">
                      {[
                        { label: 'Revenue', value: plData.revenueCents, color: 'text-green-600', border: false, bold: false },
                        { label: 'Cost of Goods Sold (COGS)', value: plData.cogsCents, negative: true, color: 'text-red-500', border: false, bold: false },
                        { label: 'Gross Profit', value: plData.grossProfitCents, color: plData.grossProfitCents >= 0 ? 'text-green-600' : 'text-red-600', border: true, bold: true },
                        { label: 'Operating Expenses', value: plData.expensesCents, negative: true, color: 'text-red-500', border: false, bold: false },
                        { label: 'Net Profit', value: plData.netProfitCents, color: plData.netProfitCents >= 0 ? 'text-green-600' : 'text-red-600', border: true, bold: true },
                      ].map((row) => (
                        <div
                          key={row.label}
                          className={`flex justify-between py-3 ${row.bold ? 'font-bold text-base' : 'text-sm'} ${row.border ? 'border-t mt-1' : ''}`}
                        >
                          <span className={row.bold ? 'text-gray-900' : 'text-gray-600 pl-4'}>{row.label}</span>
                          <span className={row.color}>
                            {row.negative ? '(' : ''}
                            {formatKES(Math.abs(row.value))}
                            {row.negative ? ')' : ''}
                          </span>
                        </div>
                      ))}
                      {plData.revenueCents > 0 && (
                        <p className="text-sm text-gray-400 text-right pt-2">
                          Margin: {((plData.netProfitCents / plData.revenueCents) * 100).toFixed(1)}%
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {expenseData && expenseData.byCategory && Object.keys(expenseData.byCategory).length > 0 && (
                  <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-5 py-4 border-b">
                      <h2 className="font-semibold text-gray-800">
                        Expenses by Category · {formatKES(expenseData.totalCents)}
                      </h2>
                    </div>
                    <div className="p-5 space-y-3">
                      {Object.entries(expenseData.byCategory)
                        .sort(([, a], [, b]) => b - a)
                        .map(([cat, amt], i) => {
                          const pct = expenseData.totalCents > 0 ? (amt / expenseData.totalCents) * 100 : 0;
                          return (
                            <div key={cat}>
                              <div className="flex justify-between text-sm mb-1">
                                <span className="font-medium text-gray-700">{cat}</span>
                                <span className="text-gray-500">
                                  {formatKES(amt)} ({pct.toFixed(0)}%)
                                </span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-2">
                                <div
                                  className="h-2 rounded-full"
                                  style={{
                                    width: `${pct}%`,
                                    backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── INVENTORY ── */}
            {tab === 'inventory' && (
              <div className="space-y-4">
                {/* Live / Historical toggle */}
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-600">View:</span>
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                    <button
                      onClick={() => setStockViewMode('live')}
                      className={`px-4 py-1.5 font-medium transition-colors ${stockViewMode === 'live' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                    >
                      Live Stock
                    </button>
                    <button
                      onClick={() => setStockViewMode('historical')}
                      className={`px-4 py-1.5 font-medium transition-colors flex items-center gap-1.5 ${stockViewMode === 'historical' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                    >
                      <History className="w-3.5 h-3.5" />
                      Stock by Date
                    </button>
                  </div>
                  {stockViewMode === 'historical' && (
                    <div className="flex items-center gap-2 ml-2">
                      <label className="text-sm font-medium text-gray-600">As of:</label>
                      <input
                        type="date"
                        value={historyAsOf}
                        max={new Date().toISOString().substring(0, 10)}
                        onChange={(e) => setHistoryAsOf(e.target.value)}
                        className="border rounded-lg px-3 py-1.5 text-sm" aria-label="Date" />
                    </div>
                  )}
                </div>
                {stockViewMode === 'live' && stockData ? (
                  <>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      <StatCard
                        label="Total Stock Value (Cost)"
                        value={formatKES(stockData.totalValueCents)}
                        icon={Package}
                        color="bg-blue-500"
                        sub={`${stockData.items?.length ?? 0} products`}
                      />
                    </div>

                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-5 py-4 border-b flex justify-between items-center">
                        <h2 className="font-semibold text-gray-800">Live Stock Valuation</h2>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => { void refetchStock(); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                            title="Refresh stock levels"
                          >
                            <RefreshCw size={13} />
                            Refresh
                          </button>
                          <button
                            onClick={() => {
                              if (!stockData?.items?.length) return;
                              const rows = stockData.items.map((i) =>
                                `<tr><td>${i.name}</td><td class="r">${i.quantity.toLocaleString()}</td><td class="r">${formatKES(i.costPriceCents)}</td><td class="r">${formatKES(i.valueCents)}</td></tr>`
                              ).join('');
                              printHtml('Stock Valuation Report', `<h1>Stock Valuation</h1><p class="sub">As of ${new Date().toLocaleDateString('en-KE')} &bull; ${stockData.items.length} products</p><table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Cost/Unit</th><th class="r">Total Value</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="3">TOTAL</td><td class="r">${formatKES(stockData.totalValueCents)}</td></tr></tfoot></table>`);
                            }}
                            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-800"
                          >
                            <Printer className="w-4 h-4" /> Print
                          </button>
                          <button
                            onClick={() => {
                              if (!stockData?.items?.length) return;
                              downloadCsv(`stock-valuation-${new Date().toISOString().substring(0, 10)}.csv`, [
                                ['Item Name', 'Qty', 'Cost Price (KES)', 'Total Value (KES)'],
                                ...stockData.items.map((i) => [
                                  i.name,
                                  String(i.quantity),
                                  (i.costPriceCents / 100).toFixed(2),
                                  (i.valueCents / 100).toFixed(2),
                                ]),
                                ['TOTAL', '', '', (stockData.totalValueCents / 100).toFixed(2)],
                              ]);
                            }}
                            className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                          >
                            <Download className="w-4 h-4" />
                            Export CSV
                          </button>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Item</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Qty</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Cost/Unit</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Total Value</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {stockData.items?.map((item) => (
                              <tr key={item.itemId} className="hover:bg-gray-50">
                                <td className="px-5 py-3 font-medium">{item.name}</td>
                                <td className="px-5 py-3 text-right">{item.quantity.toLocaleString()}</td>
                                <td className="px-5 py-3 text-right">{formatKES(item.costPriceCents)}</td>
                                <td className="px-5 py-3 text-right font-semibold">{formatKES(item.valueCents)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="bg-gray-50 font-bold">
                            <tr>
                              <td colSpan={3} className="px-5 py-3">TOTAL</td>
                              <td className="px-5 py-3 text-right">{formatKES(stockData.totalValueCents)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  </>
                ) : stockViewMode === 'live' ? (
                  <div className="flex items-center justify-center py-16 text-gray-400">
                    <RefreshCw className="w-6 h-6 animate-spin mr-2" />
                    Loading stock data…
                  </div>
                ) : null}

                {/* ── Historical view ── */}
                {stockViewMode === 'historical' && historicalStock && (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <StatCard label="Stock Lines" value={historicalStock.totalItems} icon={Package} color="bg-blue-500" />
                      <StatCard label="Total Cost Value" value={formatKES(historicalStock.totalValueCents)} icon={DollarSign} color="bg-orange-500" />
                      <StatCard label="Total Retail Value" value={formatKES(historicalStock.totalRetailValueCents)} icon={TrendingUp} color="bg-green-500" />
                      <StatCard label="Gross Profit Potential" value={formatKES(historicalStock.totalRetailValueCents - historicalStock.totalValueCents)} icon={TrendingUp} color="bg-purple-500" />
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-5 py-4 border-b flex justify-between items-center">
                        <h2 className="font-semibold text-gray-800">Historical Stock Levels — {new Date(historyAsOf).toLocaleDateString('en-KE')}</h2>
                        <button
                          onClick={() => {
                            if (!historicalStock.items.length) return;
                            downloadCsv(`stock-history-${historyAsOf}.csv`, [
                              ['Item', 'Category', 'Barcode', 'Qty', 'Cost/Unit (KES)', 'Total Cost (KES)', 'Retail/Unit (KES)', 'Retail Value (KES)'],
                              ...historicalStock.items.map((i) => [
                                i.name, i.category, i.barcode, String(i.quantity),
                                (i.costPriceCents / 100).toFixed(2), (i.valueCents / 100).toFixed(2),
                                (i.retailPriceCents / 100).toFixed(2), (i.retailValueCents / 100).toFixed(2),
                              ]),
                              ['', '', '', 'TOTALS', '', (historicalStock.totalValueCents / 100).toFixed(2), '', (historicalStock.totalRetailValueCents / 100).toFixed(2)],
                            ]);
                          }}
                          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <Download className="w-4 h-4" /> Export CSV
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Item</th>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Category</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Qty</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Cost/Unit</th>
                              <th className="text-right px-5 py-3 font-medium text-orange-700">Total Cost</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Retail/Unit</th>
                              <th className="text-right px-5 py-3 font-medium text-green-700">Retail Value</th>
                              <th className="px-5 py-3"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {historicalStock.items.length === 0 && (
                              <tr>
                                <td colSpan={8} className="px-5 py-10 text-center text-gray-400">
                                  <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
                                  No stock data for this date.
                                </td>
                              </tr>
                            )}
                            {historicalStock.items.map((item) => (
                              <tr key={item.itemId} className={`hover:bg-gray-50 ${item.quantity === 0 ? 'opacity-50' : ''}`}>
                                <td className="px-5 py-3 font-medium">{item.name}</td>
                                <td className="px-5 py-3 text-gray-500">{item.category || '—'}</td>
                                <td className={`px-5 py-3 text-right font-semibold ${item.quantity === 0 ? 'text-gray-400' : ''}`}>{item.quantity}</td>
                                <td className="px-5 py-3 text-right text-gray-500">{formatKES(item.costPriceCents)}</td>
                                <td className="px-5 py-3 text-right font-semibold text-orange-700">{item.quantity > 0 ? formatKES(item.valueCents) : '—'}</td>
                                <td className="px-5 py-3 text-right text-gray-500">{formatKES(item.retailPriceCents)}</td>
                                <td className="px-5 py-3 text-right font-semibold text-green-700">{item.quantity > 0 ? formatKES(item.retailValueCents) : '—'}</td>
                                <td className="px-5 py-3 text-right">
                                  <button
                                    onClick={() => {
                                      setWriteOffItem({ itemId: item.itemId, name: item.name, qty: item.quantity });
                                      setWriteOffQty('');
                                      setWriteOffReason('WRITE_OFF');
                                      setWriteOffNotes('');
                                    }}
                                    className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 border border-orange-200 rounded px-2 py-1"
                                    title="Write-off / Adjust stock"
                                  >
                                    <Pencil className="w-3 h-3" /> Adjust
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="bg-gray-50 font-bold border-t-2 border-gray-200">
                            <tr>
                              <td colSpan={4} className="px-5 py-3 text-gray-700">TOTAL COST VALUE</td>
                              <td className="px-5 py-3 text-right text-orange-700">{formatKES(historicalStock.totalValueCents)}</td>
                              <td className="px-5 py-3 text-right text-gray-500 font-normal text-xs">Retail totals →</td>
                              <td className="px-5 py-3 text-right text-green-700">{formatKES(historicalStock.totalRetailValueCents)}</td>
                              <td></td>
                            </tr>
                            <tr className="border-t border-gray-200">
                              <td colSpan={4} className="px-5 py-2 text-gray-500 font-normal text-xs">Gross Profit Potential (Retail − Cost)</td>
                              <td colSpan={3} className="px-5 py-2 text-right font-bold text-purple-700">
                                {formatKES(historicalStock.totalRetailValueCents - historicalStock.totalValueCents)}
                              </td>
                              <td></td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  </>
                )}
                {stockViewMode === 'historical' && !historicalStock && (
                  <div className="flex items-center justify-center py-16 text-gray-400">
                    <RefreshCw className="w-6 h-6 animate-spin mr-2" />
                    Loading historical stock…
                  </div>
                )}

                {/* Write-off / Adjustment modal */}
                {writeOffItem && (
                  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
                      <div className="flex items-center justify-between px-6 py-4 border-b">
                        <h3 className="font-bold text-gray-900">Stock Adjustment — {writeOffItem.name}</h3>
                        <button onClick={() => setWriteOffItem(null)} className="text-gray-400 hover:text-gray-600" aria-label="Close">
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                      <div className="px-6 py-5 space-y-4">
                        <p className="text-sm text-gray-600">Current stock on selected date: <strong>{writeOffItem.qty}</strong> units</p>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                          <select value={writeOffReason} onChange={(e) => setWriteOffReason(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                            <option value="WRITE_OFF">Write-Off (General)</option>
                            <option value="DAMAGED">Damaged</option>
                            <option value="EXPIRED">Expired / Spoilage</option>
                            <option value="THEFT">Theft / Shrinkage</option>
                            <option value="ADJUSTMENT">Manual Correction</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Quantity to remove</label>
                          <input type="number" min="1" max={writeOffItem.qty} value={writeOffQty} onChange={(e) => setWriteOffQty(e.target.value)} placeholder="e.g. 5" className="w-full border rounded-lg px-3 py-2 text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                          <textarea value={writeOffNotes} onChange={(e) => setWriteOffNotes(e.target.value)} rows={2} placeholder="e.g. Found 5 units mouldy during stock count" className="w-full border rounded-lg px-3 py-2 text-sm resize-none" />
                        </div>
                        {writeOffMutation.isError && <p className="text-sm text-red-600">Failed to save adjustment. Please try again.</p>}
                        {writeOffMutation.isSuccess && <p className="text-sm text-green-600">Adjustment recorded successfully.</p>}
                      </div>
                      <div className="px-6 py-4 border-t flex gap-3 justify-end">
                        <button onClick={() => setWriteOffItem(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                        <button
                          disabled={!writeOffQty || Number(writeOffQty) <= 0 || writeOffMutation.isPending}
                          onClick={() => {
                            if (!writeOffItem || !writeOffQty) return;
                            writeOffMutation.mutate({ itemId: writeOffItem.itemId, qty: Number(writeOffQty), reason: writeOffReason, notes: writeOffNotes });
                          }}
                          className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
                        >
                          {writeOffMutation.isPending ? 'Saving…' : 'Save Adjustment'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── ATTENDANCE REPORT ── */}
            {tab === 'attendance' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <StatCard
                    label="Total Records"
                    value={attendanceReport.length}
                    icon={BarChart3}
                    color="bg-blue-500"
                  />
                  <StatCard
                    label="On Time"
                    value={attendanceReport.filter((r) => !r.isLate).length}
                    icon={BarChart3}
                    color="bg-green-500"
                  />
                  <StatCard
                    label="Late Arrivals"
                    value={attendanceReport.filter((r) => r.isLate).length}
                    icon={BarChart3}
                    color="bg-red-500"
                  />
                  <StatCard
                    label="Completed Shifts"
                    value={attendanceReport.filter((r) => r.clockOut).length}
                    icon={BarChart3}
                    color="bg-purple-500"
                  />
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-5 py-4 border-b flex justify-between items-center">
                    <h2 className="font-semibold text-gray-800">Attendance Records ({attendanceReport.length})</h2>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          if (!attendanceReport.length) return;
                          const rows = attendanceReport.map((r) =>
                            `<tr><td>${r.employee?.user.name ?? r.id.slice(0,8)}</td><td>${r.employee?.user.role ?? ''}</td><td>${new Date(r.shiftDate).toLocaleDateString('en-KE')}</td><td class="r">${new Date(r.clockIn).toLocaleTimeString('en-KE',{hour:'2-digit',minute:'2-digit'})}</td><td class="r">${r.clockOut?new Date(r.clockOut).toLocaleTimeString('en-KE',{hour:'2-digit',minute:'2-digit'}):'-'}</td><td class="r" style="color:${r.isLate?'#dc2626':'#16a34a'}">${r.isLate?'Late':'On Time'}</td></tr>`
                          ).join('');
                          const lateCount = attendanceReport.filter((r)=>r.isLate).length;
                          printHtml('Attendance Report', `<h1>Attendance Report</h1><p class="sub">${startDate.substring(0,10)} to ${endDate.substring(0,10)} &bull; ${attendanceReport.length} records &bull; ${lateCount} late</p><table><thead><tr><th>Employee</th><th>Role</th><th>Date</th><th class="r">Clock In</th><th class="r">Clock Out</th><th class="r">Status</th></tr></thead><tbody>${rows}</tbody></table>`);
                        }}
                        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-800"
                      >
                        <Printer className="w-4 h-4" /> Print
                      </button>
                      <button
                        onClick={() => {
                          if (!attendanceReport.length) return;
                          downloadCsv(`attendance-${startDate}-${endDate}.csv`, [
                            ['Employee', 'Role', 'Date', 'Clock In', 'Clock Out', 'Status'],
                            ...attendanceReport.map((r) => [
                              r.employee?.user.name ?? r.id.slice(0, 8),
                              r.employee?.user.role ?? '',
                              new Date(r.shiftDate).toLocaleDateString('en-KE'),
                              new Date(r.clockIn).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }),
                              r.clockOut ? new Date(r.clockOut).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '',
                              r.isLate ? 'Late' : 'On Time',
                            ]),
                          ]);
                        }}
                        className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                      >
                        <Download className="w-4 h-4" />
                        Export CSV
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">Employee</th>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">Date</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">Clock In</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">Clock Out</th>
                          <th className="text-center px-5 py-3 font-medium text-gray-600">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {attendanceReport.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-5 py-8 text-center text-gray-400">No records in this period</td>
                          </tr>
                        ) : (
                          attendanceReport.slice(0, 100).map((r) => (
                            <tr key={r.id} className="hover:bg-gray-50">
                              <td className="px-5 py-3">
                                <div className="font-medium">{r.employee?.user.name ?? r.id.slice(0, 8)}</div>
                                <div className="text-xs text-gray-400">{r.employee?.user.role ?? ''}</div>
                              </td>
                              <td className="px-5 py-3 text-gray-500">
                                {new Date(r.shiftDate).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' })}
                              </td>
                              <td className="px-5 py-3 text-right font-mono">
                                {new Date(r.clockIn).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="px-5 py-3 text-right font-mono text-gray-500">
                                {r.clockOut
                                  ? new Date(r.clockOut).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })
                                  : <span className="text-green-600 text-xs font-semibold">Active</span>
                                }
                              </td>
                              <td className="px-5 py-3 text-center">
                                {r.isLate
                                  ? <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">Late</span>
                                  : <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">On Time</span>
                                }
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── COMMISSIONS REPORT ── */}
            {tab === 'commissions' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <StatCard
                    label="Total Commissions"
                    value={formatKES(commissionReport.reduce((s, c) => s + c.commissionCents, 0))}
                    icon={TrendingUp}
                    color="bg-green-500"
                  />
                  <StatCard
                    label="Total Sales"
                    value={formatKES(commissionReport.reduce((s, c) => s + c.totalSalesCents, 0))}
                    icon={DollarSign}
                    color="bg-blue-500"
                  />
                  <StatCard
                    label="Employees"
                    value={commissionReport.length}
                    icon={BarChart3}
                    color="bg-purple-500"
                  />
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-5 py-4 border-b flex justify-between items-center">
                    <h2 className="font-semibold text-gray-800">Commission Summary</h2>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          if (!commissionReport.length) return;
                          const rows = [...commissionReport].sort((a,b)=>b.commissionCents-a.commissionCents).map((c) =>
                            `<tr><td>${c.employeeName}</td><td class="r">${c.commissionRate}${c.commissionBasis==='TRANSACTION_COUNT'?' KES/txn':'%'}</td><td class="r">${c.salesCount}</td><td class="r">${formatKES(c.totalSalesCents)}</td><td class="r" style="color:#16a34a;font-weight:bold">${formatKES(c.commissionCents)}</td></tr>`
                          ).join('');
                          const totalComm = commissionReport.reduce((s,c)=>s+c.commissionCents,0);
                          printHtml('Commission Report', `<h1>Commission Report</h1><p class="sub">${startDate.substring(0,10)} to ${endDate.substring(0,10)}</p><table><thead><tr><th>Employee</th><th class="r">Rate</th><th class="r">Sales</th><th class="r">Total Sales</th><th class="r">Commission</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="4">TOTAL</td><td class="r" style="color:#16a34a">${formatKES(totalComm)}</td></tr></tfoot></table>`);
                        }}
                        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-800"
                      >
                        <Printer className="w-4 h-4" /> Print
                      </button>
                      <button
                        onClick={() => {
                          if (!commissionReport.length) return;
                          downloadCsv(`commissions-${startDate}-${endDate}.csv`, [
                            ['Employee', 'Commission Rate', 'Basis', 'Sales Count', 'Total Sales (KES)', 'Commission Earned (KES)'],
                            ...commissionReport.map((c) => [
                              c.employeeName,
                              `${c.commissionRate}${c.commissionBasis === 'TRANSACTION_COUNT' ? ' KES/txn' : '%'}`,
                              c.commissionBasis ?? 'SALES_VALUE',
                              String(c.salesCount),
                              (c.totalSalesCents / 100).toFixed(2),
                              (c.commissionCents / 100).toFixed(2),
                            ]),
                          ]);
                        }}
                        className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                      >
                        <Download className="w-4 h-4" />
                        Export CSV
                      </button>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-5 py-3 font-medium text-gray-600">Employee</th>
                        <th className="text-center px-5 py-3 font-medium text-gray-600">Rate</th>
                        <th className="text-center px-5 py-3 font-medium text-gray-600">Basis</th>
                        <th className="text-center px-5 py-3 font-medium text-gray-600">Sales</th>
                        <th className="text-right px-5 py-3 font-medium text-gray-600">Total Sales</th>
                        <th className="text-right px-5 py-3 font-medium text-gray-600">Commission</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {commissionReport.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-5 py-8 text-center text-gray-400">No commission data for this period</td>
                        </tr>
                      ) : (
                        commissionReport
                          .sort((a, b) => b.commissionCents - a.commissionCents)
                          .map((c) => (
                            <tr key={c.employeeId} className="hover:bg-gray-50">
                              <td className="px-5 py-3 font-medium">{c.employeeName}</td>
                              <td className="px-5 py-3 text-center">{c.commissionRate}{c.commissionBasis === 'TRANSACTION_COUNT' ? ' KES/txn' : '%'}</td>
                              <td className="px-5 py-3 text-center">
                                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                                  c.commissionBasis === 'TRANSACTION_COUNT' ? 'bg-purple-100 text-purple-700' :
                                  c.commissionBasis === 'GROSS_MARGIN'      ? 'bg-blue-100 text-blue-700' :
                                                                              'bg-gray-100 text-gray-600'
                                }`}>
                                  {c.commissionBasis === 'TRANSACTION_COUNT' ? 'Per Txn' :
                                   c.commissionBasis === 'GROSS_MARGIN'      ? 'Margin' : 'Sales'}
                                </span>
                              </td>
                              <td className="px-5 py-3 text-center">{c.salesCount}</td>
                              <td className="px-5 py-3 text-right">{formatKES(c.totalSalesCents)}</td>
                              <td className="px-5 py-3 text-right font-bold text-green-700">{formatKES(c.commissionCents)}</td>
                            </tr>
                          ))
                      )}
                    </tbody>
                    {commissionReport.length > 0 && (
                      <tfoot className="bg-gray-50 font-bold">
                        <tr>
                          <td colSpan={5} className="px-5 py-3">TOTAL</td>
                          <td className="px-5 py-3 text-right text-green-700">
                            {formatKES(commissionReport.reduce((s, c) => s + c.commissionCents, 0))}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            )}

            {/* ── RECIPE VARIANCE ── */}
            {tab === 'recipes' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <StatCard label="Ingredients Tracked" value={recipeVariance.length} icon={ChefHat} color="bg-orange-500" />
                  <StatCard
                    label="Over Variance (>10%)"
                    value={recipeVariance.filter((r) => Math.abs(r.variancePct ?? 0) > 10).length}
                    icon={AlertCircle}
                    color="bg-red-500"
                  />
                  <StatCard
                    label="Within Target"
                    value={recipeVariance.filter((r) => Math.abs(r.variancePct ?? 0) <= 10).length}
                    icon={TrendingUp}
                    color="bg-green-500"
                  />
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-5 py-4 border-b flex justify-between items-center">
                    <h2 className="font-semibold text-gray-800">Recipe vs Actual Usage</h2>
                    <button
                      onClick={() => {
                        if (!recipeVariance.length) return;
                        downloadCsv(`recipe-variance-${startDate}-${endDate}.csv`, [
                          ['Ingredient', 'Planned (g)', 'Actual (g)', 'Variance (g)', 'Variance %'],
                          ...recipeVariance.map((r) => [
                            r.ingredientName,
                            r.plannedGrams.toFixed(1),
                            r.actualGrams != null ? r.actualGrams.toFixed(1) : 'N/A',
                            r.varianceGrams != null ? r.varianceGrams.toFixed(1) : 'N/A',
                            r.variancePct != null ? (r.variancePct > 0 ? '+' : '') + r.variancePct.toFixed(1) + '%' : 'N/A',
                          ]),
                        ]);
                      }}
                      className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                    >
                      <Download className="w-4 h-4" />
                      Export CSV
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">Ingredient</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">Planned (g)</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">Actual (g)</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">Variance (g)</th>
                          <th className="text-center px-5 py-3 font-medium text-gray-600">Variance %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {recipeVariance.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-5 py-8 text-center text-gray-400">No recipe data for this period</td>
                          </tr>
                        ) : (
                          recipeVariance.map((r, i) => {
                            const vPct = r.variancePct ?? 0;
                            const vGrams = r.varianceGrams ?? 0;
                            const isHigh = Math.abs(vPct) > 10;
                            return (
                              <tr key={i} className="hover:bg-gray-50">
                                <td className="px-5 py-3 font-medium">{r.ingredientName}</td>
                                <td className="px-5 py-3 text-right text-gray-500">{r.plannedGrams.toFixed(1)}</td>
                                <td className="px-5 py-3 text-right">{r.actualGrams != null ? r.actualGrams.toFixed(1) : '—'}</td>
                                <td className={`px-5 py-3 text-right ${vGrams > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                  {r.varianceGrams != null ? `${vGrams > 0 ? '+' : ''}${vGrams.toFixed(1)}` : '—'}
                                </td>
                                <td className="px-5 py-3 text-center">
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${isHigh ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                    {r.variancePct != null ? `${vPct > 0 ? '+' : ''}${vPct.toFixed(1)}%` : '—'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── BUNDLE PROFITABILITY ── */}
            {tab === 'bundles' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <StatCard label="Bundles Sold" value={bundleProfitability.reduce((s, b) => s + b.sold, 0)} icon={Layers} color="bg-blue-500" />
                  <StatCard label="Total Revenue" value={formatKES(bundleProfitability.reduce((s, b) => s + b.revenueCents, 0))} icon={DollarSign} color="bg-green-500" />
                  <StatCard label="Total Cost" value={formatKES(bundleProfitability.reduce((s, b) => s + b.totalCostCents, 0))} icon={Package} color="bg-orange-500" />
                  <StatCard label="Total Profit" value={formatKES(bundleProfitability.reduce((s, b) => s + b.profitCents, 0))} icon={TrendingUp} color="bg-purple-500" />
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-5 py-4 border-b flex justify-between items-center">
                    <h2 className="font-semibold text-gray-800">Bundle Profitability</h2>
                    <button
                      onClick={() => {
                        if (!bundleProfitability.length) return;
                        downloadCsv(`bundle-profitability-${startDate}-${endDate}.csv`, [
                          ['Bundle', 'Sold', 'Revenue (KES)', 'Cost (KES)', 'Profit (KES)', 'Margin %'],
                          ...bundleProfitability.map((b) => [
                            b.bundleName,
                            String(b.sold),
                            (b.revenueCents / 100).toFixed(2),
                            (b.totalCostCents / 100).toFixed(2),
                            (b.profitCents / 100).toFixed(2),
                            b.marginPct.toFixed(1) + '%',
                          ]),
                        ]);
                      }}
                      className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                    >
                      <Download className="w-4 h-4" />
                      Export CSV
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">Bundle</th>
                          <th className="text-center px-5 py-3 font-medium text-gray-600">Sold</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">Revenue</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">Cost</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">Profit</th>
                          <th className="text-center px-5 py-3 font-medium text-gray-600">Margin</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {bundleProfitability.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-5 py-8 text-center text-gray-400">No bundle sales in this period</td>
                          </tr>
                        ) : (
                          bundleProfitability
                            .sort((a, b) => b.profitCents - a.profitCents)
                            .map((b) => (
                              <tr key={b.bundleId} className="hover:bg-gray-50">
                                <td className="px-5 py-3 font-medium">{b.bundleName}</td>
                                <td className="px-5 py-3 text-center">{b.sold}</td>
                                <td className="px-5 py-3 text-right">{formatKES(b.revenueCents)}</td>
                                <td className="px-5 py-3 text-right text-gray-500">{formatKES(b.totalCostCents)}</td>
                                <td className={`px-5 py-3 text-right font-semibold ${b.profitCents >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                                  {formatKES(b.profitCents)}
                                </td>
                                <td className="px-5 py-3 text-center">
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${b.marginPct >= 20 ? 'bg-green-100 text-green-700' : b.marginPct >= 10 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                                    {b.marginPct.toFixed(1)}%
                                  </span>
                                </td>
                              </tr>
                            ))
                        )}
                      </tbody>
                      {bundleProfitability.length > 0 && (
                        <tfoot className="bg-gray-50 font-bold">
                          <tr>
                            <td className="px-5 py-3">TOTAL</td>
                            <td className="px-5 py-3 text-center">{bundleProfitability.reduce((s, b) => s + b.sold, 0)}</td>
                            <td className="px-5 py-3 text-right">{formatKES(bundleProfitability.reduce((s, b) => s + b.revenueCents, 0))}</td>
                            <td className="px-5 py-3 text-right">{formatKES(bundleProfitability.reduce((s, b) => s + b.totalCostCents, 0))}</td>
                            <td className="px-5 py-3 text-right text-green-700">{formatKES(bundleProfitability.reduce((s, b) => s + b.profitCents, 0))}</td>
                            <td></td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── SUPPLIERS ── */}
            {tab === 'suppliers' && (
              <div className="space-y-6">
                {/* Supplier Ledger */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-5 py-4 border-b flex justify-between items-center">
                    <div>
                      <h2 className="font-semibold text-gray-800">Supplier Ledger</h2>
                      <p className="text-xs text-gray-500 mt-0.5">Purchase orders by supplier</p>
                    </div>
                    <button
                      onClick={() => {
                        if (!supplierLedger.length) return;
                        downloadCsv(`supplier-ledger-${startDate}-${endDate}.csv`, [
                          ['Supplier', 'Total POs', 'Pending', 'Received', 'Total Value (KES)'],
                          ...supplierLedger.map((s) => [
                            s.supplierName,
                            String(s.poCount),
                            String(s.pendingCount),
                            String(s.receivedCount),
                            (s.totalValueCents / 100).toFixed(2),
                          ]),
                        ]);
                      }}
                      className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                    >
                      <Download className="w-4 h-4" />
                      Export CSV
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">Supplier</th>
                          <th className="text-center px-5 py-3 font-medium text-gray-600">Total POs</th>
                          <th className="text-center px-5 py-3 font-medium text-gray-600">Pending</th>
                          <th className="text-center px-5 py-3 font-medium text-gray-600">Received</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">Total Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {supplierLedger.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-5 py-8 text-center text-gray-400">No supplier data for this period</td>
                          </tr>
                        ) : (
                          supplierLedger.map((s) => (
                            <tr key={s.supplierId} className="hover:bg-gray-50">
                              <td className="px-5 py-3 font-medium">{s.supplierName}</td>
                              <td className="px-5 py-3 text-center">{s.poCount}</td>
                              <td className="px-5 py-3 text-center">
                                {s.pendingCount > 0 ? (
                                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">{s.pendingCount}</span>
                                ) : (
                                  <span className="text-gray-400">0</span>
                                )}
                              </td>
                              <td className="px-5 py-3 text-center">
                                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">{s.receivedCount}</span>
                              </td>
                              <td className="px-5 py-3 text-right font-semibold">{formatKES(s.totalValueCents)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      {supplierLedger.length > 0 && (
                        <tfoot className="bg-gray-50 font-bold">
                          <tr>
                            <td colSpan={4} className="px-5 py-3">TOTAL</td>
                            <td className="px-5 py-3 text-right">{formatKES(supplierLedger.reduce((s, r) => s + r.totalValueCents, 0))}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>

                {/* Supplier Performance */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-5 py-4 border-b flex justify-between items-center">
                    <div>
                      <h2 className="font-semibold text-gray-800">Supplier Performance</h2>
                      <p className="text-xs text-gray-500 mt-0.5">On-time delivery, lead time, fill rate</p>
                    </div>
                    <button
                      onClick={() => {
                        if (!supplierPerformance.length) return;
                        downloadCsv(`supplier-performance-${startDate}-${endDate}.csv`, [
                          ['Supplier', 'On-Time Rate', 'Avg Lead Time (days)', 'Fill Rate'],
                          ...supplierPerformance.map((s) => [
                            s.supplierName,
                            s.onTimeRate.toFixed(1) + '%',
                            s.avgLeadTimeDays.toFixed(1),
                            s.fillRate.toFixed(1) + '%',
                          ]),
                        ]);
                      }}
                      className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                    >
                      <Download className="w-4 h-4" />
                      Export CSV
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">Supplier</th>
                          <th className="text-center px-5 py-3 font-medium text-gray-600">On-Time Rate</th>
                          <th className="text-center px-5 py-3 font-medium text-gray-600">Avg Lead Time</th>
                          <th className="text-center px-5 py-3 font-medium text-gray-600">Fill Rate</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {supplierPerformance.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-5 py-8 text-center text-gray-400">No performance data for this period</td>
                          </tr>
                        ) : (
                          supplierPerformance
                            .sort((a, b) => (b.onTimeRate ?? 0) - (a.onTimeRate ?? 0))
                            .map((s) => (
                              <tr key={s.supplierId} className="hover:bg-gray-50">
                                <td className="px-5 py-3 font-medium">{s.supplierName}</td>
                                <td className="px-5 py-3 text-center">
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${(s.onTimeRate ?? 0) >= 80 ? 'bg-green-100 text-green-700' : (s.onTimeRate ?? 0) >= 60 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                                    {s.onTimeRate != null ? `${s.onTimeRate.toFixed(1)}%` : '—'}
                                  </span>
                                </td>
                                <td className="px-5 py-3 text-center">{s.avgLeadTimeDays != null ? `${s.avgLeadTimeDays.toFixed(1)} days` : '—'}</td>
                                <td className="px-5 py-3 text-center">
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${(s.fillRate ?? 0) >= 90 ? 'bg-green-100 text-green-700' : (s.fillRate ?? 0) >= 70 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                                    {s.fillRate != null ? `${s.fillRate.toFixed(1)}%` : '—'}
                                  </span>
                                </td>
                              </tr>
                            ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── SUPPLIER AGEING ── */}
            {tab === 'supplier-ageing' && (
              <div className="space-y-4">
                {supplierAgeing ? (
                  <>
                    {/* Summary buckets */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                      {[
                        { label: 'Total Outstanding', value: supplierAgeing.summary.totalOutstandingCents, color: 'bg-gray-700' },
                        { label: 'Current', value: supplierAgeing.summary.currentCents, color: 'bg-green-500' },
                        { label: '1–30 Days', value: supplierAgeing.summary.days1to30Cents, color: 'bg-yellow-500' },
                        { label: '31–60 Days', value: supplierAgeing.summary.days31to60Cents, color: 'bg-orange-500' },
                        { label: '61–90 Days', value: supplierAgeing.summary.days61to90Cents, color: 'bg-red-500' },
                        { label: '90+ Days', value: supplierAgeing.summary.days90plusCents, color: 'bg-red-800' },
                      ].map((b) => (
                        <div key={b.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                          <div className={`w-2 h-2 rounded-full ${b.color} mb-2`} />
                          <p className="text-lg font-bold text-gray-900">{formatKES(b.value)}</p>
                          <p className="text-xs text-gray-500">{b.label}</p>
                        </div>
                      ))}
                    </div>

                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-5 py-4 border-b flex justify-between items-center">
                        <div>
                          <h2 className="font-semibold text-gray-800">Supplier Ageing Statement</h2>
                          <p className="text-xs text-gray-500 mt-0.5">As of {new Date(supplierAgeing.asOfDate).toLocaleDateString('en-KE')} · {supplierAgeing.summary.totalSuppliers} suppliers with open orders</p>
                        </div>
                        <button
                          onClick={() => {
                            if (!supplierAgeing.rows.length) return;
                            downloadCsv(`supplier-ageing-${new Date().toISOString().split('T')[0]}.csv`, [
                              ['Supplier', 'Contact', 'Payment Terms', 'Total Outstanding (KES)', 'Current (KES)', '1-30 Days (KES)', '31-60 Days (KES)', '61-90 Days (KES)', '90+ Days (KES)', 'Overdue Orders', 'Total Orders'],
                              ...supplierAgeing.rows.map((r) => [
                                r.supplierName,
                                r.contact ?? '',
                                r.paymentTerms ?? '',
                                (r.totalOutstandingCents / 100).toFixed(2),
                                (r.currentCents / 100).toFixed(2),
                                (r.days1to30Cents / 100).toFixed(2),
                                (r.days31to60Cents / 100).toFixed(2),
                                (r.days61to90Cents / 100).toFixed(2),
                                (r.days90plusCents / 100).toFixed(2),
                                String(r.overdueOrderCount),
                                String(r.totalOrderCount),
                              ]),
                            ]);
                          }}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium"
                        >
                          <Download className="w-4 h-4" /> CSV
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                            <tr>
                              <th className="text-left px-5 py-3 font-medium">Supplier</th>
                              <th className="text-right px-3 py-3 font-medium">Total</th>
                              <th className="text-right px-3 py-3 font-medium text-green-700">Current</th>
                              <th className="text-right px-3 py-3 font-medium text-yellow-700">1–30d</th>
                              <th className="text-right px-3 py-3 font-medium text-orange-700">31–60d</th>
                              <th className="text-right px-3 py-3 font-medium text-red-600">61–90d</th>
                              <th className="text-right px-3 py-3 font-medium text-red-800">90+d</th>
                              <th className="text-center px-3 py-3 font-medium">Overdue</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {supplierAgeing.rows.length === 0 ? (
                              <tr>
                                <td colSpan={8} className="px-5 py-8 text-center text-gray-400">No outstanding supplier orders</td>
                              </tr>
                            ) : (
                              supplierAgeing.rows.map((r) => (
                                <tr key={r.supplierId} className="hover:bg-gray-50">
                                  <td className="px-5 py-3">
                                    <div className="font-medium text-gray-800">{r.supplierName}</div>
                                    {r.paymentTerms && <div className="text-xs text-gray-400">{r.paymentTerms}</div>}
                                  </td>
                                  <td className="px-3 py-3 text-right font-semibold">{formatKES(r.totalOutstandingCents)}</td>
                                  <td className="px-3 py-3 text-right text-green-700">{r.currentCents > 0 ? formatKES(r.currentCents) : '—'}</td>
                                  <td className="px-3 py-3 text-right text-yellow-700">{r.days1to30Cents > 0 ? formatKES(r.days1to30Cents) : '—'}</td>
                                  <td className="px-3 py-3 text-right text-orange-700">{r.days31to60Cents > 0 ? formatKES(r.days31to60Cents) : '—'}</td>
                                  <td className="px-3 py-3 text-right text-red-600">{r.days61to90Cents > 0 ? formatKES(r.days61to90Cents) : '—'}</td>
                                  <td className="px-3 py-3 text-right text-red-800 font-semibold">{r.days90plusCents > 0 ? formatKES(r.days90plusCents) : '—'}</td>
                                  <td className="px-3 py-3 text-center">
                                    {r.overdueOrderCount > 0 ? (
                                      <span className="bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                                        {r.overdueOrderCount}/{r.totalOrderCount}
                                      </span>
                                    ) : (
                                      <span className="text-gray-400 text-xs">0/{r.totalOrderCount}</span>
                                    )}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                          {supplierAgeing.rows.length > 0 && (
                            <tfoot className="bg-gray-50 border-t-2 border-gray-200 font-bold text-sm">
                              <tr>
                                <td className="px-5 py-3 text-gray-700">Total ({supplierAgeing.summary.totalSuppliers} suppliers)</td>
                                <td className="px-3 py-3 text-right">{formatKES(supplierAgeing.summary.totalOutstandingCents)}</td>
                                <td className="px-3 py-3 text-right text-green-700">{formatKES(supplierAgeing.summary.currentCents)}</td>
                                <td className="px-3 py-3 text-right text-yellow-700">{formatKES(supplierAgeing.summary.days1to30Cents)}</td>
                                <td className="px-3 py-3 text-right text-orange-700">{formatKES(supplierAgeing.summary.days31to60Cents)}</td>
                                <td className="px-3 py-3 text-right text-red-600">{formatKES(supplierAgeing.summary.days61to90Cents)}</td>
                                <td className="px-3 py-3 text-right text-red-800">{formatKES(supplierAgeing.summary.days90plusCents)}</td>
                                <td />
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center py-20">
                    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
            )}

            {/* ── CREDIT BOOK ── */}
            {tab === 'credit' && (
              <div className="space-y-4">
                {creditBook ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <StatCard
                        label="Total Outstanding"
                        value={formatKES(creditBook.summary.totalOutstandingCents)}
                        icon={DollarSign}
                        color="bg-red-500"
                        sub={`${creditBook.summary.totalCreditSales} credit sales`}
                      />
                      <StatCard
                        label="Unique Debtors"
                        value={creditBook.summary.uniqueDebtors}
                        icon={ShoppingBag}
                        color="bg-orange-500"
                      />
                      <StatCard
                        label="Avg Outstanding"
                        value={creditBook.summary.uniqueDebtors > 0
                          ? formatKES(Math.round(creditBook.summary.totalOutstandingCents / creditBook.summary.uniqueDebtors))
                          : 'KES 0.00'}
                        icon={TrendingUp}
                        color="bg-amber-500"
                      />
                    </div>

                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-5 py-4 border-b flex justify-between items-center">
                        <div>
                          <h2 className="font-semibold text-gray-800">Credit Book</h2>
                          <p className="text-xs text-gray-500 mt-0.5">Outstanding balances from credit sales</p>
                        </div>
                        <button
                          onClick={() => {
                            if (!creditBook.rows.length) return;
                            downloadCsv(`credit-book-${startDate}-${endDate}.csv`, [
                              ['Receipt', 'Date', 'Customer', 'Phone', 'Total (KES)', 'Paid (KES)', 'Outstanding (KES)', 'Days', 'Aging'],
                              ...creditBook.rows.map((r) => [
                                r.receiptNumber ?? '',
                                new Date(r.date).toLocaleDateString('en-KE'),
                                r.customerName,
                                r.customerPhone ?? '',
                                (r.totalCents / 100).toFixed(2),
                                (r.paidCents / 100).toFixed(2),
                                (r.outstandingCents / 100).toFixed(2),
                                String(r.daysSince),
                                r.agingBucket,
                              ]),
                            ]);
                          }}
                          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <Download className="w-4 h-4" />
                          Export CSV
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Receipt</th>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Date</th>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Customer</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Total</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Paid</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Outstanding</th>
                              <th className="text-center px-5 py-3 font-medium text-gray-600">Aging</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {creditBook.rows.length === 0 ? (
                              <tr>
                                <td colSpan={7} className="px-5 py-8 text-center text-gray-400">No credit sales in this period</td>
                              </tr>
                            ) : (
                              creditBook.rows.map((r) => {
                                const agingColor = r.daysSince <= 30
                                  ? 'bg-green-100 text-green-700'
                                  : r.daysSince <= 60
                                  ? 'bg-yellow-100 text-yellow-700'
                                  : r.daysSince <= 90
                                  ? 'bg-orange-100 text-orange-700'
                                  : 'bg-red-100 text-red-700';
                                return (
                                  <tr key={r.saleId} className="hover:bg-gray-50">
                                    <td className="px-5 py-3 font-mono text-xs text-gray-500">{r.receiptNumber ?? '—'}</td>
                                    <td className="px-5 py-3 text-gray-500">
                                      {new Date(r.date).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: '2-digit' })}
                                    </td>
                                    <td className="px-5 py-3">
                                      <div className="font-medium">{r.customerName}</div>
                                      {r.customerPhone && <div className="text-xs text-gray-400">{r.customerPhone}</div>}
                                    </td>
                                    <td className="px-5 py-3 text-right">{formatKES(r.totalCents)}</td>
                                    <td className="px-5 py-3 text-right text-green-600">{formatKES(r.paidCents)}</td>
                                    <td className="px-5 py-3 text-right font-semibold text-red-600">{formatKES(r.outstandingCents)}</td>
                                    <td className="px-5 py-3 text-center">
                                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${agingColor}`}>
                                        {r.agingBucket}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                          {creditBook.rows.length > 0 && (
                            <tfoot className="bg-gray-50 font-bold">
                              <tr>
                                <td colSpan={5} className="px-5 py-3">TOTAL OUTSTANDING</td>
                                <td className="px-5 py-3 text-right text-red-600">{formatKES(creditBook.summary.totalOutstandingCents)}</td>
                                <td></td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center py-16 text-gray-400">
                    <RefreshCw className="w-6 h-6 animate-spin mr-2" />
                    Loading credit book…
                  </div>
                )}
              </div>
            )}

            {/* ── EMPLOYEE SALES REPORT ── */}
            {tab === 'employee-sales' && (
              <div className="space-y-4">
                {/* Employee filter */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
                  <Users className="w-4 h-4 text-gray-400" />
                  <label className="text-sm font-medium text-gray-700">Filter by employee:</label>
                  <select
                    value={empSalesFilter}
                    onChange={(e) => setEmpSalesFilter(e.target.value)}
                    className="border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 min-w-[200px]">
                    <option value="">All Employees</option>
                    {businessUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                    ))}
                  </select>
                  {empSalesFilter && (
                    <button
                      onClick={() => setEmpSalesFilter('')}
                      className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                    >
                      <X className="w-3 h-3" /> Clear
                    </button>
                  )}
                </div>

                {/* Summary cards */}
                {employeeSalesData && (
                  <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                    <StatCard label="Employees" value={employeeSalesData.summary.totalEmployees} icon={Users} color="bg-blue-500" />
                    <StatCard label="Total Transactions" value={employeeSalesData.summary.totalSales} icon={ShoppingBag} color="bg-indigo-500" />
                    <StatCard label="Total Revenue" value={formatKES(employeeSalesData.summary.totalRevenueCents)} icon={TrendingUp} color="bg-green-500" />
                    <StatCard label="M-Pesa Collected" value={formatKES(employeeSalesData.summary.totalMpesaCents)} icon={Smartphone} color="bg-emerald-500" />
                    <StatCard label="Items Sold" value={employeeSalesData.summary.totalItemsSold ?? 0} icon={Package} color="bg-purple-500" />
                    <StatCard label="Avg Items/Txn" value={(employeeSalesData.summary.avgItemsPerTransaction ?? 0).toFixed(1)} icon={BarChart2} color="bg-orange-500" />
                  </div>
                )}

                {/* CSV export + Print All */}
                {employeeSalesData && (
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => {
                        // Print all employees
                        const dateLabel = `${startDate.substring(0,10)} to ${endDate.substring(0,10)}`;
                        const body = employeeSalesData.rows.map((emp) => {
                          const catRows = emp.categories.map((cat) =>
                            `<h2>${cat.name} &mdash; ${formatKES(cat.subtotalCents)}</h2>
                            <table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Revenue</th></tr></thead><tbody>
                            ${cat.items.map((i) => `<tr><td>${i.itemName}</td><td class="r">${i.qty}</td><td class="r">${formatKES(i.totalCents)}</td></tr>`).join('')}
                            </tbody></table>`
                          ).join('');
                          const mpesaRows = emp.mpesaPayments.length
                            ? `<h2 style="border-left-color:#059669">M-Pesa Transactions (${emp.mpesaPayments.length}) &mdash; ${formatKES(emp.mpesaTotalCents)}</h2>
                               <table><thead><tr><th>Reference</th><th>Receipt</th><th>Time</th><th class="r">Amount</th></tr></thead><tbody>
                               ${emp.mpesaPayments.map((p) => `<tr><td>${p.mpesaRef ?? 'M-PESA'}</td><td>${p.saleReceiptNumber ?? '—'}</td><td>${new Date(p.createdAt).toLocaleTimeString('en-KE',{hour:'2-digit',minute:'2-digit'})}</td><td class="r">${formatKES(p.amountCents)}</td></tr>`).join('')}
                               </tbody></table>` : '';
                          return `<div style="page-break-inside:avoid;margin-bottom:20px;border:1px solid #ddd;padding:12px;border-radius:6px">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                              <div><strong style="font-size:14pt">${emp.employeeName}</strong> <span style="color:#666;font-size:9pt">${emp.role}</span></div>
                              <div style="text-align:right;font-size:9pt">Sales: <strong>${emp.salesCount}</strong> &bull; Revenue: <strong>${formatKES(emp.totalCents)}</strong> &bull; M-Pesa: <strong>${formatKES(emp.mpesaTotalCents)}</strong></div>
                            </div>
                            ${catRows}${mpesaRows}
                            <div style="margin-top:8px;padding:6px;background:#f0f9ff;border-left:4px solid #1F6BFF">
                              Cash Expected = Total Revenue (${formatKES(emp.totalCents)}) &minus; M-Pesa (${formatKES(emp.mpesaTotalCents)}) = <strong>${formatKES(emp.totalCents - emp.mpesaTotalCents)}</strong>
                            </div>
                          </div>`;
                        }).join('');
                        printHtml('Employee Sales Report', `<h1>Employee Sales Report</h1><p class="sub">${dateLabel}</p>${body}`);
                      }}
                      className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-800"
                    >
                      <Printer className="w-4 h-4" /> Print All
                    </button>
                    <button
                      onClick={() => {
                        const rows: string[][] = [['Employee', 'Role', 'Transactions', 'Revenue (KES)', 'Category', 'Item', 'Qty', 'Item Revenue (KES)', 'M-Pesa Total (KES)']];
                        for (const emp of employeeSalesData.rows) {
                          for (const cat of emp.categories) {
                            for (const item of cat.items) {
                              rows.push([emp.employeeName, emp.role, String(emp.salesCount), (emp.totalCents / 100).toFixed(2), cat.name, item.itemName, String(item.qty), (item.totalCents / 100).toFixed(2), (emp.mpesaTotalCents / 100).toFixed(2)]);
                            }
                          }
                          if (emp.categories.length === 0) {
                            rows.push([emp.employeeName, emp.role, String(emp.salesCount), (emp.totalCents / 100).toFixed(2), '', '', '', '', (emp.mpesaTotalCents / 100).toFixed(2)]);
                          }
                        }
                        downloadCsv(`employee-sales-${startDate.substring(0, 10)}-to-${endDate.substring(0, 10)}.csv`, rows);
                      }}
                      className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                    >
                      <Download className="w-4 h-4" /> Export CSV
                    </button>
                  </div>
                )}

                {/* Per-employee sections */}
                {(employeeSalesData?.rows ?? []).map((emp) => (
                  <div key={emp.employeeId} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    {/* Employee header */}
                    <div className="bg-blue-50 px-5 py-4 flex flex-wrap items-center justify-between gap-3 border-b border-blue-100">
                      <div className="flex items-center gap-3">
                        <div className="bg-blue-600 text-white w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm">
                          {emp.employeeName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-bold text-gray-900">{emp.employeeName}</p>
                          <p className="text-xs text-gray-500 uppercase">{emp.role}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex gap-6 text-sm">
                          <div className="text-center">
                            <p className="font-bold text-gray-900">{emp.salesCount}</p>
                            <p className="text-gray-500 text-xs">Sales</p>
                          </div>
                          <div className="text-center">
                            <p className="font-bold text-green-700">{formatKES(emp.totalCents)}</p>
                            <p className="text-gray-500 text-xs">Revenue</p>
                          </div>
                          <div className="text-center">
                            <p className="font-bold text-emerald-700">{formatKES(emp.mpesaTotalCents)}</p>
                            <p className="text-gray-500 text-xs">M-Pesa</p>
                          </div>
                          <div className="text-center">
                            <p className="font-bold text-purple-700">{emp.totalItemsSold ?? 0}</p>
                            <p className="text-gray-500 text-xs">Items Sold</p>
                          </div>
                          <div className="text-center">
                            <p className="font-bold text-orange-700">{(emp.avgItemsPerTransaction ?? 0).toFixed(1)}</p>
                            <p className="text-gray-500 text-xs">Items/Txn</p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            const dateLabel = `${startDate.substring(0,10)} to ${endDate.substring(0,10)}`;
                            const catRows = emp.categories.map((cat) =>
                              `<h2>${cat.name} &mdash; ${formatKES(cat.subtotalCents)}</h2>
                              <table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Revenue</th></tr></thead><tbody>
                              ${cat.items.map((i) => `<tr><td>${i.itemName}</td><td class="r">${i.qty}</td><td class="r">${formatKES(i.totalCents)}</td></tr>`).join('')}
                              </tbody></table>`
                            ).join('');
                            const mpesaRows = emp.mpesaPayments.length
                              ? `<h2 style="border-left-color:#059669">M-Pesa Transactions (${emp.mpesaPayments.length}) &mdash; ${formatKES(emp.mpesaTotalCents)}</h2>
                                 <table><thead><tr><th>Reference</th><th>Receipt</th><th>Time</th><th class="r">Amount</th></tr></thead><tbody>
                                 ${emp.mpesaPayments.map((p) => `<tr><td>${p.mpesaRef ?? 'M-PESA'}</td><td>${p.saleReceiptNumber ?? '—'}</td><td>${new Date(p.createdAt).toLocaleTimeString('en-KE',{hour:'2-digit',minute:'2-digit'})}</td><td class="r">${formatKES(p.amountCents)}</td></tr>`).join('')}
                                 </tbody></table>` : '';
                            const cashExp = formatKES(emp.totalCents - emp.mpesaTotalCents);
                            printHtml(`${emp.employeeName} — Sales Report`, `<h1>${emp.employeeName}</h1><p class="sub">${emp.role} &bull; ${dateLabel} &bull; ${emp.salesCount} sales</p>${catRows}${mpesaRows}<div class="grand">Cash Expected: ${cashExp} &nbsp;(Total ${formatKES(emp.totalCents)} &minus; M-Pesa ${formatKES(emp.mpesaTotalCents)})</div>`);
                          }}
                          className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                          title="Print this employee's report"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Category breakdown */}
                    {emp.categories.length > 0 && (
                      <div className="divide-y divide-gray-50">
                        {emp.categories.map((cat) => (
                          <div key={cat.name} className="px-5 py-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{cat.name}</span>
                              <span className="text-xs font-semibold text-gray-700">{formatKES(cat.subtotalCents)}</span>
                            </div>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-xs text-gray-400">
                                  <th className="text-left font-medium pb-1">Item</th>
                                  <th className="text-right font-medium pb-1">Qty</th>
                                  <th className="text-right font-medium pb-1">Revenue</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cat.items.map((item) => (
                                  <tr key={item.itemName} className="hover:bg-gray-50">
                                    <td className="py-1 text-gray-800">{item.itemName}</td>
                                    <td className="py-1 text-right text-gray-600">{item.qty}</td>
                                    <td className="py-1 text-right font-medium text-gray-800">{formatKES(item.totalCents)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* M-Pesa transactions */}
                    {emp.mpesaPayments.length > 0 && (
                      <div className="border-t border-emerald-100 bg-emerald-50 px-5 py-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Smartphone className="w-4 h-4 text-emerald-600" />
                          <span className="text-sm font-semibold text-emerald-800">M-Pesa Transactions ({emp.mpesaPayments.length})</span>
                          <span className="ml-auto text-sm font-bold text-emerald-700">{formatKES(emp.mpesaTotalCents)}</span>
                        </div>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {emp.mpesaPayments.map((pmt, idx) => (
                            <div key={idx} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-2 border border-emerald-100">
                              <div>
                                <span className="font-medium text-gray-800">{pmt.mpesaRef ?? 'M-PESA'}</span>
                                {pmt.saleReceiptNumber && <span className="text-gray-400 ml-2">Receipt {pmt.saleReceiptNumber}</span>}
                              </div>
                              <div className="text-right">
                                <span className="font-bold text-emerald-700">{formatKES(pmt.amountCents)}</span>
                                <span className="text-gray-400 ml-2">{new Date(pmt.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {employeeSalesData?.rows.length === 0 && (
                  <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
                    <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No employee sales data for this period.</p>
                  </div>
                )}
              </div>
            )}

            {/* ── LAYAWAY BOOK ── */}
            {tab === 'layaway' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="text-sm font-medium text-gray-700">Status filter:</label>
                  {['', 'ACTIVE', 'COMPLETED', 'CANCELLED'].map((s) => (
                    <button
                      key={s}
                      onClick={() => setLayawayStatus(s)}
                      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${layawayStatus === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      {s || 'All'}
                    </button>
                  ))}
                </div>

                {layawayBook && (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <StatCard label="Active" value={layawayBook.summary.activeCount} icon={BookOpen} color="bg-blue-500" />
                      <StatCard label="Total Value" value={formatKES(layawayBook.summary.totalValueCents)} icon={DollarSign} color="bg-green-500" />
                      <StatCard label="Collected" value={formatKES(layawayBook.summary.totalPaidCents)} icon={TrendingUp} color="bg-emerald-500" />
                      <StatCard label="Outstanding" value={formatKES(layawayBook.summary.totalRemainingCents)} icon={AlertCircle} color="bg-orange-500" />
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-5 py-4 border-b flex justify-between items-center">
                        <h2 className="font-semibold text-gray-800">Layaway Book ({layawayBook.summary.count})</h2>
                        <button
                          onClick={() => {
                            if (!layawayBook.rows.length) return;
                            downloadCsv(`layaway-book-${startDate}-${endDate}.csv`, [
                              ['Customer', 'Phone', 'Status', 'Total (KES)', 'Paid (KES)', 'Remaining (KES)', 'Payments', 'Days', 'Created'],
                              ...layawayBook.rows.map((r) => [
                                r.customerName, r.customerPhone, r.status,
                                (r.totalCents / 100).toFixed(2), (r.paidCents / 100).toFixed(2),
                                (r.remainingCents / 100).toFixed(2), String(r.paymentCount),
                                String(r.daysSinceCreated), new Date(r.createdAt).toLocaleDateString('en-KE'),
                              ]),
                            ]);
                          }}
                          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <Download className="w-4 h-4" /> Export CSV
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Customer</th>
                              <th className="text-center px-5 py-3 font-medium text-gray-600">Status</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Total</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Paid</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Remaining</th>
                              <th className="text-center px-5 py-3 font-medium text-gray-600">Days</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {layawayBook.rows.length === 0 ? (
                              <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-400">No layaway records</td></tr>
                            ) : layawayBook.rows.map((r) => (
                              <tr key={r.id} className="hover:bg-gray-50">
                                <td className="px-5 py-3">
                                  <div className="font-medium">{r.customerName}</div>
                                  {r.customerPhone && <div className="text-xs text-gray-400">{r.customerPhone}</div>}
                                </td>
                                <td className="px-5 py-3 text-center">
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${r.status === 'ACTIVE' ? 'bg-blue-100 text-blue-700' : r.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                    {r.status}
                                  </span>
                                </td>
                                <td className="px-5 py-3 text-right">{formatKES(r.totalCents)}</td>
                                <td className="px-5 py-3 text-right text-green-600">{formatKES(r.paidCents)}</td>
                                <td className="px-5 py-3 text-right font-semibold text-orange-600">{formatKES(r.remainingCents)}</td>
                                <td className="px-5 py-3 text-center text-gray-500">{r.daysSinceCreated}d</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── PROFORMA PIPELINE ── */}
            {tab === 'proforma' && (
              <div className="space-y-4">
                {proformaPipeline && (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <StatCard label="Active" value={proformaPipeline.summary.active} icon={ClipboardList} color="bg-blue-500" sub={`Pipeline: ${formatKES(proformaPipeline.summary.pipelineValueCents)}`} />
                      <StatCard label="Expired" value={proformaPipeline.summary.expired} icon={AlertCircle} color="bg-red-500" />
                      <StatCard label="Converted" value={proformaPipeline.summary.converted} icon={TrendingUp} color="bg-green-500" />
                      <StatCard label="Total Value" value={formatKES(proformaPipeline.summary.totalValueCents)} icon={DollarSign} color="bg-purple-500" />
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-5 py-4 border-b flex justify-between items-center">
                        <h2 className="font-semibold text-gray-800">Proforma Pipeline ({proformaPipeline.summary.total})</h2>
                        <button
                          onClick={() => {
                            if (!proformaPipeline.rows.length) return;
                            downloadCsv(`proforma-pipeline.csv`, [
                              ['Receipt #', 'Status', 'Customer', 'Total (KES)', 'Items', 'Created', 'Valid Until', 'Days Remaining'],
                              ...proformaPipeline.rows.map((r) => [
                                r.receiptNumber ?? '', r.status, r.customerName,
                                (r.totalCents / 100).toFixed(2), String(r.itemCount),
                                new Date(r.createdAt).toLocaleDateString('en-KE'),
                                r.validUntil ? new Date(r.validUntil).toLocaleDateString('en-KE') : '',
                                r.daysRemaining !== null ? String(r.daysRemaining) : '',
                              ]),
                            ]);
                          }}
                          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <Download className="w-4 h-4" /> Export CSV
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Receipt #</th>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Customer</th>
                              <th className="text-center px-5 py-3 font-medium text-gray-600">Status</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Total</th>
                              <th className="text-center px-5 py-3 font-medium text-gray-600">Valid Until</th>
                              <th className="text-center px-5 py-3 font-medium text-gray-600">Days</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {proformaPipeline.rows.length === 0 ? (
                              <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-400">No proforma invoices</td></tr>
                            ) : proformaPipeline.rows.map((r) => (
                              <tr key={r.id} className={`hover:bg-gray-50 ${r.isUrgent ? 'bg-amber-50' : ''}`}>
                                <td className="px-5 py-3 font-mono text-xs text-blue-600">{r.receiptNumber ?? '—'}</td>
                                <td className="px-5 py-3">
                                  <div className="font-medium">{r.customerName}</div>
                                  {r.customerPhone && <div className="text-xs text-gray-400">{r.customerPhone}</div>}
                                </td>
                                <td className="px-5 py-3 text-center">
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${r.status === 'DRAFT' ? 'bg-blue-100 text-blue-700' : r.status === 'EXPIRED' ? 'bg-red-100 text-red-700' : r.status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                    {r.status}
                                  </span>
                                </td>
                                <td className="px-5 py-3 text-right font-semibold">{formatKES(r.totalCents)}</td>
                                <td className="px-5 py-3 text-center text-gray-500 text-xs">
                                  {r.validUntil ? new Date(r.validUntil).toLocaleDateString('en-KE') : '—'}
                                </td>
                                <td className="px-5 py-3 text-center">
                                  {r.daysRemaining !== null ? (
                                    <span className={`text-xs font-semibold ${r.isExpired ? 'text-red-600' : r.isUrgent ? 'text-amber-600' : 'text-gray-600'}`}>
                                      {r.isExpired ? 'Expired' : `${r.daysRemaining}d`}
                                    </span>
                                  ) : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── SERIAL REGISTRY ── */}
            {tab === 'serials' && (
              <div className="space-y-4">
                {serialRegistry && (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <StatCard label="Total Serials" value={serialRegistry.summary.total} icon={Hash} color="bg-blue-500" />
                      <StatCard label="Available" value={serialRegistry.summary.available} icon={Package} color="bg-green-500" />
                      <StatCard label="Sold" value={serialRegistry.summary.sold} icon={ShoppingBag} color="bg-purple-500" />
                      <StatCard label="Reserved" value={serialRegistry.summary.reserved} icon={AlertCircle} color="bg-amber-500" />
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-5 py-4 border-b flex justify-between items-center">
                        <h2 className="font-semibold text-gray-800">Serial Number Registry</h2>
                        <button
                          onClick={() => {
                            if (!serialRegistry.rows.length) return;
                            downloadCsv(`serial-registry.csv`, [
                              ['Serial Number', 'Status', 'Item', 'Category', 'Receipt #', 'Sold Date', 'Customer'],
                              ...serialRegistry.rows.map((r) => [
                                r.serialNumber, r.status, r.itemName, r.category,
                                r.saleReceiptNumber ?? '', r.soldAt ? new Date(r.soldAt).toLocaleDateString('en-KE') : '',
                                r.customerName ?? '',
                              ]),
                            ]);
                          }}
                          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <Download className="w-4 h-4" /> Export CSV
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Serial Number</th>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Item</th>
                              <th className="text-center px-5 py-3 font-medium text-gray-600">Status</th>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Receipt #</th>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Customer</th>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Sold Date</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {serialRegistry.rows.length === 0 ? (
                              <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-400">No serial records</td></tr>
                            ) : serialRegistry.rows.map((r) => (
                              <tr key={r.id} className="hover:bg-gray-50">
                                <td className="px-5 py-3 font-mono text-xs font-bold">{r.serialNumber}</td>
                                <td className="px-5 py-3">
                                  <div className="font-medium">{r.itemName}</div>
                                  {r.category && <div className="text-xs text-gray-400">{r.category}</div>}
                                </td>
                                <td className="px-5 py-3 text-center">
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${r.status === 'AVAILABLE' ? 'bg-green-100 text-green-700' : r.status === 'SOLD' ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 text-amber-700'}`}>
                                    {r.status}
                                  </span>
                                </td>
                                <td className="px-5 py-3 font-mono text-xs text-blue-600">{r.saleReceiptNumber ?? '—'}</td>
                                <td className="px-5 py-3 text-gray-600">{r.customerName ?? '—'}</td>
                                <td className="px-5 py-3 text-gray-500 text-xs">
                                  {r.soldAt ? new Date(r.soldAt).toLocaleDateString('en-KE') : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── GRN DISCREPANCY ── */}
            {tab === 'grn' && (
              <div className="space-y-4">
                {grnDiscrepancy && (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <StatCard label="Total GRN Lines" value={grnDiscrepancy.summary.totalLines} icon={Truck} color="bg-blue-500" />
                      <StatCard label="Discrepancies" value={grnDiscrepancy.summary.discrepancyCount} icon={AlertTriangle} color={grnDiscrepancy.summary.discrepancyCount > 0 ? 'bg-red-500' : 'bg-green-500'} />
                      <StatCard label="Short Deliveries" value={grnDiscrepancy.summary.shortDeliveries} icon={Package} color="bg-orange-500" />
                      <StatCard label="Variance Value" value={formatKES(grnDiscrepancy.summary.totalVarianceValueCents)} icon={DollarSign} color="bg-purple-500" />
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-5 py-4 border-b flex justify-between items-center">
                        <div>
                          <h2 className="font-semibold text-gray-800">GRN Discrepancy Report</h2>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Discrepancy rate: {grnDiscrepancy.summary.discrepancyRate}%
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            if (!grnDiscrepancy.rows.length) return;
                            downloadCsv(`grn-discrepancy-${startDate}-${endDate}.csv`, [
                              ['PO Number', 'Supplier', 'Received Date', 'Ordered', 'Received', 'Variance', 'Variance %', 'Type', 'Lot #'],
                              ...grnDiscrepancy.rows.map((r) => [
                                r.poNumber, r.supplierName,
                                new Date(r.receivedAt).toLocaleDateString('en-KE'),
                                String(r.quantityOrdered), String(r.quantityReceived),
                                String(r.variance), r.variancePct.toFixed(1) + '%',
                                r.discrepancyType, r.batchLotNumber ?? '',
                              ]),
                            ]);
                          }}
                          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <Download className="w-4 h-4" /> Export CSV
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">PO Number</th>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Supplier</th>
                              <th className="text-center px-5 py-3 font-medium text-gray-600">Ordered</th>
                              <th className="text-center px-5 py-3 font-medium text-gray-600">Received</th>
                              <th className="text-center px-5 py-3 font-medium text-gray-600">Variance</th>
                              <th className="text-center px-5 py-3 font-medium text-gray-600">Type</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {grnDiscrepancy.rows.length === 0 ? (
                              <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-400">No GRN data for this period</td></tr>
                            ) : grnDiscrepancy.rows.map((r, i) => (
                              <tr key={i} className={`hover:bg-gray-50 ${r.hasDiscrepancy ? 'bg-red-50/30' : ''}`}>
                                <td className="px-5 py-3 font-mono text-xs text-blue-600">{r.poNumber}</td>
                                <td className="px-5 py-3 font-medium">{r.supplierName}</td>
                                <td className="px-5 py-3 text-center">{r.quantityOrdered}</td>
                                <td className="px-5 py-3 text-center">{r.quantityReceived}</td>
                                <td className={`px-5 py-3 text-center font-semibold ${r.variance < 0 ? 'text-red-600' : r.variance > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                                  {r.variance > 0 ? '+' : ''}{r.variance} ({r.variancePct > 0 ? '+' : ''}{r.variancePct}%)
                                </td>
                                <td className="px-5 py-3 text-center">
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${r.discrepancyType === 'MATCH' ? 'bg-green-100 text-green-700' : r.discrepancyType === 'SHORT' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                                    {r.discrepancyType}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── KRA EXPORT ── */}
            {tab === 'kra' && (
              <div className="space-y-4">
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                  <div className="flex items-start gap-4 mb-6">
                    <div className="bg-green-100 p-3 rounded-xl">
                      <Flag className="w-6 h-6 text-green-700" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">KRA-Formatted Tax Export</h2>
                      <p className="text-sm text-gray-500 mt-1">
                        Downloads all VAT/TOT sales data in KRA eTIMS-compatible JSON format for the selected period.
                        Includes eTIMS control numbers and submission status.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <button
                      onClick={async () => {
                        const data = await api.get(`/reports/kra-export?businessId=${businessId}&startDate=${startDate}&endDate=${endDate}`);
                        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `kra-export-${startDate.substring(0, 10)}-to-${endDate.substring(0, 10)}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="flex items-center gap-2 px-5 py-3 bg-green-700 hover:bg-green-800 text-white rounded-lg font-medium"
                    >
                      <Download className="w-4 h-4" />
                      Download KRA JSON Export
                    </button>
                    <button
                      onClick={async () => {
                        const data: any = await api.get(`/reports/kra-export?businessId=${businessId}&startDate=${startDate}&endDate=${endDate}`);
                        const rows: string[][] = [
                          ['Receipt Number', 'Date', 'eTIMS Control', 'eTIMS Submitted', 'Subtotal (KES)', 'VAT (KES)', 'TOT (KES)', 'Total (KES)'],
                          ...data.transactions.map((t: any) => [
                            t.receiptNumber ?? '',
                            new Date(t.date).toLocaleDateString('en-KE'),
                            t.etimsControlNumber ?? '',
                            t.etimsSubmitted ? 'YES' : 'NO',
                            (t.subtotalCents / 100).toFixed(2),
                            (t.vatCents / 100).toFixed(2),
                            (t.totCents / 100).toFixed(2),
                            (t.totalCents / 100).toFixed(2),
                          ]),
                        ];
                        downloadCsv(`kra-export-${startDate.substring(0, 10)}.csv`, rows);
                      }}
                      className="flex items-center gap-2 px-5 py-3 bg-white border border-green-700 text-green-700 hover:bg-green-50 rounded-lg font-medium"
                    >
                      <Download className="w-4 h-4" />
                      Download KRA CSV Export
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── AUDIT LOG ── */}
            {tab === 'audit' && (
              <div className="space-y-4">
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                  <div className="flex items-start gap-4 mb-6">
                    <div className="bg-blue-100 p-3 rounded-xl">
                      <Shield className="w-6 h-6 text-blue-700" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Tamper-Evident Audit Log Export</h2>
                      <p className="text-sm text-gray-500 mt-1">
                        Exports the SHA-256 hash-chained audit log. Each entry includes previousHash and hash for chain verification.
                        The chain integrity is verified on export.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <button
                      onClick={async () => {
                        const data: any = await api.get(`/reports/audit-log-export?businessId=${businessId}&startDate=${startDate}&endDate=${endDate}`);
                        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `audit-log-${startDate.substring(0, 10)}-to-${endDate.substring(0, 10)}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="flex items-center gap-2 px-5 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-medium"
                    >
                      <Download className="w-4 h-4" />
                      Download Audit Log (JSON with hash chain)
                    </button>
                    <button
                      onClick={async () => {
                        const data: any = await api.get(`/reports/audit-log-export?businessId=${businessId}&startDate=${startDate}&endDate=${endDate}`);
                        const rows: string[][] = [
                          ['Seq', 'Date', 'Actor', 'Action', 'Entity', 'Entity ID', 'Chain Valid', 'Hash (first 16)'],
                          ...data.entries.map((e: any) => [
                            String(e.sequence),
                            new Date(e.createdAt).toLocaleString('en-KE'),
                            e.actor, e.action, e.entity, e.entityId,
                            e.chainValid ? 'YES' : 'TAMPERED',
                            e.hash.substring(0, 16) + '...',
                          ]),
                        ];
                        downloadCsv(`audit-log-${startDate.substring(0, 10)}.csv`, rows);
                      }}
                      className="flex items-center gap-2 px-5 py-3 bg-white border border-blue-700 text-blue-700 hover:bg-blue-50 rounded-lg font-medium"
                    >
                      <Download className="w-4 h-4" />
                      Download Audit Log CSV
                    </button>
                    <div className="text-xs text-gray-400 flex items-center gap-1.5 mt-2">
                      <Shield className="w-3.5 h-3.5" />
                      Chain integrity is verified automatically. TAMPERED entries indicate potential data modification.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── FULL DATA EXPORT ── */}
            {tab === 'export' && (
              <div className="space-y-4">
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                  <div className="flex items-start gap-4 mb-6">
                    <div className="bg-purple-100 p-3 rounded-xl">
                      <DatabaseBackup className="w-6 h-6 text-purple-700" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Full Data Export</h2>
                      <p className="text-sm text-gray-500 mt-1">
                        Exports all business data: items, sales (last 10,000), customers, expenses, suppliers, employees.
                        Use for data portability, backup, or migration.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <button
                      onClick={async () => {
                        const data = await api.get(`/reports/full-data-export?businessId=${businessId}`);
                        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `full-export-${new Date().toISOString().substring(0, 10)}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="flex items-center gap-2 px-5 py-3 bg-purple-700 hover:bg-purple-800 text-white rounded-lg font-medium"
                    >
                      <Download className="w-4 h-4" />
                      Download Full Data Export (JSON)
                    </button>
                    <p className="text-xs text-gray-400">
                      Note: Large datasets may take a moment to generate. Sales limited to last 10,000 transactions.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ── STOCK TRANSFERS ── */}
            {tab === 'transfers' && (
              <div className="space-y-4">
                {/* In-transit alert for selected store */}
                {storeId && transfersData && transfersData.summary.inTransitToStore > 0 && (
                  <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-5 py-3">
                    <ArrowRightLeft className="w-5 h-5 text-blue-600 flex-shrink-0" />
                    <p className="text-sm text-blue-800 font-medium">
                      {transfersData.summary.inTransitToStore} pending transfer{transfersData.summary.inTransitToStore !== 1 ? 's' : ''} in transit to this branch. Stock will appear once transfers are marked received.
                    </p>
                  </div>
                )}

                {/* Summary cards */}
                {transfersData && (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard label="Total Transfers" value={transfersData.summary.total} icon={ArrowRightLeft} color="bg-blue-500" />
                    <StatCard label="Pending / In-Transit" value={transfersData.summary.pending} icon={Package} color="bg-amber-500" sub="Awaiting receipt" />
                    <StatCard label="Completed" value={transfersData.summary.completed} icon={Package} color="bg-green-500" sub="Stock received" />
                    <StatCard label="Cancelled" value={transfersData.summary.cancelled} icon={Package} color="bg-red-400" />
                  </div>
                )}

                {/* Filter + export row */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex gap-2">
                    {(['', 'PENDING', 'COMPLETED', 'CANCELLED'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setTransferStatusFilter(s)}
                        className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${transferStatusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >{s === '' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}</button>
                    ))}
                  </div>
                  <div className="ml-auto">
                    <button
                      onClick={() => {
                        if (!transfersData?.transfers.length) return;
                        downloadCsv(`stock-transfers-${startDate.substring(0, 10)}.csv`, [
                          ['Date', 'Status', 'From Store', 'To Store', 'Items', 'Total Qty', 'Initiated By', 'Completed At'],
                          ...transfersData.transfers.map((t) => [
                            new Date(t.createdAt).toLocaleDateString('en-KE'),
                            t.status,
                            t.fromStoreName,
                            t.toStoreName,
                            t.items.map((i) => `${i.itemName} (${i.quantity})`).join('; '),
                            String(t.items.reduce((s, i) => s + i.quantity, 0)),
                            t.initiatedByName ?? '—',
                            t.completedAt ? new Date(t.completedAt).toLocaleDateString('en-KE') : '—',
                          ]),
                        ]);
                      }}
                      className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                    >
                      <Download className="w-4 h-4" /> Export CSV
                    </button>
                  </div>
                </div>

                {/* Transfers table */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-5 py-4 border-b">
                    <h2 className="font-semibold text-gray-800">Transfer History ({transfersData?.transfers.length ?? 0})</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">Date</th>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">Status</th>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">From → To</th>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">Items</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">Total Qty</th>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">Initiated By</th>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {!transfersData || transfersData.transfers.length === 0 ? (
                          <tr><td colSpan={7} className="px-5 py-10 text-center text-gray-400">No transfers found for this period</td></tr>
                        ) : transfersData.transfers.map((t) => (
                          <tr key={t.id} className="hover:bg-gray-50">
                            <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">
                              {new Date(t.createdAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </td>
                            <td className="px-5 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                t.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                                t.status === 'PENDING' ? 'bg-amber-100 text-amber-700' :
                                t.status === 'CANCELLED' ? 'bg-red-100 text-red-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>{t.status}</span>
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-1.5 text-sm">
                                <span className="font-medium text-gray-800">{t.fromStoreName}</span>
                                <ArrowRightLeft className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                                <span className="font-medium text-gray-800">{t.toStoreName}</span>
                              </div>
                            </td>
                            <td className="px-5 py-3">
                              <div className="space-y-0.5">
                                {t.items.slice(0, 3).map((item, idx) => (
                                  <div key={idx} className="text-xs text-gray-600">
                                    {item.itemName} <span className="font-semibold text-gray-800">×{item.quantity}</span>
                                  </div>
                                ))}
                                {t.items.length > 3 && (
                                  <div className="text-xs text-blue-500">+{t.items.length - 3} more items</div>
                                )}
                              </div>
                            </td>
                            <td className="px-5 py-3 text-right font-semibold">
                              {t.items.reduce((s, i) => s + i.quantity, 0)}
                            </td>
                            <td className="px-5 py-3 text-gray-500 text-xs">{t.initiatedByName ?? '—'}</td>
                            <td className="px-5 py-3 text-gray-400 text-xs max-w-32 truncate">{t.notes ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── DEAD STOCK ── */}
            {tab === 'dead-stock' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-gray-700">Threshold (days without a sale):</label>
                  {([30, 60, 90, 180] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setDeadStockDays(d)}
                      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${deadStockDays === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >{d}d</button>
                  ))}
                </div>
                {deadStockData && (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                      <StatCard label="Dead Stock Items" value={deadStockData.totalItems} icon={Package} color="bg-red-500" sub={`No sale in ${deadStockData.daysThreshold}+ days`} />
                      <StatCard label="Total Value at Cost" value={formatKES(deadStockData.totalValueCents)} icon={DollarSign} color="bg-orange-500" sub="Capital tied up" />
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-5 py-4 border-b flex justify-between items-center">
                        <h2 className="font-semibold text-gray-800">Dead Stock Items ({deadStockData.totalItems})</h2>
                        <button
                          onClick={() => {
                            if (!deadStockData.items.length) return;
                            downloadCsv(`dead-stock-${deadStockDays}d.csv`, [
                              ['Item', 'Category', 'Stock', 'Cost Price', 'Stock Value', 'Days Since Last Sale', 'Last Sale Date'],
                              ...deadStockData.items.map((r) => [
                                r.name, r.category, String(r.stock),
                                (r.costPriceCents / 100).toFixed(2),
                                (r.stockValueCents / 100).toFixed(2),
                                r.daysSinceLastSale != null ? String(r.daysSinceLastSale) : 'Never sold',
                                r.lastSaleDate ? new Date(r.lastSaleDate).toLocaleDateString('en-KE') : '—',
                              ]),
                            ]);
                          }}
                          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <Download className="w-4 h-4" /> Export CSV
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Item</th>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Category</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Stock</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Value at Cost</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Days Since Last Sale</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Last Sale</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {deadStockData.items.length === 0 ? (
                              <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-400">No dead stock found for this threshold</td></tr>
                            ) : deadStockData.items.map((r) => (
                              <tr key={r.itemId} className="hover:bg-gray-50">
                                <td className="px-5 py-3 font-medium">{r.name}</td>
                                <td className="px-5 py-3 text-gray-500">{r.category || '—'}</td>
                                <td className="px-5 py-3 text-right font-semibold">{r.stock}</td>
                                <td className="px-5 py-3 text-right text-orange-600 font-semibold">{formatKES(r.stockValueCents)}</td>
                                <td className="px-5 py-3 text-right">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.daysSinceLastSale == null ? 'bg-red-100 text-red-700' : r.daysSinceLastSale > 180 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                                    {r.daysSinceLastSale != null ? `${r.daysSinceLastSale}d` : 'Never sold'}
                                  </span>
                                </td>
                                <td className="px-5 py-3 text-right text-gray-500 text-xs">
                                  {r.lastSaleDate ? new Date(r.lastSaleDate).toLocaleDateString('en-KE') : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── GROSS MARGIN ── */}
            {tab === 'gross-margin' && (
              <div className="space-y-4">
                {grossMarginData && (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <StatCard label="Revenue" value={formatKES(grossMarginData.totalRevenueCents)} icon={DollarSign} color="bg-blue-500" />
                      <StatCard label="Total Cost" value={formatKES(grossMarginData.totalCostCents)} icon={TrendingUp} color="bg-red-500" />
                      <StatCard label="Gross Profit" value={formatKES(grossMarginData.totalGrossProfitCents)} icon={TrendingUp} color={grossMarginData.totalGrossProfitCents >= 0 ? 'bg-green-500' : 'bg-red-500'} />
                      <StatCard label="Overall Margin" value={`${grossMarginData.overallMarginPct.toFixed(1)}%`} icon={BarChart3} color="bg-purple-500" />
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-5 py-4 border-b flex justify-between items-center">
                        <h2 className="font-semibold text-gray-800">Gross Margin by Category</h2>
                        <button
                          onClick={() => {
                            if (!grossMarginData.categories.length) return;
                            const rows: string[][] = [['Category', 'Revenue', 'Cost', 'Gross Profit', 'Margin %', 'Qty']];
                            grossMarginData.categories.forEach((cat) => {
                              rows.push([cat.name, (cat.revenueCents / 100).toFixed(2), (cat.costCents / 100).toFixed(2), (cat.grossProfitCents / 100).toFixed(2), cat.marginPct.toFixed(1) + '%', String(cat.qty)]);
                              cat.items.forEach((item) => {
                                rows.push(['  ' + item.name, (item.revenueCents / 100).toFixed(2), (item.costCents / 100).toFixed(2), (item.grossProfitCents / 100).toFixed(2), item.marginPct.toFixed(1) + '%', String(item.qty)]);
                              });
                            });
                            downloadCsv(`gross-margin-${startDate.substring(0, 10)}.csv`, rows);
                          }}
                          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <Download className="w-4 h-4" /> Export CSV
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Category / Item</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Qty</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Revenue</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Cost</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Gross Profit</th>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Margin %</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {grossMarginData.categories.length === 0 ? (
                              <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-400">No sales data for this period</td></tr>
                            ) : grossMarginData.categories.map((cat) => (
                              <>
                                <tr
                                  key={cat.name}
                                  onClick={() => setExpandedGrossMarginCategory(expandedGrossMarginCategory === cat.name ? null : cat.name)}
                                  className="bg-gray-50 cursor-pointer hover:bg-gray-100"
                                >
                                  <td className="px-5 py-3 font-bold text-gray-800 flex items-center gap-2">
                                    <span className={`text-gray-400 transition-transform ${expandedGrossMarginCategory === cat.name ? 'rotate-90' : ''}`}>▶</span>
                                    {cat.name}
                                  </td>
                                  <td className="px-5 py-3 text-right font-semibold">{cat.qty}</td>
                                  <td className="px-5 py-3 text-right font-semibold">{formatKES(cat.revenueCents)}</td>
                                  <td className="px-5 py-3 text-right font-semibold text-red-600">{formatKES(cat.costCents)}</td>
                                  <td className="px-5 py-3 text-right font-bold text-green-600">{formatKES(cat.grossProfitCents)}</td>
                                  <td className="px-5 py-3">
                                    <div className="flex items-center gap-2">
                                      <div className="flex-1 bg-gray-200 rounded-full h-2 min-w-16">
                                        <div className="bg-green-500 h-2 rounded-full" style={{ width: `${Math.min(100, Math.max(0, cat.marginPct))}%` }} />
                                      </div>
                                      <span className="text-xs font-semibold text-gray-700 whitespace-nowrap">{cat.marginPct.toFixed(1)}%</span>
                                    </div>
                                  </td>
                                </tr>
                                {expandedGrossMarginCategory === cat.name && cat.items.map((item) => (
                                  <tr key={item.name} className="hover:bg-blue-50/30">
                                    <td className="px-5 py-2 pl-10 text-gray-700">{item.name}</td>
                                    <td className="px-5 py-2 text-right text-gray-600">{item.qty}</td>
                                    <td className="px-5 py-2 text-right text-gray-600">{formatKES(item.revenueCents)}</td>
                                    <td className="px-5 py-2 text-right text-red-500">{formatKES(item.costCents)}</td>
                                    <td className="px-5 py-2 text-right text-green-600 font-semibold">{formatKES(item.grossProfitCents)}</td>
                                    <td className="px-5 py-2">
                                      <div className="flex items-center gap-2">
                                        <div className="flex-1 bg-gray-200 rounded-full h-1.5 min-w-16">
                                          <div className="bg-green-400 h-1.5 rounded-full" style={{ width: `${Math.min(100, Math.max(0, item.marginPct))}%` }} />
                                        </div>
                                        <span className="text-xs text-gray-600 whitespace-nowrap">{item.marginPct.toFixed(1)}%</span>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </>
                            ))}
                          </tbody>
                          {grossMarginData.categories.length > 0 && (
                            <tfoot>
                              <tr className="bg-gray-100 font-bold">
                                <td className="px-5 py-3 text-gray-800">Total</td>
                                <td className="px-5 py-3 text-right">{grossMarginData.categories.reduce((s, c) => s + c.qty, 0)}</td>
                                <td className="px-5 py-3 text-right">{formatKES(grossMarginData.totalRevenueCents)}</td>
                                <td className="px-5 py-3 text-right text-red-600">{formatKES(grossMarginData.totalCostCents)}</td>
                                <td className="px-5 py-3 text-right text-green-600">{formatKES(grossMarginData.totalGrossProfitCents)}</td>
                                <td className="px-5 py-3 text-sm font-bold text-purple-700">{grossMarginData.overallMarginPct.toFixed(1)}%</td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── SHRINKAGE ── */}
            {tab === 'shrinkage' && (
              <div className="space-y-4">
                {shrinkageData && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <StatCard
                        label="Total Incidents"
                        value={shrinkageData.totalIncidents}
                        icon={AlertTriangle}
                        color="bg-orange-500"
                      />
                      <StatCard
                        label="Total Value Lost"
                        value={formatKES(shrinkageData.totalValueCents)}
                        icon={DollarSign}
                        color="bg-red-500"
                      />
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-5 py-4 border-b flex justify-between items-center">
                        <h2 className="font-semibold text-gray-800">Shrinkage by Item</h2>
                        <button
                          onClick={() => {
                            if (!shrinkageData.items.length) return;
                            const rows: string[][] = [['Item Name', 'SKU', 'Units Lost', 'Incidents', 'Value Lost (KES)']];
                            shrinkageData.items.forEach((i) => {
                              rows.push([i.name, i.sku, String(i.totalUnitsLost), String(i.incidents), (i.totalValueCents / 100).toFixed(2)]);
                            });
                            downloadCsv(`shrinkage-${startDate.substring(0, 10)}.csv`, rows);
                          }}
                          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <Download className="w-4 h-4" /> Export CSV
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Item Name</th>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">SKU</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Units Lost</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Incidents</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Value Lost</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {shrinkageData.items.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="px-5 py-8 text-center text-gray-400">
                                  No shrinkage recorded for this period
                                </td>
                              </tr>
                            ) : shrinkageData.items.map((item) => (
                              <tr key={item.itemId} className="hover:bg-gray-50">
                                <td className="px-5 py-3 font-medium text-gray-800">{item.name}</td>
                                <td className="px-5 py-3 text-gray-500 font-mono text-xs">{item.sku || '—'}</td>
                                <td className="px-5 py-3 text-right text-orange-600 font-semibold">{item.totalUnitsLost}</td>
                                <td className="px-5 py-3 text-right text-gray-600">{item.incidents}</td>
                                <td className="px-5 py-3 text-right text-red-600 font-semibold">{formatKES(item.totalValueCents)}</td>
                              </tr>
                            ))}
                          </tbody>
                          {shrinkageData.items.length > 0 && (
                            <tfoot>
                              <tr className="bg-gray-100 font-bold">
                                <td className="px-5 py-3 text-gray-800" colSpan={2}>Total</td>
                                <td className="px-5 py-3 text-right text-orange-700">
                                  {shrinkageData.items.reduce((s, i) => s + i.totalUnitsLost, 0)}
                                </td>
                                <td className="px-5 py-3 text-right text-gray-700">{shrinkageData.totalIncidents}</td>
                                <td className="px-5 py-3 text-right text-red-700">{formatKES(shrinkageData.totalValueCents)}</td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>
                  </>
                )}
                {!shrinkageData && (
                  <div className="flex items-center justify-center py-16 text-gray-400">
                    <RefreshCw className="w-6 h-6 animate-spin mr-2" /> Loading…
                  </div>
                )}
              </div>
            )}

            {/* ── DEPT P&L ── */}
            {tab === 'dept-pnl' && (
              <div className="space-y-4">
                {deptPnlData && (
                  <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <StatCard label="Total Revenue" value={formatKES(deptPnlData.totals.revenueCents)} icon={DollarSign} color="bg-blue-500" />
                      <StatCard label="Total COGS" value={formatKES(deptPnlData.totals.cogsCents)} icon={TrendingUp} color="bg-red-500" />
                      <StatCard label="Gross Profit" value={formatKES(deptPnlData.totals.grossProfitCents)} icon={TrendingUp} color={deptPnlData.totals.grossProfitCents >= 0 ? 'bg-green-500' : 'bg-red-500'} />
                      <StatCard label="Overall Margin" value={`${deptPnlData.totals.marginPct.toFixed(1)}%`} icon={BarChart3} color="bg-purple-500" />
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-5 py-4 border-b flex justify-between items-center">
                        <h2 className="font-semibold text-gray-800">Department / Category P&L</h2>
                        <button
                          onClick={() => {
                            if (!deptPnlData.departments.length) return;
                            const rows: string[][] = [['Category', 'Revenue', 'COGS', 'Gross Profit', 'Margin %', 'Units']];
                            deptPnlData.departments.forEach((d) => {
                              rows.push([d.category, (d.revenueCents / 100).toFixed(2), (d.cogsCents / 100).toFixed(2), (d.grossProfitCents / 100).toFixed(2), d.marginPct.toFixed(1) + '%', String(d.units)]);
                            });
                            downloadCsv(`dept-pnl-${startDate.substring(0, 10)}.csv`, rows);
                          }}
                          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <Download className="w-4 h-4" /> Export CSV
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Category</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Units</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Revenue</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">COGS</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Gross Profit</th>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Margin %</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {deptPnlData.departments.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="px-5 py-8 text-center text-gray-400">
                                  No sales data for this period
                                </td>
                              </tr>
                            ) : deptPnlData.departments.map((dept) => {
                              const marginColor = dept.marginPct >= 30
                                ? 'text-green-600'
                                : dept.marginPct >= 10
                                ? 'text-yellow-600'
                                : 'text-red-600';
                              const barColor = dept.marginPct >= 30
                                ? 'bg-green-500'
                                : dept.marginPct >= 10
                                ? 'bg-yellow-400'
                                : 'bg-red-400';
                              const barWidth = Math.min(100, Math.max(0, (dept.marginPct / 60) * 100));
                              return (
                                <tr key={dept.category} className="hover:bg-gray-50">
                                  <td className="px-5 py-3 font-medium text-gray-800">{dept.category}</td>
                                  <td className="px-5 py-3 text-right text-gray-600">{dept.units}</td>
                                  <td className="px-5 py-3 text-right font-semibold text-blue-700">{formatKES(dept.revenueCents)}</td>
                                  <td className="px-5 py-3 text-right text-red-600">{formatKES(dept.cogsCents)}</td>
                                  <td className={`px-5 py-3 text-right font-bold ${dept.grossProfitCents >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {formatKES(dept.grossProfitCents)}
                                  </td>
                                  <td className="px-5 py-3">
                                    <div className="flex items-center gap-2">
                                      <div className="flex-1 bg-gray-200 rounded-full h-2 min-w-16">
                                        <div className={`${barColor} h-2 rounded-full`} style={{ width: `${barWidth}%` }} />
                                      </div>
                                      <span className={`text-xs font-semibold whitespace-nowrap ${marginColor}`}>
                                        {dept.marginPct.toFixed(1)}%
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          {deptPnlData.departments.length > 0 && (
                            <tfoot>
                              <tr className="bg-gray-100 font-bold">
                                <td className="px-5 py-3 text-gray-800">Total</td>
                                <td className="px-5 py-3 text-right">{deptPnlData.departments.reduce((s, d) => s + d.units, 0)}</td>
                                <td className="px-5 py-3 text-right text-blue-700">{formatKES(deptPnlData.totals.revenueCents)}</td>
                                <td className="px-5 py-3 text-right text-red-600">{formatKES(deptPnlData.totals.cogsCents)}</td>
                                <td className="px-5 py-3 text-right text-green-600">{formatKES(deptPnlData.totals.grossProfitCents)}</td>
                                <td className="px-5 py-3 text-sm font-bold text-purple-700">{deptPnlData.totals.marginPct.toFixed(1)}%</td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>
                  </>
                )}
                {!deptPnlData && (
                  <div className="flex items-center justify-center py-16 text-gray-400">
                    <RefreshCw className="w-6 h-6 animate-spin mr-2" /> Loading…
                  </div>
                )}
              </div>
            )}

            {/* ── RECIPE COSTING ── */}
            {tab === 'recipe-costing' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-green-700">{recipeCostData?.summary.totalItems ?? 0}</p>
                    <p className="text-xs text-gray-500">Recipe Items</p>
                  </div>
                  <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-yellow-700">{(recipeCostData?.summary.avgFoodCostPct ?? 0).toFixed(1)}%</p>
                    <p className="text-xs text-gray-500">Avg Food Cost %</p>
                  </div>
                  <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-red-700">{recipeCostData?.summary.highCostItems ?? 0}</p>
                    <p className="text-xs text-gray-500">High Cost Items</p>
                  </div>
                </div>
                {!recipeCostData?.items.length ? (
                  <div className="text-center py-12 text-gray-400">No recipe items found. Add bundle components to items in Inventory to enable food cost analysis.</div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 dark:bg-gray-800">
                        <tr>
                          <th className="px-4 py-3 text-left">Item</th>
                          <th className="px-4 py-3 text-left">Category</th>
                          <th className="px-4 py-3 text-right">Selling Price</th>
                          <th className="px-4 py-3 text-right">Ingredient Cost</th>
                          <th className="px-4 py-3 text-right">Food Cost %</th>
                          <th className="px-4 py-3 text-right">Margin %</th>
                          <th className="px-4 py-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {recipeCostData.items.map(item => (
                          <tr key={item.itemId} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                            <td className="px-4 py-3 font-medium">{item.name}</td>
                            <td className="px-4 py-3 text-gray-500">{item.category}</td>
                            <td className="px-4 py-3 text-right">{formatKES(item.sellingPriceCents)}</td>
                            <td className="px-4 py-3 text-right">{formatKES(item.totalIngredientCostCents)}</td>
                            <td className="px-4 py-3 text-right font-semibold">{item.foodCostPct !== null ? `${item.foodCostPct.toFixed(1)}%` : '—'}</td>
                            <td className="px-4 py-3 text-right">
                              {item.grossMarginPct !== null ? (
                                <span className={item.grossMarginPct >= 65 ? 'text-green-600' : item.grossMarginPct >= 40 ? 'text-yellow-600' : 'text-red-600'}>
                                  {item.grossMarginPct.toFixed(1)}%
                                </span>
                              ) : '—'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.status === 'HIGH_COST' ? 'bg-red-100 text-red-700' : item.status === 'ACCEPTABLE' ? 'bg-yellow-100 text-yellow-700' : item.status === 'LOW_COST' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                {item.status.replace('_', ' ')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── VAT RETURN ── */}
            {tab === 'vat-return' && (
              <div className="space-y-6">
                {vatReturnLoading && (
                  <div className="flex items-center justify-center py-16 text-gray-400">
                    <RefreshCw className="w-6 h-6 animate-spin mr-2" /> Loading VAT Return data…
                  </div>
                )}
                {!vatReturnLoading && vatReturnData && (
                  <>
                    {/* Summary cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4">
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Output VAT (Sales)</p>
                        <p className="text-2xl font-bold text-green-700 dark:text-green-400">{formatKES(vatReturnData.outputVat.totalCents)}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">From {vatReturnData.outputVat.salesCount} transactions totalling {formatKES(vatReturnData.outputVat.totalSalesCents)}</p>
                      </div>
                      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4">
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Input VAT (Reclaimable)</p>
                        <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{formatKES(vatReturnData.inputVat.totalCents)}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">From {vatReturnData.inputVat.expensesCount} approved reclaimable expenses</p>
                      </div>
                      <div className={`rounded-xl p-4 ${vatReturnData.netVatPayableCents >= 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-purple-50 dark:bg-purple-900/20'}`}>
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Net VAT Payable</p>
                        <p className={`text-2xl font-bold ${vatReturnData.netVatPayableCents >= 0 ? 'text-red-700 dark:text-red-400' : 'text-purple-700 dark:text-purple-400'}`}>
                          {formatKES(Math.abs(vatReturnData.netVatPayableCents))}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {vatReturnData.netVatPayableCents >= 0 ? 'Payable to KRA' : 'Credit / Refund due from KRA'}
                        </p>
                      </div>
                    </div>

                    {/* Export button */}
                    <div className="flex justify-end">
                      <button
                        onClick={() => {
                          const rows: string[][] = [
                            ['KRA VAT Return Export'],
                            [`Period: ${new Date(vatReturnData.period.startDate).toLocaleDateString('en-KE')} to ${new Date(vatReturnData.period.endDate).toLocaleDateString('en-KE')}`],
                            [],
                            ['SECTION A — OUTPUT TAX (SALES)'],
                            ['Receipt No', 'Date', 'Gross Sales (KES)', 'Taxable Amount (KES)', 'Output VAT (KES)'],
                            ...vatReturnData.outputVat.sales.map(s => [
                              s.receiptNumber ?? '',
                              new Date(s.createdAt).toLocaleDateString('en-KE'),
                              ((s.totalCents) / 100).toFixed(2),
                              ((s.subtotalCents - (s.discountCents ?? 0)) / 100).toFixed(2),
                              (s.vatCents / 100).toFixed(2),
                            ]),
                            ['TOTAL', '', (vatReturnData.outputVat.totalSalesCents / 100).toFixed(2), '', (vatReturnData.outputVat.totalCents / 100).toFixed(2)],
                            [],
                            ['SECTION B — INPUT TAX (PURCHASES / EXPENSES)'],
                            ['Description', 'Category', 'Date', 'Amount Incl. VAT (KES)', 'Input VAT (KES)'],
                            ...vatReturnData.inputVat.expenses.map(e => [
                              e.description,
                              e.category,
                              new Date(e.createdAt).toLocaleDateString('en-KE'),
                              (e.amountCents / 100).toFixed(2),
                              (e.vatCents / 100).toFixed(2),
                            ]),
                            ['TOTAL', '', '', '', (vatReturnData.inputVat.totalCents / 100).toFixed(2)],
                            [],
                            ['SUMMARY'],
                            ['Output VAT', (vatReturnData.outputVat.totalCents / 100).toFixed(2)],
                            ['Input VAT (Claimable)', (vatReturnData.inputVat.totalCents / 100).toFixed(2)],
                            ['Net VAT Payable', (vatReturnData.netVatPayableCents / 100).toFixed(2)],
                          ];
                          const content = rows.map(r => r.map(c => { const s = String(c ?? ''); return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');
                          const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a'); a.href = url; a.download = `vat-return-itax-${startDate.substring(0, 10)}.csv`; a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl transition-colors"
                      >
                        <Download className="w-4 h-4" /> Export for iTax (CSV)
                      </button>
                    </div>

                    {/* Output VAT table */}
                    <div>
                      <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-3">Section A — Output VAT (Sales)</h3>
                      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                            <tr>
                              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Receipt No</th>
                              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
                              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Gross (KES)</th>
                              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Output VAT (KES)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                            {vatReturnData.outputVat.sales.slice(0, 50).map((s, i) => (
                              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                <td className="px-4 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300">{s.receiptNumber ?? '—'}</td>
                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{new Date(s.createdAt).toLocaleDateString('en-KE')}</td>
                                <td className="px-4 py-2.5 text-right">{formatKES(s.totalCents)}</td>
                                <td className="px-4 py-2.5 text-right font-semibold text-green-700 dark:text-green-400">{formatKES(s.vatCents)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="border-t-2 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                            <tr>
                              <td colSpan={2} className="px-4 py-3 font-bold text-gray-800 dark:text-gray-200">TOTAL</td>
                              <td className="px-4 py-3 text-right font-bold">{formatKES(vatReturnData.outputVat.totalSalesCents)}</td>
                              <td className="px-4 py-3 text-right font-bold text-green-700 dark:text-green-400">{formatKES(vatReturnData.outputVat.totalCents)}</td>
                            </tr>
                          </tfoot>
                        </table>
                        {vatReturnData.outputVat.salesCount > 50 && (
                          <p className="text-xs text-gray-400 text-center py-2">Showing first 50 of {vatReturnData.outputVat.salesCount} transactions. Export CSV for full data.</p>
                        )}
                      </div>
                    </div>

                    {/* Input VAT table */}
                    <div>
                      <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-3">Section B — Input VAT (Reclaimable Expenses)</h3>
                      {vatReturnData.inputVat.expensesCount === 0 ? (
                        <div className="text-center py-8 text-gray-400 dark:text-gray-500 border border-dashed border-gray-300 dark:border-gray-600 rounded-xl">
                          No reclaimable expenses for this period. Mark expenses as &ldquo;VAT Reclaimable&rdquo; in the Expenses module.
                        </div>
                      ) : (
                        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                              <tr>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Description</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Category</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
                                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Amount (KES)</th>
                                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Input VAT (KES)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                              {vatReturnData.inputVat.expenses.map((e, i) => (
                                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                  <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200">{e.description}</td>
                                  <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{e.category}</td>
                                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{new Date(e.createdAt).toLocaleDateString('en-KE')}</td>
                                  <td className="px-4 py-2.5 text-right">{formatKES(e.amountCents)}</td>
                                  <td className="px-4 py-2.5 text-right font-semibold text-blue-700 dark:text-blue-400">{formatKES(e.vatCents)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot className="border-t-2 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                              <tr>
                                <td colSpan={3} className="px-4 py-3 font-bold text-gray-800 dark:text-gray-200">TOTAL</td>
                                <td className="px-4 py-3 text-right font-bold">{formatKES(vatReturnData.inputVat.expenses.reduce((s, e) => s + e.amountCents, 0))}</td>
                                <td className="px-4 py-3 text-right font-bold text-blue-700 dark:text-blue-400">{formatKES(vatReturnData.inputVat.totalCents)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Net summary */}
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                      <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-3">Summary — VAT Computation</h3>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between"><span className="text-gray-600 dark:text-gray-400">Output VAT (Box 8)</span><span className="font-semibold text-gray-900 dark:text-white">{formatKES(vatReturnData.outputVat.totalCents)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-600 dark:text-gray-400">Input VAT Claimable (Box 13)</span><span className="font-semibold text-gray-900 dark:text-white">({formatKES(vatReturnData.inputVat.totalCents)})</span></div>
                        <div className="flex justify-between border-t border-gray-200 dark:border-gray-700 pt-2 mt-2">
                          <span className="font-bold text-gray-800 dark:text-gray-200">Net VAT Payable / (Refundable)</span>
                          <span className={`font-bold text-lg ${vatReturnData.netVatPayableCents >= 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                            {vatReturnData.netVatPayableCents < 0 ? `(${formatKES(Math.abs(vatReturnData.netVatPayableCents))})` : formatKES(vatReturnData.netVatPayableCents)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── FISCAL ── */}
            {tab === 'fiscal' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* X-Report */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                    <div className="px-5 py-4 border-b">
                      <h2 className="font-semibold text-gray-800">X-Report (Snapshot)</h2>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Current session totals — does NOT close the day
                      </p>
                    </div>
                    <div className="p-5">
                      {xReport?.error ? (
                        <div className="text-center py-6 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg">
                          {xReport.error}
                        </div>
                      ) : xReport?.session ? (
                        <div className="space-y-3 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600">Transactions</span>
                            <span className="font-semibold">{xReport.salesCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Total Sales</span>
                            <span className="font-semibold">{formatKES(xReport.totalSalesCents)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">VAT</span>
                            <span className="font-semibold text-purple-600">{formatKES(xReport.totalVatCents)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Opening Float</span>
                            <span className="font-semibold">{formatKES(xReport.openingBalanceCents)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Expected Cash in Drawer</span>
                            <span className="font-semibold text-green-700">{formatKES(xReport.expectedCashCents)}</span>
                          </div>
                          {(xReport.paymentBreakdown ?? []).length > 0 && (
                            <div className="border-t pt-3">
                              <p className="text-xs text-gray-400 font-semibold uppercase mb-2">
                                By Payment Method
                              </p>
                              {(xReport.paymentBreakdown ?? []).map((pm) => (
                                <div key={pm.method} className="flex justify-between py-1">
                                  <span className="text-gray-600">{pm.method} ({pm.count})</span>
                                  <span>{formatKES(pm.amountCents)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <p className="text-xs text-gray-400 pt-2">
                            Generated: {new Date(xReport.generatedAt).toLocaleString('en-KE')}
                          </p>
                        </div>
                      ) : (
                        <div className="text-center py-6">
                          <p className="text-gray-500 text-sm mb-4">
                            Click to generate current session snapshot
                          </p>
                          <button
                            onClick={() => void refetchXReport()}
                            disabled={xLoading}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 mx-auto"
                          >
                            {xLoading && <RefreshCw className="w-4 h-4 animate-spin" />}
                            Generate X-Report
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Z-Report */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                    <div className="px-5 py-4 border-b">
                      <h2 className="font-semibold text-gray-800">Z-Report (End of Day)</h2>
                      <p className="text-xs text-gray-500 mt-0.5">Closes the business day — run at end of shift</p>
                    </div>
                    <div className="p-5">
                      <div className="flex items-start gap-3 p-3 bg-amber-50 rounded-lg mb-4">
                        <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-700">
                          Z-Report closes the current business day and resets daily counters. Run only at end of business day.
                        </p>
                      </div>
                      <button
                        onClick={() => setShowZReportModal(true)}
                        className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium"
                      >
                        Run Z-Report (End of Day)
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {/* ── MENU ENGINEERING ── */}
            {tab === 'menu-engineering' && (
              <div className="space-y-4">
                {/* Days selector + export */}
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium text-gray-600">Period:</span>
                  {([7, 30, 90] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setMenuEngDays(d)}
                      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${menuEngDays === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >{d === 7 ? '7 Days' : d === 30 ? '30 Days' : '90 Days'}</button>
                  ))}
                  <div className="ml-auto">
                    <button
                      onClick={() => {
                        if (!menuEngineeringData?.items.length) return;
                        downloadCsv(`menu-engineering-${menuEngDays}d.csv`, [
                          ['Item', 'Category', 'Sold Qty', 'Revenue (KES)', 'Margin %', 'Quadrant'],
                          ...menuEngineeringData.items.map((i) => [
                            i.name, i.category, String(i.qty),
                            (i.revenueCents / 100).toFixed(2),
                            i.marginPct.toFixed(1) + '%', i.quadrant,
                          ]),
                        ]);
                      }}
                      className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                    >
                      <Download className="w-4 h-4" /> Export CSV
                    </button>
                  </div>
                </div>

                {/* Quadrant visual grid */}
                {menuEngineeringData && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {(
                        [
                          { key: 'STAR', label: 'Stars', desc: 'High margin + High sales', color: 'bg-yellow-50 border-yellow-300', badge: 'bg-yellow-100 text-yellow-800' },
                          { key: 'PLOWHORSE', label: 'Plowhorses', desc: 'Low margin + High sales', color: 'bg-blue-50 border-blue-300', badge: 'bg-blue-100 text-blue-800' },
                          { key: 'PUZZLE', label: 'Puzzles', desc: 'High margin + Low sales', color: 'bg-purple-50 border-purple-300', badge: 'bg-purple-100 text-purple-800' },
                          { key: 'DOG', label: 'Dogs', desc: 'Low margin + Low sales', color: 'bg-gray-50 border-gray-300', badge: 'bg-gray-100 text-gray-600' },
                        ] as const
                      ).map((q) => {
                        const count = menuEngineeringData.items.filter((i) => i.quadrant === q.key).length;
                        return (
                          <div key={q.key} className={`rounded-xl border-2 p-4 ${q.color}`}>
                            <div className="flex items-center justify-between mb-1">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${q.badge}`}>{q.key}</span>
                              <span className="text-2xl font-bold text-gray-800">{count}</span>
                            </div>
                            <p className="font-semibold text-gray-800 text-sm">{q.label}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{q.desc}</p>
                          </div>
                        );
                      })}
                    </div>

                    {/* Items table */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-5 py-4 border-b flex items-center justify-between">
                        <h2 className="font-semibold text-gray-800">All Items ({menuEngineeringData.items.length})</h2>
                        <span className="text-xs text-gray-400">Avg Qty: {menuEngineeringData.avgQty.toFixed(0)} · Avg Margin: {menuEngineeringData.avgMarginPct.toFixed(1)}%</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Item</th>
                              <th className="text-left px-5 py-3 font-medium text-gray-600">Category</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Sold Qty</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Revenue</th>
                              <th className="text-right px-5 py-3 font-medium text-gray-600">Margin %</th>
                              <th className="text-center px-5 py-3 font-medium text-gray-600">Quadrant</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {menuEngineeringData.items.length === 0 ? (
                              <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-400">No data for this period</td></tr>
                            ) : menuEngineeringData.items.map((item) => (
                              <tr key={item.id} className="hover:bg-gray-50">
                                <td className="px-5 py-3 font-medium text-gray-800">{item.name}</td>
                                <td className="px-5 py-3 text-gray-500">{item.category}</td>
                                <td className="px-5 py-3 text-right text-gray-700">{item.qty.toLocaleString()}</td>
                                <td className="px-5 py-3 text-right text-gray-700">{formatKES(item.revenueCents)}</td>
                                <td className="px-5 py-3 text-right text-gray-700">{item.marginPct.toFixed(1)}%</td>
                                <td className="px-5 py-3 text-center">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                    item.quadrant === 'STAR' ? 'bg-yellow-100 text-yellow-800' :
                                    item.quadrant === 'PLOWHORSE' ? 'bg-blue-100 text-blue-800' :
                                    item.quadrant === 'PUZZLE' ? 'bg-purple-100 text-purple-800' :
                                    'bg-gray-100 text-gray-600'
                                  }`}>{item.quadrant}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
                {!menuEngineeringData && (
                  <div className="flex items-center justify-center py-16 text-gray-400">
                    <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading menu engineering data…
                  </div>
                )}
              </div>
            )}

            {/* ── BASKET ANALYSIS ── */}
            {tab === 'basket-analysis' && (
              <div className="space-y-4">
                {/* Days selector */}
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium text-gray-600">Period:</span>
                  {([7, 30, 90] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setBasketDays(d)}
                      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${basketDays === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >{d === 7 ? '7 Days' : d === 30 ? '30 Days' : '90 Days'}</button>
                  ))}
                  {basketAnalysisData && (
                    <span className="ml-2 text-sm text-gray-500">{basketAnalysisData.totalSales.toLocaleString()} total sales analyzed</span>
                  )}
                </div>

                {/* Pairs table */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-5 py-4 border-b">
                    <h2 className="font-semibold text-gray-800">Frequently Bought Together</h2>
                    <p className="text-xs text-gray-500 mt-0.5">Items most often purchased in the same transaction</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">Rank</th>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">Item A</th>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">Item B</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">Bought Together</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">% of Sales</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {!basketAnalysisData ? (
                          <tr><td colSpan={5} className="px-5 py-10 text-center text-gray-400"><RefreshCw className="w-5 h-5 animate-spin inline mr-2" />Loading…</td></tr>
                        ) : basketAnalysisData.pairs.length === 0 ? (
                          <tr><td colSpan={5} className="px-5 py-10 text-center text-gray-400">No co-purchase data for this period</td></tr>
                        ) : basketAnalysisData.pairs.map((pair, idx) => {
                          const pct = basketAnalysisData.totalSales > 0 ? ((pair.count / basketAnalysisData.totalSales) * 100).toFixed(1) : '0.0';
                          return (
                            <tr key={`${pair.item1}-${pair.item2}`} className="hover:bg-gray-50">
                              <td className="px-5 py-3 text-gray-400 font-mono text-xs">{idx + 1}</td>
                              <td className="px-5 py-3 font-medium text-gray-800">{pair.name1}</td>
                              <td className="px-5 py-3 font-medium text-gray-800">{pair.name2}</td>
                              <td className="px-5 py-3 text-right text-gray-700">{pair.count.toLocaleString()}</td>
                              <td className="px-5 py-3 text-right">
                                <span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-semibold">{pct}%</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── CUSTOMER LTV ── */}
            {tab === 'clv' && (
              <div className="space-y-4">
                {/* Summary cards */}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  <StatCard
                    label="Total Customers"
                    value={clvData.length}
                    icon={Users}
                    color="bg-blue-500"
                  />
                  <StatCard
                    label="Avg Lifetime Value"
                    value={clvData.length > 0 ? formatKES(Math.round(clvData.reduce((s, r) => s + r.totalSpendCents, 0) / clvData.length)) : '—'}
                    icon={DollarSign}
                    color="bg-green-500"
                    valueColor="text-green-600"
                  />
                  <StatCard
                    label="High Churn Risk"
                    value={clvData.filter((r) => r.churnRisk === 'HIGH').length}
                    icon={AlertCircle}
                    color="bg-red-500"
                    valueColor="text-red-600"
                    sub="Customers at risk"
                  />
                </div>

                {/* Export */}
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      if (!clvData.length) return;
                      downloadCsv('customer-ltv.csv', [
                        ['Customer', 'Phone', 'Visits', 'Total Spend (KES)', 'Avg Order (KES)', 'First Visit', 'Last Visit', 'Days Since Last', 'Frequency (days)', 'Churn Risk'],
                        ...clvData.map((r) => [
                          r.name, r.phone, String(r.visitCount),
                          (r.totalSpendCents / 100).toFixed(2),
                          (r.avgOrderCents / 100).toFixed(2),
                          new Date(r.firstVisit).toLocaleDateString('en-KE'),
                          new Date(r.lastVisit).toLocaleDateString('en-KE'),
                          String(r.daysSinceLast),
                          r.visitFrequencyDays > 0 ? r.visitFrequencyDays.toFixed(0) : '—',
                          r.churnRisk,
                        ]),
                      ]);
                    }}
                    className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                  >
                    <Download className="w-4 h-4" /> Export CSV
                  </button>
                </div>

                {/* Table sorted by total spend desc */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-5 py-4 border-b">
                    <h2 className="font-semibold text-gray-800">Customer Lifetime Value ({clvData.length})</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">Customer</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">Visits</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">Total Spend</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">Avg Order</th>
                          <th className="text-left px-5 py-3 font-medium text-gray-600">Last Visit</th>
                          <th className="text-right px-5 py-3 font-medium text-gray-600">Frequency</th>
                          <th className="text-center px-5 py-3 font-medium text-gray-600">Churn Risk</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {clvData.length === 0 ? (
                          <tr><td colSpan={7} className="px-5 py-10 text-center text-gray-400">No customer data available</td></tr>
                        ) : [...clvData].sort((a, b) => b.totalSpendCents - a.totalSpendCents).map((row) => (
                          <tr key={row.id} className="hover:bg-gray-50">
                            <td className="px-5 py-3">
                              <p className="font-medium text-gray-800">{row.name}</p>
                              <p className="text-xs text-gray-400">{row.phone}</p>
                            </td>
                            <td className="px-5 py-3 text-right text-gray-700">{row.visitCount}</td>
                            <td className="px-5 py-3 text-right font-semibold text-gray-800">{formatKES(row.totalSpendCents)}</td>
                            <td className="px-5 py-3 text-right text-gray-600">{formatKES(row.avgOrderCents)}</td>
                            <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">
                              {new Date(row.lastVisit).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
                              <span className="ml-1 text-gray-400">({row.daysSinceLast}d ago)</span>
                            </td>
                            <td className="px-5 py-3 text-right text-gray-600 text-xs">
                              {row.visitFrequencyDays > 0 ? `every ${row.visitFrequencyDays.toFixed(0)}d` : '—'}
                            </td>
                            <td className="px-5 py-3 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                row.churnRisk === 'HIGH' ? 'bg-red-100 text-red-700' :
                                row.churnRisk === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' :
                                'bg-green-100 text-green-700'
                              }`}>{row.churnRisk}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── NPS DASHBOARD ── */}
            {tab === 'nps' && (
              <div className="space-y-4">
                {npsData ? (
                  <>
                    {/* Big NPS score + promoter/passive/detractor cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      {/* NPS score */}
                      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 flex flex-col items-center justify-center lg:col-span-1">
                        <p className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">NPS Score</p>
                        <p className={`text-5xl font-extrabold ${
                          npsData.npsScore == null ? 'text-gray-400' :
                          npsData.npsScore >= 50 ? 'text-green-600' :
                          npsData.npsScore >= 0 ? 'text-yellow-500' :
                          'text-red-600'
                        }`}>{npsData.npsScore == null ? '—' : (npsData.npsScore > 0 ? '+' : '') + npsData.npsScore}</p>
                        <p className="text-xs text-gray-400 mt-1">-100 to +100 scale</p>
                        <p className="text-sm text-gray-600 mt-2 font-medium">Avg rating: {npsData.avg != null ? npsData.avg.toFixed(1) : '—'} / 10</p>
                        <p className="text-xs text-gray-400">{npsData.total} responses</p>
                      </div>
                      {/* Promoters */}
                      <div className="bg-green-50 rounded-xl p-5 shadow-sm border border-green-200 text-center">
                        <p className="text-xs text-green-600 font-semibold uppercase tracking-wide mb-1">Promoters</p>
                        <p className="text-3xl font-bold text-green-700">{npsData.promoters}</p>
                        <p className="text-xs text-green-600 mt-1">Score 9 – 10</p>
                        <p className="text-sm text-green-600 font-medium mt-2">
                          {npsData.total > 0 ? ((npsData.promoters / npsData.total) * 100).toFixed(0) : 0}%
                        </p>
                      </div>
                      {/* Passives */}
                      <div className="bg-yellow-50 rounded-xl p-5 shadow-sm border border-yellow-200 text-center">
                        <p className="text-xs text-yellow-600 font-semibold uppercase tracking-wide mb-1">Passives</p>
                        <p className="text-3xl font-bold text-yellow-700">{npsData.passives}</p>
                        <p className="text-xs text-yellow-600 mt-1">Score 7 – 8</p>
                        <p className="text-sm text-yellow-600 font-medium mt-2">
                          {npsData.total > 0 ? ((npsData.passives / npsData.total) * 100).toFixed(0) : 0}%
                        </p>
                      </div>
                      {/* Detractors */}
                      <div className="bg-red-50 rounded-xl p-5 shadow-sm border border-red-200 text-center">
                        <p className="text-xs text-red-600 font-semibold uppercase tracking-wide mb-1">Detractors</p>
                        <p className="text-3xl font-bold text-red-700">{npsData.detractors}</p>
                        <p className="text-xs text-red-600 mt-1">Score 0 – 6</p>
                        <p className="text-sm text-red-600 font-medium mt-2">
                          {npsData.total > 0 ? ((npsData.detractors / npsData.total) * 100).toFixed(0) : 0}%
                        </p>
                      </div>
                    </div>

                    {/* Trend sparkline (div-based bar chart) */}
                    {npsData.trend.length > 0 && (
                      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                        <h2 className="font-semibold text-gray-800 mb-4">Rating Trend</h2>
                        <div className="flex items-end gap-1 h-24">
                          {npsData.trend.map((point, idx) => {
                            const maxAvg = Math.max(...npsData.trend.map((p) => p.avg), 10);
                            const heightPct = maxAvg > 0 ? (point.avg / maxAvg) * 100 : 0;
                            return (
                              <div key={idx} className="flex-1 flex flex-col items-center gap-1 group relative">
                                <div
                                  className={`w-full rounded-t transition-all ${
                                    point.avg >= 9 ? 'bg-green-400' :
                                    point.avg >= 7 ? 'bg-yellow-400' :
                                    'bg-red-400'
                                  }`}
                                  style={{ height: `${heightPct}%`, minHeight: '4px' }}
                                />
                                <span className="text-xs text-gray-400 whitespace-nowrap hidden group-hover:block absolute -top-5 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-1 py-0.5 rounded text-[10px]">
                                  {point.avg.toFixed(1)} ({point.count})
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex justify-between mt-1 text-xs text-gray-400">
                          <span>{npsData.trend[0]?.date ? new Date(npsData.trend[0].date).toLocaleDateString('en-KE', { month: 'short', day: 'numeric' }) : ''}</span>
                          <span>{npsData.trend[npsData.trend.length - 1]?.date ? new Date(npsData.trend[npsData.trend.length - 1].date).toLocaleDateString('en-KE', { month: 'short', day: 'numeric' }) : ''}</span>
                        </div>
                      </div>
                    )}

                    {/* Recent responses */}
                    {npsData.recent.length > 0 && (
                      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="px-5 py-4 border-b">
                          <h2 className="font-semibold text-gray-800">Recent Responses</h2>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {npsData.recent.map((r, idx) => (
                            <div key={idx} className="px-5 py-3 flex items-start gap-3">
                              <span className={`mt-0.5 px-2 py-0.5 rounded-full text-xs font-bold shrink-0 ${
                                r.score >= 9 ? 'bg-green-100 text-green-700' :
                                r.score >= 7 ? 'bg-yellow-100 text-yellow-700' :
                                'bg-red-100 text-red-700'
                              }`}>{r.score}/10</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-700">{r.comment || <span className="text-gray-400 italic">No comment</span>}</p>
                                <p className="text-xs text-gray-400 mt-0.5">
                                  {new Date(r.createdAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-center py-16 text-gray-400">
                    <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading NPS data…
                  </div>
                )}
              </div>
            )}

            {/* ── ROUTE ANALYTICS TAB ── */}
            {tab === 'route-analytics' && (
              <div className="space-y-6">
                {/* Summary cards */}
                {routeProfitability.length > 0 && (() => {
                  const totRev = routeProfitability.reduce((s, r) => s + r.deliveredOrdersCents, 0);
                  const totExp = routeProfitability.reduce((s, r) => s + r.expensesCents, 0);
                  const totNet = routeProfitability.reduce((s, r) => s + r.netProfitCents, 0);
                  return (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-4 border border-indigo-200 dark:border-indigo-700/40">
                        <div className="text-xs text-indigo-500 uppercase tracking-wide mb-1">Active Routes</div>
                        <div className="text-2xl font-bold text-indigo-700 dark:text-indigo-300">{routeProfitability.length}</div>
                      </div>
                      <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 border border-green-200 dark:border-green-700/40">
                        <div className="text-xs text-green-500 uppercase tracking-wide mb-1">Route Revenue</div>
                        <div className="text-2xl font-bold text-green-700 dark:text-green-300">KES {(totRev/100).toLocaleString()}</div>
                      </div>
                      <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 border border-red-200 dark:border-red-700/40">
                        <div className="text-xs text-red-500 uppercase tracking-wide mb-1">Route Expenses</div>
                        <div className="text-2xl font-bold text-red-700 dark:text-red-300">KES {(totExp/100).toLocaleString()}</div>
                      </div>
                      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 border border-blue-200 dark:border-blue-700/40">
                        <div className="text-xs text-blue-500 uppercase tracking-wide mb-1">Net Route Profit</div>
                        <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">KES {(totNet/100).toLocaleString()}</div>
                      </div>
                    </div>
                  );
                })()}

                {/* Per-route table */}
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-indigo-500" /> Route Breakdown
                    </h3>
                    <button
                      onClick={() => {
                        const csv = ['Route,Orders,Revenue (KES),Expenses (KES),Net Profit (KES),Margin %',
                          ...routeProfitability.map(r =>
                            `${r.routeName},${r.ordersCount},${(r.deliveredOrdersCents/100).toFixed(2)},${(r.expensesCents/100).toFixed(2)},${(r.netProfitCents/100).toFixed(2)},${r.deliveredOrdersCents > 0 ? ((r.netProfitCents/r.deliveredOrdersCents)*100).toFixed(1) : 0}%`)
                        ].join('\n');
                        const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
                        a.download = 'route-analytics.csv'; a.click();
                      }}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" /> CSV
                    </button>
                  </div>
                  {routeProfitability.length === 0 ? (
                    <div className="text-center py-12 text-gray-400 text-sm">No route data for the selected period</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 dark:bg-gray-700/50">
                          <tr>
                            {['Route','Days','Orders','Revenue','Expenses','Net Profit','Margin','Top Item'].map(h => (
                              <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                          {routeProfitability.map(r => {
                            const margin = r.deliveredOrdersCents > 0 ? ((r.netProfitCents / r.deliveredOrdersCents) * 100).toFixed(1) : '0.0';
                            const maxNet = Math.max(...routeProfitability.map(x => x.netProfitCents), 1);
                            return (
                              <tr key={r.routeId} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                                <td className="px-4 py-3">
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{r.routeName}</div>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex flex-wrap gap-1">
                                    {r.deliveryDays.map((d: string) => (
                                      <span key={d} className="text-[10px] bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded px-1.5 py-0.5">{d.slice(0,3)}</span>
                                    ))}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{r.ordersCount}</td>
                                <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">KES {(r.deliveredOrdersCents/100).toLocaleString()}</td>
                                <td className="px-4 py-3 text-sm text-red-500">KES {(r.expensesCents/100).toLocaleString()}</td>
                                <td className="px-4 py-3">
                                  <div className="text-sm font-semibold text-green-600 dark:text-green-400">KES {(r.netProfitCents/100).toLocaleString()}</div>
                                  <div className="mt-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden w-24">
                                    <div className="h-full bg-green-500 rounded-full" style={{ width: `${(r.netProfitCents / maxNet) * 100}%` }} />
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{margin}%</td>
                                <td className="px-4 py-3 text-xs text-gray-500">{r.topItems?.[0]?.itemName ?? '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Top items per route */}
                {routeProfitability.some(r => r.topItems?.length > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {routeProfitability.filter(r => r.topItems?.length > 0).map(r => (
                      <div key={r.routeId} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                        <div className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                          <MapPin className="w-3.5 h-3.5 text-indigo-500" /> {r.routeName}
                        </div>
                        <div className="space-y-2">
                          {r.topItems.slice(0, 5).map((item, i) => (
                            <div key={i} className="flex items-center justify-between text-xs">
                              <span className="text-gray-600 dark:text-gray-400 truncate flex-1">{item.itemName}</span>
                              <span className="text-gray-900 dark:text-white font-medium ml-2">×{item.totalQty}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Invoice Ageing ─────────────────────────────────────────────── */}
            {tab === 'invoice-ageing' && (
              <div className="space-y-6">
                {invoiceAgeing && (
                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                    {[
                      { label: 'Total Outstanding', value: invoiceAgeing.summary.totalOutstanding, color: 'bg-gray-700 text-white' },
                      { label: '0–30 Days', value: invoiceAgeing.summary['0-30d'], color: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' },
                      { label: '31–60 Days', value: invoiceAgeing.summary['31-60d'], color: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300' },
                      { label: '61–90 Days', value: invoiceAgeing.summary['61-90d'], color: 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300' },
                      { label: '90+ Days', value: invoiceAgeing.summary['90+d'], color: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className={`rounded-xl p-4 border border-gray-200 dark:border-gray-700 ${color}`}>
                        <div className="text-xs font-semibold uppercase tracking-wide mb-1 opacity-70">{label}</div>
                        <div className="text-xl font-bold">KES {((value ?? 0) / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Outstanding Field Invoices</h3>
                    <button
                      onClick={() => {
                        if (!invoiceAgeing) return;
                        const csv = ['Invoice #,Order #,Customer,Agent,Invoiced On,Days Out,Total (KES),Paid (KES),Outstanding (KES),Bucket',
                          ...invoiceAgeing.rows.map(r =>
                            `${r.invoiceNumber},${r.orderNumber},${r.customerName},${r.agentName},${r.invoicedAt ? new Date(r.invoicedAt).toLocaleDateString('en-KE') : ''},${r.daysOutstanding},${(r.totalCents/100).toFixed(2)},${(r.paidAmountCents/100).toFixed(2)},${(r.outstandingCents/100).toFixed(2)},${r.bucket}`)
                        ].join('\n');
                        const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
                        a.download = 'invoice-ageing.csv'; a.click();
                      }}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                    ><Download className="w-3.5 h-3.5" /> CSV</button>
                  </div>
                  {!invoiceAgeing || invoiceAgeing.rows.length === 0 ? (
                    <div className="text-center py-12 text-gray-400 text-sm">No outstanding invoices</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 dark:bg-gray-700/50">
                          <tr>{['Invoice #','Customer','Agent','Invoiced','Days Out','Total','Paid','Outstanding','Bucket'].map(h => (
                            <th key={h} className="text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                          ))}</tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                          {invoiceAgeing.rows.map(r => {
                            const bc = r.bucket === '0-30d' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                              r.bucket === '31-60d' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' :
                              r.bucket === '61-90d' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' :
                              'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
                            return (
                              <tr key={r.orderId} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                                <td className="px-3 py-2.5 text-xs font-mono font-semibold text-purple-600 dark:text-purple-400">{r.invoiceNumber}</td>
                                <td className="px-3 py-2.5"><div className="text-sm font-medium text-gray-900 dark:text-white">{r.customerName}</div><div className="text-xs text-gray-400">{r.customerPhone}</div></td>
                                <td className="px-3 py-2.5 text-sm text-gray-600 dark:text-gray-400">{r.agentName}</td>
                                <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{r.invoicedAt ? new Date(r.invoicedAt).toLocaleDateString('en-KE') : '—'}</td>
                                <td className="px-3 py-2.5 text-sm font-semibold">{r.daysOutstanding}d</td>
                                <td className="px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">KES {(r.totalCents/100).toLocaleString('en-KE',{minimumFractionDigits:2})}</td>
                                <td className="px-3 py-2.5 text-sm text-green-600 whitespace-nowrap">KES {(r.paidAmountCents/100).toLocaleString('en-KE',{minimumFractionDigits:2})}</td>
                                <td className="px-3 py-2.5 text-sm font-bold text-red-600 dark:text-red-400 whitespace-nowrap">KES {(r.outstandingCents/100).toLocaleString('en-KE',{minimumFractionDigits:2})}</td>
                                <td className="px-3 py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${bc}`}>{r.bucket}</span></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

          </>
        )}
      </div>

      {/* Z-Report Modal */}
      {showZReportModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-bold text-gray-900">Run Z-Report</h2>
              <p className="text-sm text-gray-500 mt-1">Enter the physical cash counted in the drawer</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Closing Cash Balance (KES)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={closingBalance}
                  onChange={(e) => setClosingBalance(e.target.value)}
                  placeholder="0.00"
                  className="w-full border rounded-lg px-3 py-2.5 text-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
              </div>
              {zReportMutation.isSuccess && (
                <div className="p-3 bg-green-50 rounded-lg text-sm text-green-700">
                  Z-Report generated successfully. Day has been closed.
                </div>
              )}
              {zReportMutation.isError && (
                <p className="text-sm text-red-600">{(zReportMutation.error as Error).message}</p>
              )}
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => {
                  setShowZReportModal(false);
                  setClosingBalance('');
                }}
                className="flex-1 py-2.5 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => zReportMutation.mutate()}
                disabled={!closingBalance || zReportMutation.isPending}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-50"
              >
                {zReportMutation.isPending ? 'Running…' : 'Run Z-Report'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
