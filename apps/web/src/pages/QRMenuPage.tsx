import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ShoppingBag, Search, Loader2 } from 'lucide-react';

interface MenuItem {
  id: string;
  name: string;
  category: string;
  retailPriceCents: number;
  description?: string;
  imageUrl?: string;
  allergens?: string[];
  soldOut?: boolean;
}

interface BusinessInfo {
  name: string;
  items: MenuItem[];
}

function fmt(cents: number) {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

export default function QRMenuPage() {
  const { businessId } = useParams<{ businessId: string }>();
  const [data, setData] = useState<BusinessInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  useEffect(() => {
    if (!businessId) return;
    // The public portal menu needs no login; the staff endpoints (settings, items) answer 401 to a diner.
    fetch(`/api/v1/portal/menu?businessId=${encodeURIComponent(businessId)}`)
      .then(r => { if (!r.ok) throw new Error('menu unavailable'); return r.json(); })
      .then((menu: { business: { name?: string } | null; categories: Array<{ name: string; items: Array<Omit<MenuItem, 'category'>> }> }) => {
        if (!menu.business) { setData(null); return; }
        setData({
          name: menu.business.name ?? 'Menu',
          items: menu.categories.flatMap(c => c.items.map(i => ({ ...i, category: c.name }))),
        });
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [businessId]);

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
    </div>
  );

  if (!data) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-400">Menu not found</p>
    </div>
  );

  const categories = ['all', ...Array.from(new Set(data.items.map(i => i.category).filter(Boolean)))];
  const filtered = data.items.filter(i => {
    if (activeCategory !== 'all' && i.category !== activeCategory) return false;
    if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const groups = activeCategory === 'all'
    ? categories.filter(c => c !== 'all').map(cat => ({ cat, items: filtered.filter(i => i.category === cat) })).filter(g => g.items.length > 0)
    : [{ cat: activeCategory, items: filtered }];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3 mb-3">
            <ShoppingBag className="w-6 h-6 text-blue-600" />
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{data.name}</h1>
          </div>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search menu…"
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap pb-1">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  activeCategory === cat
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {cat === 'all' ? 'All Items' : cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Menu */}
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-6">
        {groups.map(({ cat, items }) => (
          <div key={cat}>
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3">{cat}</h2>
            <div className="space-y-2">
              {items.map(item => (
                <div key={item.id} className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex gap-4 ${item.soldOut ? 'opacity-50' : ''}`}>
                  {item.imageUrl && (
                    <img src={item.imageUrl} alt={item.name} className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-gray-900 dark:text-white">{item.name}</h3>
                      <span className="font-bold text-gray-900 dark:text-white whitespace-nowrap">{fmt(item.retailPriceCents)}</span>
                    </div>
                    {item.soldOut && (
                      <span className="inline-block mt-1 text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 rounded font-semibold">Sold Out</span>
                    )}
                    {item.allergens && item.allergens.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {item.allergens.map(a => (
                          <span key={a} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">{a}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No items found</p>
          </div>
        )}
        <div className="text-center py-4 text-xs text-gray-300 dark:text-gray-600">
          Powered by Faida POS
        </div>
      </div>
    </div>
  );
}
