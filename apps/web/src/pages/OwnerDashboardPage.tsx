import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import {
  TrendingUp, TrendingDown, ShoppingCart, Store, DollarSign,
  Package, ArrowRight, BarChart2, Users, AlertTriangle,
  CheckCircle2, Activity, Zap, Calendar,
  FileText, CreditCard, Truck, RefreshCw, Medal,
} from 'lucide-react';
import { formatKES } from '@pos/shared';
import { ActionCard } from '../components/ui';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StoreStats {
  storeId: string;
  storeName: string;
  storeCode: string;
  totalRevenueCents: number;
  totalVatCents: number;
  transactionCount: number;
  topItems: Array<{ itemId: string; name: string; qtySold: number; revenueCents: number }>;
  totalStockLines: number;
}

interface CrossStoreSummary {
  stores: StoreStats[];
  summary: {
    totalRevenueCents: number;
    totalTransactions: number;
    storeCount: number;
  };
}

interface PLData {
  revenueCents: number;
  expensesCents: number;
  netProfitCents: number;
  grossProfitCents: number;
}

// ─── Date Presets ─────────────────────────────────────────────────────────────

const PRESETS = [
  { label: 'Today',        days: 0  },
  { label: '7 Days',       days: 7  },
  { label: '30 Days',      days: 30 },
  { label: 'This Month',   days: -1 },
];

function getRange(days: number) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  if (days === -1) {
    const start = new Date(end.getFullYear(), end.getMonth(), 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  if (days === 0) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  const start = new Date(end.getTime() - days * 86400000);
  start.setHours(0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Previous period range
function getPrevRange(days: number) {
  if (days === 0) days = 1;
  if (days === -1) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  const end = new Date(Date.now() - days * 86400000);
  end.setHours(23, 59, 59, 999);
  const start = new Date(end.getTime() - days * 86400000);
  start.setHours(0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

function pctChange(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

// ─── Sparkline SVG ────────────────────────────────────────────────────────────

function MiniBar({ values, color = '#3B7DFF' }: { values: number[]; color?: string }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const w = 100 / values.length;
  return (
    <svg viewBox={`0 0 100 32`} className="w-24 h-8" preserveAspectRatio="none">
      {values.map((v, i) => {
        const h = Math.max(2, (v / max) * 30);
        return (
          <rect
            key={i}
            x={i * w + 0.5}
            y={32 - h}
            width={w - 1}
            height={h}
            fill={color}
            opacity={0.7 + 0.3 * (i / values.length)}
            rx="1"
          />
        );
      })}
    </svg>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, trend, trendLabel, accent, bars, valueColor,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  trend?: number;
  trendLabel?: string;
  accent: string;
  bars?: number[];
  valueColor?: string;
}) {
  const up = trend !== undefined && trend >= 0;
  return (
    <div className="surface p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</span>
        <div className={`w-9 h-9 rounded-xl ${accent} flex items-center justify-center`}>
          <Icon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
        </div>
      </div>
      <div>
        <p className={`text-2xl font-black tracking-tight ${valueColor ?? 'text-gray-900 dark:text-white'}`}>{value}</p>
        {sub && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sub}</p>}
      </div>
      <div className="flex items-center justify-between">
        {trend !== undefined ? (
          <span className={`flex items-center gap-1 text-xs font-semibold ${up ? 'text-emerald-600' : 'text-red-500'}`}>
            {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {Math.abs(trend).toFixed(1)}% {trendLabel ?? 'vs prev period'}
          </span>
        ) : (
          <span />
        )}
        {bars && <MiniBar values={bars} color={up ? '#10b981' : '#ef4444'} />}
      </div>
    </div>
  );
}

// ─── Store Row ────────────────────────────────────────────────────────────────

function StoreRow({
  store, rank, totalRevenue,
}: {
  store: StoreStats;
  rank: number;
  totalRevenue: number;
}) {
  const share = totalRevenue > 0 ? (store.totalRevenueCents / totalRevenue) * 100 : 0;
  const avgTicket = store.transactionCount > 0
    ? store.totalRevenueCents / store.transactionCount
    : 0;
  const medalColors = ['text-yellow-500', 'text-gray-400', 'text-amber-700'];

  return (
    <tr className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50/60 dark:hover:bg-gray-700/30 transition-colors group">
      <td className="px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="w-6 flex justify-center text-sm font-bold text-gray-500">{rank < 3 ? <Medal className={`w-5 h-5 ${medalColors[rank]}`} aria-label={`Rank ${rank + 1}`} /> : `#${rank + 1}`}</span>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-black flex-shrink-0">
            {store.storeCode.slice(0, 3)}
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-white text-sm">{store.storeName}</p>
            <p className="text-xs text-gray-400 font-mono">{store.storeCode}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-4 text-right">
        <p className="font-bold text-gray-900 dark:text-white text-sm">{formatKES(store.totalRevenueCents)}</p>
        <div className="mt-1 h-1 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden w-24 ml-auto">
          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${share}%` }} />
        </div>
        <p className="text-xs text-gray-400 mt-0.5">{share.toFixed(1)}% of total</p>
      </td>
      <td className="px-4 py-4 text-right hidden sm:table-cell">
        <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm">{store.transactionCount.toLocaleString()}</p>
        <p className="text-xs text-gray-400">transactions</p>
      </td>
      <td className="px-4 py-4 text-right hidden md:table-cell">
        <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm">{formatKES(avgTicket)}</p>
        <p className="text-xs text-gray-400">avg ticket</p>
      </td>
      <td className="px-4 py-4 text-right hidden md:table-cell">
        <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm">{formatKES(store.totalVatCents)}</p>
        <p className="text-xs text-gray-400">VAT</p>
      </td>
      <td className="px-4 py-4">
        {store.topItems[0] && (
          <div className="text-xs text-gray-600 dark:text-gray-400 text-right">
            <p className="font-medium truncate max-w-[100px] ml-auto">{store.topItems[0].name}</p>
            <p className="text-gray-400">{formatKES(store.topItems[0].revenueCents)}</p>
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Quick Action Card ────────────────────────────────────────────────────────

function QuickAction({
  icon: Icon, label, desc, onClick,
}: {
  icon: React.ElementType;
  label: string;
  desc: string;
  onClick: () => void;
  /** Accepted so call sites need not change; every action now uses the brand icon tile. */
  color?: string;
}) {
  return (
    <ActionCard icon={<Icon className="w-5 h-5" />} title={label} description={desc} onClick={onClick} />
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OwnerDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const businessId = user?.businessId ?? '';
  const [preset, setPreset] = useState(1);

  const { start, end } = getRange(PRESETS[preset].days);
  const { start: prevStart, end: prevEnd } = getPrevRange(PRESETS[preset].days);

  const { data, isLoading, refetch } = useQuery<CrossStoreSummary>({
    queryKey: ['cross-store-dashboard', businessId, start, end],
    queryFn: () =>
      api.get(`/reports/cross-store-dashboard?businessId=${businessId}&startDate=${start}&endDate=${end}`),
    enabled: !!businessId,
  });

  const { data: prevData } = useQuery<CrossStoreSummary>({
    queryKey: ['cross-store-dashboard', businessId, prevStart, prevEnd],
    queryFn: () =>
      api.get(`/reports/cross-store-dashboard?businessId=${businessId}&startDate=${prevStart}&endDate=${prevEnd}`),
    enabled: !!businessId,
  });

  const { data: plData } = useQuery<PLData>({
    queryKey: ['pl', businessId, start, end],
    queryFn: () =>
      api.get(`/reports/profit-loss?businessId=${businessId}&startDate=${start}&endDate=${end}`),
    enabled: !!businessId,
  });

  const { data: stockData } = useQuery<{ totalValueCents: number; items: Array<{ itemId: string; name: string; quantity: number; costPriceCents: number; valueCents: number }> }>({
    queryKey: ['owner-stock', businessId],
    queryFn: () => api.get(`/reports/stock-valuation?businessId=${businessId}`),
    enabled: !!businessId,
  });

  const stores = data?.stores ?? [];
  const summary = data?.summary;
  const ranked = useMemo(() => [...stores].sort((a, b) => b.totalRevenueCents - a.totalRevenueCents), [stores]);

  const totalRev = summary?.totalRevenueCents ?? 0;
  const totalTx = summary?.totalTransactions ?? 0;
  const prevRev = prevData?.summary?.totalRevenueCents ?? 0;
  const prevTx = prevData?.summary?.totalTransactions ?? 0;
  const avgTicket = totalTx > 0 ? totalRev / totalTx : 0;
  const prevAvg = (prevData?.summary?.totalTransactions ?? 0) > 0
    ? (prevData?.summary?.totalRevenueCents ?? 0) / (prevData?.summary?.totalTransactions ?? 1)
    : 0;
  const totalVat = stores.reduce((s, st) => s + st.totalVatCents, 0);

  // Top items across all stores (aggregated)
  const allTopItems = useMemo(() => {
    const map = new Map<string, { name: string; revenueCents: number; qtySold: number }>();
    stores.forEach((st) => {
      st.topItems.forEach((item) => {
        const existing = map.get(item.itemId);
        if (existing) {
          existing.revenueCents += item.revenueCents;
          existing.qtySold += item.qtySold;
        } else {
          map.set(item.itemId, { name: item.name, revenueCents: item.revenueCents, qtySold: item.qtySold });
        }
      });
    });
    return Array.from(map.values()).sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 5);
  }, [stores]);

  const bestStore = ranked[0];
  const netProfit = plData?.netProfitCents;
  const profitMargin = totalRev > 0 && netProfit !== undefined ? (netProfit / totalRev) * 100 : null;

  // Simulate bar data from per-store revenues for sparkline
  const revBars = ranked.map((s) => s.totalRevenueCents);

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-950">

      {/* ── Hero Header ── */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 px-6 py-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-400 text-xs font-semibold uppercase tracking-widest">Live Dashboard</span>
              </div>
              <h1 className="text-3xl font-black text-white tracking-tight">
                Business Intelligence
              </h1>
              <p className="text-blue-300 text-sm mt-1 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                {dateStr} · {summary?.storeCount ?? 0} active store{(summary?.storeCount ?? 0) !== 1 ? 's' : ''}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex bg-white/10 backdrop-blur border border-white/10 rounded-xl p-1 gap-0.5">
                {PRESETS.map((p, i) => (
                  <button
                    key={p.label}
                    onClick={() => setPreset(i)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      preset === i
                        ? 'bg-blue-500 text-white shadow-sm'
                        : 'text-blue-200 hover:bg-white/10'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => void refetch()}
                className="p-2 text-blue-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Hero KPIs strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            {[
              {
                label: 'Total Revenue',
                value: formatKES(totalRev),
                trend: pctChange(totalRev, prevRev),
                icon: DollarSign,
                color: 'text-emerald-300',
              },
              {
                label: 'Transactions',
                value: totalTx.toLocaleString(),
                trend: pctChange(totalTx, prevTx),
                icon: ShoppingCart,
                color: 'text-blue-300',
              },
              {
                label: 'Avg Ticket',
                value: formatKES(avgTicket),
                trend: pctChange(avgTicket, prevAvg),
                icon: Activity,
                color: 'text-purple-300',
              },
              {
                label: 'VAT Collected',
                value: formatKES(totalVat),
                trend: undefined as number | undefined,
                icon: FileText,
                color: 'text-amber-300',
              },
            ].map(({ label, value, trend, icon: Icon, color }) => (
              <div key={label} className="bg-white/5 backdrop-blur border border-white/10 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-blue-300/70 font-medium">{label}</span>
                  <Icon className={`w-3.5 h-3.5 ${color}`} />
                </div>
                <p className={`text-xl font-black ${color} tabular-nums`}>{value}</p>
                {trend !== undefined && (
                  <span className={`text-xs flex items-center gap-0.5 mt-0.5 ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {Math.abs(trend).toFixed(1)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1,2,3,4,5,6].map((i) => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-3" />
                <div className="h-7 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* ── Profit / Health Row ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                label="Net Profit"
                value={netProfit !== undefined ? formatKES(netProfit) : '—'}
                sub={profitMargin !== null ? `${profitMargin.toFixed(1)}% margin` : undefined}
                icon={netProfit !== undefined && netProfit < 0 ? TrendingDown : TrendingUp}
                accent={netProfit !== undefined && netProfit < 0 ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'}
                valueColor={netProfit !== undefined && netProfit < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}
                bars={revBars}
              />
              <KpiCard
                label="Total Expenses"
                value={plData?.expensesCents !== undefined ? formatKES(plData.expensesCents) : '—'}
                sub="Operating costs"
                icon={CreditCard}
                accent="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                valueColor="text-red-600 dark:text-red-400"
              />
              <KpiCard
                label="Best Store"
                value={bestStore?.storeName ?? '—'}
                sub={bestStore ? formatKES(bestStore.totalRevenueCents) : undefined}
                icon={Store}
                accent="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                trend={bestStore && summary?.storeCount && summary.storeCount > 0
                  ? (bestStore.totalRevenueCents / (summary.totalRevenueCents || 1)) * 100
                  : undefined}
                trendLabel="of total revenue"
              />
              <KpiCard
                label="Stock Coverage"
                value={`${stores.reduce((s, st) => s + st.totalStockLines, 0)} lines`}
                sub={`across ${summary?.storeCount ?? 0} stores`}
                icon={Package}
                accent="bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
              />
            </div>

            {/* ── Store Performance Table + Top Items ── */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

              {/* Store table — takes 2/3 */}
              <div className="xl:col-span-2 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-50 dark:border-gray-700 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-blue-600" />
                    <h2 className="font-bold text-gray-900 dark:text-white text-sm">Store Performance</h2>
                    <span className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full font-semibold">
                      {ranked.length} stores
                    </span>
                  </div>
                  <button
                    onClick={() => navigate('/reports')}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                  >
                    Full Reports <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                {ranked.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                    <Store className="w-10 h-10 mb-3 opacity-30" />
                    <p className="text-sm">No data for this period</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-gray-50/60 dark:bg-gray-700/30">
                          <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Store</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Revenue</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">Txns</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">Avg Ticket</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">VAT</th>
                          <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">Top Item</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ranked.map((store, idx) => (
                          <StoreRow
                            key={store.storeId}
                            store={store}
                            rank={idx}
                            totalRevenue={totalRev}
                          />
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-gray-50/80 dark:bg-gray-700/30 border-t-2 border-gray-100 dark:border-gray-600">
                          <td className="px-5 py-3 text-sm font-bold text-gray-800 dark:text-white">Total</td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-gray-900 dark:text-white">{formatKES(totalRev)}</td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-gray-900 dark:text-white hidden sm:table-cell">{totalTx.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-gray-900 dark:text-white hidden md:table-cell">{formatKES(avgTicket)}</td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-gray-900 dark:text-white hidden md:table-cell">{formatKES(totalVat)}</td>
                          <td className="px-4 py-3" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {/* Top Products — takes 1/3 */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-50 dark:border-gray-700 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <h2 className="font-bold text-gray-900 dark:text-white text-sm">Top Products</h2>
                  <span className="text-xs text-gray-400 ml-auto">All stores</span>
                </div>
                {allTopItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                    <Package className="w-8 h-8 mb-2 opacity-30" />
                    <p className="text-xs">No data</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
                    {allTopItems.map((item, idx) => {
                      const share = totalRev > 0 ? (item.revenueCents / totalRev) * 100 : 0;
                      const colors = ['bg-amber-500', 'bg-blue-500', 'bg-purple-500', 'bg-emerald-500', 'bg-rose-500'];
                      return (
                        <div key={idx} className="px-5 py-3.5">
                          <div className="flex items-center gap-3 mb-1.5">
                            <span className={`w-5 h-5 rounded-md ${colors[idx]} flex items-center justify-center text-white text-[10px] font-black flex-shrink-0`}>
                              {idx + 1}
                            </span>
                            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate flex-1">{item.name}</span>
                            <span className="text-sm font-bold text-gray-900 dark:text-white flex-shrink-0">
                              {formatKES(item.revenueCents)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 ml-8">
                            <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                              <div className={`h-full ${colors[idx]} rounded-full`} style={{ width: `${share}%` }} />
                            </div>
                            <span className="text-xs text-gray-400 w-10 text-right">{item.qtySold} sold</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ── Revenue Distribution bar chart ── */}
            {ranked.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-blue-600" />
                    <h2 className="font-bold text-gray-900 dark:text-white text-sm">Revenue Distribution</h2>
                  </div>
                  <span className="text-xs text-gray-400">{PRESETS[preset].label}</span>
                </div>
                <div className="space-y-3">
                  {ranked.map((store, idx) => {
                    const share = totalRev > 0 ? (store.totalRevenueCents / totalRev) * 100 : 0;
                    const barColors = [
                      'bg-blue-500', 'bg-indigo-500', 'bg-purple-500',
                      'bg-violet-500', 'bg-sky-500',
                    ];
                    return (
                      <div key={store.storeId} className="flex items-center gap-4">
                        <span className="w-28 text-sm font-medium text-gray-700 dark:text-gray-300 truncate flex-shrink-0 text-right">
                          {store.storeName}
                        </span>
                        <div className="flex-1 h-7 bg-gray-50 dark:bg-gray-700 rounded-lg overflow-hidden relative">
                          <div
                            className={`h-full ${barColors[idx % barColors.length]} rounded-lg flex items-center px-3 transition-all duration-700`}
                            style={{ width: `${Math.max(share, 2)}%` }}
                          >
                            {share > 10 && (
                              <span className="text-white text-xs font-bold">
                                {formatKES(store.totalRevenueCents)}
                              </span>
                            )}
                          </div>
                          {share <= 10 && (
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-600 dark:text-gray-400">
                              {formatKES(store.totalRevenueCents)}
                            </span>
                          )}
                        </div>
                        <span className="w-12 text-xs font-semibold text-gray-500 dark:text-gray-400 flex-shrink-0">
                          {share.toFixed(1)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Inventory Overview ── */}
            {stockData && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-50 dark:border-gray-700 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-purple-600" />
                    <h2 className="font-bold text-gray-900 dark:text-white text-sm">Inventory Overview</h2>
                    <span className="text-xs bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded-full font-semibold">
                      All Branches
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Total Stock Value</p>
                      <p className="font-black text-gray-900 dark:text-white text-sm">{formatKES(stockData.totalValueCents)}</p>
                    </div>
                    <button
                      onClick={() => navigate('/reports')}
                      className="text-xs text-purple-600 hover:text-purple-700 font-medium flex items-center gap-1"
                    >
                      Full Report <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
                  {[...stockData.items].sort((a, b) => b.valueCents - a.valueCents).slice(0, 5).map((item, idx) => {
                    const share = stockData.totalValueCents > 0 ? (item.valueCents / stockData.totalValueCents) * 100 : 0;
                    const colors = ['bg-purple-500', 'bg-blue-500', 'bg-indigo-500', 'bg-violet-500', 'bg-sky-500'];
                    return (
                      <div key={item.itemId} className="px-5 py-3 flex items-center gap-4">
                        <span className={`w-6 h-6 rounded-md ${colors[idx]} flex items-center justify-center text-white text-[10px] font-black flex-shrink-0`}>
                          {idx + 1}
                        </span>
                        <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{item.name}</span>
                        <span className="text-xs text-gray-400">{item.quantity.toLocaleString()} units</span>
                        <div className="w-24 hidden sm:block">
                          <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div className={`h-full ${colors[idx]} rounded-full`} style={{ width: `${share}%` }} />
                          </div>
                        </div>
                        <span className="text-sm font-bold text-gray-900 dark:text-white w-28 text-right">{formatKES(item.valueCents)}</span>
                      </div>
                    );
                  })}
                  {stockData.items.length === 0 && (
                    <div className="px-5 py-8 text-center text-gray-400 text-sm">No stock data available</div>
                  )}
                </div>
              </div>
            )}

            {/* ── Quick Actions ── */}
            <div>
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4 text-blue-500" />
                Quick Actions
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <QuickAction
                  icon={BarChart2}
                  label="Full Reports"
                  desc="Revenue, VAT, P&L, KRA"
                  onClick={() => navigate('/reports')}
                  color="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                />
                <QuickAction
                  icon={Users}
                  label="HR & Payroll"
                  desc="Staff, shifts, performance"
                  onClick={() => navigate('/hr')}
                  color="bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
                />
                <QuickAction
                  icon={Truck}
                  label="Suppliers & POs"
                  desc="Purchase orders, GRN"
                  onClick={() => navigate('/suppliers')}
                  color="bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
                />
                <QuickAction
                  icon={AlertTriangle}
                  label="Expiry Alerts"
                  desc="Batches near expiry"
                  onClick={() => navigate('/batch')}
                  color="bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400"
                />
                <QuickAction
                  icon={Package}
                  label="Inventory"
                  desc="Items, stock levels"
                  onClick={() => navigate('/inventory')}
                  color="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
                />
                <QuickAction
                  icon={DollarSign}
                  label="Expenses"
                  desc="Track & approve costs"
                  onClick={() => navigate('/expenses')}
                  color="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                />
                <QuickAction
                  icon={CheckCircle2}
                  label="Sales History"
                  desc="Transactions, voids"
                  onClick={() => navigate('/sales-list')}
                  color="bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400"
                />
                <QuickAction
                  icon={Store}
                  label="Settings"
                  desc="Stores, users, KRA"
                  onClick={() => navigate('/settings')}
                  color="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
