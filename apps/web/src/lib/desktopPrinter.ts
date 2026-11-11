/**
 * Printers installed on this computer, reached through the Faida POS desktop app (Tauri).
 *
 * The browser cannot list or silently use installed printers, but the desktop shell can: it asks the
 * operating system's print spooler for the printer list and sends raw ESC/POS bytes straight to the
 * chosen queue, so no print dialog appears. Outside the desktop app every function here reports that
 * it is unavailable, and the Settings screen hides the option.
 */
import { bytesToBase64 } from '@pos/print-core';

export interface SystemPrinter {
  name: string;
  isDefault: boolean;
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function getInvoke(): Invoke | null {
  const w = window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: Invoke };
    __TAURI__?: { invoke?: Invoke };
  };
  return w.__TAURI_INTERNALS__?.invoke ?? w.__TAURI__?.invoke ?? null;
}

/** True inside the Faida POS desktop app. */
export function isDesktopApp(): boolean {
  return getInvoke() !== null;
}

function requireInvoke(): Invoke {
  const invoke = getInvoke();
  if (!invoke) throw new Error('Printing to an installed printer needs the Faida POS desktop app');
  return invoke;
}

function readableError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === 'string' && err ? err : 'The printer did not respond');
}

/** Printers installed on this computer, the default one first. */
export async function listSystemPrinters(): Promise<SystemPrinter[]> {
  try {
    const rows = await requireInvoke()<Array<{ name: string; is_default: boolean }>>('list_system_printers');
    return rows.map((r) => ({ name: r.name, isDefault: r.is_default }));
  } catch (err) {
    throw readableError(err);
  }
}

/** Send ESC/POS bytes to an installed printer by name, with no print dialog. */
export async function printRawToSystemPrinter(printerName: string, bytes: Uint8Array): Promise<void> {
  try {
    await requireInvoke()<boolean>('print_to_system_printer', {
      printerName,
      dataBase64: bytesToBase64(bytes),
    });
  } catch (err) {
    throw readableError(err);
  }
}
