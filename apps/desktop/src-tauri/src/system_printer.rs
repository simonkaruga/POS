//! Printers installed on this computer, and raw (ESC/POS) printing to them.
//!
//! A thermal printer with its normal driver appears in the operating system's printer list like any other
//! printer. Sending it the receipt bytes through the OS spooler (instead of opening the USB device or
//! showing the print dialog) lets the till print silently to whichever installed printer the owner picked.
//!
//! Windows uses the spooler API with the RAW datatype; Linux and macOS use CUPS (`lpstat` / `lp -o raw`).
//! This module has no Tauri dependency so the platform code can be tested and compiled on its own; the
//! `#[tauri::command]` wrappers live in `printer.rs`.

use serde::Serialize;

/// Upper bound for one print job. A receipt is a few KB; this only stops a runaway caller.
pub const MAX_JOB_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SystemPrinter {
    pub name: String,
    pub is_default: bool,
}

/// All printers installed on this computer, default first, then alphabetical.
pub fn list() -> Result<Vec<SystemPrinter>, String> {
    let mut printers = platform::list()?;
    printers.sort_by(|a, b| b.is_default.cmp(&a.is_default).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(printers)
}

/// Send raw bytes to the named installed printer. The name must be one the OS lists.
pub fn print_raw(printer_name: &str, data: &[u8]) -> Result<(), String> {
    if data.is_empty() {
        return Err("Nothing to print".into());
    }
    if data.len() > MAX_JOB_BYTES {
        return Err("Print job is too large".into());
    }
    let known = list()?;
    if !known.iter().any(|p| p.name == printer_name) {
        return Err(format!("Printer \"{}\" is not installed on this computer", printer_name));
    }
    platform::print_raw(printer_name, data)
}

// ─── CUPS output parsing (pure, unit-tested) ─────────────────────────────────

/// `lpstat -e` prints one destination per line.
#[cfg_attr(windows, allow(dead_code))]
pub(crate) fn parse_lpstat_destinations(out: &str) -> Vec<String> {
    out.lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_string).collect()
}

/// `lpstat -d` prints `system default destination: NAME`, or says there is none.
#[cfg_attr(windows, allow(dead_code))]
pub(crate) fn parse_lpstat_default(out: &str) -> Option<String> {
    out.lines()
        .find_map(|l| l.trim().strip_prefix("system default destination:"))
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
}

// ─── Linux / macOS (CUPS) ────────────────────────────────────────────────────

#[cfg(unix)]
mod platform {
    use super::{parse_lpstat_default, parse_lpstat_destinations, SystemPrinter};
    use std::io::Write;
    use std::process::{Command, Stdio};

    pub fn list() -> Result<Vec<SystemPrinter>, String> {
        let dests = Command::new("lpstat")
            .arg("-e")
            .output()
            .map_err(|e| format!("Cannot list printers (is CUPS installed?): {}", e))?;
        // lpstat exits non-zero with "No destinations added." when nothing is installed; that is an empty list.
        let names = parse_lpstat_destinations(&String::from_utf8_lossy(&dests.stdout));

        let default = Command::new("lpstat")
            .arg("-d")
            .output()
            .ok()
            .and_then(|o| parse_lpstat_default(&String::from_utf8_lossy(&o.stdout)));

        Ok(names
            .into_iter()
            .map(|name| SystemPrinter { is_default: default.as_deref() == Some(name.as_str()), name })
            .collect())
    }

    pub fn print_raw(printer_name: &str, data: &[u8]) -> Result<(), String> {
        // Arguments are passed individually (no shell), and the name was checked against the installed list.
        let mut child = Command::new("lp")
            .args(["-d", printer_name, "-o", "raw", "-t", "Faida POS receipt"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Cannot start the print command: {}", e))?;

        child
            .stdin
            .take()
            .ok_or_else(|| "Cannot open the print command's input".to_string())?
            .write_all(data)
            .map_err(|e| format!("Could not send the receipt to the printer: {}", e))?;

        let out = child.wait_with_output().map_err(|e| format!("Print command failed: {}", e))?;
        if out.status.success() {
            Ok(())
        } else {
            let why = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Err(if why.is_empty() { "The printer rejected the job".to_string() } else { why })
        }
    }
}

// ─── Windows (print spooler, RAW datatype) ───────────────────────────────────

#[cfg(windows)]
mod platform {
    use super::SystemPrinter;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Graphics::Printing::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, GetDefaultPrinterW, OpenPrinterW,
        StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_ENUM_CONNECTIONS,
        PRINTER_ENUM_LOCAL, PRINTER_INFO_4W,
    };

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn from_wide(p: *const u16) -> String {
        if p.is_null() {
            return String::new();
        }
        let mut len = 0;
        while *p.add(len) != 0 {
            len += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(p, len))
    }

    fn default_printer() -> Option<String> {
        unsafe {
            let mut len: u32 = 0;
            GetDefaultPrinterW(null_mut(), &mut len);
            if len == 0 {
                return None;
            }
            let mut buf = vec![0u16; len as usize];
            if GetDefaultPrinterW(buf.as_mut_ptr(), &mut len) == 0 {
                return None;
            }
            Some(from_wide(buf.as_ptr()))
        }
    }

    pub fn list() -> Result<Vec<SystemPrinter>, String> {
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let default = default_printer();
        unsafe {
            let (mut needed, mut returned) = (0u32, 0u32);
            // First call reports the buffer size; it "fails" with insufficient buffer by design.
            EnumPrintersW(flags, null(), 4, null_mut(), 0, &mut needed, &mut returned);
            if needed == 0 {
                return Ok(vec![]);
            }
            let mut buf = vec![0u8; needed as usize];
            if EnumPrintersW(flags, null(), 4, buf.as_mut_ptr(), needed, &mut needed, &mut returned) == 0 {
                return Err("Cannot list the installed printers".into());
            }
            // The buffer is only byte-aligned; read each entry unaligned.
            let base = buf.as_ptr() as *const PRINTER_INFO_4W;
            let mut out = Vec::with_capacity(returned as usize);
            for i in 0..returned as usize {
                let info = std::ptr::read_unaligned(base.add(i));
                let name = from_wide(info.pPrinterName);
                if !name.is_empty() {
                    out.push(SystemPrinter { is_default: default.as_deref() == Some(name.as_str()), name });
                }
            }
            Ok(out)
        }
    }

    pub fn print_raw(printer_name: &str, data: &[u8]) -> Result<(), String> {
        let mut name = to_wide(printer_name);
        let mut doc_name = to_wide("Faida POS receipt");
        let mut datatype = to_wide("RAW");
        unsafe {
            let mut handle: HANDLE = null_mut();
            if OpenPrinterW(name.as_mut_ptr(), &mut handle, null()) == 0 {
                return Err(format!("Cannot open printer \"{}\"", printer_name));
            }
            let doc = DOC_INFO_1W { pDocName: doc_name.as_mut_ptr(), pOutputFile: null_mut(), pDatatype: datatype.as_mut_ptr() };
            let result = if StartDocPrinterW(handle, 1, &doc) == 0 {
                Err("The printer would not accept the job".to_string())
            } else {
                let mut r = Ok(());
                if StartPagePrinter(handle) == 0 {
                    r = Err("The printer would not start the page".to_string());
                } else {
                    let mut written: u32 = 0;
                    if WritePrinter(handle, data.as_ptr() as *const _, data.len() as u32, &mut written) == 0
                        || written as usize != data.len()
                    {
                        r = Err("Could not send the whole receipt to the printer".to_string());
                    }
                    EndPagePrinter(handle);
                }
                EndDocPrinter(handle);
                r
            };
            ClosePrinter(handle);
            result
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_destinations_and_ignores_blank_lines() {
        let out = "Epson_TM_T20\n\n  Star_TSP100  \n";
        assert_eq!(parse_lpstat_destinations(out), vec!["Epson_TM_T20", "Star_TSP100"]);
        assert!(parse_lpstat_destinations("").is_empty());
    }

    #[test]
    fn parses_default_destination() {
        assert_eq!(parse_lpstat_default("system default destination: Epson_TM_T20\n"), Some("Epson_TM_T20".into()));
        assert_eq!(parse_lpstat_default("no system default destination\n"), None);
        assert_eq!(parse_lpstat_default(""), None);
    }

    #[test]
    fn rejects_empty_and_oversized_jobs() {
        assert!(print_raw("anything", &[]).is_err());
        assert!(print_raw("anything", &vec![0u8; MAX_JOB_BYTES + 1]).is_err());
    }
}
