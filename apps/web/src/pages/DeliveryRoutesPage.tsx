import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { selectDrivers, NO_DRIVERS_HINT } from '../lib/staff';
import { useAuthStore } from '../stores/auth';
import { useDialog } from '../components/Dialog';
import { toast } from 'sonner';
import {
  MapPin, Plus, Pencil, Trash2, X, Users, ChevronDown, ChevronRight,
  CheckSquare, Square, Truck, CalendarDays, DollarSign, Package,
  PenLine, CheckCircle,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Day = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
type RunStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED';

interface SalesRoute {
  id: string;
  businessId: string;
  branchId?: string;
  name: string;
  deliveryDays: Day[];
  driverUserId?: string;
  driverName?: string;
  color?: string;
  isActive: boolean;
  customerCount?: number;
  customers?: Array<{ id: string; name: string; shopCode?: string }>;
}

interface DeliveryRun {
  id: string;
  routeId: string;
  routeName?: string;
  businessId: string;
  date: string;
  driverUserId?: string;
  driverName?: string;
  status: RunStatus;
  orderCount?: number;
  totalCents?: number;
  orders?: DeliveryRunOrder[];
  expenses?: RouteExpense[];
  expenseTotalCents?: number;
}

interface DeliveryRunOrder {
  id: string;
  fieldOrderId: string;
  orderNumber?: string;
  customerName?: string;
  totalCents: number;
  status: string;
  deliveredAt?: string;
}

interface RouteExpense {
  id: string;
  category: string;
  amountCents: number;
  description?: string;
  recordedBy?: string;
}

interface User {
  id: string;
  name: string;
  role: string;
}

interface FieldOrder {
  id: string;
  orderNumber: string;
  customerName?: string;
  totalCents: number;
  routeId?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtKES(cents: number) {
  return (cents / 100).toLocaleString('en-KE', { style: 'currency', currency: 'KES' });
}
function fmtDate(s?: string) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
}

const DAYS: Day[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DAY_LABELS: Record<Day, string> = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };
const PRESET_COLORS = ['#3B7DFF', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

const RUN_STATUS_STYLE: Record<RunStatus, string> = {
  PLANNED:     'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  IN_PROGRESS: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  COMPLETED:   'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
};

const EXPENSE_CATEGORIES = ['FUEL', 'DRIVER_ALLOWANCE', 'FOOD', 'OTHER'];

// ── Proof of Delivery Modal ───────────────────────────────────────────────────

interface ProofOfDeliveryModalProps {
  deliveryRunOrderId: string;
  customerName: string;
  orderNumber: string;
  onClose: () => void;
  onSuccess: () => void;
}

function ProofOfDeliveryModal({
  deliveryRunOrderId,
  customerName,
  orderNumber,
  onClose,
  onSuccess,
}: ProofOfDeliveryModalProps) {
  const [receivedByName, setReceivedByName] = useState('');
  const [notes, setNotes] = useState('');
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locLoading, setLocLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  function getPos(e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      const t = (e as TouchEvent).touches[0];
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
    }
    return {
      x: ((e as MouseEvent).clientX - rect.left) * scaleX,
      y: ((e as MouseEvent).clientY - rect.top) * scaleY,
    };
  }

  function handleCanvasMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current; if (!canvas) return;
    drawingRef.current = true;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const pos = getPos(e.nativeEvent, canvas);
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
  }

  function handleCanvasMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const pos = getPos(e.nativeEvent, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1245B5'; ctx.lineWidth = 2.5;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  }

  function handleCanvasMouseUp() { drawingRef.current = false; }

  function handleCanvasTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current; if (!canvas) return;
    drawingRef.current = true;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const pos = getPos(e.nativeEvent, canvas);
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
  }

  function handleCanvasTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (!drawingRef.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const pos = getPos(e.nativeEvent, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1245B5'; ctx.lineWidth = 2.5;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  }

  function handleCanvasTouchEnd(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault(); drawingRef.current = false;
  }

  function clearCanvas() {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function captureLocation() {
    if (!navigator.geolocation) { toast.error('Geolocation not supported'); return; }
    setLocLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocLoading(false); toast.success('Location captured'); },
      (err) => { toast.error(`Location error: ${err.message}`); setLocLoading(false); },
      { timeout: 10000 }
    );
  }

  const qc = useQueryClient();

  const submitMutation = useMutation({
    mutationFn: async () => {
      const canvas = canvasRef.current;
      const signatureBase64 = canvas ? canvas.toDataURL('image/png') : undefined;
      return api.post(`/delivery-routes/run-orders/${deliveryRunOrderId}/proof`, {
        receivedByName,
        signatureBase64,
        latitude: location?.lat ?? null,
        longitude: location?.lng ?? null,
        notes: notes || null,
      });
    },
    onSuccess: () => {
      toast.success('Proof of delivery captured');
      qc.invalidateQueries({ queryKey: ['delivery-run-detail'] });
      onSuccess();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="font-bold text-gray-900 dark:text-white">Proof of Delivery</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{customerName} &bull; {orderNumber}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Received By *</label>
            <input
              value={receivedByName}
              onChange={(e) => setReceivedByName(e.target.value)}
              placeholder="Enter receiver's name"
              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Signature</label>
              <button onClick={clearCanvas} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Clear</button>
            </div>
            <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl overflow-hidden bg-gray-50 dark:bg-gray-700/50">
              <canvas
                ref={canvasRef}
                width={460}
                height={150}
                className="w-full h-[150px] cursor-crosshair touch-none"
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
                onTouchStart={handleCanvasTouchStart}
                onTouchMove={handleCanvasTouchMove}
                onTouchEnd={handleCanvasTouchEnd}
              />
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Ask receiver to sign above</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">GPS Location (optional)</label>
            {location ? (
              <div className="flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-3 py-2">
                <MapPin className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                <span className="text-xs text-green-700 dark:text-green-300 font-mono">
                  {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
                </span>
                <button onClick={() => setLocation(null)} className="ml-auto text-green-500 hover:text-red-500" aria-label="Close">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={captureLocation}
                disabled={locLoading}
                className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                <MapPin className="w-4 h-4" />
                {locLoading ? 'Getting location…' : 'Capture Location'}
              </button>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any delivery notes…"
              rows={2}
              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
            />
          </div>
        </div>

        <div className="p-5 flex gap-3 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
          <button
            onClick={() => submitMutation.mutate()}
            disabled={!receivedByName || submitMutation.isPending}
            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {submitMutation.isPending ? 'Submitting…' : 'Submit Proof'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Route Form Modal ─────────────────────────────────────────────────────────

function RouteModal({
  route,
  users,
  businessId,
  onClose,
}: {
  route?: SalesRoute;
  users: User[];
  businessId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(route?.name ?? '');
  const [deliveryDays, setDeliveryDays] = useState<Day[]>(route?.deliveryDays ?? []);
  const [driverUserId, setDriverUserId] = useState(route?.driverUserId ?? '');
  const driverOptions = selectDrivers(users);
  const [color, setColor] = useState(route?.color ?? PRESET_COLORS[0]);
  const [isActive, setIsActive] = useState(route?.isActive ?? true);

  const mutation = useMutation({
    mutationFn: (data: object) =>
      route
        ? api.patch(`/field-sales/routes/${route.id}?businessId=${businessId}`, data)
        : api.post(`/field-sales/routes?businessId=${businessId}`, data),
    onSuccess: () => {
      toast.success(route ? 'Route updated' : 'Route created');
      qc.invalidateQueries({ queryKey: ['sales-routes'] });
      onClose();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  function toggleDay(d: Day) {
    setDeliveryDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-white">{route ? 'Edit Route' : 'New Route'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Route Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nairobi East Route"
              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">Delivery Days</label>
            <div className="flex gap-1.5 flex-wrap">
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    deliveryDays.includes(d)
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-indigo-300'
                  }`}
                >
                  {DAY_LABELS[d]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Driver</label>
            <select
              value={driverUserId}
              onChange={(e) => setDriverUserId(e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none">
              <option value="">No driver assigned</option>
              {driverOptions.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            {driverOptions.usingFallback && (
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{NO_DRIVERS_HINT}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">Color</label>
            <div className="flex gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full border-2 transition-all ${color === c ? 'border-gray-900 dark:border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="accent-indigo-600 w-4 h-4" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Active</span>
          </label>
        </div>
        <div className="p-5 flex gap-3 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
          <button
            onClick={() => mutation.mutate({ name, deliveryDays, driverUserId: driverUserId || null, color, isActive, businessId })}
            disabled={!name || mutation.isPending}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'Saving…' : route ? 'Save Changes' : 'Create Route'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create Run Modal ──────────────────────────────────────────────────────────

function CreateRunModal({
  routes,
  users,
  businessId,
  onClose,
}: {
  routes: SalesRoute[];
  users: User[];
  businessId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [routeId, setRouteId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [driverUserId, setDriverUserId] = useState('');
  const driverOptions = selectDrivers(users);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);

  const { data: packedOrders = [] } = useQuery<FieldOrder[]>({
    queryKey: ['packed-orders', businessId, routeId],
    queryFn: () => api.get<FieldOrder[]>(`/field-sales/orders?businessId=${businessId}&status=PACKED${routeId ? `&routeId=${routeId}` : ''}`),
    enabled: !!businessId && !!routeId,
  });

  const mutation = useMutation({
    mutationFn: (data: object) => api.post(`/delivery-routes/runs?businessId=${businessId}`, data),
    onSuccess: () => {
      toast.success('Delivery run created');
      qc.invalidateQueries({ queryKey: ['delivery-runs'] });
      onClose();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  function toggleOrder(id: string) {
    setSelectedOrderIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-white">Create Delivery Run</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Route *</label>
            <select
              value={routeId}
              onChange={(e) => setRouteId(e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none">
              <option value="">Select route…</option>
              {routes.filter((r) => r.isActive).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Date *</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none" aria-label="Date" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Driver</label>
            <select
              value={driverUserId}
              onChange={(e) => setDriverUserId(e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none">
              <option value="">No driver assigned</option>
              {driverOptions.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            {driverOptions.usingFallback && (
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{NO_DRIVERS_HINT}</p>
            )}
          </div>
          {routeId && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">
                Packed Orders on Route ({packedOrders.length})
              </label>
              {packedOrders.length === 0
                ? <p className="text-xs text-gray-400 dark:text-gray-500">No packed orders for this route.</p>
                : <div className="space-y-2 max-h-48 overflow-y-auto">
                    {packedOrders.map((o) => (
                      <label key={o.id} className="flex items-center gap-3 p-2.5 border border-gray-200 dark:border-gray-700 rounded-xl cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <button type="button" onClick={() => toggleOrder(o.id)} className="flex-shrink-0">
                          {selectedOrderIds.includes(o.id)
                            ? <CheckSquare className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                            : <Square className="w-5 h-5 text-gray-300 dark:text-gray-600" />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white">{o.customerName ?? '—'}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">{o.orderNumber}</p>
                        </div>
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{fmtKES(o.totalCents)}</span>
                      </label>
                    ))}
                  </div>
              }
            </div>
          )}
        </div>
        <div className="p-5 flex gap-3 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
          <button
            onClick={() => mutation.mutate({ routeId, date, driverUserId: driverUserId || null, orderIds: selectedOrderIds, businessId })}
            disabled={!routeId || !date || mutation.isPending}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'Creating…' : 'Create Run'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Run Detail Modal ──────────────────────────────────────────────────────────

function RunDetailModal({ run, businessId, onClose }: { run: DeliveryRun; businessId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: detail, refetch: refetchDetail } = useQuery<DeliveryRun>({
    queryKey: ['delivery-run-detail', run.id],
    queryFn: () => api.get<DeliveryRun>(`/delivery-routes/runs/${run.id}?businessId=${businessId}`),
    enabled: !!run.id,
  });

  const [expCategory, setExpCategory] = useState('FUEL');
  const [expAmount, setExpAmount] = useState('');
  const [expDesc, setExpDesc] = useState('');

  // Proof of Delivery state
  const [podOrder, setPodOrder] = useState<DeliveryRunOrder | null>(null);
  // Track locally delivered orders (for optimistic UI after proof submission)
  const [locallyDelivered, setLocallyDelivered] = useState<Set<string>>(new Set());

  const expMutation = useMutation({
    mutationFn: (data: object) => api.post(`/delivery-routes/runs/${run.id}/expenses`, data),
    onSuccess: () => {
      toast.success('Expense added');
      qc.invalidateQueries({ queryKey: ['delivery-run-detail', run.id] });
      setExpAmount(''); setExpDesc('');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const completeMutation = useMutation({
    mutationFn: () => api.patch(`/delivery-routes/runs/${run.id}/complete`, {}),
    onSuccess: () => {
      toast.success('Run marked complete');
      qc.invalidateQueries({ queryKey: ['delivery-runs'] });
      onClose();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const d = detail ?? run;
  const orders = d.orders ?? [];
  const expenses = d.expenses ?? [];
  const expenseTotal = expenses.reduce((s, e) => s + e.amountCents, 0);

  return (
  <>
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="font-bold text-gray-900 dark:text-white">{d.routeName ?? 'Delivery Run'}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{fmtDate(d.date)} &bull; {d.driverName ?? 'No driver'}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Orders */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Orders ({orders.length})</p>
            {orders.length === 0
              ? <p className="text-xs text-gray-400 dark:text-gray-500">No orders assigned.</p>
              : <div className="space-y-2">
                  {orders.map((o) => {
                    const isDelivered = o.status === 'DELIVERED' || locallyDelivered.has(o.id);
                    const canCapture = !isDelivered && (o.status === 'PENDING' || o.status === 'PARTIAL' || !o.status);
                    return (
                      <div key={o.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white">{o.customerName ?? '—'}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">{o.orderNumber}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right">
                            <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtKES(o.totalCents)}</p>
                            {isDelivered ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                                <CheckCircle className="w-3 h-3" /> Delivered
                              </span>
                            ) : (
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300`}>
                                {o.status || 'PENDING'}
                              </span>
                            )}
                          </div>
                          {canCapture && d.status !== 'COMPLETED' && (
                            <button
                              onClick={() => setPodOrder(o)}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 rounded-lg text-xs font-semibold transition-colors"
                              title="Capture proof of delivery"
                            >
                              <PenLine className="w-3.5 h-3.5" /> Capture Proof
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
            }
          </div>

          {/* Expenses */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Expenses</p>
            <div className="space-y-2 mb-3">
              {expenses.map((e) => (
                <div key={e.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
                  <div>
                    <span className="text-xs font-semibold px-2 py-0.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded">{e.category}</span>
                    {e.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{e.description}</p>}
                  </div>
                  <span className="text-sm font-bold text-gray-900 dark:text-white">{fmtKES(e.amountCents)}</span>
                </div>
              ))}
              {expenses.length > 0 && (
                <div className="flex justify-between font-bold text-sm text-gray-900 dark:text-white pt-1 border-t border-gray-200 dark:border-gray-700">
                  <span>Total Expenses</span><span>{fmtKES(expenseTotal)}</span>
                </div>
              )}
            </div>
            {/* Add expense form */}
            {d.status !== 'COMPLETED' && (
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">Add Expense</p>
                <div className="flex gap-2">
                  <select value={expCategory} onChange={(e) => setExpCategory(e.target.value)} className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none">
                    {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input type="number" placeholder="Amount (KES)" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} className="w-32 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none" />
                </div>
                <input type="text" placeholder="Description (optional)" value={expDesc} onChange={(e) => setExpDesc(e.target.value)} className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none" />
                <button
                  onClick={() => expMutation.mutate({ category: expCategory, amountCents: Math.round(Number(expAmount) * 100), description: expDesc || null })}
                  disabled={!expAmount || expMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">Close</button>
          {d.status !== 'COMPLETED' && (
            <button
              onClick={() => completeMutation.mutate()}
              disabled={completeMutation.isPending}
              className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {completeMutation.isPending ? 'Completing…' : 'Mark Complete'}
            </button>
          )}
        </div>
      </div>
    </div>

    {/* Proof of Delivery modal */}
    {podOrder && (
      <ProofOfDeliveryModal
        deliveryRunOrderId={podOrder.id}
        customerName={podOrder.customerName ?? '—'}
        orderNumber={podOrder.orderNumber ?? podOrder.id}
        onClose={() => setPodOrder(null)}
        onSuccess={() => {
          setLocallyDelivered((prev) => new Set([...prev, podOrder.id]));
          setPodOrder(null);
          refetchDetail();
        }}
      />
    )}
  </>
  );
}

// ── Routes Tab ────────────────────────────────────────────────────────────────

function RoutesTab({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const { confirm } = useDialog();
  const [showModal, setShowModal] = useState(false);
  const [editRoute, setEditRoute] = useState<SalesRoute | undefined>(undefined);
  const [expandedRouteId, setExpandedRouteId] = useState<string | null>(null);

  const { data: routes = [], isLoading } = useQuery<SalesRoute[]>({
    queryKey: ['sales-routes', businessId],
    queryFn: () => api.get<SalesRoute[]>(`/field-sales/routes?businessId=${businessId}`),
    enabled: !!businessId,
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['business-users', businessId],
    queryFn: () => api.get<User[]>(`/business/${businessId}/users`),
    enabled: !!businessId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/field-sales/routes/${id}?businessId=${businessId}`),
    onSuccess: () => {
      toast.success('Route deleted');
      qc.invalidateQueries({ queryKey: ['sales-routes'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  async function handleDelete(r: SalesRoute) {
    const ok = await confirm({ title: 'Delete Route', message: `Delete route "${r.name}"? This cannot be undone.`, variant: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;
    deleteMutation.mutate(r.id);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">{routes.length} route{routes.length !== 1 ? 's' : ''} configured</p>
        <button
          onClick={() => { setEditRoute(undefined); setShowModal(true); }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          <Plus className="w-4 h-4" /> New Route
        </button>
      </div>

      {isLoading && <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Loading routes…</p>}

      <div className="space-y-3">
        {routes.map((r) => (
          <div key={r.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              {/* Color dot */}
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: r.color ?? '#3B7DFF' }} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900 dark:text-white">{r.name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.isActive ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                    {r.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  <div className="flex gap-1">
                    {r.deliveryDays?.map((d) => (
                      <span key={d} className="text-xs px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded font-medium">{DAY_LABELS[d]}</span>
                    ))}
                  </div>
                  {r.driverName && (
                    <span className="text-xs text-gray-500 dark:text-gray-400"><Truck className="w-3 h-3 inline mr-0.5" />{r.driverName}</span>
                  )}
                  {r.customerCount !== undefined && (
                    <span className="text-xs text-gray-500 dark:text-gray-400"><Users className="w-3 h-3 inline mr-0.5" />{r.customerCount} customers</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setExpandedRouteId(expandedRouteId === r.id ? null : r.id)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-xs transition-colors"
                  title="View customers"
                >
                  {expandedRouteId === r.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => { setEditRoute(r); setShowModal(true); }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" aria-label="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(r)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" aria-label="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Expanded customers */}
            {expandedRouteId === r.id && (
              <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-700/30">
                {!r.customers || r.customers.length === 0
                  ? <p className="text-xs text-gray-400 dark:text-gray-500">No customers on this route.</p>
                  : <div className="grid grid-cols-2 gap-1.5">
                      {r.customers.map((c) => (
                        <div key={c.id} className="text-xs text-gray-600 dark:text-gray-400">
                          {c.name}{c.shopCode && ` (${c.shopCode})`}
                        </div>
                      ))}
                    </div>
                }
              </div>
            )}
          </div>
        ))}
      </div>

      {showModal && (
        <RouteModal
          route={editRoute}
          users={users}
          businessId={businessId}
          onClose={() => { setShowModal(false); setEditRoute(undefined); }}
        />
      )}
    </div>
  );
}

// ── Runs Tab ──────────────────────────────────────────────────────────────────

function RunsTab({ businessId }: { businessId: string }) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedRun, setSelectedRun] = useState<DeliveryRun | null>(null);
  const [routeFilter, setRouteFilter] = useState('');

  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today.toISOString().split('T')[0]);

  const { data: routes = [] } = useQuery<SalesRoute[]>({
    queryKey: ['sales-routes', businessId],
    queryFn: () => api.get<SalesRoute[]>(`/field-sales/routes?businessId=${businessId}`),
    enabled: !!businessId,
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['business-users', businessId],
    queryFn: () => api.get<User[]>(`/business/${businessId}/users`),
    enabled: !!businessId,
  });

  const { data: runs = [], isLoading } = useQuery<DeliveryRun[]>({
    queryKey: ['delivery-runs', businessId, routeFilter, dateFrom, dateTo],
    queryFn: () => {
      const p = new URLSearchParams({ businessId });
      if (routeFilter) p.set('routeId', routeFilter);
      if (dateFrom) p.set('startDate', dateFrom);
      if (dateTo) p.set('endDate', dateTo);
      return api.get<DeliveryRun[]>(`/delivery-routes/runs?${p}`);
    },
    enabled: !!businessId,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <select value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)} className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none" aria-label="Filter by routes">
            <option value="">All Routes</option>
            {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none" aria-label="Date" />
          <span className="text-gray-400 text-sm">–</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none" aria-label="Date" />
        </div>
        <button onClick={() => setShowCreateModal(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors">
          <Plus className="w-4 h-4" /> Create Run
        </button>
      </div>

      {isLoading && <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Loading runs…</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {runs.map((r) => (
          <div
            key={r.id}
            onClick={() => setSelectedRun(r)}
            className="surface-interactive p-4" role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.currentTarget.click(); } }}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">{r.routeName ?? 'Unknown Route'}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  <CalendarDays className="w-3.5 h-3.5 inline mr-1" />{fmtDate(r.date)}
                  {r.driverName && ` · ${r.driverName}`}
                </p>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${RUN_STATUS_STYLE[r.status]}`}>{r.status}</span>
            </div>
            <div className="flex items-center gap-4 mt-3 text-sm text-gray-600 dark:text-gray-400">
              <span><Package className="w-3.5 h-3.5 inline mr-1" />{r.orderCount ?? 0} orders</span>
              {r.totalCents !== undefined && (
                <span><DollarSign className="w-3.5 h-3.5 inline mr-1" />{fmtKES(r.totalCents)}</span>
              )}
            </div>
          </div>
        ))}
        {!isLoading && runs.length === 0 && (
          <p className="col-span-2 text-sm text-gray-400 dark:text-gray-500 text-center py-12">No delivery runs found for this period.</p>
        )}
      </div>

      {showCreateModal && (
        <CreateRunModal
          routes={routes}
          users={users}
          businessId={businessId}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {selectedRun && (
        <RunDetailModal
          run={selectedRun}
          businessId={businessId}
          onClose={() => setSelectedRun(null)}
        />
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type ActiveTab = 'routes' | 'runs';

export default function DeliveryRoutesPage() {
  const user = useAuthStore((s) => s.user);
  const businessId = user?.businessId ?? '';
  const [activeTab, setActiveTab] = useState<ActiveTab>('routes');

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center">
            <MapPin className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Delivery Routes</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Manage routes and delivery runs</p>
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('routes')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${activeTab === 'routes' ? 'bg-emerald-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
          >
            Routes
          </button>
          <button
            onClick={() => setActiveTab('runs')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${activeTab === 'runs' ? 'bg-emerald-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
          >
            Delivery Runs
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'routes' && <RoutesTab businessId={businessId} />}
        {activeTab === 'runs' && <RunsTab businessId={businessId} />}
      </div>
    </div>
  );
}
