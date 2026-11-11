import { useState, useEffect, useCallback, useRef } from 'react';
import { computeTaxes, taxClassOf } from '@pos/shared';
import {
  ShoppingCart, Plus, Minus, Trash2, CreditCard, Banknote,
  Phone, AlertCircle, CheckCircle2, Search, ScanLine,
  ChevronRight, RotateCcw, X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface KioskItem {
  id: string;
  name: string;
  retailPriceCents: number;
  category?: string;
  imageUrl?: string;
  vatApplicable: boolean;
  taxClass?: string;
  barcode?: string;
}

interface CartEntry {
  item: KioskItem;
  qty: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(cents: number) {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

function fmtShort(cents: number) {
  const v = cents / 100;
  return v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(2);
}

function getUrlParams() {
  const p = new URLSearchParams(window.location.search);
  return { businessId: p.get('businessId') ?? '', storeId: p.get('storeId') ?? '' };
}

const CAT_COLORS: Record<string, string> = {
  'Food':     '#ef4444', 'Drinks':  '#3B7DFF', 'Coffee':    '#a16207',
  'Desserts': '#ec4899', 'Bakery':  '#f59e0b', 'Snacks':    '#10b981',
  'Produce':  '#22c55e', 'Dairy':   '#3B7DFF', 'Household': '#8b5cf6',
  'Other':    '#64748b',
};
function catColor(cat: string) { return CAT_COLORS[cat] ?? '#3B7DFF'; }

// ─── Overlay screens ──────────────────────────────────────────────────────────

function SuccessScreen({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 5000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-50 bg-emerald-600 flex flex-col items-center justify-center text-white p-8">
      <CheckCircle2 className="w-32 h-32 mb-6 animate-bounce" />
      <h2 className="text-5xl font-black mb-3">Thank You!</h2>
      <p className="text-xl text-emerald-100">Purchase complete. Please take your items.</p>
      <p className="mt-6 text-emerald-200 text-sm">Returning in 5 seconds…</p>
    </div>
  );
}

function CashScreen({ total, onBack, onDone }: { total: number; onBack: () => void; onDone: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex items-center justify-center p-6">
      <div className="bg-gray-900 rounded-3xl p-10 max-w-md w-full text-center shadow-2xl">
        <div className="w-20 h-20 rounded-full bg-green-900 flex items-center justify-center mx-auto mb-4">
          <Banknote className="w-10 h-10 text-green-400" />
        </div>
        <h2 className="text-3xl font-bold text-white mb-1">Pay with Cash</h2>
        <p className="text-gray-400 mb-4">Present this amount to the cashier</p>
        <div className="text-6xl font-black text-green-400 my-6">{fmt(total)}</div>
        <p className="text-gray-500 mb-8 text-sm">Please give the exact amount at the counter</p>
        <div className="flex gap-3">
          <button onClick={onBack} className="flex-1 py-4 rounded-2xl bg-gray-700 text-gray-200 text-lg font-semibold hover:bg-gray-600 transition-colors">
            ← Back
          </button>
          <button onClick={onDone} className="flex-[2] py-4 rounded-2xl bg-green-600 text-white text-lg font-bold hover:bg-green-700 transition-colors flex items-center justify-center gap-2">
            <CheckCircle2 className="w-5 h-5" /> Paid
          </button>
        </div>
      </div>
    </div>
  );
}

function MpesaScreen({ total, qr, onBack, onDone }: { total: number; qr: string | null; onBack: () => void; onDone: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex items-center justify-center p-6">
      <div className="bg-gray-900 rounded-3xl p-10 max-w-md w-full text-center shadow-2xl">
        <div className="w-20 h-20 rounded-full bg-green-900 flex items-center justify-center mx-auto mb-4">
          <Phone className="w-10 h-10 text-green-400" />
        </div>
        <h2 className="text-3xl font-bold text-white mb-1">M-Pesa</h2>
        <p className="text-gray-400 mb-1">Scan QR with M-Pesa app</p>
        <div className="text-4xl font-black text-green-400 my-4">{fmt(total)}</div>
        {qr ? (
          <img src={qr} alt="M-Pesa QR" className="mx-auto w-52 h-52 my-4 border-4 border-green-700 rounded-2xl" />
        ) : (
          <div className="w-52 h-52 mx-auto my-4 bg-gray-800 rounded-2xl flex flex-col items-center justify-center text-gray-500 gap-2">
            <ScanLine className="w-12 h-12" />
            <span className="text-sm">QR loading…</span>
          </div>
        )}
        <p className="text-gray-500 text-sm mb-6">Or enter till number manually in the M-Pesa app</p>
        <div className="flex gap-3">
          <button onClick={onBack} className="flex-1 py-4 rounded-2xl bg-gray-700 text-gray-200 text-lg font-semibold hover:bg-gray-600 transition-colors">
            ← Back
          </button>
          <button onClick={onDone} className="flex-[2] py-4 rounded-2xl bg-green-600 text-white text-lg font-bold hover:bg-green-700 transition-colors flex items-center justify-center gap-2">
            <CheckCircle2 className="w-5 h-5" /> Done
          </button>
        </div>
      </div>
    </div>
  );
}

function CallStaffScreen({ onCancel, notified }: { onCancel: () => void; notified: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-red-600 flex flex-col items-center justify-center p-8 text-white">
      <AlertCircle className="w-28 h-28 mb-6 animate-pulse" />
      <h2 className="text-5xl font-black mb-3">Staff Called</h2>
      <p className="text-red-100 text-xl">A staff member will be with you shortly.</p>
      {notified && (
        <p className="mt-3 text-red-200 text-sm bg-red-700/50 px-4 py-2 rounded-lg">
          ✓ Staff notified via in-app notification
        </p>
      )}
      <button onClick={onCancel} className="mt-10 px-12 py-5 bg-white text-red-600 rounded-2xl text-xl font-bold hover:bg-red-50 transition-colors">
        Cancel
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function KioskPage() {
  const authUser = useAuthStore((s) => s.user);
  const urlParams = getUrlParams();
  // When accessed from within the app (staff sidebar), use auth store; URL params take priority for standalone kiosk URLs
  const businessId = urlParams.businessId || authUser?.businessId || '';
  const storeId = urlParams.storeId || authUser?.storeId || '';
  const [items, setItems] = useState<KioskItem[]>([]);
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [cartOpen, setCartOpen] = useState(false);   // phones: cart is a full-screen sheet
  const [search, setSearch] = useState('');
  const [screen, setScreen] = useState<'shop' | 'cash' | 'mpesa' | 'success' | 'staff'>('shop');
  const [staffNotified, setStaffNotified] = useState(false);
  const [mpesaQR, setMpesaQR] = useState<string | null>(null);
  const [mpesaLoading, setMpesaLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('Self Checkout');
  const [storeName, setStoreName] = useState<string>('');
  const [logo, setLogo] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Fetch items + business/store name
  useEffect(() => {
    if (!businessId) return;
    api.get<KioskItem[]>(`/items?businessId=${businessId}&activeOnly=true${storeId ? `&storeId=${storeId}` : ''}`)
      .then(setItems)
      .catch(() => setError('Could not load items. Please call staff.'));
    api.get<{ name: string; logoUrl?: string }>(`/business/${businessId}/settings`)
      .then(b => {
        if (b.name) setBusinessName(b.name);
        if (b.logoUrl) setLogo(b.logoUrl);
      })
      .catch(() => {});
    if (storeId) {
      api.get<{ id: string; name: string }[]>(`/business/${businessId}/stores`)
        .then(stores => {
          const match = stores.find(s => s.id === storeId);
          if (match) setStoreName(match.name);
        })
        .catch(() => {});
    }
  }, [businessId, storeId]);

  // Call staff — shows screen + fires in-app notification so staff see it on their devices
  const callStaff = useCallback(() => {
    setScreen('staff');
    setStaffNotified(false);
    if (!businessId) return;
    const locationLabel = storeName ? `at ${storeName}` : 'at the kiosk';
    api.post('/notifications', {
      businessId,
      ...(storeId && { storeId }),
      type: 'KIOSK_HELP',
      title: `Kiosk Help — ${storeName || 'Self Checkout'}`,
      body: `A customer ${locationLabel} (self-service kiosk) has pressed the Help button and needs assistance.`,
      priority: 'HIGH',
    })
      .then(() => setStaffNotified(true))
      .catch(() => {}); // Fail silently — visual screen still shows
  }, [businessId, storeId, storeName]);

  // Cart helpers
  const addItem = useCallback((item: KioskItem) => {
    setCart(c => {
      const idx = c.findIndex(e => e.item.id === item.id);
      if (idx >= 0) return c.map((e, i) => i === idx ? { ...e, qty: e.qty + 1 } : e);
      return [...c, { item, qty: 1 }];
    });
  }, []);

  const removeItem = useCallback((itemId: string) => {
    setCart(c => c.filter(e => e.item.id !== itemId));
  }, []);

  const updateQty = useCallback((itemId: string, qty: number) => {
    if (qty <= 0) { removeItem(itemId); return; }
    setCart(c => c.map(e => e.item.id === itemId ? { ...e, qty } : e));
  }, [removeItem]);

  // Barcode lookup via search
  const handleSearch = useCallback((val: string) => {
    setSearch(val);
    if (val.length >= 8) {
      const match = items.find(i => i.barcode?.toLowerCase() === val.toLowerCase());
      if (match) {
        addItem(match);
        setSearch('');
        if (searchRef.current) searchRef.current.value = '';
      }
    }
  }, [items, addItem]);

  // Totals
  const subtotalCents = cart.reduce((s, e) => s + e.item.retailPriceCents * e.qty, 0);
  const vatCents = computeTaxes(
    cart.map((e) => ({ totalCents: e.item.retailPriceCents * e.qty, taxClass: taxClassOf(e.item) })),
    0,
    { vatRegistered: true },
  ).vatCents;
  const totalCents = subtotalCents;
  const cartQty = cart.reduce((s, e) => s + e.qty, 0);

  useEffect(() => { if (cart.length === 0) setCartOpen(false); }, [cart.length]);

  // Categories
  const categories = ['all', ...Array.from(new Set(items.map(i => i.category ?? 'Other')))];
  const filtered = (activeCategory === 'all' ? items : items.filter(i => (i.category ?? 'Other') === activeCategory))
    .filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.barcode?.toLowerCase().includes(search.toLowerCase()));

  // Cart map for quick lookup
  const cartMap = Object.fromEntries(cart.map(e => [e.item.id, e.qty]));

  // M-Pesa QR
  async function handleMpesa() {
    setMpesaLoading(true);
    try {
      const res = await api.post<{ qrCode?: string; QRCode?: string }>('/payments/mpesa/qr', {
        businessId, storeId, amountCents: totalCents,
      });
      setMpesaQR(res.qrCode ?? res.QRCode ?? null);
      setScreen('mpesa');
    } catch {
      setError('M-Pesa QR unavailable. Please pay at counter.');
    } finally {
      setMpesaLoading(false);
    }
  }

  function completeSale() {
    setCart([]);
    setScreen('success');
  }

  function resetToShop() {
    setScreen('shop');
    setMpesaQR(null);
  }

  // ── Overlay screens ───────────────────────────────────────────────────────
  if (screen === 'success') return <SuccessScreen onDone={resetToShop} />;
  if (screen === 'cash')    return <CashScreen total={totalCents} onBack={() => setScreen('shop')} onDone={completeSale} />;
  if (screen === 'mpesa')   return <MpesaScreen total={totalCents} qr={mpesaQR} onBack={() => setScreen('shop')} onDone={completeSale} />;
  if (screen === 'staff')   return <CallStaffScreen onCancel={() => setScreen('shop')} notified={staffNotified} />;

  // ── Main shop screen ──────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-gray-950 overflow-hidden select-none" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-gray-900 text-white flex flex-wrap md:flex-nowrap items-center gap-3 md:gap-4 px-3 md:px-5 py-3 shrink-0">
        {/* Logo / Business name */}
        <div className="flex items-center gap-3 shrink-0 mr-auto md:mr-0">
          {logo ? (
            <img src={logo} alt="logo" className="h-10 w-10 object-contain rounded-lg" />
          ) : (
            <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center font-black text-lg">
              {businessName.charAt(0)}
            </div>
          )}
          <div>
            <div className="font-bold text-base leading-none">{businessName}</div>
            <div className="text-gray-400 text-xs mt-0.5">Self Checkout</div>
          </div>
        </div>

        {/* Search / Barcode input */}
        <div className="order-last md:order-none w-full md:w-auto flex-1 md:mx-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <ScanLine className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search items or scan barcode…"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Cart count pill */}
        {cartQty > 0 && (
          <div className="hidden md:flex items-center gap-2 bg-blue-600 px-4 py-2 rounded-xl text-sm font-bold shrink-0">
            <ShoppingCart className="w-4 h-4" />
            {cartQty} item{cartQty !== 1 ? 's' : ''}
          </div>
        )}

        {/* Call staff */}
        <button
          onClick={callStaff}
          className="flex items-center gap-2 bg-red-600 hover:bg-red-700 px-4 py-2.5 rounded-xl text-sm font-semibold shrink-0 transition-colors"
        >
          <Phone className="w-4 h-4" /> Help
        </button>
      </header>

      {/* ── Category strip ──────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border-b border-gray-700 shrink-0 flex items-center gap-2 px-4 py-2.5 overflow-x-auto">
        {categories.map(cat => {
          const color = cat === 'all' ? '#3B7DFF' : catColor(cat);
          const active = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={active ? { background: color, color: '#fff', borderColor: color } : {}}
              className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap border transition-all shrink-0 ${
                active ? '' : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
              }`}
            >
              {cat === 'all' ? 'All Items' : cat}
            </button>
          );
        })}
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Item grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="bg-red-950 border border-red-800 rounded-xl p-4 mb-4 text-red-300 text-center text-base flex items-center gap-2 justify-center">
              <AlertCircle className="w-5 h-5" /> {error}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filtered.map(item => {
              const qtyInCart = cartMap[item.id] ?? 0;
              const color = catColor(item.category ?? 'Other');
              return (
                <button
                  key={item.id}
                  onClick={() => addItem(item)}
                  className="relative bg-gray-900 rounded-2xl shadow-sm hover:shadow-md transition-all active:scale-95 text-left overflow-hidden border border-gray-700 hover:border-blue-500 flex flex-col"
                  style={{ outline: qtyInCart > 0 ? `2px solid ${color}` : 'none' }}
                >
                  {/* Category color bar */}
                  <div className="h-1.5 w-full" style={{ background: color }} />

                  {/* Image / placeholder */}
                  <div className="relative flex-none">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="w-full h-28 object-cover" />
                    ) : (
                      <div className="w-full h-28 flex items-center justify-center" style={{ background: `${color}12` }}>
                        <span className="text-4xl font-black opacity-20" style={{ color }}>{item.name.charAt(0)}</span>
                      </div>
                    )}
                    {/* Cart badge */}
                    {qtyInCart > 0 && (
                      <div
                        className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center text-sm font-black text-white shadow"
                        style={{ background: color }}
                      >
                        {qtyInCart}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-3 flex flex-col flex-1">
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">{item.category ?? 'Other'}</p>
                    <p className="font-semibold text-white text-sm leading-tight flex-1 line-clamp-2">{item.name}</p>
                    <div className="flex items-end justify-between mt-2">
                      <div>
                        <p className="text-base font-black text-white">{fmt(item.retailPriceCents)}</p>
                        {item.vatApplicable && <p className="text-[10px] text-gray-400">VAT incl.</p>}
                      </div>
                      <div
                        className="w-8 h-8 rounded-xl flex items-center justify-center text-white shadow-sm"
                        style={{ background: color }}
                      >
                        <Plus className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {filtered.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500">
              <ShoppingCart className="w-16 h-16 mb-3 opacity-20" />
              <p className="text-lg font-medium">No items found</p>
              {search && <p className="text-sm mt-1">Try a different search term</p>}
            </div>
          )}
        </div>

        {/* ── Cart Sidebar ──────────────────────────────────────────────────── */}
        <div className={`${cartOpen ? 'flex' : 'hidden'} md:flex flex-col fixed inset-0 z-40 md:static md:inset-auto md:z-auto md:w-80 bg-gray-900 md:border-l border-gray-700 shrink-0 shadow-lg`}>

          {/* Cart header */}
          <div className="px-4 py-3 border-b border-gray-700 bg-gray-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <button onClick={() => setCartOpen(false)} aria-label="Back to items" className="md:hidden -ml-1 p-1.5 text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
              <ShoppingCart className="w-5 h-5 text-blue-500" />
              <span className="font-bold text-white">Your Order</span>
              {cartQty > 0 && (
                <span className="bg-blue-600 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">{cartQty}</span>
              )}
            </div>
            {cart.length > 0 && (
              <button onClick={() => setCart([])} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 font-medium">
                <RotateCcw className="w-3 h-3" /> Clear
              </button>
            )}
          </div>

          {/* Cart items */}
          <div className="flex-1 overflow-y-auto py-2">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 py-12 px-4">
                <ShoppingCart className="w-12 h-12 mb-3 opacity-20" />
                <p className="text-sm font-medium text-center">Tap an item to add it to your order</p>
              </div>
            ) : (
              cart.map(({ item, qty }) => {
                const color = catColor(item.category ?? 'Other');
                return (
                  <div key={item.id} className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-800 transition-colors border-b border-gray-700 last:border-0">
                    {/* Color indicator */}
                    <div className="w-1 h-12 rounded-full shrink-0" style={{ background: color }} />

                    {/* Name + price */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate leading-tight">{item.name}</p>
                      <p className="text-xs text-gray-400">{fmt(item.retailPriceCents)} each</p>
                      <p className="text-sm font-bold" style={{ color }}>{fmt(item.retailPriceCents * qty)}</p>
                    </div>

                    {/* Qty controls */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => updateQty(item.id, qty - 1)}
                        className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors active:scale-90"
                      >
                        {qty === 1 ? <Trash2 className="w-3.5 h-3.5 text-red-400" /> : <Minus className="w-3.5 h-3.5 text-gray-300" />}
                      </button>
                      <span className="w-6 text-center font-bold text-sm text-white">{qty}</span>
                      <button
                        onClick={() => updateQty(item.id, qty + 1)}
                        className="w-8 h-8 rounded-full flex items-center justify-center transition-colors active:scale-90 text-white"
                        style={{ background: color }} aria-label="Add">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Totals + payment */}
          <div className="border-t border-gray-700 p-4 shrink-0 space-y-3">
            {/* VAT breakdown */}
            <div className="space-y-1 text-sm text-gray-300 bg-gray-800 rounded-xl p-3">
              <div className="flex justify-between">
                <span>Subtotal (ex-VAT)</span>
                <span className="font-medium">{fmt(subtotalCents - vatCents)}</span>
              </div>
              <div className="flex justify-between">
                <span>VAT (16%)</span>
                <span className="font-medium">{fmt(vatCents)}</span>
              </div>
              <div className="flex justify-between font-black text-base text-white pt-1.5 border-t border-gray-700 mt-1.5">
                <span>Total</span>
                <span className="text-blue-400">KES {fmtShort(totalCents)}</span>
              </div>
            </div>

            {cart.length > 0 ? (
              <div className="space-y-2">
                <button
                  onClick={() => setScreen('cash')}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-2 transition-colors active:scale-98 shadow-sm"
                >
                  <Banknote className="w-5 h-5" />
                  Pay with Cash
                  <ChevronRight className="w-4 h-4 opacity-70" />
                </button>
                <button
                  onClick={() => void handleMpesa()}
                  disabled={mpesaLoading}
                  className="w-full bg-gray-700 hover:bg-gray-600 text-white py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 active:scale-98 shadow-sm"
                >
                  <CreditCard className="w-5 h-5" />
                  {mpesaLoading ? 'Loading…' : 'Pay with M-Pesa'}
                  <ChevronRight className="w-4 h-4 opacity-70" />
                </button>
              </div>
            ) : (
              <div className="text-center text-gray-500 text-sm py-3 flex items-center justify-center gap-1.5">
                <ShoppingCart className="w-4 h-4 opacity-50" />
                Add items to continue
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Phone cart bar: opens the order sheet */}
      <button
        onClick={() => setCartOpen(true)}
        className="md:hidden shrink-0 flex items-center justify-between gap-3 px-4 py-3 bg-blue-600 active:bg-blue-700 text-white font-bold"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      >
        <span className="flex items-center gap-2">
          <ShoppingCart className="w-5 h-5" />
          {cartQty} item{cartQty !== 1 ? 's' : ''}
        </span>
        <span>KES {fmtShort(totalCents)}</span>
      </button>
    </div>
  );
}
