import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { mobileApi, formatKES } from '../../lib/api';
import { useActiveStore } from '../../lib/useActiveStore';
import { useAuthStore } from '../../stores/auth';
import { canManage } from '../../lib/roles';
import { Colors } from '../../constants/theme';
import { DateRangePicker, type DateRange } from '../../components/DateRangePicker';

// ─── API shapes (match apps/api reports.service.ts) ───────────────────────────

interface SaleLine { name: string; quantity: number; totalCents: number }
interface SaleRow {
  createdAt: string;
  totalCents: number;
  discountCents: number;
  items?: SaleLine[];
}
interface SalesReportResp {
  sales: SaleRow[];
  summary: {
    totalSales: number;
    totalRevenueCents: number;
    totalVatCents: number;
    totalTotCents: number;
  };
}
interface PayMethod { method: string; totalCents: number; count: number }
interface LowStockItem { id: string; name: string; currentStock: number }
interface StockValuation {
  items: Array<{ itemId: string; name: string; quantity: number; valueCents: number }>;
  totalValueCents?: number;
}
interface DeadStock {
  items: Array<{ itemId: string; name: string; stock: number; stockValueCents: number; daysSinceLastSale?: number }>;
}
interface GrossMargin {
  categories: Array<{ name: string; revenueCents: number; costCents: number; grossProfitCents: number; marginPct: number }>;
}
interface ProfitLoss {
  revenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  expensesCents: number;
  netProfitCents: number;
  profitMargin: number;
}
interface EmployeeSales {
  rows: Array<{ employeeId: string; employeeName: string; role: string; salesCount: number; totalCents: number }>;
}
interface CreditBook {
  rows: Array<{ saleId: string; receiptNumber: string; customerName?: string; outstandingCents?: number; totalCents: number; daysOutstanding?: number }>;
  summary?: { totalOutstandingCents?: number };
}
interface VoidedReturn { id: string; receiptNumber: string; totalCents: number; status: string; createdAt: string }

// ─── Period handling ──────────────────────────────────────────────────────────

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'custom';
type Section = 'overview' | 'sales' | 'inventory' | 'money';

const PRESET_LABELS: Record<Preset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Last 7 days',
  month: 'This month',
  lastMonth: 'Last month',
  custom: 'Custom',
};

/**
 * Local-day boundaries (00:00:00.000 → 23:59:59.999 in the device timezone),
 * sent as full ISO timestamps. Bare dates would resolve to UTC midnight and the
 * end bound could land before the day's last sale.
 */
function rangeForPreset(preset: Preset, custom: DateRange): DateRange {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  switch (preset) {
    case 'yesterday':
      start.setDate(now.getDate() - 1);
      end.setDate(now.getDate() - 1);
      break;
    case 'week':
      start.setDate(now.getDate() - 6);
      break;
    case 'month':
      start.setDate(1);
      break;
    case 'lastMonth': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      first.setHours(0, 0, 0, 0);
      last.setHours(23, 59, 59, 999);
      return { start: first, end: last };
    }
    case 'custom':
      return custom;
    case 'today':
    default:
      break;
  }

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function fmtDay(d: Date) {
  return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

function rangeLabel(range: DateRange) {
  const sameDay =
    range.start.toDateString() === range.end.toDateString();
  return sameDay ? fmtDay(range.start) : `${fmtDay(range.start)} — ${fmtDay(range.end)}`;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const { businessId, storeId } = useActiveStore();
  const role = useAuthStore((s) => s.user?.role);
  const isManager = canManage(role);

  const [preset, setPreset] = useState<Preset>('today');
  const [section, setSection] = useState<Section>('overview');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [custom, setCustom] = useState<DateRange>(() => {
    const start = new Date();
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end };
  });

  const range = useMemo(() => rangeForPreset(preset, custom), [preset, custom]);
  const startDate = range.start.toISOString();
  const endDate = range.end.toISOString();
  const qs = `businessId=${businessId}&storeId=${storeId}&startDate=${startDate}&endDate=${endDate}`;
  const ready = !!businessId && !!storeId;

  // ── Core (always loaded) ────────────────────────────────────────────────────

  const { data: report, isLoading, refetch, isRefetching } = useQuery<SalesReportResp>({
    queryKey: ['report-sales', businessId, storeId, startDate, endDate],
    queryFn: () => mobileApi.get<SalesReportResp>(`/reports/sales?${qs}`),
    enabled: ready,
    staleTime: 30_000,
  });

  const { data: payMethods, refetch: refetchPay } = useQuery<PayMethod[]>({
    queryKey: ['report-pay', businessId, storeId, startDate, endDate],
    queryFn: () => mobileApi.get<PayMethod[]>(`/reports/payment-methods?${qs}`),
    enabled: ready,
    staleTime: 30_000,
  });

  // ── Inventory section ───────────────────────────────────────────────────────

  const { data: lowStock, refetch: refetchLow } = useQuery<LowStockItem[]>({
    queryKey: ['report-lowstock', businessId, storeId],
    queryFn: () => mobileApi.get<LowStockItem[]>(`/items/low-stock?businessId=${businessId}&storeId=${storeId}`),
    enabled: ready,
    staleTime: 60_000,
  });

  const { data: valuation } = useQuery<StockValuation>({
    queryKey: ['report-valuation', businessId, storeId],
    queryFn: () => mobileApi.get<StockValuation>(`/reports/stock-valuation?businessId=${businessId}&storeId=${storeId}`),
    enabled: ready && section === 'inventory' && isManager,
    staleTime: 60_000,
  });

  const { data: deadStock } = useQuery<DeadStock>({
    queryKey: ['report-deadstock', businessId, storeId],
    queryFn: () => mobileApi.get<DeadStock>(`/reports/dead-stock?businessId=${businessId}&storeId=${storeId}`),
    enabled: ready && section === 'inventory' && isManager,
    staleTime: 60_000,
  });

  // ── Sales section ───────────────────────────────────────────────────────────

  const { data: voidedReturns } = useQuery<VoidedReturn[]>({
    queryKey: ['report-voids', businessId, storeId, startDate, endDate],
    queryFn: () => mobileApi.get<VoidedReturn[]>(`/sales/voided-returns?${qs}`),
    enabled: ready && section === 'sales',
    staleTime: 30_000,
  });

  // ── Money / staff section (manager+) ────────────────────────────────────────

  const { data: margin } = useQuery<GrossMargin>({
    queryKey: ['report-margin', businessId, storeId, startDate, endDate],
    queryFn: () => mobileApi.get<GrossMargin>(`/reports/gross-margin?${qs}`),
    enabled: ready && section === 'money' && isManager,
    staleTime: 60_000,
  });

  const { data: pnl } = useQuery<ProfitLoss>({
    queryKey: ['report-pnl', businessId, storeId, startDate, endDate],
    queryFn: () => mobileApi.get<ProfitLoss>(`/reports/profit-loss?${qs}`),
    enabled: ready && section === 'money' && isManager,
    staleTime: 60_000,
  });

  const { data: staffSales } = useQuery<EmployeeSales>({
    queryKey: ['report-staff', businessId, storeId, startDate, endDate],
    queryFn: () => mobileApi.get<EmployeeSales>(`/reports/employee-sales?${qs}`),
    enabled: ready && section === 'money' && isManager,
    staleTime: 60_000,
  });

  const { data: credit } = useQuery<CreditBook>({
    queryKey: ['report-credit', businessId],
    queryFn: () => mobileApi.get<CreditBook>(`/reports/credit-book?businessId=${businessId}`),
    enabled: ready && section === 'money' && isManager,
    staleTime: 60_000,
  });

  // ── Derived ─────────────────────────────────────────────────────────────────

  const summary = report?.summary;
  const total = summary?.totalRevenueCents ?? 0;
  const txCount = summary?.totalSales ?? 0;
  const tax = (summary?.totalVatCents ?? 0) + (summary?.totalTotCents ?? 0);
  const avgTx = txCount > 0 ? Math.round(total / txCount) : 0;
  const discount = (report?.sales ?? []).reduce((s, x) => s + (x.discountCents ?? 0), 0);

  const itemAgg = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const s of report?.sales ?? []) {
      for (const it of s.items ?? []) {
        const e = map.get(it.name) ?? { name: it.name, qty: 0, revenue: 0 };
        e.qty += it.quantity;
        e.revenue += it.totalCents;
        map.set(it.name, e);
      }
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  }, [report]);

  const topItems = itemAgg.slice(0, 5);
  const topItemsLong = itemAgg.slice(0, 10);
  const slowItems = useMemo(() => [...itemAgg].reverse().slice(0, 5), [itemAgg]);

  /** Revenue per hour of day — shows the real peak trading window. */
  const hourly = useMemo(() => {
    const buckets = new Array(24).fill(0) as number[];
    for (const s of report?.sales ?? []) {
      buckets[new Date(s.createdAt).getHours()] += s.totalCents;
    }
    return buckets;
  }, [report]);

  /** Revenue per calendar day across the selected range (capped for legibility). */
  const daily = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of report?.sales ?? []) {
      const key = new Date(s.createdAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' });
      map.set(key, (map.get(key) ?? 0) + s.totalCents);
    }
    return [...map.entries()].map(([label, cents]) => ({ label, cents })).slice(-14);
  }, [report]);

  const payOf = (m: string) => payMethods?.find((p) => p.method === m);
  const cash = payOf('CASH');
  const mpesa = payOf('MPESA');
  const card = payOf('CARD');
  const otherCents = (payMethods ?? [])
    .filter((p) => !['CASH', 'MPESA', 'CARD'].includes(p.method))
    .reduce((s, p) => s + p.totalCents, 0);

  const valuationTotal =
    valuation?.totalValueCents ??
    (valuation?.items ?? []).reduce((s, i) => s + i.valueCents, 0);

  const refresh = () => {
    void refetch();
    void refetchPay();
    void refetchLow();
  };

  async function shareSummary() {
    const lines = [
      `Faida POS — ${rangeLabel(range)}`,
      '',
      `Revenue:      ${formatKES(total)}`,
      `Transactions: ${txCount}`,
      `Average sale: ${formatKES(avgTx)}`,
      `Tax:          ${formatKES(tax)}`,
      `Discounts:    ${formatKES(discount)}`,
      '',
      'Payments',
      `  Cash:   ${formatKES(cash?.totalCents ?? 0)} (${cash?.count ?? 0})`,
      `  M-Pesa: ${formatKES(mpesa?.totalCents ?? 0)} (${mpesa?.count ?? 0})`,
      `  Card:   ${formatKES(card?.totalCents ?? 0)} (${card?.count ?? 0})`,
      ...(topItems.length ? ['', 'Top sellers', ...topItems.map((t, i) => `  ${i + 1}. ${t.name} — ${t.qty} sold`)] : []),
    ];
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // user dismissed the share sheet
    }
  }

  const SECTIONS: Array<{ id: Section; label: string; icon: any; managerOnly?: boolean }> = [
    { id: 'overview', label: 'Overview', icon: 'stats-chart-outline' },
    { id: 'sales', label: 'Sales', icon: 'receipt-outline' },
    { id: 'inventory', label: 'Stock', icon: 'cube-outline' },
    { id: 'money', label: 'Money', icon: 'wallet-outline', managerOnly: true },
  ];
  const visibleSections = SECTIONS.filter((s) => !s.managerOnly || isManager);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Reports</Text>
        <TouchableOpacity onPress={shareSummary} hitSlop={10} style={styles.shareBtn} accessibilityRole="button" accessibilityLabel="Share">
          <Ionicons name="share-outline" size={20} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Period selector */}
      <View style={styles.periodBarWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodBar}>
          {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.chip, preset === p && styles.chipActive]}
              onPress={() => {
                if (p === 'custom') { setPickerOpen(true); return; }
                setPreset(p);
              }}
            >
              {p === 'custom' && (
                <Ionicons
                  name="calendar-outline"
                  size={13}
                  color={preset === p ? '#FFFFFF' : Colors.textSecondary}
                />
              )}
              <Text style={[styles.chipText, preset === p && styles.chipTextActive]}>
                {PRESET_LABELS[p]}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Section tabs */}
      <View style={styles.tabRow}>
        {visibleSections.map((sec) => (
          <TouchableOpacity
            key={sec.id}
            style={[styles.tab, section === sec.id && styles.tabActive]}
            onPress={() => setSection(sec.id)}
          >
            <Ionicons
              name={sec.icon}
              size={15}
              color={section === sec.id ? Colors.primary : Colors.textSecondary}
            />
            <Text style={[styles.tabText, section === sec.id && styles.tabTextActive]}>
              {sec.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading report...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refresh} colors={[Colors.primary]} />}
        >
          <TouchableOpacity onPress={() => setPickerOpen(true)} style={styles.dateLabelRow}>
            <Ionicons name="calendar-outline" size={13} color={Colors.textSecondary} />
            <Text style={styles.dateLabel}>{rangeLabel(range)}</Text>
          </TouchableOpacity>

          {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
          {section === 'overview' && (
            <>
              <View style={[styles.card, styles.revenueCard]}>
                <Text style={styles.revenueLabel}>Total Revenue</Text>
                <Text style={styles.revenueValue}>{formatKES(total)}</Text>
                <Text style={styles.revenueSub}>{txCount} transactions</Text>
              </View>

              <View style={styles.metricsGrid}>
                <Metric icon="receipt-outline" color={Colors.primary} value={String(txCount)} label="Sales" />
                <Metric icon="trending-up" color={Colors.success} value={formatKES(avgTx)} label="Avg. Txn" />
                <Metric icon="calculator-outline" color={Colors.warning} value={formatKES(tax)} label="Tax" />
                <Metric icon="pricetag-outline" color={Colors.indigo} value={formatKES(discount)} label="Discounts" />
              </View>

              <Text style={styles.sectionTitle}>Payment Breakdown</Text>
              <View style={styles.card}>
                <PaymentRow label="Cash" count={cash?.count ?? 0} amountCents={cash?.totalCents ?? 0} icon="cash-outline" color={Colors.success} />
                <View style={styles.divider} />
                <PaymentRow label="M-Pesa" count={mpesa?.count ?? 0} amountCents={mpesa?.totalCents ?? 0} icon="phone-portrait-outline" color={Colors.primary} />
                <View style={styles.divider} />
                <PaymentRow label="Card" count={card?.count ?? 0} amountCents={card?.totalCents ?? 0} icon="card-outline" color={Colors.indigo} />
                {otherCents > 0 && (
                  <>
                    <View style={styles.divider} />
                    <PaymentRow label="Other" count={0} amountCents={otherCents} icon="ellipsis-horizontal-circle-outline" color={Colors.textSecondary} />
                  </>
                )}
              </View>

              <Text style={styles.sectionTitle}>Busiest Hours</Text>
              <View style={styles.card}>
                <HourlyChart buckets={hourly} />
              </View>

              {topItems.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>Top Sellers</Text>
                  <View style={styles.card}>
                    {topItems.map((it, i) => (
                      <RankRow key={it.name} index={i} name={it.name} right={`${it.qty} sold`} amount={it.revenue} />
                    ))}
                  </View>
                </>
              )}

              <Text style={styles.sectionTitle}>Net Summary</Text>
              <View style={styles.card}>
                <SummaryRow label="Gross Revenue" value={formatKES(total)} />
                <SummaryRow label="Total Tax Collected" value={formatKES(tax)} />
                <SummaryRow label="Total Discounts" value={`-${formatKES(discount)}`} color={Colors.error} />
                <View style={[styles.divider, { marginVertical: 6 }]} />
                <SummaryRow label="Net (ex-Tax)" value={formatKES(total - tax - discount)} bold />
              </View>
            </>
          )}

          {/* ── SALES ────────────────────────────────────────────────────── */}
          {section === 'sales' && (
            <>
              <Text style={styles.sectionTitle}>Daily Trend</Text>
              <View style={styles.card}>
                {daily.length === 0 ? (
                  <Text style={styles.emptyText}>No sales in this period</Text>
                ) : (
                  <BarList rows={daily.map((d) => ({ label: d.label, value: d.cents }))} />
                )}
              </View>

              <Text style={styles.sectionTitle}>Top 10 Products</Text>
              <View style={styles.card}>
                {topItemsLong.length === 0 ? (
                  <Text style={styles.emptyText}>No product sales yet</Text>
                ) : (
                  topItemsLong.map((it, i) => (
                    <RankRow key={it.name} index={i} name={it.name} right={`${it.qty} sold`} amount={it.revenue} />
                  ))
                )}
              </View>

              {slowItems.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>Slowest Movers</Text>
                  <View style={styles.card}>
                    {slowItems.map((it, i) => (
                      <View key={it.name} style={[styles.payRow, i > 0 && styles.rowBorder]}>
                        <Text style={styles.payLabel} numberOfLines={1}>{it.name}</Text>
                        <Text style={styles.payAmount}>{it.qty} sold</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}

              <Text style={[styles.sectionTitle, { color: Colors.error }]}>
                Voids &amp; Returns ({voidedReturns?.length ?? 0})
              </Text>
              <View style={styles.card}>
                {!voidedReturns || voidedReturns.length === 0 ? (
                  <Text style={styles.emptyText}>None in this period — good sign</Text>
                ) : (
                  voidedReturns.slice(0, 8).map((v, i) => (
                    <View key={v.id} style={[styles.payRow, i > 0 && styles.rowBorder]}>
                      <View style={styles.payLeft}>
                        <Ionicons name="close-circle" size={16} color={Colors.error} />
                        <Text style={styles.payLabel} numberOfLines={1}>{v.receiptNumber}</Text>
                      </View>
                      <View style={styles.payRight}>
                        <Text style={styles.payCount}>{v.status}</Text>
                        <Text style={styles.payAmount}>{formatKES(v.totalCents)}</Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </>
          )}

          {/* ── INVENTORY ────────────────────────────────────────────────── */}
          {section === 'inventory' && (
            <>
              {isManager && (
                <View style={[styles.card, styles.revenueCard, { backgroundColor: Colors.indigo }]}>
                  <Text style={styles.revenueLabel}>Stock Value at Cost</Text>
                  <Text style={styles.revenueValue}>{formatKES(valuationTotal)}</Text>
                  <Text style={styles.revenueSub}>{valuation?.items?.length ?? 0} tracked items</Text>
                </View>
              )}

              <Text style={[styles.sectionTitle, { color: Colors.error }]}>
                Low Stock ({lowStock?.length ?? 0})
              </Text>
              <View style={styles.card}>
                {!lowStock || lowStock.length === 0 ? (
                  <Text style={styles.emptyText}>Everything is above its reorder level</Text>
                ) : (
                  lowStock.slice(0, 12).map((it, i) => (
                    <View key={it.id} style={[styles.payRow, i > 0 && styles.rowBorder]}>
                      <View style={styles.payLeft}>
                        <Ionicons name="alert-circle" size={16} color={Colors.error} />
                        <Text style={styles.payLabel} numberOfLines={1}>{it.name}</Text>
                      </View>
                      <Text style={[styles.payAmount, { color: it.currentStock <= 0 ? Colors.error : Colors.warning }]}>
                        {it.currentStock} left
                      </Text>
                    </View>
                  ))
                )}
              </View>

              {isManager && (
                <>
                  <Text style={styles.sectionTitle}>Dead Stock</Text>
                  <View style={styles.card}>
                    {!deadStock?.items?.length ? (
                      <Text style={styles.emptyText}>Nothing sitting idle</Text>
                    ) : (
                      deadStock.items.slice(0, 8).map((it, i) => (
                        <View key={it.itemId} style={[styles.payRow, i > 0 && styles.rowBorder]}>
                          <View style={styles.payLeft}>
                            <Ionicons name="hourglass-outline" size={16} color={Colors.warning} />
                            <Text style={styles.payLabel} numberOfLines={1}>{it.name}</Text>
                          </View>
                          <View style={styles.payRight}>
                            <Text style={styles.payCount}>{it.stock} in stock</Text>
                            <Text style={styles.payAmount}>{formatKES(it.stockValueCents)}</Text>
                          </View>
                        </View>
                      ))
                    )}
                  </View>

                  <Text style={styles.sectionTitle}>Highest Value on Hand</Text>
                  <View style={styles.card}>
                    {!valuation?.items?.length ? (
                      <Text style={styles.emptyText}>No stock valuation available</Text>
                    ) : (
                      [...valuation.items]
                        .sort((a, b) => b.valueCents - a.valueCents)
                        .slice(0, 8)
                        .map((it, i) => (
                          <RankRow key={it.itemId} index={i} name={it.name} right={`${it.quantity} units`} amount={it.valueCents} />
                        ))
                    )}
                  </View>
                </>
              )}
            </>
          )}

          {/* ── MONEY (manager+) ─────────────────────────────────────────── */}
          {section === 'money' && isManager && (
            <>
              <Text style={styles.sectionTitle}>Profit &amp; Loss</Text>
              <View style={styles.card}>
                {!pnl ? (
                  <Text style={styles.emptyText}>Loading…</Text>
                ) : (
                  <>
                    <SummaryRow label="Revenue" value={formatKES(pnl.revenueCents)} />
                    <SummaryRow label="Cost of Goods Sold" value={`-${formatKES(pnl.cogsCents)}`} color={Colors.error} />
                    <SummaryRow label="Gross Profit" value={formatKES(pnl.grossProfitCents)} />
                    <SummaryRow label="Operating Expenses" value={`-${formatKES(pnl.expensesCents)}`} color={Colors.error} />
                    <View style={[styles.divider, { marginVertical: 6 }]} />
                    <SummaryRow
                      label="Net Profit"
                      value={formatKES(pnl.netProfitCents)}
                      bold
                      color={pnl.netProfitCents >= 0 ? Colors.success : Colors.error}
                    />
                    <Text style={styles.footnote}>Margin {pnl.profitMargin.toFixed(1)}%</Text>
                  </>
                )}
              </View>

              <Text style={styles.sectionTitle}>Margin by Category</Text>
              <View style={styles.card}>
                {!margin?.categories?.length ? (
                  <Text style={styles.emptyText}>No category data for this period</Text>
                ) : (
                  margin.categories.slice(0, 8).map((c, i) => (
                    <View key={c.name} style={[styles.payRow, i > 0 && styles.rowBorder]}>
                      <Text style={styles.payLabel} numberOfLines={1}>{c.name}</Text>
                      <View style={styles.payRight}>
                        <Text style={styles.payCount}>{c.marginPct.toFixed(1)}% margin</Text>
                        <Text style={styles.payAmount}>{formatKES(c.grossProfitCents)}</Text>
                      </View>
                    </View>
                  ))
                )}
              </View>

              <Text style={styles.sectionTitle}>Sales by Staff</Text>
              <View style={styles.card}>
                {!staffSales?.rows?.length ? (
                  <Text style={styles.emptyText}>No staff sales in this period</Text>
                ) : (
                  staffSales.rows
                    .slice(0, 8)
                    .map((r, i) => (
                      <RankRow
                        key={r.employeeId}
                        index={i}
                        name={r.employeeName}
                        right={`${r.salesCount} sales`}
                        amount={r.totalCents}
                      />
                    ))
                )}
              </View>

              <Text style={styles.sectionTitle}>Credit Book</Text>
              <View style={styles.card}>
                {!credit?.rows?.length ? (
                  <Text style={styles.emptyText}>No outstanding credit</Text>
                ) : (
                  <>
                    {credit.rows.slice(0, 8).map((r, i) => (
                      <View key={r.saleId} style={[styles.payRow, i > 0 && styles.rowBorder]}>
                        <View style={styles.payLeft}>
                          <Ionicons name="person-outline" size={16} color={Colors.warning} />
                          <Text style={styles.payLabel} numberOfLines={1}>
                            {r.customerName ?? r.receiptNumber}
                          </Text>
                        </View>
                        <View style={styles.payRight}>
                          {r.daysOutstanding != null && (
                            <Text style={styles.payCount}>{r.daysOutstanding}d overdue</Text>
                          )}
                          <Text style={[styles.payAmount, { color: Colors.error }]}>
                            {formatKES(r.outstandingCents ?? r.totalCents)}
                          </Text>
                        </View>
                      </View>
                    ))}
                    {credit.rows.length > 8 && (
                      <Text style={styles.moreText}>+{credit.rows.length - 8} more</Text>
                    )}
                  </>
                )}
              </View>
            </>
          )}
        </ScrollView>
      )}

      <DateRangePicker
        visible={pickerOpen}
        initial={range}
        onCancel={() => setPickerOpen(false)}
        onApply={(r) => {
          const start = new Date(r.start);
          start.setHours(0, 0, 0, 0);
          const end = new Date(r.end);
          end.setHours(23, 59, 59, 999);
          setCustom({ start, end });
          setPreset('custom');
          setPickerOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

// ─── Small presentational pieces ─────────────────────────────────────────────

function Metric({ icon, color, value, label }: { icon: any; color: string; value: string; label: string }) {
  return (
    <View style={styles.metricCard}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function SummaryRow({
  label, value, bold, color,
}: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, bold && { fontWeight: '700', color: Colors.text }]}>{label}</Text>
      <Text style={[styles.summaryValue, bold && { fontWeight: '800' }, color ? { color } : bold ? { color: Colors.primary } : null]}>
        {value}
      </Text>
    </View>
  );
}

function RankRow({
  index, name, right, amount,
}: { index: number; name: string; right: string; amount: number }) {
  return (
    <View style={[styles.payRow, index > 0 && styles.rowBorder]}>
      <View style={styles.payLeft}>
        <View style={[styles.rankBadge, index === 0 && { backgroundColor: Colors.primary }]}>
          <Text style={[styles.rankText, index === 0 && { color: '#FFFFFF' }]}>{index + 1}</Text>
        </View>
        <Text style={styles.payLabel} numberOfLines={1}>{name}</Text>
      </View>
      <View style={styles.payRight}>
        <Text style={styles.payCount}>{right}</Text>
        <Text style={styles.payAmount}>{formatKES(amount)}</Text>
      </View>
    </View>
  );
}

/** Horizontal bars — avoids pulling in a charting library for a phone-sized view. */
function BarList({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <View style={{ gap: 8 }}>
      {rows.map((r) => (
        <View key={r.label} style={styles.barRow}>
          <Text style={styles.barLabel}>{r.label}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.max(2, (r.value / max) * 100)}%` }]} />
          </View>
          <Text style={styles.barValue}>{formatKES(r.value)}</Text>
        </View>
      ))}
    </View>
  );
}

/** 24 vertical columns; only labels every 6 hours so the axis stays readable. */
function HourlyChart({ buckets }: { buckets: number[] }) {
  const max = Math.max(...buckets, 1);
  const peak = buckets.indexOf(max);
  const hasData = buckets.some((b) => b > 0);
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.hourChart}>
        {buckets.map((v, h) => (
          <View key={h} style={styles.hourCol}>
            <View
              style={[
                styles.hourBar,
                { height: `${Math.max(2, (v / max) * 100)}%` },
                h === peak && v > 0 && { backgroundColor: Colors.primary },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.hourAxis}>
        {[0, 6, 12, 18, 23].map((h) => (
          <Text key={h} style={styles.hourAxisLabel}>{String(h).padStart(2, '0')}</Text>
        ))}
      </View>
      <Text style={styles.footnote}>
        {hasData
          ? `Peak hour: ${String(peak).padStart(2, '0')}:00 — ${formatKES(max)}`
          : 'No sales recorded in this period'}
      </Text>
    </View>
  );
}

function PaymentRow({
  label, count, amountCents, icon, color,
}: { label: string; count: number; amountCents: number; icon: any; color: string }) {
  return (
    <View style={styles.payRow}>
      <View style={styles.payLeft}>
        <View style={[styles.payIcon, { backgroundColor: color + '15' }]}>
          <Ionicons name={icon} size={16} color={color} />
        </View>
        <Text style={styles.payLabel}>{label}</Text>
      </View>
      <View style={styles.payRight}>
        {count > 0 && <Text style={styles.payCount}>{count} txns</Text>}
        <Text style={styles.payAmount}>{formatKES(amountCents)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    backgroundColor: Colors.card,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: Colors.text },
  shareBtn: { padding: 4 },
  periodBarWrap: { backgroundColor: Colors.card, borderBottomWidth: 1, borderBottomColor: Colors.border },
  periodBar: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: Colors.background,
  },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { fontSize: 12.5, color: Colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '700' },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: Colors.primary },
  tabText: { fontSize: 12.5, color: Colors.textSecondary, fontWeight: '500' },
  tabTextActive: { color: Colors.primary, fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  dateLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  dateLabel: { fontSize: 12, color: Colors.textSecondary },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  revenueCard: { backgroundColor: Colors.primary, alignItems: 'center', paddingVertical: 24, gap: 4 },
  revenueLabel: { fontSize: 14, color: '#FFFFFF99', fontWeight: '500' },
  revenueValue: { fontSize: 34, fontWeight: '900', color: '#FFFFFF' },
  revenueSub: { fontSize: 13, color: '#FFFFFF99' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  metricValue: { fontSize: 15, fontWeight: '800', color: Colors.text },
  metricLabel: { fontSize: 11, color: Colors.textSecondary },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, marginTop: 4 },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 2 },
  rowBorder: { borderTopWidth: 1, borderTopColor: Colors.border },
  payRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 },
  payLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, paddingRight: 8 },
  payIcon: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  payLabel: { fontSize: 14, color: Colors.text, fontWeight: '500', flexShrink: 1 },
  payRight: { alignItems: 'flex-end', gap: 2 },
  payCount: { fontSize: 11, color: Colors.textSecondary },
  payAmount: { fontSize: 14, fontWeight: '700', color: Colors.text },
  rankBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.border, justifyContent: 'center', alignItems: 'center' },
  rankText: { fontSize: 12, fontWeight: '800', color: Colors.textSecondary },
  moreText: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center', paddingTop: 8 },
  emptyText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', paddingVertical: 12 },
  footnote: { fontSize: 11, color: Colors.textSecondary, textAlign: 'center', paddingTop: 4 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  summaryLabel: { fontSize: 13, color: Colors.textSecondary },
  summaryValue: { fontSize: 13, fontWeight: '600', color: Colors.text },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { fontSize: 11, color: Colors.textSecondary, width: 52 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: Colors.background, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4, backgroundColor: Colors.primary },
  barValue: { fontSize: 11, color: Colors.text, fontWeight: '600', width: 86, textAlign: 'right' },
  hourChart: { flexDirection: 'row', alignItems: 'flex-end', height: 90, gap: 2 },
  hourCol: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  hourBar: { width: '100%', borderRadius: 2, backgroundColor: Colors.primaryLight, minHeight: 2 },
  hourAxis: { flexDirection: 'row', justifyContent: 'space-between' },
  hourAxisLabel: { fontSize: 10, color: Colors.textSecondary },
});
