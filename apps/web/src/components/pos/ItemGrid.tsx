import { useState, type RefObject } from 'react';
import { Search, ShoppingCart, Camera, Monitor, User, Star, X } from 'lucide-react';
import type { ApiItem, PriceLevel } from '../../stores/pos';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CAT_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#F97316','#EC4899','#6366F1','#14B8A6'];

function categoryColor(name?: string | null): string {
  if (!name) return '#3B82F6';
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return CAT_COLORS[Math.abs(h) % CAT_COLORS.length];
}

function formatKES(cents: number) {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const PRICE_LEVEL_LABELS: Record<PriceLevel, string> = {
  RETAIL: 'Retail',
  WHOLESALE: 'Wholesale',
  VIP: 'VIP',
};

interface Category {
  id: string;
  name: string;
  color?: string;
}

interface LoyaltyData {
  loyaltyPoints: number;
  balanceCents?: number;
  program?: { redemptionRate?: number; pointValueCents?: number; minRedemption: number };
}

interface Props {
  items: ApiItem[];
  categories: Category[];
  activeCategory: string;
  setActiveCategory: (id: string) => void;
  priceLevel: PriceLevel;
  setPriceLevel: (level: PriceLevel) => void;
  search: string;
  setSearch: (v: string) => void;
  searchRef: RefObject<HTMLInputElement>;
  ageConfirmed: boolean;
  heldSalesCount: number;
  customerName: string | null;
  loyaltyData: LoyaltyData | null | undefined;
  loyaltyDiscountApplied: boolean;
  loyaltyDiscountCents: number;
  onAddItem: (item: ApiItem) => void;
  onBarcodeSearch: (raw: string) => void;
  onOpenCamera: () => void;
  enableBarcodeScanner?: boolean;
  onSelectCustomer: () => void;
  onClearCustomer: () => void;
  onToggleLoyalty: () => void;
  onAgeRestrictedItem: (item: ApiItem) => void;
}

export default function ItemGrid({
  items, categories, activeCategory, setActiveCategory,
  priceLevel, setPriceLevel, search, setSearch, searchRef,
  ageConfirmed, heldSalesCount, customerName, loyaltyData,
  loyaltyDiscountApplied, loyaltyDiscountCents,
  onAddItem, onBarcodeSearch, onOpenCamera, enableBarcodeScanner = true, onSelectCustomer,
  onClearCustomer, onToggleLoyalty, onAgeRestrictedItem,
}: Props) {
  /** The tile that was just added to the sale; it pops once (.tile-pop in index.css). */
  const [popped, setPopped] = useState<string | null>(null);
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-950">
      {/* Search + Price Level bar */}
      {/* Wraps on the width of THIS pane, not the window: with the sidebar open and the cart beside it the item area
          can be ~300px inside an 800px window, and a window-width breakpoint (sm:flex-row) squeezed the search box to
          nothing and pushed the price levels and Customer button out over the edge. The search keeps at least 200px
          and the controls drop to their own line when there is no room. */}
      <div className="bg-slate-900 border-b border-slate-800 px-3 md:px-4 py-2 md:py-3 flex flex-wrap items-center gap-2 md:gap-3">
        <div className="relative flex-1 basis-[200px] min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && search) onBarcodeSearch(search); }}
            placeholder="Search or scan barcode"
            className="w-full bg-slate-800 border border-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 rounded-xl pl-10 pr-10 py-2.5 text-sm text-slate-100 placeholder-slate-400 outline-none transition-all"
          />
          {enableBarcodeScanner && (
            <button
              onClick={onOpenCamera}
              title="Scan barcode with camera"
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-blue-400 transition-colors rounded"
            >
              <Camera className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap max-w-full">
          {/* Price Level pill buttons */}
          <div className="flex items-center border border-slate-700 rounded-lg overflow-hidden flex-shrink-0" title="Price Level">
            {(Object.entries(PRICE_LEVEL_LABELS) as [PriceLevel, string][]).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setPriceLevel(val)}
                className={`px-2 py-1.5 text-xs font-semibold transition-colors ${
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

          {/* Customer chip / select button */}
          {customerName ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="flex items-center gap-1.5 px-2 py-1.5 bg-blue-900/40 border border-blue-700/50 rounded-lg text-sm min-w-0">
                <User className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <span className="text-blue-300 font-medium truncate max-w-[120px]">{customerName}</span>
                <button onClick={onClearCustomer} className="text-blue-500 hover:text-blue-200 flex-shrink-0" aria-label="Clear">
                  <X className="w-3 h-3" />
                </button>
              </div>
              {loyaltyData && loyaltyData.loyaltyPoints > 0 && loyaltyData.program && (
                <button
                  onClick={onToggleLoyalty}
                  className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors flex-shrink-0 ${
                    loyaltyDiscountApplied
                      ? 'bg-yellow-500 text-white'
                      : 'bg-yellow-900/30 text-yellow-400 border border-yellow-700/50 hover:bg-yellow-900/50'
                  }`}
                  title={`${loyaltyData.loyaltyPoints} pts = KES ${((loyaltyData.loyaltyPoints * (loyaltyData.program?.redemptionRate ?? 0)) / 100).toFixed(0)}`}
                >
                  <Star className="w-3 h-3" />
                  {loyaltyDiscountApplied ? `−${(loyaltyDiscountCents / 100).toFixed(0)}` : `${loyaltyData.loyaltyPoints}pts`}
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={onSelectCustomer}
              className="flex items-center gap-1.5 px-2.5 py-1.5 border border-slate-700 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200 flex-shrink-0 transition-colors"
              title="Select customer (F2)"
            >
              <User className="w-4 h-4" />
              <span className="hidden sm:inline">Customer</span>
            </button>
          )}

          {/* Pole Display */}
          <button
            onClick={() => window.open('/pole-display', '_blank', 'width=1024,height=600,resizable=yes')}
            title="Open customer-facing pole display (2nd screen)"
            className="hidden md:flex p-2 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded-lg transition-colors flex-shrink-0"
          >
            <Monitor className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Category tabs */}
      <div className="bg-slate-900/50 border-b border-slate-800 px-4 py-2 flex gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveCategory('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
            activeCategory === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 border border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
          }`}
        >
          All Items
        </button>
        {categories.filter((cat) => cat.name?.trim()).map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              activeCategory === cat.id
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 border border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Item grid */}
      <div className="flex-1 overflow-y-auto p-2 md:p-4" style={{ paddingBottom: 'calc(120px + env(safe-area-inset-bottom))' }}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2 md:gap-3">
          {items.map((item) => {
            const price =
              priceLevel === 'WHOLESALE' && item.wholesalePriceCents
                ? item.wholesalePriceCents
                : priceLevel === 'VIP' && item.vipPriceCents
                  ? item.vipPriceCents
                  : item.retailPriceCents;
            const outOfStock = item.trackStock && (item.currentStock ?? 0) <= 0;
            const isExpired = !!(item as any).batchExpired;
            const isExpiringSoon = !!(item as any).batchExpiringSoon;
            const canOversell = !item.negativeStockPolicy || item.negativeStockPolicy !== 'BLOCK';
            const hardDisabled = (outOfStock && !canOversell) || isExpired || !!item.soldOut;

            const handleClick = () => {
              if (hardDisabled) return;
              if (item.ageRestricted && !ageConfirmed) {
                onAgeRestrictedItem(item);
                return;
              }
              onAddItem(item);
              setPopped(item.id);
            };

            return (
              <button
                key={item.id}
                onClick={handleClick}
                disabled={hardDisabled}
                onAnimationEnd={() => { if (popped === item.id) setPopped(null); }}
                className={`${popped === item.id ? 'tile-pop ' : ''}p-3 rounded-xl border-2 text-left transition-all relative touch-manipulation ${
                  hardDisabled
                    ? 'border-slate-800 bg-slate-900/30 opacity-50 cursor-not-allowed'
                    : outOfStock && canOversell
                      ? 'border-orange-700/60 bg-orange-950/30 hover:bg-orange-900/30 hover:border-orange-600/70 active:scale-95'
                      : 'border-slate-700 bg-slate-800/50 hover:bg-slate-700/60 hover:border-slate-500 active:scale-95 active:bg-slate-700'
                }`}
              >
                {item.ageRestricted && (
                  <div className="absolute top-1 left-1 bg-red-600 text-white text-[9px] font-bold px-1 py-0.5 rounded">
                    {item.minAgeYears ?? 18}+
                  </div>
                )}
                {isExpiringSoon && !isExpired && (
                  <div className="absolute top-1 right-1 bg-orange-500 text-white text-xs px-1.5 py-0.5 rounded">
                    Expiring
                  </div>
                )}
                {isExpired && (
                  <div className="absolute top-1 right-1 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded">
                    Expired
                  </div>
                )}
                {item.soldOut && (
                  <div className="absolute bottom-1 left-1/2 -translate-x-1/2 bg-red-600 text-white text-xs px-2 py-0.5 rounded font-bold">
                    86&apos;d
                  </div>
                )}
                <div
                  className="w-full h-14 md:h-12 rounded-lg mb-2 flex items-center justify-center text-2xl md:text-xl font-bold text-white"
                  style={{ backgroundColor: categoryColor(typeof item.category === 'object' ? item.category?.name : item.category) }}
                >
                  {item.name[0]?.toUpperCase() ?? '?'}
                </div>
                <p className="text-xs font-semibold text-slate-200 leading-tight line-clamp-2">{item.name}</p>
                <p className="text-sm font-bold text-blue-400 mt-1">{formatKES(price)}</p>
                {item.trackStock && (
                  <p className={`text-xs mt-0.5 ${outOfStock ? 'text-orange-400' : 'text-slate-400'}`}>
                    {outOfStock
                      ? hardDisabled ? 'Blocked' : `${item.currentStock ?? 0} (neg. stock)`
                      : `${item.currentStock ?? 0} left`}
                  </p>
                )}
              </button>
            );
          })}
        </div>
        {items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <ShoppingCart className="w-12 h-12 mb-3 opacity-30" />
            <p>No items found</p>
          </div>
        )}
      </div>

      {/* Keyboard hints */}
      <div className="hidden md:flex bg-slate-900 border-t border-slate-800 px-4 py-1.5 gap-3 text-xs text-slate-400 overflow-x-auto">
        <span><kbd className="bg-slate-700 text-slate-300 px-1 rounded">/</kbd> Search</span>
        <span><kbd className="bg-slate-700 text-slate-300 px-1 rounded">F1</kbd> Pay</span>
        <span><kbd className="bg-slate-700 text-slate-300 px-1 rounded">F2</kbd> Customer</span>
        <span><kbd className="bg-slate-700 text-slate-300 px-1 rounded">F3</kbd> Service</span>
        <span><kbd className="bg-slate-700 text-slate-300 px-1 rounded">F4</kbd> Pay</span>
        <span><kbd className="bg-slate-700 text-slate-300 px-1 rounded">F5</kbd> Hold</span>
        <span><kbd className="bg-slate-700 text-slate-300 px-1 rounded">F6</kbd> Held ({heldSalesCount})</span>
        <span><kbd className="bg-slate-700 text-slate-300 px-1 rounded">F7</kbd> Proforma</span>
        <span><kbd className="bg-slate-700 text-slate-300 px-1 rounded">F8</kbd> Layaway</span>
      </div>
    </div>
  );
}
