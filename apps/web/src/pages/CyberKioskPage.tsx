import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Briefcase, Gamepad2, Globe, Monitor, Package, Pause, Printer, type LucideIcon } from 'lucide-react';

// Public fetch — no auth token needed
async function fetchKiosk(stationId: string) {
  const res = await fetch(`/api/v1/cybercafe/kiosk/${stationId}`);
  if (!res.ok) throw new Error('Station not found');
  return res.json();
}

async function postCallAttendant(stationId: string) {
  await fetch(`/api/v1/cybercafe/kiosk/${stationId}/call`, { method: 'POST' });
}

function fmtKES(cents: number) {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function pad(n: number) {
  return String(Math.floor(n)).padStart(2, '0');
}

function formatHMS(minutes: number) {
  const total = Math.max(0, minutes) * 60;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// ── Live elapsed/remaining timer ─────────────────────────────────────────────
function useLiveTimes(session: any) {
  const [elapsed, setElapsed] = useState(0);   // minutes
  const [remaining, setRemaining] = useState<number | null>(null);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!session) { setElapsed(0); setRemaining(null); return; }

    const calc = () => {
      const started = new Date(session.startedAt).getTime();
      const now = Date.now();
      const rawElapsed = (now - started) / 60000;
      const paused = session.pausedMinutes ?? 0;
      const billable = Math.max(0, rawElapsed - paused);
      setElapsed(billable);

      if (session.timeLimitMinutes) {
        const limit = session.timeLimitMinutes + (session.extendedMinutes ?? 0);
        setRemaining(Math.max(0, limit - billable));
      } else {
        setRemaining(null);
      }
    };

    calc();
    if (session.status === 'ACTIVE') {
      ref.current = setInterval(calc, 1000);
    }
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [session]);

  return { elapsed, remaining };
}

// ── Progress arc for package ──────────────────────────────────────────────────
function ProgressRing({ pct, urgent, warning }: { pct: number; urgent: boolean; warning: boolean }) {
  const r = 88;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(1, Math.max(0, pct)));
  const color = urgent ? '#ef4444' : warning ? '#f59e0b' : '#22c55e';

  return (
    <svg width="220" height="220" className="absolute inset-0 m-auto">
      <circle cx="110" cy="110" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
      <circle
        cx="110" cy="110" r={r} fill="none"
        stroke={color} strokeWidth="10"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 110 110)"
        style={{ transition: 'stroke-dashoffset 1s linear, stroke 1s' }}
      />
    </svg>
  );
}

// ── Main kiosk page ──────────────────────────────────────────────────────────
export default function CyberKioskPage() {
  const params = new URLSearchParams(window.location.search);
  const stationId = params.get('stationId') ?? '';
  const [attendantCalled, setAttendantCalled] = useState(false);
  const [callTimeout, setCallTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  const { data, isError } = useQuery({
    queryKey: ['kiosk', stationId],
    queryFn: () => fetchKiosk(stationId),
    enabled: !!stationId,
    refetchInterval: 15000,
    retry: 3,
  });

  const session = data?.session ?? null;
  const station = data?.station ?? null;
  const { elapsed, remaining } = useLiveTimes(session);

  const isPackage = !!session?.package;
  const limitMins = session?.timeLimitMinutes ? session.timeLimitMinutes + (session.extendedMinutes ?? 0) : null;
  const pct = isPackage && limitMins ? remaining! / limitMins : 0;
  const urgent = remaining !== null && remaining < 5;
  const warning = remaining !== null && remaining >= 5 && remaining < 15;

  const estCharge = session && !isPackage
    ? Math.round((elapsed / 60) * session.ratePerHourCents)
    : session?.package?.priceCents ?? 0;

  const callAttendant = () => {
    if (attendantCalled) return;
    setAttendantCalled(true);
    postCallAttendant(stationId);
    if (callTimeout) clearTimeout(callTimeout);
    setCallTimeout(setTimeout(() => setAttendantCalled(false), 15000));
  };

  // No stationId in URL
  if (!stationId) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center text-white">
          <Monitor className="w-16 h-16 mb-4 mx-auto text-gray-500" aria-hidden />
          <p className="text-xl text-gray-400">No station configured.</p>
          <p className="text-sm text-gray-600 mt-2">Add <code>?stationId=...</code> to the URL.</p>
        </div>
      </div>
    );
  }

  // Error / not found
  if (isError) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center text-white">
          <AlertTriangle className="w-16 h-16 mb-4 mx-auto text-amber-500" aria-hidden />
          <p className="text-xl text-gray-400">Station not found.</p>
        </div>
      </div>
    );
  }

  // Loading
  if (!data) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const stationName = station?.label ?? `PC ${station?.number}`;
  const typeIcon: Record<string, LucideIcon> = { GAMING: Gamepad2, BROWSING: Globe, WORKSTATION: Briefcase, PRINTING: Printer };
  const TypeIcon = typeIcon[station?.stationType ?? 'BROWSING'] ?? Monitor;

  // ── AVAILABLE screen ────────────────────────────────────────────────────────
  if (!session || station?.status === 'AVAILABLE') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex flex-col items-center justify-center select-none">
        {/* Subtle grid */}
        <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

        <div className="relative z-10 text-center px-8">
          <TypeIcon className="w-24 h-24 mb-6 mx-auto animate-bounce text-brand-300" aria-hidden />
          <div className="text-3xl font-black text-white tracking-tight mb-2">{stationName}</div>
          <div className="inline-flex items-center gap-2 bg-green-500/20 border border-green-500/40 text-green-400 text-sm font-semibold px-4 py-2 rounded-full mb-8">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            AVAILABLE
          </div>
          <p className="text-gray-500 text-lg">Ask the attendant to start your session.</p>
          <div className="mt-6 text-gray-600 text-sm">
            {station?.ratePerHourCents > 0 && (
              <span>KES {station.ratePerHourCents / 100}/hr</span>
            )}
          </div>
        </div>

        <div className="absolute bottom-8 text-gray-700 text-xs">Faida POS · Cybercafé</div>
      </div>
    );
  }

  // ── PAUSED screen ───────────────────────────────────────────────────────────
  if (session.status === 'PAUSED') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-amber-950/20 to-gray-950 flex flex-col items-center justify-center select-none">
        <div className="text-center px-8">
          <Pause className="w-16 h-16 mb-4 mx-auto text-amber-400" aria-hidden />
          <div className="text-4xl font-black text-white mb-2">{stationName}</div>
          <div className="inline-flex items-center gap-2 bg-amber-500/20 border border-amber-500/40 text-amber-400 text-sm font-bold px-4 py-2 rounded-full mb-8">
            SESSION PAUSED
          </div>
          <p className="text-gray-400 text-lg">Your session is paused.<br/>Ask the attendant to resume.</p>
        </div>
        <button
          onClick={callAttendant}
          className={`mt-12 px-10 py-4 rounded-2xl text-lg font-bold transition-all ${attendantCalled ? 'bg-green-600 text-white scale-105 animate-pulse' : 'bg-amber-500 hover:bg-amber-400 text-gray-950'}`}
        >
          {attendantCalled ? 'Attendant notified' : 'Call attendant'}
        </button>
        <div className="absolute bottom-8 text-gray-700 text-xs">Faida POS · Cybercafé</div>
      </div>
    );
  }

  // ── ACTIVE screen ───────────────────────────────────────────────────────────
  return (
    <div
      className={`min-h-screen flex flex-col items-center justify-between select-none transition-colors duration-1000 ${
        urgent
          ? 'bg-gradient-to-br from-red-950 via-gray-950 to-red-950'
          : 'bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950'
      }`}
    >
      {/* Subtle grid */}
      <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

      {/* Top bar */}
      <div className="relative z-10 w-full flex items-center justify-between px-8 pt-6">
        <div className="flex items-center gap-3">
          <TypeIcon className="w-6 h-6 text-brand-300" aria-hidden />
          <span className="text-white font-bold text-lg">{stationName}</span>
          <span className="text-xs bg-blue-500/20 border border-blue-500/30 text-blue-400 px-2 py-0.5 rounded-full font-semibold">
            {station?.stationType ?? 'BROWSING'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-green-400 text-sm font-semibold">
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          ACTIVE
        </div>
      </div>

      {/* Main display */}
      <div className="relative z-10 flex flex-col items-center justify-center flex-1 px-8 py-4">

        {/* Customer name */}
        <p className="text-gray-400 text-lg mb-6">
          Welcome, <span className="text-white font-bold">{session.customerName ?? 'Guest'}</span>
        </p>

        {/* Timer circle */}
        <div className="relative w-56 h-56 flex items-center justify-center mb-6">
          {isPackage && limitMins && (
            <ProgressRing pct={pct} urgent={urgent} warning={warning} />
          )}
          <div className="text-center z-10">
            {isPackage && remaining !== null ? (
              <>
                <div className={`font-mono text-4xl font-black tracking-tight ${urgent ? 'text-red-400' : warning ? 'text-amber-400' : 'text-white'}`}>
                  {formatHMS(remaining)}
                </div>
                <div className={`text-xs font-semibold mt-1 uppercase tracking-widest ${urgent ? 'text-red-500' : warning ? 'text-amber-500' : 'text-gray-500'}`}>
                  remaining
                </div>
              </>
            ) : (
              <>
                <div className="font-mono text-4xl font-black text-white tracking-tight">
                  {formatHMS(elapsed)}
                </div>
                <div className="text-xs font-semibold mt-1 uppercase tracking-widest text-gray-500">
                  elapsed
                </div>
              </>
            )}
          </div>
        </div>

        {/* Package name or rate */}
        {isPackage ? (
          <div className="flex items-center gap-2 bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 px-4 py-2 rounded-full text-sm font-semibold mb-4">
            <Package className="w-4 h-4" aria-hidden /> {session.package.name}
          </div>
        ) : (
          <div className="text-gray-500 text-sm mb-4">
            KES {session.ratePerHourCents / 100}/hr
          </div>
        )}

        {/* Charge display */}
        <div className="bg-white/5 border border-white/10 rounded-2xl px-8 py-5 text-center mb-4">
          <div className="text-gray-400 text-xs uppercase tracking-widest mb-1">
            {isPackage ? 'Session Cost' : 'Running Charge'}
          </div>
          <div className="text-white font-black text-5xl tracking-tight">
            {fmtKES(estCharge)}
          </div>
        </div>

        {/* Urgent warning */}
        {urgent && (
          <div className="bg-red-500/20 border border-red-500/50 text-red-400 rounded-xl px-6 py-3 text-sm font-bold animate-pulse text-center mb-2">
            Less than 5 minutes remaining. Ask the attendant to extend.
          </div>
        )}
        {warning && !urgent && (
          <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl px-6 py-3 text-sm font-semibold text-center mb-2">
            ⏱ Under 15 minutes left. Consider extending your session.
          </div>
        )}
      </div>

      {/* Bottom: call attendant */}
      <div className="relative z-10 w-full flex flex-col items-center gap-3 px-8 pb-8">
        <button
          onClick={callAttendant}
          className={`w-full max-w-xs py-4 rounded-2xl text-lg font-bold transition-all duration-300 ${
            attendantCalled
              ? 'bg-green-600 text-white scale-105'
              : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
          }`}
        >
          {attendantCalled ? 'Attendant on the way' : 'Call attendant'}
        </button>
        <p className="text-gray-700 text-xs">Faida POS · Cybercafé Management</p>
      </div>
    </div>
  );
}
