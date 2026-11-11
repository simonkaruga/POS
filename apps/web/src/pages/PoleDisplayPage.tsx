import { useEffect, useState, useRef } from 'react';

// ─── Types ───────────────────────────────────────────────────

interface CartItem {
  id: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

interface PoleDisplayState {
  businessName: string;
  items: CartItem[];
  subtotalCents: number;
  discountCents: number;
  vatCents: number;
  totalCents: number;
  status: 'idle' | 'cart' | 'payment' | 'complete';
  customerName?: string;
  changeCents?: number;
}

function formatKES(cents: number): string {
  return `KES ${(cents / 100).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ─── Idle Screen ─────────────────────────────────────────────

interface PoleConfig {
  name: string;
  idleMessage: string;
  idleLogoUrl: string | null;
}

function IdleScreen({ poleConfig }: { poleConfig: PoleConfig }) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 text-white">
      {poleConfig.idleLogoUrl && (
        <img src={poleConfig.idleLogoUrl} alt="Logo" className="h-16 w-auto mx-auto object-contain" />
      )}
      <div className="text-5xl font-black tracking-tight text-center leading-tight">
        {poleConfig.name || 'Faida POS'}
      </div>
      <div className="text-2xl font-light opacity-80">
        {poleConfig.idleMessage || 'Welcome!'}
      </div>
      <div className="text-xl font-light opacity-70">
        {time.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>
      <div className="text-lg opacity-50">
        {time.toLocaleDateString('en-KE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      </div>
    </div>
  );
}

// ─── Cart Screen ─────────────────────────────────────────────

function CartScreen({ state }: { state: PoleDisplayState }) {
  return (
    <div className="flex flex-col h-full text-white">
      {/* Header */}
      <div className="bg-white/10 px-8 py-4 border-b border-white/10">
        <div className="text-2xl font-black">{state.businessName}</div>
        {state.customerName && (
          <div className="text-sm opacity-70 mt-0.5">Customer: {state.customerName}</div>
        )}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto px-8 py-4 space-y-2">
        {state.items.length === 0 ? (
          <div className="flex items-center justify-center h-full text-white/40 text-lg">
            Scanning items…
          </div>
        ) : (
          state.items.map((item) => (
            <div key={item.id} className="flex items-center justify-between py-2 border-b border-white/10">
              <div className="flex-1 min-w-0 mr-4">
                <div className="font-semibold truncate">{item.name}</div>
                <div className="text-sm opacity-60">
                  {item.quantity} × {formatKES(item.unitPriceCents)}
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold text-lg">{formatKES(item.totalCents)}</div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Totals */}
      <div className="bg-white/10 px-8 py-5 space-y-2 border-t border-white/10">
        {state.discountCents > 0 && (
          <div className="flex justify-between text-sm opacity-70">
            <span>Discount</span>
            <span className="text-green-400">- {formatKES(state.discountCents)}</span>
          </div>
        )}
        {state.vatCents > 0 && (
          <div className="flex justify-between text-sm opacity-70">
            <span>VAT (16%)</span>
            <span>{formatKES(state.vatCents)}</span>
          </div>
        )}
        <div className="flex justify-between items-center pt-2 border-t border-white/20">
          <span className="text-2xl font-bold">TOTAL</span>
          <span className="text-4xl font-black text-yellow-400">{formatKES(state.totalCents)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Payment Screen ───────────────────────────────────────────

function PaymentScreen({ state }: { state: PoleDisplayState }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 text-white">
      <div className="text-3xl font-bold opacity-70">Processing Payment…</div>
      <div className="text-6xl font-black text-yellow-400">{formatKES(state.totalCents)}</div>
      <div className="mt-4 text-xl opacity-60">Please follow cashier instructions</div>
    </div>
  );
}

// ─── Complete Screen ──────────────────────────────────────────

function CompleteScreen({ state }: { state: PoleDisplayState }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 text-white">
      <div className="w-24 h-24 rounded-full bg-green-500 flex items-center justify-center mb-2">
        <svg className="w-14 h-14 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div className="text-4xl font-black text-green-400">PAID</div>
      <div className="text-3xl font-bold opacity-70">{formatKES(state.totalCents)}</div>
      {state.changeCents !== undefined && state.changeCents > 0 && (
        <div className="mt-4 text-center">
          <div className="text-lg opacity-60">Your change</div>
          <div className="text-4xl font-black text-yellow-400">{formatKES(state.changeCents)}</div>
        </div>
      )}
      <div className="mt-6 text-xl opacity-50">Thank you!</div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────

export default function PoleDisplayPage() {
  const [state, setState] = useState<PoleDisplayState>({
    businessName: 'Faida POS',
    items: [],
    subtotalCents: 0,
    discountCents: 0,
    vatCents: 0,
    totalCents: 0,
    status: 'idle',
  });
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [poleConfig, setPoleConfig] = useState<PoleConfig>({
    name: 'Faida POS',
    idleMessage: 'Welcome!',
    idleLogoUrl: null,
  });

  useEffect(() => {
    // Fetch business pole display config
    const bizId =
      sessionStorage.getItem('pos-business-id') || localStorage.getItem('pos-business-id');
    if (bizId) {
      fetch(`/api/v1/business/${bizId}/pole-config`)
        .then((r) => r.json())
        .then((data) => {
          if (data?.name) setPoleConfig(data as PoleConfig);
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    // Listen on the BroadcastChannel for updates from POSPage
    const channel = new BroadcastChannel('pos-pole-display');
    channelRef.current = channel;

    channel.onmessage = (event) => {
      const data = event.data as PoleDisplayState;
      setState(data);
      // Update pole config name from broadcast if provided
      if (data.businessName) {
        setPoleConfig((prev) => ({ ...prev, name: data.businessName }));
      }
    };

    return () => {
      channel.close();
    };
  }, []);

  return (
    <div
      className="w-screen h-screen overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #1e3a5f 0%, #0d1b2a 50%, #1a2a1a 100%)',
        fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      }}
    >
      {state.status === 'idle' && <IdleScreen poleConfig={poleConfig} />}
      {state.status === 'cart' && <CartScreen state={state} />}
      {state.status === 'payment' && <PaymentScreen state={state} />}
      {state.status === 'complete' && <CompleteScreen state={state} />}

      {/* Status bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-black/30 px-6 py-2 flex justify-between items-center">
        <span className="text-white/30 text-xs">Faida POS — Customer Display</span>
        <span className="text-white/30 text-xs">
          {state.items.length} item{state.items.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}
