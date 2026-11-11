import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Bluetooth, CheckCircle2, Printer, RefreshCw, Usb } from 'lucide-react';
import {
  buildTestReceipt, getReceiptPrintPref, getSavedEpsonPrinter, getSavedStarPrinter,
  printErrorMessage, printReceiptVia, setReceiptPrintPref,
  type PrintMethod, type ReceiptPrintPref,
} from '../lib/receiptPrint';
import {
  getPairedBluetoothPrinter, getPairedUsbPrinter, getPaperWidth, pairBluetoothPrinter, pairUsbPrinter, setPaperWidth,
  type PairedPrinter, type PaperWidth,
} from '../lib/printer';
import { isDesktopApp, listSystemPrinters, type SystemPrinter } from '../lib/desktopPrinter';
import PrintQueuePanel from './PrintQueuePanel';
import { printDiagnostic, testCashDrawer, type TestMethod } from '../lib/printer';

interface NetworkPrinterRow {
  id: string;
  name: string;
  connectionType: string;
  connectionDetails: string;
}

interface Props {
  businessName?: string;
  /** Printer rows saved for the store (Settings -> Printers). */
  printers: NetworkPrinterRow[];
}

const SYSTEM_SILENT_OPTION: { value: PrintMethod; label: string } = {
  value: 'system',
  label: 'Installed printer, no print window: pick a printer installed on this computer (recommended)',
};

const METHOD_OPTIONS: Array<{ value: PrintMethod; label: string }> = [
  { value: 'browser', label: 'System printer: opens the print window with every installed printer' },
  { value: 'ask', label: 'Ask each time (show the picker)' },
];

// Direct modes send raw ESC/POS to one specific device and bypass the installed-printer list.
const ADVANCED_METHOD_OPTIONS: Array<{ value: PrintMethod; label: string }> = [
  { value: 'usb', label: 'USB thermal printer, direct (ESC/POS over WebUSB)' },
  { value: 'bluetooth', label: 'Bluetooth thermal printer, direct' },
  { value: 'network', label: 'LAN thermal printer (via server)' },
  { value: 'star', label: 'Star network printer (WebPRNT)' },
  { value: 'epson', label: 'Epson network printer (ePOS)' },
];

type Status = { kind: 'ok' | 'error'; text: string } | null;

export default function ReceiptPrinterSettings({ businessName, printers }: Props) {
  const [pref, setPref] = useState<ReceiptPrintPref>(getReceiptPrintPref);
  const [usb, setUsb] = useState<PairedPrinter | null>(getPairedUsbPrinter);
  const [bt, setBt] = useState<PairedPrinter | null>(getPairedBluetoothPrinter);
  const [starHost, setStarHost] = useState(() => getSavedStarPrinter()?.host ?? '');
  const [epsonHost, setEpsonHost] = useState(() => getSavedEpsonPrinter()?.host ?? '');
  const [paper, setPaper] = useState<PaperWidth | ''>(() => getPaperWidth() ?? '');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const desktop = isDesktopApp();
  const [installed, setInstalled] = useState<SystemPrinter[] | null>(null);
  const [installedError, setInstalledError] = useState('');

  const lanPrinters = printers.filter((p) => p.connectionType === 'NETWORK');

  function update(patch: Partial<ReceiptPrintPref>) {
    setPref((prev) => {
      const next = { ...prev, ...patch };
      setReceiptPrintPref(next);
      return next;
    });
  }

  const loadInstalled = useCallback(async () => {
    setInstalledError('');
    try {
      const list = await listSystemPrinters();
      setInstalled(list);
      // First use: preselect the computer's default printer so one click is enough.
      setPref((prev) => {
        if (prev.systemPrinterName || list.length === 0) return prev;
        const next = { ...prev, systemPrinterName: (list.find((p) => p.isDefault) ?? list[0]).name };
        setReceiptPrintPref(next);
        return next;
      });
    } catch (err) {
      setInstalled([]);
      setInstalledError(printErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (pref.method === 'system' && installed === null) void loadInstalled();
  }, [pref.method, installed, loadInstalled]);

  function chooseMethod(method: PrintMethod) {
    setStatus(null);
    // Picking a dedicated printer (silent system, USB, LAN, ...) means "use it for every sale"; the switch
    // below can still turn that off. The print-window modes never switch it on by themselves.
    const dedicated = method !== 'ask' && method !== 'browser';
    const wasWindowMode = pref.method === 'ask' || pref.method === 'browser';
    update({ method, autoPrint: method === 'ask' ? false : dedicated && wasWindowMode ? true : pref.autoPrint });
  }

  /** Where the saved choices point, for the self-test buttons. */
  function testTarget() {
    return { networkPrinterId: pref.networkPrinterId, systemPrinterName: pref.systemPrinterName, star: getSavedStarPrinter(), epson: getSavedEpsonPrinter() };
  }

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setStatus(null);
    try {
      await action();
      setStatus({ kind: 'ok', text: success });
    } catch (err) {
      setStatus({ kind: 'error', text: printErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  function saveHost(key: 'star-printer' | 'epson-printer', host: string) {
    try { localStorage.setItem(key, JSON.stringify({ host: host.trim() })); } catch { /* storage unavailable */ }
    setStatus({ kind: 'ok', text: 'Address saved on this device.' });
  }

  const canTest = pref.method !== 'ask' && (pref.method !== 'system' || !!pref.systemPrinterName);

  return (
    <div className="bg-white rounded-xl shadow p-4 sm:p-5">
      <div className="flex items-start gap-3 mb-4">
        <Printer className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
        <div>
          <h3 className="font-semibold text-gray-800">Receipt printing (this device)</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Choose the printer once. Every sale then prints to it with no pop-up. Each till and phone keeps its own choice,
            because the printer is physically attached to that device.
          </p>
        </div>
      </div>

      <label htmlFor="receipt-printer-method" className="block text-sm font-medium text-gray-700 mb-1">Receipt printer</label>
      <select
        id="receipt-printer-method"
        value={pref.method}
        onChange={(e) => chooseMethod(e.target.value as PrintMethod)}
        className="w-full min-h-[44px] px-3 py-2.5 border border-gray-300 rounded-lg text-sm mb-3 bg-white"
      >
        {(desktop ? [SYSTEM_SILENT_OPTION, ...METHOD_OPTIONS] : METHOD_OPTIONS).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
        <optgroup label="Advanced: direct thermal printing">
          {ADVANCED_METHOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </optgroup>
      </select>

      {pref.method === 'browser' && (
        <p className="text-sm text-gray-600 bg-blue-50 border border-blue-100 rounded-lg p-3 mb-3">
          The browser print window lists every printer installed on this computer. Pick your thermal printer there; it
          remembers your last choice. Install the printer's driver as usual and set the paper size below. To print with no
          window at all, use the Faida POS desktop app, or make the thermal printer the computer's default printer
          and start Chrome or Edge with
          <code className="mx-1 px-1 bg-white rounded border border-blue-100">--kiosk-printing</code>.
        </p>
      )}

      {pref.method === 'system' && (
        <div className="mb-3">
          <label htmlFor="receipt-printer-installed" className="block text-sm font-medium text-gray-700 mb-1">
            Installed printer
          </label>
          <div className="flex gap-2">
            <select
              id="receipt-printer-installed"
              value={pref.systemPrinterName ?? ''}
              onChange={(e) => update({ systemPrinterName: e.target.value || undefined })}
              disabled={installed === null || installed.length === 0}
              className="flex-1 min-w-0 min-h-[44px] px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white disabled:opacity-60"
            >
              <option value="">{installed === null ? 'Loading printers...' : 'Select a printer'}</option>
              {(installed ?? []).map((p) => (
                <option key={p.name} value={p.name}>{p.name}{p.isDefault ? ' (default)' : ''}</option>
              ))}
              {pref.systemPrinterName && !(installed ?? []).some((p) => p.name === pref.systemPrinterName) && installed !== null && (
                <option value={pref.systemPrinterName}>{pref.systemPrinterName} (not found)</option>
              )}
            </select>
            <button
              type="button"
              onClick={() => { setInstalled(null); void loadInstalled(); }}
              aria-label="Refresh the printer list"
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          {installedError && <p className="text-sm text-red-700 mt-1">{installedError}</p>}
          {installed !== null && installed.length === 0 && !installedError && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mt-2">
              No printers are installed on this computer yet. Install the thermal printer's driver in the operating
              system, then press refresh.
            </p>
          )}
          <p className="text-xs text-gray-400 mt-1">
            Receipts go straight to this printer as ESC/POS with no print window. Use a thermal receipt printer; a
            laser or inkjet printer would print the raw commands as text.
          </p>
        </div>
      )}

      {pref.method === 'usb' && (
        <PairRow
          icon={<Usb className="w-5 h-5 text-green-600" />}
          paired={usb}
          busy={busy}
          hint="Plug the printer into this device, then pair it. The browser asks once and remembers it."
          onPair={() => run(async () => { setUsb(await pairUsbPrinter()); }, 'USB printer paired.')}
        />
      )}

      {pref.method === 'bluetooth' && (
        <PairRow
          icon={<Bluetooth className="w-5 h-5 text-purple-600" />}
          paired={bt}
          busy={busy}
          hint="Switch the printer on and pair it from here. Pair again if the browser forgets it after a restart."
          onPair={() => run(async () => { setBt(await pairBluetoothPrinter()); }, 'Bluetooth printer paired.')}
        />
      )}

      {pref.method === 'network' && (
        <div className="mb-3">
          <label htmlFor="receipt-printer-lan" className="block text-sm font-medium text-gray-700 mb-1">LAN printer</label>
          {lanPrinters.length === 0 ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              No LAN printer is saved yet. Add one below with connection type NETWORK and its address, for example 192.168.1.50:9100.
              The server must be on the same network as the printer.
            </p>
          ) : (
            <select
              id="receipt-printer-lan"
              value={pref.networkPrinterId ?? ''}
              onChange={(e) => update({ networkPrinterId: e.target.value || undefined })}
              className="w-full min-h-[44px] px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white"
            >
              <option value="">Select a printer</option>
              {lanPrinters.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.connectionDetails})</option>)}
            </select>
          )}
        </div>
      )}

      {(pref.method === 'star' || pref.method === 'epson') && (
        <div className="mb-3">
          <label htmlFor="receipt-printer-host" className="block text-sm font-medium text-gray-700 mb-1">
            {pref.method === 'star' ? 'Star printer address' : 'Epson printer address'}
          </label>
          <div className="flex gap-2">
            <input
              id="receipt-printer-host"
              value={pref.method === 'star' ? starHost : epsonHost}
              onChange={(e) => (pref.method === 'star' ? setStarHost : setEpsonHost)(e.target.value)}
              placeholder="192.168.1.60"
              inputMode="decimal"
              className="flex-1 min-w-0 min-h-[44px] px-3 py-2.5 border border-gray-300 rounded-lg text-sm"
            />
            <button
              type="button"
              onClick={() => saveHost(pref.method === 'star' ? 'star-printer' : 'epson-printer', pref.method === 'star' ? starHost : epsonHost)}
              disabled={!(pref.method === 'star' ? starHost : epsonHost).trim()}
              className="min-h-[44px] px-4 rounded-lg bg-gray-800 text-white text-sm font-medium disabled:opacity-50"
            >
              Save
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            This browser talks to the printer directly, so the app must be opened over http on the same network
            (browsers block a secure page from calling a plain-http printer).
          </p>
        </div>
      )}

      {pref.method !== 'ask' && (
        <div className="mb-3">
          <label htmlFor="receipt-paper-width" className="block text-sm font-medium text-gray-700 mb-1">Paper size</label>
          <select
            id="receipt-paper-width"
            value={paper}
            onChange={(e) => {
              const w = Number(e.target.value) as PaperWidth;
              setPaperWidth(w);
              setPaper(w);
            }}
            className="w-full min-h-[44px] px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white"
          >
            <option value="" disabled>Choose the paper roll width</option>
            <option value={58}>58 mm: small Bluetooth printers</option>
            <option value={80}>80 mm: standard thermal printers</option>
          </select>
          <p className="text-xs text-gray-400 mt-1">
            Receipts are laid out to fit the roll, so 58 mm paper is not cut off and 80 mm paper is not left half empty.
            If you leave this unset, receipts printed through the print window use 80 mm and thermal (ESC/POS) receipts use 58 mm.
          </p>
        </div>
      )}

      <label
        className={`flex items-center justify-between gap-3 p-3 min-h-[44px] rounded-lg border ${
          pref.method === 'ask' ? 'border-gray-100 bg-gray-50 opacity-60' : 'border-gray-200'
        }`}
      >
        <div>
          <p className="text-sm font-medium text-gray-800">Print automatically after each sale</p>
          <p className="text-xs text-gray-500">No confirmation pop-up. If the printer cannot be reached, the picker opens instead.</p>
        </div>
        <input
          type="checkbox"
          checked={pref.autoPrint && pref.method !== 'ask'}
          disabled={pref.method === 'ask'}
          onChange={(e) => update({ autoPrint: e.target.checked })}
          className="w-5 h-5 accent-blue-600 shrink-0"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!canTest || busy}
          onClick={() =>
            run(
              () => printReceiptVia(pref.method as Exclude<PrintMethod, 'ask'>, buildTestReceipt(businessName), false, pref),
              'Test receipt sent to the printer.',
            )
          }
          className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <Printer className="w-4 h-4" />
          {busy ? 'Working...' : 'Print test receipt'}
        </button>
        <button
          type="button"
          disabled={!canTest || busy}
          onClick={() =>
            run(
              () => printDiagnostic(pref.method as TestMethod, testTarget()),
              'Test page sent. Check each numbered section on the paper.',
            )
          }
          className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <Printer className="w-4 h-4" />
          Print full test page
        </button>
        <button
          type="button"
          disabled={!canTest || busy || pref.method === 'browser' || pref.method === 'star' || pref.method === 'epson'}
          onClick={() => run(() => testCashDrawer(pref.method as TestMethod, testTarget()), 'Drawer pulse sent. The drawer should have opened.')}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Test cash drawer
        </button>
        {status && (
          <p
            role="status"
            className={`inline-flex items-start gap-1.5 text-sm ${status.kind === 'ok' ? 'text-green-700' : 'text-red-700'}`}
          >
            {status.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
            <span>{status.text}</span>
          </p>
        )}
      </div>
      <PrintQueuePanel />
    </div>
  );
}

function PairRow({
  icon, paired, busy, hint, onPair,
}: {
  icon: React.ReactNode;
  paired: PairedPrinter | null;
  busy: boolean;
  hint: string;
  onPair: () => void;
}) {
  return (
    <div className="mb-3 p-3 rounded-lg border border-gray-200 bg-gray-50">
      <div className="flex items-center gap-3">
        {icon}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{paired ? paired.name : 'No printer paired yet'}</p>
          <p className="text-xs text-gray-500">{hint}</p>
        </div>
        <button
          type="button"
          onClick={onPair}
          disabled={busy}
          className="min-h-[44px] px-4 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 shrink-0"
        >
          {paired ? 'Change' : 'Pair'}
        </button>
      </div>
    </div>
  );
}
