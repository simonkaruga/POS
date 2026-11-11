/**
 * Desktop Installation Wizard — only shown in Tauri context on first launch.
 *
 * Two questions: where does your data live, and what does THIS computer do?
 *
 *  Cloud:                      Welcome → License → Data → Network → Done
 *  This computer (server+till)
 *  or server only:             Welcome → License → Data → This computer → Folders → Done
 *  Till (client):              Welcome → License → Data → This computer → Device role → Network → Done
 *
 * The rules (which step comes next, what is saved) live in lib/desktopSetup.ts and are unit-tested.
 *
 * Device roles (tills only):
 *   FULL_POS   — standard cashier terminal, full POS + inventory
 *   CASHIER    — sales only, no management/settings
 *   KIOSK      — customer self-service ordering (fullscreen /kiosk route)
 *   KDS        — kitchen display only (fullscreen /kds route)
 *   MANAGER    — back office, reports, settings — no POS
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ShoppingCart, Key, Server, Monitor, Wifi, CheckCircle,
  ChevronRight, ChevronLeft, AlertCircle, Loader2, RefreshCw,
  ArrowRight, Shield, Tablet, ChefHat, BarChart3, User, HardDrive, Cloud, FolderOpen, Eye, EyeOff,
} from 'lucide-react';
import {
  buildSetupPayload, validateOwnerAccount, localServerUrl, defaultLanEnabled, flowFor, isLocalTopology, normalizeServerUrl, STEP_LABEL, stepAfter, stepBefore,
  topologyName, type DeviceRole, type Place, type StepId, type Topology,
} from '../lib/desktopSetup';
import { serverDefaults, serverStart, serverStatus, validateFolders, type FolderCheck } from '../lib/desktopServer';
import { registerOwner, waitForLocalServer } from '../lib/ownerSetup';
import { setToken } from '../lib/api';
import { useAuthStore } from '../stores/auth';

// ─── Tauri invoke shim ────────────────────────────────────────────────────────

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // Tauri v2: __TAURI_INTERNALS__ holds the invoke function
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
  if (internals?.invoke) return internals.invoke<T>(cmd, args);
  // Tauri v1 fallback
  if (window.__TAURI__) return (window.__TAURI__ as { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> }).invoke<T>(cmd, args);
  // Browser dev fallback
  if (cmd === 'get_machine_id')         return Promise.resolve({ machine_id: 'dev-machine-001', hostname: 'localhost' } as T);
  if (cmd === 'get_setup_mode')         return Promise.resolve({ mode: 'UNCONFIGURED' } as T);
  if (cmd === 'set_setup_mode')         return Promise.resolve(true as T);
  if (cmd === 'reset_setup')            return Promise.resolve(true as T);
  if (cmd === 'test_server_connection') return Promise.resolve(true as T);
  if (cmd === 'discover_servers')       return Promise.resolve([] as T);
  if (cmd === 'get_cloud_url')          return Promise.resolve('https://faida-api.onrender.com' as T);
  return Promise.resolve(null as T);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiscoveredServer { ip: string; port: number; hostname: string; url: string; }

// ─── Cards ────────────────────────────────────────────────────────────────────

type Card = {
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
  details: string[];
  badge?: string;
  color: string;
};

/** Question 1: where does your data live? */
const PLACES: Array<Card & { value: Place }> = [
  {
    value: 'LOCAL',
    label: 'On this computer (works offline)',
    icon: HardDrive,
    desc: 'Your sales, stock and customers are kept on your own computer. No internet needed to sell.',
    details: [
      'Works fully offline, like desktop accounting software',
      'Automatic backups to your Documents folder',
      'Other tills in the shop can connect over your local network',
    ],
    badge: 'Offline',
    color: 'blue',
  },
  {
    value: 'CLOUD',
    label: 'Faida Cloud (online)',
    icon: Cloud,
    desc: 'Your data is kept online and is reachable from anywhere.',
    details: [
      'Owner can watch every branch remotely',
      'Needs an internet connection to sign in and sell',
      'Nothing to back up yourself',
    ],
    color: 'sky',
  },
];

/** Question 2 (data on your computers): what does THIS computer do? */
const TOPOLOGIES: Array<Card & { value: Topology }> = [
  {
    value: 'SERVER_POS',
    label: 'Server and till on this computer',
    icon: Monitor,
    desc: 'One computer does everything. The usual choice for a shop with a single counter.',
    details: [
      'Keeps the database and is also the till',
      'Add more tills later if you grow',
      'Nothing else to set up',
    ],
    badge: 'Most shops',
    color: 'blue',
  },
  {
    value: 'SERVER',
    label: 'Server only',
    icon: Server,
    desc: 'A dedicated computer that keeps the data. Tills on other computers connect to it.',
    details: [
      'For a supermarket or any shop with several tills',
      'Shows server status, backups and the address tills connect to',
      'Leave it switched on while the shop is open',
    ],
    color: 'purple',
  },
  {
    value: 'CLIENT',
    label: 'Till only',
    icon: Wifi,
    desc: 'This computer is a till. It connects to the server computer on your network.',
    details: [
      'Needs the server computer to be switched on',
      'Choose what this screen is for next: cashier, kiosk, kitchen display or back office',
      'Finds the server automatically',
    ],
    color: 'emerald',
  },
];

// ─── Device Role cards ────────────────────────────────────────────────────────

const DEVICE_ROLES: Array<{
  value: DeviceRole;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
  details: string[];
  warning?: string;
  color: string;
}> = [
  {
    value: 'FULL_POS',
    label: 'Full POS Terminal',
    icon: ShoppingCart,
    desc: 'Complete access — cashier, inventory, management.',
    details: [
      'Full POS, sales history, inventory',
      'Access to reports and settings',
      'Suitable for main cashier or manager workstation',
    ],
    color: 'blue',
  },
  {
    value: 'CASHIER',
    label: 'Cashier Only',
    icon: User,
    desc: 'Sales and payments only — management sections locked.',
    details: [
      'POS, checkout and payments',
      'No inventory or settings access',
      'Best for dedicated cashier station',
    ],
    color: 'indigo',
  },
  {
    value: 'KIOSK',
    label: 'Customer Kiosk Terminal',
    icon: Tablet,
    desc: 'This screen is primarily used for customer self-service ordering.',
    details: [
      'Normal POS login after setup',
      'Staff can launch Kiosk Mode from the POS screen',
      'Works for any business type — optional feature',
    ],
    color: 'orange',
  },
  {
    value: 'KDS',
    label: 'Kitchen Display (KDS)',
    icon: ChefHat,
    desc: 'This screen is primarily used by kitchen staff to view orders.',
    details: [
      'Normal login after setup',
      'Staff can launch KDS fullscreen from the Hospitality screen',
      'Ideal for restaurants with a dedicated kitchen monitor',
    ],
    color: 'red',
  },
  {
    value: 'MANAGER',
    label: 'Manager / Back Office',
    icon: BarChart3,
    desc: 'Reports, inventory, HR and settings — no POS.',
    details: [
      'Full access to reports, analytics',
      'Inventory, suppliers, HR management',
      'POS / checkout tabs hidden',
    ],
    color: 'purple',
  },
];

// ─── Colour helpers ───────────────────────────────────────────────────────────

const BORDER_BG: Record<string, string> = {
  sky:     'border-sky-500 bg-sky-50',
  blue:    'border-blue-500 bg-blue-50',
  purple:  'border-purple-500 bg-purple-50',
  emerald: 'border-emerald-500 bg-emerald-50',
  indigo:  'border-indigo-500 bg-indigo-50',
  orange:  'border-orange-500 bg-orange-50',
  red:     'border-red-500 bg-red-50',
};
const ICON_CLS: Record<string, string> = {
  sky:     'text-sky-600 bg-sky-100',
  blue:    'text-blue-600 bg-blue-100',
  purple:  'text-purple-600 bg-purple-100',
  emerald: 'text-emerald-600 bg-emerald-100',
  indigo:  'text-indigo-600 bg-indigo-100',
  orange:  'text-orange-600 bg-orange-100',
  red:     'text-red-600 bg-red-100',
};

// ─── Step bar ─────────────────────────────────────────────────────────────────

function StepBar({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center gap-1 px-6 py-3 bg-gray-50/80 border-b border-gray-100">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center flex-1 min-w-0">
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap ${
            i < current
              ? 'text-green-600'
              : i === current
              ? 'text-blue-600 bg-blue-50'
              : 'text-gray-400'
          }`}>
            {i < current
              ? <CheckCircle className="w-3 h-3 flex-shrink-0" />
              : <span className="w-3.5 h-3.5 rounded-full border-[1.5px] border-current flex items-center justify-center text-[9px] flex-shrink-0">{i + 1}</span>
            }
            {label}
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-px mx-1 ${i < current ? 'bg-green-300' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// Steps are named (see StepId in lib/desktopSetup.ts), and the order a choice leads through is flowFor().

// ─── Main component ───────────────────────────────────────────────────────────

export default function DesktopSetupPage() {
  const navigate = useNavigate();

  const [step,          setStep]          = useState<StepId>('WELCOME');
  const [place,         setPlace]         = useState<Place | null>(null);
  const [topology,      setTopology]      = useState<Topology | null>(null);
  const [deviceRole,    setDeviceRole]    = useState<DeviceRole>('FULL_POS');
  const [machineId,     setMachineId]     = useState('');
  const [serverUrl,     setServerUrl]     = useState('http://192.168.1.');
  const [connectStatus, setConnectStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [scanning,      setScanning]      = useState(false);
  const [discovered,    setDiscovered]    = useState<DiscoveredServer[]>([]);
  const [cloudUrl,      setCloudUrl]      = useState('https://faida-api.onrender.com');
  const [terminalName,  setTerminalName]  = useState('');
  const [businessName,  setBusinessName]  = useState('');
  const [saving,        setSaving]        = useState(false);
  // The owner's account, made by the wizard once the database exists. Optional: it can still be made on the sign-in screen.
  const [ownerName,     setOwnerName]     = useState('');
  const [ownerEmail,    setOwnerEmail]    = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [ownerConfirm,  setOwnerConfirm]  = useState('');
  const [ownerSkipped,  setOwnerSkipped]  = useState(false);
  const [ownerError,    setOwnerError]    = useState('');
  const [showOwnerPw,   setShowOwnerPw]   = useState(false);
  /** What the server is doing while the Launch button waits for it. */
  const [launchNote,    setLaunchNote]    = useState('');
  const [dataDir,       setDataDir]       = useState('');
  const [backupDir,     setBackupDir]     = useState('');
  const [lanEnabled,    setLanEnabled]    = useState(false);
  const [folderCheck,   setFolderCheck]   = useState<FolderCheck | null>(null);
  const [checking,      setChecking]      = useState(false);
  // The default folders come from the server program, whose files are unpacked the first time it is used (up to a minute on
  // Windows). So they are asked for when the folders step opens, with a visible "preparing" note, not when the wizard loads.
  const [defaultsState, setDefaultsState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [defaultsError, setDefaultsError] = useState('');

  /* The steps this choice leads through, and where we are in them */
  const flow = flowFor(place, topology);
  const visibleSteps = flow.map((id) => STEP_LABEL[id]);
  const stepBarPos = Math.max(0, flow.indexOf(step));
  const next = () => setStep(stepAfter(flow, step));
  const back = () => setStep(stepBefore(flow, step));

  useEffect(() => {
    void (async () => {
      try {
        const info = await invoke<{ machine_id: string; hostname: string }>('get_machine_id');
        setMachineId(info.machine_id);
        setTerminalName(`Terminal-${info.hostname}`);
      } catch { /* ok */ }

      try {
        const url = await invoke<string>('get_cloud_url');
        if (url) setCloudUrl(url);
      } catch { /* ok */ }

      // If already configured, redirect straight to app
      try {
        const cfg = await invoke<{ mode: string }>('get_setup_mode');
        if (cfg.mode && cfg.mode !== 'UNCONFIGURED') navigate('/');
      } catch { /* first run */ }
    })();
  }, [navigate]);

  useEffect(() => {
    if (step !== 'FOLDERS' || defaultsState !== 'idle') return;
    setDefaultsState('loading');
    serverDefaults().then(
      (d) => {
        // Only fill what the person has not already typed.
        setDataDir((v) => v || d.dataDir);
        setBackupDir((v) => v || d.backupDir);
        setDefaultsState('ready');
      },
      (e: Error) => { setDefaultsError(e.message); setDefaultsState('failed'); },
    );
  }, [step, defaultsState]);

  /* ── Handlers ─────────────────────────────────────────────────────────────── */

  /** Question 1 answered. Cloud needs no further choice about this computer; local asks what this computer does. */
  function afterPlace() {
    if (place === 'CLOUD') {
      setTopology('CLOUD');
      setServerUrl(cloudUrl);
      setStep('NETWORK');
    } else {
      if (topology === 'CLOUD') setTopology(null);
      setStep('TOPOLOGY');
    }
  }

  /** The folders must pass the same checks the server program will apply, so a bad choice is caught here, with a reason. */
  async function afterFolders() {
    setChecking(true);
    try {
      const result = await validateFolders(dataDir.trim(), backupDir.trim());
      setFolderCheck(result);
      if (result.dataDir.ok && result.backupDir.ok) setStep('OWNER');
    } catch (e) {
      toast.error('Could not check the folders: ' + String(e));
    } finally {
      setChecking(false);
    }
  }

  async function testConnection() {
    setConnectStatus('testing');
    try {
      const ok = await invoke<boolean>('test_server_connection', { serverUrl: normalizeServerUrl(serverUrl) });
      setConnectStatus(ok ? 'ok' : 'fail');
    } catch {
      setConnectStatus('fail');
    }
  }

  async function scanForServers() {
    setScanning(true); setDiscovered([]);
    try {
      const found = await invoke<DiscoveredServer[]>('discover_servers');
      setDiscovered(found);
      if (found.length === 0) toast.info('No servers found. Try entering the IP manually.');
    } catch (e) {
      toast.error('Scan failed: ' + String(e));
    } finally {
      setScanning(false);
    }
  }

  const ownerInput = { businessName, name: ownerName, email: ownerEmail, password: ownerPassword, confirm: ownerConfirm };
  /** The wizard makes the owner's account only when it was filled in correctly and not skipped. */
  const wantsOwner = isLocalTopology(topology) && !ownerSkipped && validateOwnerAccount(ownerInput) === null;

  function afterOwner() {
    const problem = validateOwnerAccount(ownerInput);
    if (problem) { setOwnerError(problem); return; }
    setOwnerError('');
    setOwnerSkipped(false);
    setStep('DONE');
  }

  function skipOwner() {
    setOwnerSkipped(true);
    setOwnerError('');
    setStep('DONE');
  }

  async function finish() {
    if (!topology) return;
    setSaving(true);
    try {
      const payload = buildSetupPayload({
        topology, deviceRole, serverUrl, terminalName, businessName, dataDir, backupDir, lanEnabled,
      });
      await invoke('set_setup_mode', payload.invokeArgs);
      localStorage.setItem('faida-server-url', payload.apiServerUrl);

      localStorage.setItem('desktop-setup-done', '1');
      if (businessName.trim()) localStorage.setItem('desktop-business-name', businessName.trim());
      else localStorage.removeItem('desktop-business-name');
      localStorage.setItem('desktop-device-role', payload.deviceRole);

      // A computer that keeps its own data starts its database and API now. This returns at once; the app shows the
      // progress ("Creating your database...") until the server is ready.
      if (payload.startsLocalServer) await serverStart();

      // Make the owner's account on the new database. This waits for the server (the first start creates the database), which
      // is why the button shows what the server is doing. Any failure falls back to the sign-in screen, where the same
      // account can be made, so a problem here never strands the shop.
      let destination = '/login';
      if (payload.startsLocalServer && wantsOwner) {
        try {
          setLaunchNote('Starting the server');
          const status = await waitForLocalServer(serverStatus, { onProgress: setLaunchNote });
          const base = localServerUrl(status.apiPort);
          // The server may have taken another port than the usual one; the app must use the one it really has.
          localStorage.setItem('faida-server-url', base);
          setLaunchNote('Creating your account');
          const { accessToken, user } = await registerOwner(base, { name: ownerName, email: ownerEmail, password: ownerPassword, businessName });
          setToken(accessToken);
          useAuthStore.setState({ user, isAuthenticated: true });
          destination = topology === 'SERVER' ? '/' : '/setup';
        } catch (e) {
          toast.error(`${(e as Error).message} You can create your account on the sign-in screen.`);
        }
      }

      // Full reload so api.ts re-resolves the API URL from localStorage.
      window.location.href = destination;
    } catch (e) {
      toast.error('Failed to save: ' + String(e));
    } finally {
      setSaving(false);
      setLaunchNote('');
    }
  }

  /* ── Render ───────────────────────────────────────────────────────────────── */

  const selectedRole = DEVICE_ROLES.find((r) => r.value === deviceRole);

  return (
    <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center p-4"
         style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, #1e3a5f 0%, #0a0f1e 70%)' }}>
      <div className="w-full max-w-[560px] bg-white rounded-2xl shadow-[0_32px_80px_rgba(0,0,0,0.5)] overflow-hidden">

        {/* Step bar — hidden on welcome */}
        {step > 'WELCOME' && step < 'DONE' && (
          <StepBar steps={visibleSteps} current={stepBarPos} />
        )}

        <div className="p-8">

          {/* ── Step 0: Welcome ──────────────────────────────────────────── */}
          {step === 'WELCOME' && (
            <div className="text-center space-y-6">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl flex items-center justify-center mx-auto shadow-lg">
                <ShoppingCart className="w-10 h-10 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Faida POS</h1>
                <p className="text-gray-500 mt-1 text-sm">Enterprise Point of Sale · Desktop Edition</p>
                <div className="mt-3 inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                  <Shield className="w-3.5 h-3.5" /> First-time installation wizard
                </div>
              </div>

              <div className="text-left space-y-2">
                {[
                  { icon: Key,         label: 'Licence',             desc: 'Starts as a free trial; activate any time' },
                  { icon: Server,      label: 'Where your data lives', desc: 'On this computer (works offline) or in the cloud' },
                  { icon: Tablet,      label: 'What this computer does', desc: 'Server and till, server only, or a till' },
                  { icon: CheckCircle, label: 'Ready to Launch',     desc: 'Start taking sales immediately' },
                ].map(({ icon: Icon, label, desc }) => (
                  <div key={label} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50">
                    <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-[18px] h-[18px] text-blue-600" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-800">{label}</div>
                      <div className="text-xs text-gray-500">{desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setStep('LICENSE')}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-[15px] flex items-center justify-center gap-2 transition-colors shadow-lg"
              >
                Begin Setup <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* ── Step 1: Licence ──────────────────────────────────────────── */}
          {step === 'LICENSE' && (
            <div className="space-y-6">
              <div>
                <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center mb-3">
                  <Key className="w-6 h-6 text-amber-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Licence</h2>
                <p className="text-gray-500 text-sm mt-1">You start with a free trial. There is nothing to enter now.</p>
              </div>

              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm text-gray-600">
                <p>When you have bought a plan, open <strong>Licence</strong> in the menu and enter your key. Faida ties it to this computer and checks it with our server once; after that it renews itself whenever the computer is online.</p>
                <p>Without the internet it keeps working. If it cannot reach us for a long time you get a warning first, and your data stays safe whatever happens.</p>
              </div>

              <div className="bg-gray-50 rounded-xl p-3 space-y-1">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">This computer's ID</div>
                <div className="flex items-center gap-2">
                  <div className="font-mono text-xs text-gray-700 break-all select-all flex-1 bg-white border border-gray-200 rounded-lg px-3 py-2">{machineId || 'Loading…'}</div>
                  <button
                    onClick={() => {
                      if (machineId) {
                        navigator.clipboard.writeText(machineId);
                        toast.success('Computer ID copied');
                      }
                    }}
                    disabled={!machineId}
                    className="flex-shrink-0 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-xs font-semibold disabled:opacity-40 transition-colors"
                  >
                    Copy
                  </button>
                </div>
                <p className="text-[10px] text-gray-400">Support may ask for this if a licence needs to be moved to another computer.</p>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep('WELCOME')} className="px-4 py-2.5 border rounded-xl text-gray-600 hover:bg-gray-50 flex items-center gap-1">
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={() => setStep('PLACE')}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl flex items-center justify-center gap-2"
                  autoFocus
                >
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Where does your data live? ───────────────────────── */}
          {step === 'PLACE' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Where will your data live?</h2>
                <p className="text-gray-500 text-sm mt-1">You can change this later, but each business keeps its data in one place at a time.</p>
              </div>

              <div className="space-y-2.5">
                {PLACES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setPlace(t.value)}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                      place === t.value ? BORDER_BG[t.color] : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/60'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${ICON_CLS[t.color]}`}>
                        <t.icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[13px] text-gray-800">{t.label}</span>
                          {t.badge && <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">{t.badge}</span>}
                          {place === t.value && <CheckCircle className="w-4 h-4 text-green-500 ml-auto" />}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{t.desc}</p>
                        {place === t.value && (
                          <ul className="mt-2 space-y-0.5">
                            {t.details.map((d) => (
                              <li key={d} className="text-[11px] text-gray-400 flex items-center gap-1.5">
                                <span className="w-1 h-1 rounded-full bg-gray-300 flex-shrink-0" />{d}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Business Name <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Premier Cafe Ltd"
                  className="w-full border-2 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
                <p className="text-xs text-gray-400 mt-1">Pre-fills the registration form when you create the business account on this device.</p>
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={back} className="px-4 py-2.5 border rounded-xl text-gray-600 hover:bg-gray-50 flex items-center gap-1">
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={afterPlace}
                  disabled={!place}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: What does THIS computer do? ──────────────────────── */}
          {step === 'TOPOLOGY' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-gray-900">What will this computer do?</h2>
                <p className="text-gray-500 text-sm mt-1">Your data stays on your own computers. Choose this computer's job.</p>
              </div>

              <div className="space-y-2.5">
                {TOPOLOGIES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => { setTopology(t.value); setLanEnabled(defaultLanEnabled(t.value)); }}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                      topology === t.value ? BORDER_BG[t.color] : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/60'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${ICON_CLS[t.color]}`}>
                        <t.icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[13px] text-gray-800">{t.label}</span>
                          {t.badge && <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">{t.badge}</span>}
                          {topology === t.value && <CheckCircle className="w-4 h-4 text-green-500 ml-auto" />}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{t.desc}</p>
                        {topology === t.value && (
                          <ul className="mt-2 space-y-0.5">
                            {t.details.map((d) => (
                              <li key={d} className="text-[11px] text-gray-400 flex items-center gap-1.5">
                                <span className="w-1 h-1 rounded-full bg-gray-300 flex-shrink-0" />{d}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={back} className="px-4 py-2.5 border rounded-xl text-gray-600 hover:bg-gray-50 flex items-center gap-1">
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={next}
                  disabled={!topology || topology === 'CLOUD'}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Folders (server computers) ───────────────────────── */}
          {step === 'FOLDERS' && isLocalTopology(topology) && (
            <div className="space-y-5">
              <div>
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-3">
                  <FolderOpen className="w-6 h-6 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Where to keep your data</h2>
                <p className="text-gray-500 text-sm mt-1">The suggested folders are right for almost everyone.</p>
              </div>

              {defaultsState === 'loading' && (
                <div role="status" className="flex items-start gap-2.5 p-3 rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-800">
                  <Loader2 className="w-4 h-4 animate-spin flex-shrink-0 mt-0.5" />
                  <span>Preparing the server files. This takes up to a minute the first time after installing.</span>
                </div>
              )}
              {defaultsState === 'failed' && (
                <div role="alert" className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 space-y-2">
                  <div className="flex items-start gap-2"><AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{defaultsError}</span></div>
                  <button onClick={() => setDefaultsState('idle')} className="font-semibold underline">Try again</button>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Database folder</label>
                <input
                  value={dataDir}
                  onChange={(e) => { setDataDir(e.target.value); setFolderCheck(null); }}
                  className={`w-full border-2 rounded-xl px-4 py-2.5 font-mono text-sm focus:ring-2 outline-none ${
                    folderCheck && !folderCheck.dataDir.ok ? 'border-red-300 focus:ring-red-400' : 'focus:ring-blue-500 focus:border-blue-500'
                  }`}
                  spellCheck={false}
                  aria-label="Database folder"
                />
                {folderCheck && !folderCheck.dataDir.ok ? (
                  <div className="flex items-start gap-2 mt-1.5 text-xs text-red-600"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{folderCheck.dataDir.reason}</div>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">Must be a folder on this computer, not on OneDrive, Dropbox, a network drive, or in Documents or Desktop (Windows often syncs those).</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Backup folder</label>
                <input
                  value={backupDir}
                  onChange={(e) => { setBackupDir(e.target.value); setFolderCheck(null); }}
                  className={`w-full border-2 rounded-xl px-4 py-2.5 font-mono text-sm focus:ring-2 outline-none ${
                    folderCheck && !folderCheck.backupDir.ok ? 'border-red-300 focus:ring-red-400' : 'focus:ring-blue-500 focus:border-blue-500'
                  }`}
                  spellCheck={false}
                  aria-label="Backup folder"
                />
                {folderCheck && !folderCheck.backupDir.ok ? (
                  <div className="flex items-start gap-2 mt-1.5 text-xs text-red-600"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{folderCheck.backupDir.reason}</div>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">A backup is saved every day and when you close the app. A USB drive or another disk is safest.</p>
                )}
              </div>

              <label className="flex items-start gap-3 p-3.5 rounded-xl border-2 border-gray-200 cursor-pointer hover:bg-gray-50/60">
                <input
                  type="checkbox"
                  checked={lanEnabled}
                  onChange={(e) => setLanEnabled(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-blue-600"
                  aria-label="Let other computers on this network connect"
                />
                <span>
                  <span className="block text-sm font-semibold text-gray-800">Let other computers on this network connect</span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    {topology === 'SERVER'
                      ? 'Needed so the tills can reach this server. Leave this on.'
                      : 'Switch on only if you will add more tills. You can change this later.'}
                  </span>
                </span>
              </label>

              <div className="flex gap-3 pt-1">
                <button onClick={back} className="px-4 py-2.5 border rounded-xl text-gray-600 hover:bg-gray-50 flex items-center gap-1">
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={() => void afterFolders()}
                  disabled={checking || defaultsState === 'loading' || defaultsState === 'failed' || !dataDir.trim() || !backupDir.trim()}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {checking ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking…</> : <>Continue <ChevronRight className="w-4 h-4" /></>}
                </button>
              </div>
            </div>
          )}

          {/* ── Owner account (this computer keeps the data) ─────────────── */}
          {step === 'OWNER' && isLocalTopology(topology) && (
            <form
              className="space-y-5"
              onSubmit={(e) => { e.preventDefault(); afterOwner(); }}
            >
              <div>
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mb-3">
                  <User className="w-6 h-6 text-green-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Create your owner account</h2>
                <p className="text-gray-500 text-sm mt-1">
                  This is the account you sign in with. It is made on {topology === 'SERVER' ? 'this server' : 'this computer'} and stays here, so it works with no internet.
                </p>
              </div>

              {ownerError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {ownerError}
                </div>
              )}

              <div className="space-y-3">
                <label className="block">
                  <span className="block text-sm font-semibold text-gray-700 mb-1">Business name</span>
                  <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Premier Cafe Ltd" autoComplete="organization"
                    className="w-full border-2 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                </label>
                <label className="block">
                  <span className="block text-sm font-semibold text-gray-700 mb-1">Your full name</span>
                  <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} autoComplete="name"
                    className="w-full border-2 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                </label>
                <label className="block">
                  <span className="block text-sm font-semibold text-gray-700 mb-1">Email (you sign in with this)</span>
                  <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} autoComplete="email"
                    className="w-full border-2 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                </label>
                <div>
                  <label htmlFor="owner-password" className="block text-sm font-semibold text-gray-700 mb-1">Password</label>
                  <div className="relative">
                    <input id="owner-password" type={showOwnerPw ? 'text' : 'password'} value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} autoComplete="new-password" aria-describedby="owner-password-hint"
                      className="w-full border-2 rounded-xl px-4 py-2.5 pr-11 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                    <button type="button" onClick={() => setShowOwnerPw((v) => !v)} aria-label={showOwnerPw ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showOwnerPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p id="owner-password-hint" className="text-xs text-gray-400 mt-1">At least 8 characters, with a capital letter and a number.</p>
                </div>
                <div>
                  <label htmlFor="owner-confirm" className="block text-sm font-semibold text-gray-700 mb-1">Confirm password</label>
                  <input id="owner-confirm" type={showOwnerPw ? 'text' : 'password'} value={ownerConfirm} onChange={(e) => setOwnerConfirm(e.target.value)} autoComplete="new-password"
                    className="w-full border-2 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={back} className="px-4 py-2.5 border rounded-xl text-gray-600 hover:bg-gray-50 flex items-center gap-1">
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button type="submit" className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl flex items-center justify-center gap-2">
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <button type="button" onClick={skipOwner} className="w-full text-xs text-gray-400 hover:text-gray-600 py-1">
                Skip: I will create my account on the sign-in screen
              </button>
            </form>
          )}

          {/* ── Step 3: Device Role (CLIENT only) ────────────────────────── */}
          {step === 'ROLE' && (
            <div className="space-y-5">
              <div>
                <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center mb-3">
                  <Tablet className="w-6 h-6 text-emerald-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Device Role</h2>
                <p className="text-gray-500 text-sm mt-1">
                  What will this terminal be used for? This controls which screens are visible and how the app launches.
                </p>
              </div>

              <div className="space-y-2">
                {DEVICE_ROLES.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setDeviceRole(r.value)}
                    className={`w-full text-left p-3.5 rounded-xl border-2 transition-all ${
                      deviceRole === r.value ? BORDER_BG[r.color] : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${ICON_CLS[r.color]}`}>
                        <r.icon className="w-4.5 h-4.5" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[13px] text-gray-800">{r.label}</span>
                          {deviceRole === r.value && <CheckCircle className="w-4 h-4 text-green-500" />}
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5">{r.desc}</p>
                        {deviceRole === r.value && r.warning && (
                          <div className="mt-1.5 flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                            <AlertCircle className="w-3 h-3 text-amber-500 flex-shrink-0 mt-0.5" />
                            <span className="text-[11px] text-amber-700">{r.warning}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={back} className="px-4 py-2.5 border rounded-xl text-gray-600 hover:bg-gray-50 flex items-center gap-1">
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={next}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl flex items-center justify-center gap-2"
                >
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Network / Server URL ─────────────────────────────── */}
          {step === 'NETWORK' && (topology === 'CLIENT' || topology === 'CLOUD') && (
            <div className="space-y-5">
              <div>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-3 ${topology === 'CLOUD' ? 'bg-sky-100' : 'bg-emerald-100'}`}>
                  {topology === 'CLOUD'
                    ? <ArrowRight className="w-6 h-6 text-sky-600" />
                    : <Wifi className="w-6 h-6 text-emerald-600" />
                  }
                </div>
                <h2 className="text-xl font-bold text-gray-900">
                  {topology === 'CLOUD' ? 'Connect to Faida Cloud' : 'Connect to LAN Server'}
                </h2>
                <p className="text-gray-500 text-sm mt-1">
                  {topology === 'CLOUD'
                    ? 'Your data is stored securely in the cloud.'
                    : 'Find the Faida Server on your network or enter its IP manually.'}
                </p>
              </div>

              {topology === 'CLOUD' && (
                <div className="bg-sky-50 border border-sky-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 text-sky-700 font-semibold text-sm mb-1">
                    <Shield className="w-4 h-4" /> Faida Cloud
                  </div>
                  <div className="font-mono text-sm text-sky-800 bg-white border border-sky-200 rounded-lg px-3 py-2">{cloudUrl}</div>
                  <p className="text-xs text-sky-600 mt-1">Official cloud server — your data is isolated and encrypted.</p>
                </div>
              )}

              {topology === 'CLIENT' && (
                <>
                  <button
                    onClick={() => void scanForServers()}
                    disabled={scanning}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {scanning
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning…</>
                      : <><RefreshCw className="w-4 h-4" /> Scan for Faida Servers</>
                    }
                  </button>

                  {discovered.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{discovered.length} server{discovered.length > 1 ? 's' : ''} found</p>
                      {discovered.map((s) => (
                        <button
                          key={s.url}
                          onClick={() => { setServerUrl(s.url); setConnectStatus('idle'); }}
                          className={`w-full text-left p-3 rounded-xl border-2 transition-all ${serverUrl === s.url ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-emerald-300'}`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-semibold text-sm">{s.hostname}</div>
                              <div className="font-mono text-xs text-gray-500">{s.url}</div>
                            </div>
                            {serverUrl === s.url && <CheckCircle className="w-4 h-4 text-emerald-500" />}
                          </div>
                        </button>
                      ))}
                      <div className="border-t border-dashed border-gray-200 pt-1" />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Server URL</label>
                    <input
                      value={serverUrl}
                      onChange={(e) => { setServerUrl(e.target.value); setConnectStatus('idle'); }}
                      placeholder="http://192.168.1.100:3010"
                      className="w-full border-2 rounded-xl px-4 py-3 font-mono text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                    />
                    <p className="text-xs text-gray-400 mt-1">Find the IP in Settings → General on the Server PC.</p>
                  </div>
                </>
              )}

              {/* Terminal name */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Terminal Name <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  value={terminalName}
                  onChange={(e) => setTerminalName(e.target.value)}
                  placeholder="e.g. Cashier-1, Kiosk-Main-Entrance"
                  className="w-full border-2 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
                <p className="text-xs text-gray-400 mt-1">Shown in the admin panel so you can identify which terminal is which.</p>
              </div>

              {/* Test connection */}
              <button
                onClick={() => void testConnection()}
                disabled={connectStatus === 'testing' || !serverUrl.trim()}
                className="w-full py-2.5 border-2 border-blue-400 text-blue-700 font-semibold rounded-xl hover:bg-blue-50 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {connectStatus === 'testing'
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Testing…</>
                  : <><CheckCircle className="w-4 h-4" /> Test Connection</>
                }
              </button>

              {connectStatus === 'ok' && (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  Connected to <span className="font-mono font-semibold ml-1">{serverUrl}</span>
                </div>
              )}
              {connectStatus === 'fail' && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  Cannot reach server. Check the IP and ensure the server is running.
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={back}
                  className="px-4 py-2.5 border rounded-xl text-gray-600 hover:bg-gray-50 flex items-center gap-1"
                >
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={next}
                  disabled={connectStatus !== 'ok'}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 5: Done ─────────────────────────────────────────────── */}
          {step === 'DONE' && (
            <div className="text-center space-y-6">
              <div className="w-20 h-20 bg-green-100 rounded-2xl flex items-center justify-center mx-auto">
                <CheckCircle className="w-12 h-12 text-green-600" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Setup Complete!</h2>
                <p className="text-gray-500 text-sm mt-2">This terminal is configured as:</p>
              </div>

              {/* Summary card */}
              <div className="text-left bg-gray-50 rounded-2xl border border-gray-200 divide-y divide-gray-200 overflow-hidden">
                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Setup</span>
                  <span className="text-sm font-semibold text-gray-800">{topologyName(topology)}</span>
                </div>
                {topology === 'CLIENT' && (
                  <div className="px-4 py-3 flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Device Role</span>
                    <span className={`text-sm font-semibold ${
                      deviceRole === 'KIOSK' ? 'text-orange-600'
                      : deviceRole === 'KDS'  ? 'text-red-600'
                      : 'text-blue-700'
                    }`}>
                      {selectedRole?.label ?? deviceRole}
                    </span>
                  </div>
                )}
                {(topology === 'CLIENT' || topology === 'CLOUD') && (
                  <div className="px-4 py-3 flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Server</span>
                    <span className="text-xs font-mono text-gray-700 truncate max-w-[260px]">{normalizeServerUrl(serverUrl)}</span>
                  </div>
                )}
                {isLocalTopology(topology) && (
                  <>
                    <div className="px-4 py-3 flex items-center justify-between gap-4">
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex-shrink-0">Database</span>
                      <span className="text-xs font-mono text-gray-700 truncate">{dataDir}</span>
                    </div>
                    <div className="px-4 py-3 flex items-center justify-between gap-4">
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex-shrink-0">Backups</span>
                      <span className="text-xs font-mono text-gray-700 truncate">{backupDir}</span>
                    </div>
                    <div className="px-4 py-3 flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Other computers</span>
                      <span className="text-sm font-semibold text-gray-800">{lanEnabled ? 'May connect' : 'Not allowed'}</span>
                    </div>
                  </>
                )}
                {businessName.trim() && (
                  <div className="px-4 py-3 flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Business</span>
                    <span className="text-sm font-semibold text-gray-800">{businessName.trim()}</span>
                  </div>
                )}
                {isLocalTopology(topology) && (
                  <div className="px-4 py-3 flex items-center justify-between gap-4">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex-shrink-0">Owner account</span>
                    <span className="text-sm font-semibold text-gray-800 truncate">{wantsOwner ? ownerEmail.trim() : 'Created on the sign-in screen'}</span>
                  </div>
                )}
                {terminalName && (
                  <div className="px-4 py-3 flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Terminal Name</span>
                    <span className="text-sm font-semibold text-gray-800">{terminalName}</span>
                  </div>
                )}
                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Licence</span>
                  <span className="text-sm font-semibold text-amber-600">Free trial (activate from the menu)</span>
                </div>
              </div>

              {(deviceRole === 'KIOSK' || deviceRole === 'KDS') && (
                <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl text-left">
                  <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-blue-700">
                    After login you'll land on the normal{' '}
                    {deviceRole === 'KIOSK' ? 'POS screen. You can launch Kiosk Mode at any time from the POS toolbar.' : 'dashboard. You can launch KDS fullscreen from the Hospitality screen.'}
                  </div>
                </div>
              )}

              <button
                onClick={() => void finish()}
                disabled={saving}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-[15px] flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-lg"
              >
                {saving
                  ? <><Loader2 className="w-5 h-5 animate-spin" /> {launchNote ? `${launchNote}…` : 'Launching…'}</>
                  : <><ArrowRight className="w-5 h-5" /> {wantsOwner ? 'Create my account and launch' : 'Launch Faida POS'}</>
                }
              </button>

              <button
                onClick={back}
                className="w-full text-xs text-gray-400 hover:text-gray-600 py-1"
              >
                ← Go back and change something
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
