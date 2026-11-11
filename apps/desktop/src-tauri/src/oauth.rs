//! Desktop Google sign-in: open the consent page in the system browser and catch the
//! redirect on a one-shot loopback listener. Google blocks embedded webviews and does
//! not allow `http://tauri.localhost` as an origin, so the popup flow used on the web
//! cannot work here.

use serde::Serialize;
use std::collections::HashMap;
use std::process::Command;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const AUTH_URL_PREFIX: &str = "https://accounts.google.com/";
const REDIRECT_PLACEHOLDER: &str = "__REDIRECT_URI__";
const WAIT_SECONDS: u64 = 180;

#[derive(Serialize)]
pub struct OAuthResult {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
    /// Exact redirect URI used, needed again for the code exchange
    pub redirect_uri: String,
}

const DONE_PAGE: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Faida POS</title></head>\
<body style=\"font-family:sans-serif;text-align:center;padding-top:15vh;color:#1f2937\">\
<h2>Sign-in complete</h2><p>You can close this tab and return to Faida POS.</p></body></html>";

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                match std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(b) => {
                        out.push(b);
                        i += 2;
                    }
                    None => out.push(b'%'),
                }
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn percent_encode(input: &str) -> String {
    let mut out = String::new();
    for b in input.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

fn open_in_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let result = Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(url).spawn();
    result.map(|_| ()).map_err(|e| format!("Could not open the browser: {}", e))
}

/// Reads one HTTP request and returns the query parameters of a `GET /?...` request.
/// Returns None for anything else (favicon, preflight, stray connections).
async fn read_callback(stream: &mut tokio::net::TcpStream) -> Option<HashMap<String, String>> {
    let mut buf = vec![0u8; 8192];
    let n = stream.read(&mut buf).await.ok()?;
    let request = String::from_utf8_lossy(&buf[..n]);
    let target = request.lines().next()?.strip_prefix("GET ")?.split(' ').next()?.to_string();
    let query = target.strip_prefix("/?")?;
    let params: HashMap<String, String> = query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(k, v)| (percent_decode(k), percent_decode(v)))
        .collect();
    if params.contains_key("code") || params.contains_key("error") {
        Some(params)
    } else {
        None
    }
}

/// `auth_url` must be a Google consent URL containing `__REDIRECT_URI__` where the
/// (percent-encoded) loopback redirect belongs. Resolves once Google redirects back.
#[tauri::command]
pub async fn oauth_browser_login(auth_url: String) -> Result<OAuthResult, String> {
    if !auth_url.starts_with(AUTH_URL_PREFIX) || !auth_url.contains(REDIRECT_PLACEHOLDER) {
        return Err("Invalid sign-in URL".to_string());
    }

    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{}", port);

    open_in_browser(&auth_url.replace(REDIRECT_PLACEHOLDER, &percent_encode(&redirect_uri)))?;

    let wait = async {
        loop {
            let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
            let params = read_callback(&mut stream).await;
            let (status, body) = if params.is_some() { ("200 OK", DONE_PAGE) } else { ("404 Not Found", "") };
            let response = format!(
                "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                status,
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.shutdown().await;
            if let Some(params) = params {
                return Ok::<_, String>(params);
            }
        }
    };

    let params = tokio::time::timeout(Duration::from_secs(WAIT_SECONDS), wait)
        .await
        .map_err(|_| "Sign-in timed out. Please try again.".to_string())??;

    Ok(OAuthResult {
        code: params.get("code").cloned(),
        state: params.get("state").cloned(),
        error: params.get("error").cloned(),
        redirect_uri,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_sequences() {
        assert_eq!(percent_decode("4%2F0Abc-d_e"), "4/0Abc-d_e");
        assert_eq!(percent_decode("a+b%20c"), "a b c");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn encodes_redirect_uri() {
        assert_eq!(percent_encode("http://127.0.0.1:5000"), "http%3A%2F%2F127.0.0.1%3A5000");
    }
}
