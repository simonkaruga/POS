/**
 * The desktop setup wizard's rules, kept apart from the screens so they can be tested:
 * which steps a choice leads through, what each choice means, and what gets saved.
 *
 * Two questions, in this order:
 *   1. Where does your data live?      on this computer / network (works offline)   or   Faida Cloud (online)
 *   2. (on this computer / network) What does THIS computer do?
 *        SERVER_POS  the server AND a till (a small shop's one PC)
 *        SERVER      only the server; tills on other computers connect to it (a supermarket's back-room PC)
 *        CLIENT      only a till; connects to a server on the network
 */

export type Topology = 'CLOUD' | 'SERVER_POS' | 'SERVER' | 'CLIENT';
export type Place = 'LOCAL' | 'CLOUD';
export type DeviceRole = 'FULL_POS' | 'CASHIER' | 'KIOSK' | 'KDS' | 'MANAGER';
export type StepId = 'WELCOME' | 'LICENSE' | 'PLACE' | 'TOPOLOGY' | 'FOLDERS' | 'OWNER' | 'ROLE' | 'NETWORK' | 'DONE';

export const STEP_LABEL: Record<StepId, string> = {
  WELCOME: 'Welcome',
  LICENSE: 'Licence',
  PLACE: 'Data',
  TOPOLOGY: 'This computer',
  FOLDERS: 'Folders',
  OWNER: 'Owner account',
  ROLE: 'Device role',
  NETWORK: 'Network',
  DONE: 'Done',
};

/** The default port of the Faida API on a server computer. */
export const API_PORT = 3010;

/** Does a computer set up this way run its own database and API? (STANDALONE is the old name for SERVER_POS.) */
export const keepsOwnData = (mode: string | null | undefined): boolean => mode === 'SERVER_POS' || mode === 'SERVER' || mode === 'STANDALONE';

export const isLocalTopology = (t: Topology | null): t is 'SERVER_POS' | 'SERVER' => t === 'SERVER_POS' || t === 'SERVER';

/** The steps this choice leads through, in order. */
export function flowFor(place: Place | null, topology: Topology | null): StepId[] {
  const start: StepId[] = ['WELCOME', 'LICENSE', 'PLACE'];
  if (place === 'CLOUD' || topology === 'CLOUD') return [...start, 'NETWORK', 'DONE'];
  if (place !== 'LOCAL') return [...start, 'DONE'];
  if (isLocalTopology(topology)) return [...start, 'TOPOLOGY', 'FOLDERS', 'OWNER', 'DONE'];
  if (topology === 'CLIENT') return [...start, 'TOPOLOGY', 'ROLE', 'NETWORK', 'DONE'];
  return [...start, 'TOPOLOGY', 'DONE'];
}

export function stepAfter(flow: StepId[], current: StepId): StepId {
  const i = flow.indexOf(current);
  return flow[Math.min(flow.length - 1, i + 1)];
}

export function stepBefore(flow: StepId[], current: StepId): StepId {
  const i = flow.indexOf(current);
  return flow[Math.max(0, i - 1)];
}

/** A server for other computers is on by default; a small shop's single computer keeps its server to itself until asked. */
export const defaultLanEnabled = (t: Topology | null): boolean => t === 'SERVER';

/** Where THIS computer's own till talks to its own server. 127.0.0.1, not "localhost": Windows may resolve that to IPv6. */
export const localServerUrl = (port: number = API_PORT): string => `http://127.0.0.1:${port}`;

/**
 * Turn what a person types into a server address: add http://, the default port and drop a trailing slash.
 * "192.168.1.20" becomes "http://192.168.1.20:3010".
 */
export function normalizeServerUrl(input: string): string {
  let v = input.trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  v = v.replace(/\/+$/, '');
  const m = /^(https?:\/\/)([^/:]+)(:\d+)?(\/.*)?$/i.exec(v);
  if (m && !m[3] && m[1].toLowerCase() === 'http://') v = `${m[1]}${m[2]}:${API_PORT}${m[4] ?? ''}`;
  return v;
}

export interface SetupDraft {
  topology: Topology;
  deviceRole: DeviceRole;
  serverUrl: string;
  terminalName: string;
  businessName: string;
  dataDir: string;
  backupDir: string;
  lanEnabled: boolean;
}

export interface SetupPayload {
  /** Arguments of the Rust `set_setup_mode` command, as the webview names them. */
  invokeArgs: {
    mode: Topology;
    deviceRole: DeviceRole;
    serverUrl: string | null;
    storeId: null;
    terminalName: string | null;
    businessName: string | null;
    dataDir: string | null;
    backupDir: string | null;
    lanEnabled: boolean | null;
  };
  /** Address the app uses for its API from now on (stored as faida-server-url). */
  apiServerUrl: string;
  deviceRole: DeviceRole;
  /** True when this computer must start its own database and API. */
  startsLocalServer: boolean;
}

export function buildSetupPayload(d: SetupDraft): SetupPayload {
  const local = isLocalTopology(d.topology);
  const role: DeviceRole = local ? 'FULL_POS' : d.deviceRole;
  const remote = d.topology === 'CLIENT' || d.topology === 'CLOUD';
  return {
    invokeArgs: {
      mode: d.topology,
      deviceRole: role,
      serverUrl: remote ? normalizeServerUrl(d.serverUrl) : null,
      storeId: null,
      terminalName: d.terminalName.trim() || null,
      businessName: d.businessName.trim() || null,
      dataDir: local ? d.dataDir.trim() || null : null,
      backupDir: local ? d.backupDir.trim() || null : null,
      lanEnabled: local ? d.lanEnabled : null,
    },
    apiServerUrl: remote ? normalizeServerUrl(d.serverUrl) : localServerUrl(),
    deviceRole: role,
    startsLocalServer: local,
  };
}

/** Plain-language names for the summary and the console. */
export function topologyName(t: Topology | 'STANDALONE' | string | null): string {
  switch (t) {
    case 'CLOUD': return 'Faida Cloud (online)';
    case 'SERVER_POS':
    case 'STANDALONE': return 'This computer: server and till';
    case 'SERVER': return 'This computer: server only';
    case 'CLIENT': return 'Till connected to a server';
    default: return 'Not set up';
  }
}

/**
 * Is "Sign in with Google" offered on the login screen?
 *
 * In a browser: yes (the web app is the cloud app). In the desktop app only when the data lives in Faida Cloud. A computer that
 * keeps its own data, or a till connected to one, talks to a server on the shop network that has no Google settings and may have
 * no internet, so the button could only fail (and the Google secret must never be put on a customer's computer). While the
 * setup is still being read (`undefined`) it is hidden, so the button does not flash and vanish.
 */
export function googleSignInAvailable(inDesktopApp: boolean, setupMode: string | null | undefined): boolean {
  if (!inDesktopApp) return true;
  return setupMode === 'CLOUD';
}

// ─── The owner account, created by the wizard ───────────────────────────────────

export interface OwnerAccountInput {
  businessName: string;
  name: string;
  email: string;
  password: string;
  confirm: string;
}

/**
 * Check the owner's details before the wizard sends them, with the same password rules the server enforces (so a rejection
 * comes back as a plain sentence here, not as a failure after the database has been made). Null means fine.
 */
export function validateOwnerAccount(i: OwnerAccountInput): string | null {
  if (!i.businessName.trim()) return 'Enter the name of your business.';
  if (!i.name.trim()) return 'Enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email.trim())) return 'Enter a valid email address. You will sign in with it.';
  if (i.password.length < 8) return 'The password must be at least 8 characters.';
  if (!/[A-Z]/.test(i.password)) return 'The password must contain at least one capital letter.';
  if (!/[0-9]/.test(i.password)) return 'The password must contain at least one number.';
  if (i.password !== i.confirm) return 'The two passwords do not match.';
  return null;
}

// ─── Which server and business this computer is connected to ─────────────────────

export interface SetupSummary {
  mode: string;
  server_url?: string | null;
  business_name?: string | null;
}

/** The words for "what is this computer connected to", shown on the login screen. Null when nothing is known yet. */
export function describeConnection(cfg: SetupSummary | null | undefined): { where: string; business: string | null } | null {
  if (!cfg || !cfg.mode || cfg.mode === 'UNCONFIGURED') return null;
  const business = cfg.business_name?.trim() || null;
  switch (cfg.mode) {
    case 'SERVER_POS':
    case 'STANDALONE':
      return { where: 'This computer keeps the data and works offline', business };
    case 'SERVER':
      return { where: 'This computer is the shop server', business };
    case 'CLIENT': {
      let host = cfg.server_url ?? '';
      try { host = new URL(cfg.server_url ?? '').host; } catch { /* show it as typed */ }
      return { where: host ? `Till connected to the server at ${host}` : 'Till connected to a shop server', business };
    }
    case 'CLOUD':
      return { where: 'Faida Cloud (needs the internet)', business };
    default:
      return null;
  }
}
