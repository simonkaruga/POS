import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  MapPin, Clock, User, Package, Truck, Plus, Search,
  AlertTriangle, BarChart2, Loader2, Link, CheckCircle2,
  RefreshCw, X, Zap, MessageCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import LiveMap, { type MapPoint } from '../components/LiveMap';
import { openWhatsApp, normalisePhone } from '../lib/whatsapp';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DeliveryOrder {
  id: string; orderNumber: string; customerName: string; customerPhone: string;
  deliveryAddress: string; status: string; scheduledAt: string;
  estimatedDeliveryAt: string; deliveryFeeCents: number;
  driverId?: string; driver?: { name: string; phone: string };
  lat?: number; lng?: number; failedAttempts?: number;
  courierProvider?: string; courierOrderId?: string;
}
interface DeliveryZone {
  id: string; name: string; basePriceCents: number;
  pricePerKm: number; estimatedMinutes: number; isActive: boolean;
}
interface Driver { id: string; name: string; phone: string; isActive: boolean; }
interface SLAReport {
  totalDeliveries: number; onTimeDeliveries: number;
  onTimeRate: number; avgDeliveryTimeMinutes: number;
}
interface CourierIntegration {
  id: string; provider: string; apiKey: string; webhookUrl?: string; isActive: boolean;
}
interface DriverLocation {
  driverId: string;
  name: string;
  phone?: string | null;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number | null;
  accuracy?: number | null;
  timestamp: string;
  activeDeliveries: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  ASSIGNED: 'bg-blue-100 text-blue-800',
  ARRIVING: 'bg-orange-100 text-orange-800',
  DELIVERED: 'bg-green-100 text-green-800',
  RESCHEDULED: 'bg-purple-100 text-purple-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-800',
  COURIER_ASSIGNED: 'bg-indigo-100 text-indigo-800',
};

const fmt = (cents: number) => `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

/** The public tracking page for an order, on whatever origin this app is served from. */
const trackingUrlFor = (orderNumber: string) =>
  `${window.location.origin}/track/${orderNumber}`;

function trackingMessage(d: { orderNumber: string; customerName?: string }) {
  const hello = d.customerName ? `Hi ${d.customerName.split(' ')[0]}, ` : '';
  return `${hello}your order *${d.orderNumber}* is on its way.\n\nFollow it live here:\n${trackingUrlFor(d.orderNumber)}`;
}
const fmtTime = (d: string) => new Date(d).toLocaleString('en-KE', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });

// ─── Live GPS Map (simple canvas-based) ──────────────────────────────────────

/** The driver app only reports while it is open, so positions go stale the moment a
 *  driver locks their phone. The last known fix is still the useful answer — it is kept
 *  and labelled with its age rather than hidden, since a stale pin mistaken for a live
 *  one is the only genuinely bad outcome. */
const LIVE_WITHIN_MS  = 2 * 60 * 1000;
const STALE_AFTER_MS  = 10 * 60 * 1000;

function minutesAgo(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

/** "just now" / "6m ago" / "3h ago" / "13 Aug 14:05" — an owner should never have to
 *  work out whether a position is minutes or days old. */
function formatAge(iso: string): string {
  const mins = minutesAgo(iso);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleString('en-KE', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

type Freshness = 'live' | 'recent' | 'stale';
function freshnessOf(iso: string): Freshness {
  const age = Date.now() - new Date(iso).getTime();
  if (age <= LIVE_WITHIN_MS) return 'live';
  if (age <= STALE_AFTER_MS) return 'recent';
  return 'stale';
}

function LiveGPSMap({ deliveries, driverLocations }: { deliveries: DeliveryOrder[]; driverLocations: DriverLocation[] }) {
  const activeDeliveries = deliveries.filter(d => ['ASSIGNED', 'IN_TRANSIT', 'ARRIVING'].includes(d.status));

  const points: MapPoint[] = driverLocations.map(d => {
    const fresh = freshnessOf(d.timestamp);
    return {
      id: d.driverId,
      lat: d.lat,
      lng: d.lng,
      label: d.name,
      // Stale pins say "last seen" outright so nobody reads an old fix as live.
      sublabel: fresh === 'stale' ? `last seen ${formatAge(d.timestamp)}` : formatAge(d.timestamp),
      color: fresh === 'stale' ? '#6b7280' : d.activeDeliveries > 0 ? '#1F6BFF' : '#16a34a',
      muted: fresh === 'stale',
    };
  });
  const staleCount = driverLocations.filter(d => freshnessOf(d.timestamp) === 'stale').length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 text-sm">
          <span className="font-semibold text-gray-900 dark:text-white">
            {activeDeliveries.length} active {activeDeliveries.length === 1 ? 'delivery' : 'deliveries'}
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            {driverLocations.length} {driverLocations.length === 1 ? 'driver' : 'drivers'} reporting
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-600" /> on a delivery</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-600" /> free</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-500" /> last known</span>
        </div>
      </div>

      <LiveMap
        points={points}
        height={320}
        emptyMessage="No driver has reported a position yet. Drivers appear here once they sign in to the Faida Driver app."
      />

      {staleCount > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {staleCount} {staleCount === 1 ? 'driver has' : 'drivers have'} gone quiet — the app
          only reports while it is open, so this is their last known position, not where they are now.
        </p>
      )}

      {driverLocations.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {driverLocations.map(d => {
            const stale = freshnessOf(d.timestamp) === 'stale';
            return (
              <a
                key={d.driverId}
                href={`https://www.openstreetmap.org/?mlat=${d.lat}&mlon=${d.lng}#map=16/${d.lat}/${d.lng}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                title="Open this position in OpenStreetMap"
              >
                <MapPin className={`w-3.5 h-3.5 ${stale ? 'text-gray-400' : 'text-blue-600'}`} />
                <span className="font-medium text-gray-900 dark:text-white">{d.name}</span>
                <span className="text-gray-500 dark:text-gray-400">
                  {d.activeDeliveries > 0 ? `${d.activeDeliveries} stop${d.activeDeliveries === 1 ? '' : 's'}` : 'free'}
                  {' · '}
                  {stale ? `last seen ${formatAge(d.timestamp)}` : formatAge(d.timestamp)}
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type Tab = 'dispatch' | 'zones' | 'couriers' | 'sla';

export default function DeliveryManagementPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const businessId = user?.businessId ?? '';

  const [tab, setTab] = useState<Tab>('dispatch');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAssignDriver, setShowAssignDriver] = useState<string | null>(null);
  const [showReschedule, setShowReschedule] = useState<DeliveryOrder | null>(null);
  const [showCreateZone, setShowCreateZone] = useState(false);
  const [showCourierForm, setShowCourierForm] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [failReason, setFailReason] = useState('');
  const [showFail, setShowFail] = useState<string | null>(null);

  // Zone form
  const [zoneForm, setZoneForm] = useState({ name: '', basePriceCents: 0, pricePerKm: 0, estimatedMinutes: 30, maxDistanceKm: 10 });
  const [courierForm, setCourierForm] = useState({ provider: 'GLOVO', apiKey: '', webhookUrl: '' });

  // SLA date range
  const today = new Date().toISOString().split('T')[0];
  const monthStart = new Date(new Date().setDate(1)).toISOString().split('T')[0];
  const [slaStart, setSlaStart] = useState(monthStart);
  const [slaEnd, setSlaEnd] = useState(today);

  // ── Queries ──
  const { data: deliveries = [], isLoading } = useQuery<DeliveryOrder[]>({
    queryKey: ['delivery-orders', businessId, selectedStatus, searchQuery],
    queryFn: () => {
      const p = new URLSearchParams({ businessId });
      if (selectedStatus) p.append('status', selectedStatus);
      if (searchQuery) p.append('search', searchQuery);
      return api.get<{ data: DeliveryOrder[] }>(`/delivery/orders?${p}`).then(r => r.data ?? []);
    },
    enabled: !!businessId,
    refetchInterval: 15000,
  });

  const { data: zones = [] } = useQuery<DeliveryZone[]>({
    queryKey: ['delivery-zones', businessId],
    queryFn: () => api.get<DeliveryZone[]>(`/delivery/zones?businessId=${businessId}`),
    enabled: !!businessId && tab === 'zones',
  });

  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ['drivers', businessId],
    queryFn: () => api.get<Driver[]>(`/business/${businessId}/users`).then((u: any[]) => u.filter(u => u.role === 'DRIVER')).catch(() => []),
    enabled: !!businessId,
  });

  const { data: driverLocations = [] } = useQuery<DriverLocation[]>({
    queryKey: ['driver-locations', businessId],
    queryFn: () => api.get<DriverLocation[]>(`/delivery/driver-locations?businessId=${businessId}`),
    enabled: !!businessId && tab === 'dispatch',
    refetchInterval: 15000,
  });

  const { data: slaReport } = useQuery<SLAReport>({
    queryKey: ['sla-report', businessId, slaStart, slaEnd],
    queryFn: () => api.get<SLAReport>(`/delivery/sla-report?businessId=${businessId}&startDate=${slaStart}&endDate=${slaEnd}`),
    enabled: !!businessId && tab === 'sla',
  });

  const { data: couriers = [] } = useQuery<CourierIntegration[]>({
    queryKey: ['couriers', businessId],
    queryFn: () => api.get<CourierIntegration[]>(`/delivery/couriers?businessId=${businessId}`),
    enabled: !!businessId && tab === 'couriers',
  });

  // ── Mutations ──
  const assignDriverMut = useMutation({
    mutationFn: ({ deliveryId, driverId }: { deliveryId: string; driverId: string }) =>
      api.put(`/delivery/orders/${deliveryId}/assign-driver`, { driverId, businessId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delivery-orders'] }); setShowAssignDriver(null); },
  });

  const markDeliveredMut = useMutation({
    mutationFn: (id: string) => api.put(`/delivery/orders/${id}/delivered`, { businessId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery-orders'] }),
  });

  const markFailedMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.put(`/delivery/orders/${id}/failed`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delivery-orders'] }); setShowFail(null); setFailReason(''); },
  });

  const rescheduleMut = useMutation({
    mutationFn: ({ id, newDate, reason }: { id: string; newDate: string; reason: string }) =>
      api.put(`/delivery/orders/${id}/reschedule`, { newScheduledAt: newDate, reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delivery-orders'] }); setShowReschedule(null); },
  });

  const sendTrackingMut = useMutation({
    mutationFn: (id: string) => api.post<{ trackingUrl: string; sent: boolean }>(`/delivery/orders/${id}/tracking-link`, {}),
    onSuccess: (data) => {
      if (data?.trackingUrl) {
        navigator.clipboard.writeText(data.trackingUrl).catch(() => {});
        toast.success(`Tracking link ${data.sent ? 'sent via SMS & ' : ''}copied to clipboard`);
      }
    },
  });

  const pushCourierMut = useMutation({
    mutationFn: ({ id, provider }: { id: string; provider: string }) =>
      api.post(`/delivery/courier/push`, {
        deliveryOrderId: id, provider,
        pickupAddress: 'Store', deliveryAddress: '',
        customerPhone: '', businessId,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery-orders'] }),
  });

  const createZoneMut = useMutation({
    mutationFn: () => api.post('/delivery/zones', {
      businessId, ...zoneForm,
      basePriceCents: Math.round(zoneForm.basePriceCents * 100),
      pricePerKm: Math.round(zoneForm.pricePerKm * 100),
      coordinates: [{ lat: -1.28, lng: 36.82 }],
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delivery-zones'] }); setShowCreateZone(false); },
  });

  const saveCourierMut = useMutation({
    mutationFn: () => api.post('/delivery/couriers', { businessId, ...courierForm }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['couriers'] }); setShowCourierForm(false); },
  });

  // ── Stats ──
  const pending = deliveries.filter(d => d.status === 'PENDING').length;
  const inTransit = deliveries.filter(d => ['ASSIGNED', 'ARRIVING'].includes(d.status)).length;
  const deliveredToday = deliveries.filter(d =>
    d.status === 'DELIVERED' && new Date(d.scheduledAt).toDateString() === new Date().toDateString()
  ).length;
  const failed = deliveries.filter(d => d.status === 'FAILED').length;

  const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'dispatch', label: 'Dispatch', icon: Truck },
    { id: 'zones', label: 'Zones & Pricing', icon: MapPin },
    { id: 'couriers', label: 'Couriers', icon: Zap },
    { id: 'sla', label: 'SLA Analytics', icon: BarChart2 },
  ];

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
              <Truck className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">Delivery Management</h1>
              <p className="text-sm text-gray-500">{deliveries.length} orders</p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Pending', value: pending, color: 'yellow', icon: Clock },
            { label: 'In Transit', value: inTransit, color: 'blue', icon: Truck },
            { label: 'Delivered Today', value: deliveredToday, color: 'green', icon: CheckCircle2 },
            { label: 'Failed', value: failed, color: 'red', icon: AlertTriangle },
          ].map(s => (
            <div key={s.label} className={`bg-${s.color}-50 dark:bg-${s.color}-900/20 rounded-xl p-3 flex items-center justify-between`}>
              <div>
                <p className={`text-xs font-medium text-${s.color}-700 dark:text-${s.color}-300`}>{s.label}</p>
                <p className={`text-2xl font-bold text-${s.color}-900 dark:text-${s.color}-100`}>{s.value}</p>
              </div>
              <s.icon className={`w-7 h-7 text-${s.color}-400`} />
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">

        {/* ── DISPATCH TAB ── */}
        {tab === 'dispatch' && (
          <div className="space-y-4">
            <LiveGPSMap deliveries={deliveries} driverLocations={driverLocations} />

            {/* Filters */}
            <div className="flex gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  placeholder="Search orders…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
              </div>
              <select
                value={selectedStatus}
                onChange={e => setSelectedStatus(e.target.value)}
                className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" aria-label="Filter by status">
                <option value="">All Status</option>
                {Object.keys(STATUS_COLORS).map(s => <option key={s}>{s}</option>)}
              </select>
              <button onClick={() => qc.invalidateQueries({ queryKey: ['delivery-orders'] })}
                className="p-2 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Refresh">
                <RefreshCw className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              </button>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
            ) : deliveries.length === 0 ? (
              <div className="text-center py-12">
                <Package className="w-14 h-14 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No delivery orders found</p>
              </div>
            ) : (
              <div className="space-y-3">
                {deliveries.map(d => (
                  <div key={d.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-gray-900 dark:text-white">#{d.orderNumber}</h3>
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[d.status] ?? 'bg-gray-100 text-gray-700'}`}>{d.status}</span>
                          {(d.failedAttempts ?? 0) > 0 && (
                            <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full">{d.failedAttempts} failed attempt{d.failedAttempts !== 1 ? 's' : ''}</span>
                          )}
                          {d.courierProvider && (
                            <span className="px-2 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded-full">{d.courierProvider}</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{d.customerName} · {d.customerPhone}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-gray-900 dark:text-white">{fmt(d.deliveryFeeCents)}</p>
                        <p className="text-xs text-gray-500">{fmtTime(d.scheduledAt)}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-3">
                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{d.deliveryAddress}</span>
                    </div>

                    {d.driver && (
                      <div className="flex items-center gap-2 text-sm bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-1.5 mb-3">
                        <User className="w-3.5 h-3.5 text-blue-600" />
                        <span className="text-blue-800 dark:text-blue-300">{d.driver.name} — {d.driver.phone}</span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      {d.driver && ['ASSIGNED', 'ARRIVING', 'IN_TRANSIT'].includes(d.status) && (
                        <a href={`/track/${d.orderNumber}`} target="_blank" rel="noreferrer"
                          className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 inline-flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" /> Track
                        </a>
                      )}
                      {d.status === 'PENDING' && (
                        <button onClick={() => setShowAssignDriver(d.id)}
                          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                          Assign Driver
                        </button>
                      )}
                      {['ASSIGNED', 'ARRIVING'].includes(d.status) && (
                        <button onClick={() => markDeliveredMut.mutate(d.id)}
                          disabled={markDeliveredMut.isPending}
                          className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                          Mark Delivered
                        </button>
                      )}
                      {['PENDING', 'ASSIGNED', 'ARRIVING', 'FAILED'].includes(d.status) && (
                        <>
                          <button onClick={() => { setShowFail(d.id); setFailReason(''); }}
                            className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded-lg hover:bg-red-200">
                            Mark Failed
                          </button>
                          <button onClick={() => { setShowReschedule(d); setRescheduleDate(''); setRescheduleReason(''); }}
                            className="px-3 py-1.5 text-xs bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200">
                            Reschedule
                          </button>
                        </>
                      )}
                      {normalisePhone(d.customerPhone) && (
                        <button
                          onClick={() => {
                            if (!openWhatsApp(d.customerPhone, trackingMessage(d))) {
                              toast.error('Could not open WhatsApp — allow pop-ups, or check the customer’s number.');
                            }
                          }}
                          title="Send the tracking link on WhatsApp"
                          className="px-3 py-1.5 text-xs border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 inline-flex items-center gap-1">
                          <MessageCircle className="w-3 h-3" /> WhatsApp
                        </button>
                      )}
                      <button onClick={() => sendTrackingMut.mutate(d.id)}
                        disabled={sendTrackingMut.isPending}
                        title="Text the link to the customer and copy it"
                        className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center gap-1">
                        <Link className="w-3 h-3" /> SMS / Copy
                      </button>
                      {d.status !== 'DELIVERED' && !d.courierProvider && (
                        <button onClick={() => pushCourierMut.mutate({ id: d.id, provider: 'GLOVO' })}
                          className="px-3 py-1.5 text-xs border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 inline-flex items-center gap-1">
                          <Zap className="w-3 h-3" /> Push to Glovo
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ZONES TAB ── */}
        {tab === 'zones' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 dark:text-white">Delivery Zones & Pricing</h2>
              <button onClick={() => setShowCreateZone(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                <Plus className="w-4 h-4" /> Add Zone
              </button>
            </div>
            {zones.length === 0 ? (
              <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
                <MapPin className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No delivery zones configured</p>
                <p className="text-sm text-gray-400 mt-1">Add zones to auto-price deliveries by distance</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {zones.map(z => (
                  <div key={z.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-gray-900 dark:text-white">{z.name}</h3>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${z.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {z.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><p className="text-gray-500 text-xs">Base Price</p><p className="font-medium text-gray-900 dark:text-white">{fmt(z.basePriceCents)}</p></div>
                      <div><p className="text-gray-500 text-xs">Per km</p><p className="font-medium text-gray-900 dark:text-white">{fmt(z.pricePerKm)}</p></div>
                      <div><p className="text-gray-500 text-xs">Est. Time</p><p className="font-medium text-gray-900 dark:text-white">{z.estimatedMinutes} min</p></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── COURIERS TAB ── */}
        {tab === 'couriers' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 dark:text-white">Third-Party Courier Integrations</h2>
              <button onClick={() => setShowCourierForm(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                <Plus className="w-4 h-4" /> Add Courier
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(['GLOVO', 'SENDY', 'UBER', 'BOLT'] as const).map(provider => {
                const cfg = couriers.find(c => c.provider === provider);
                return (
                  <div key={provider} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Zap className="w-5 h-5 text-indigo-600" />
                        <h3 className="font-semibold text-gray-900 dark:text-white">{provider}</h3>
                      </div>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${cfg?.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {cfg?.isActive ? 'Connected' : 'Not configured'}
                      </span>
                    </div>
                    {cfg ? (
                      <p className="text-xs text-gray-500 font-mono truncate">API key: ••••{cfg.apiKey.slice(-4)}</p>
                    ) : (
                      <button onClick={() => { setCourierForm({ provider, apiKey: '', webhookUrl: '' }); setShowCourierForm(true); }}
                        className="mt-2 text-xs text-blue-600 hover:underline">Configure →</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── SLA TAB ── */}
        {tab === 'sla' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input type="date" value={slaStart} onChange={e => setSlaStart(e.target.value)}
                className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" aria-label="Date" />
              <span className="text-gray-500">to</span>
              <input type="date" value={slaEnd} onChange={e => setSlaEnd(e.target.value)}
                className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white" aria-label="End date" />
            </div>

            {slaReport ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: 'Total Deliveries', value: slaReport.totalDeliveries, color: 'blue' },
                    { label: 'On-Time', value: slaReport.onTimeDeliveries, color: 'green' },
                    { label: 'On-Time Rate', value: `${(slaReport.onTimeRate ?? 0).toFixed(1)}%`, color: 'purple' },
                    { label: 'Avg Delivery Time', value: `${Math.round(slaReport.avgDeliveryTimeMinutes ?? 0)} min`, color: 'orange' },
                  ].map(s => (
                    <div key={s.label} className={`bg-${s.color}-50 dark:bg-${s.color}-900/20 rounded-xl p-4`}>
                      <p className={`text-xs font-medium text-${s.color}-700 dark:text-${s.color}-300 mb-1`}>{s.label}</p>
                      <p className={`text-2xl font-bold text-${s.color}-900 dark:text-${s.color}-100`}>{s.value}</p>
                    </div>
                  ))}
                </div>

                {/* On-time gauge */}
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
                  <p className="font-semibold text-gray-900 dark:text-white mb-3">On-Time Rate</p>
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${(slaReport.onTimeRate ?? 0) >= 80 ? 'bg-green-500' : (slaReport.onTimeRate ?? 0) >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(100, slaReport.onTimeRate ?? 0)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>0%</span><span className="text-gray-900 dark:text-white font-medium">{(slaReport.onTimeRate ?? 0).toFixed(1)}%</span><span>100%</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
            )}
          </div>
        )}
      </div>

      {/* ── Modals ── */}

      {/* Assign Driver */}
      {showAssignDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <h2 className="font-bold text-gray-900 dark:text-white">Assign Driver</h2>
              <button onClick={() => setShowAssignDriver(null)} aria-label="Close"><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-4 space-y-2">
              {drivers.length === 0 ? <p className="text-gray-500 text-sm">No drivers found</p> : drivers.map(d => (
                <button key={d.id}
                  onClick={() => assignDriverMut.mutate({ deliveryId: showAssignDriver, driverId: d.id })}
                  disabled={assignDriverMut.isPending}
                  className="w-full p-3 text-left border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50">
                  <p className="font-medium text-gray-900 dark:text-white">{d.name}</p>
                  <p className="text-sm text-gray-500">{d.phone}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Mark Failed */}
      {showFail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="font-bold text-gray-900 dark:text-white mb-4">Mark Delivery Failed</h2>
            <textarea
              placeholder="Reason for failure…"
              value={failReason}
              onChange={e => setFailReason(e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-sm bg-transparent text-gray-900 dark:text-white h-24 resize-none"
            />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowFail(null)} className="flex-1 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
              <button
                onClick={() => markFailedMut.mutate({ id: showFail, reason: failReason })}
                disabled={!failReason || markFailedMut.isPending}
                className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50">
                {markFailedMut.isPending ? 'Saving…' : 'Mark Failed'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule */}
      {showReschedule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="font-bold text-gray-900 dark:text-white mb-4">Reschedule Delivery — #{showReschedule.orderNumber}</h2>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New Date & Time</label>
            <input type="datetime-local" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-sm bg-transparent text-gray-900 dark:text-white mb-3" />
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reason</label>
            <textarea value={rescheduleReason} onChange={e => setRescheduleReason(e.target.value)}
              placeholder="Reason for reschedule…"
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-sm bg-transparent text-gray-900 dark:text-white h-20 resize-none" />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowReschedule(null)} className="flex-1 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm">Cancel</button>
              <button
                onClick={() => rescheduleMut.mutate({ id: showReschedule.id, newDate: rescheduleDate, reason: rescheduleReason })}
                disabled={!rescheduleDate || rescheduleMut.isPending}
                className="flex-1 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 disabled:opacity-50">
                {rescheduleMut.isPending ? 'Saving…' : 'Reschedule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Zone */}
      {showCreateZone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="font-bold text-gray-900 dark:text-white mb-4">New Delivery Zone</h2>
            <div className="space-y-3">
              {[
                { label: 'Zone Name', key: 'name', type: 'text', placeholder: 'e.g. Westlands' },
                { label: 'Base Price (KES)', key: 'basePriceCents', type: 'number', placeholder: '150' },
                { label: 'Price per km (KES)', key: 'pricePerKm', type: 'number', placeholder: '50' },
                { label: 'Est. Time (min)', key: 'estimatedMinutes', type: 'number', placeholder: '30' },
                { label: 'Max Distance (km)', key: 'maxDistanceKm', type: 'number', placeholder: '10' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{f.label}</label>
                  <input type={f.type} placeholder={f.placeholder}
                    value={(zoneForm as any)[f.key]}
                    onChange={e => setZoneForm(z => ({ ...z, [f.key]: f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))}
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-transparent text-gray-900 dark:text-white" />
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowCreateZone(false)} className="flex-1 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm">Cancel</button>
              <button onClick={() => createZoneMut.mutate()} disabled={!zoneForm.name || createZoneMut.isPending}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                {createZoneMut.isPending ? 'Saving…' : 'Create Zone'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Courier Form */}
      {showCourierForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="font-bold text-gray-900 dark:text-white mb-4">Configure Courier</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Provider</label>
                <select value={courierForm.provider} onChange={e => setCourierForm(f => ({ ...f, provider: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                  {['GLOVO', 'SENDY', 'UBER', 'BOLT'].map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">API Key</label>
                <input type="password" value={courierForm.apiKey} onChange={e => setCourierForm(f => ({ ...f, apiKey: e.target.value }))}
                  placeholder="Your API key"
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-transparent text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Webhook URL (optional)</label>
                <input type="url" value={courierForm.webhookUrl} onChange={e => setCourierForm(f => ({ ...f, webhookUrl: e.target.value }))}
                  placeholder="https://…"
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-transparent text-gray-900 dark:text-white" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowCourierForm(false)} className="flex-1 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm">Cancel</button>
              <button onClick={() => saveCourierMut.mutate()} disabled={!courierForm.apiKey || saveCourierMut.isPending}
                className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50">
                {saveCourierMut.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
