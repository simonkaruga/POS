/// LAN server auto-discovery via UDP broadcast.
///
/// Protocol (UDP port 47480):
///   Client → broadcast  "FAIDA_DISCOVER"
///   Server → unicast    "FAIDA_SERVER:{api_port}:{hostname}"
///
/// The client broadcasts, waits 2 s, returns all responding servers.
/// The server listens permanently and replies to every valid broadcast.

use serde::{Deserialize, Serialize};
use tokio::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::time::Duration;

pub const DISCOVERY_PORT: u16 = 47480;
const DISCOVERY_MAGIC: &str = "FAIDA_DISCOVER";
const API_PORT: u16 = 3010;

/// Is the responder allowed to answer right now? Off when other computers may not connect to this server.
static ANSWERING: AtomicBool = AtomicBool::new(false);
/// Has the listening task been started? It is started once and then only switched on and off.
static STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DiscoveredServer {
    pub ip: String,
    pub port: u16,
    pub hostname: String,
    pub url: String,
}

// ─── Client: scan for servers ────────────────────────────────────────────────

/// Broadcast a discovery packet and collect all responses within 2 seconds.
/// Returns a de-duplicated list of servers found on the LAN.
#[tauri::command]
pub async fn discover_servers() -> Result<Vec<DiscoveredServer>, String> {
    let socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("bind error: {}", e))?;

    socket
        .set_broadcast(true)
        .map_err(|e| format!("broadcast enable: {}", e))?;

    let broadcast_addr = format!("255.255.255.255:{}", DISCOVERY_PORT);
    socket
        .send_to(DISCOVERY_MAGIC.as_bytes(), &broadcast_addr)
        .await
        .map_err(|e| format!("send error: {}", e))?;

    let mut servers: Vec<DiscoveredServer> = Vec::new();
    let mut buf = [0u8; 512];
    let deadline = tokio::time::sleep(Duration::from_secs(2));
    tokio::pin!(deadline);

    loop {
        tokio::select! {
            _ = &mut deadline => break,
            result = socket.recv_from(&mut buf) => {
                match result {
                    Ok((len, peer_addr)) => {
                        let msg = String::from_utf8_lossy(&buf[..len]);
                        if let Some(server) = parse_response(&msg, peer_addr.ip().to_string()) {
                            // De-duplicate by URL
                            if !servers.iter().any(|s| s.url == server.url) {
                                servers.push(server);
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        }
    }

    Ok(servers)
}

fn parse_response(msg: &str, ip: String) -> Option<DiscoveredServer> {
    // Expected: "FAIDA_SERVER:{port}:{hostname}"
    if !msg.starts_with("FAIDA_SERVER:") {
        return None;
    }
    let body = &msg["FAIDA_SERVER:".len()..];
    let mut parts = body.splitn(2, ':');
    let port: u16 = parts.next()?.parse().unwrap_or(API_PORT);
    let hostname = parts.next().unwrap_or("Faida Server").trim().to_string();
    let url = format!("http://{}:{}", ip, port);
    Some(DiscoveredServer { ip, port, hostname, url })
}

// ─── Server: respond to broadcasts ──────────────────────────────────────────

/// Spawn a background task that listens for discovery broadcasts and replies.
/// Call this once on startup when running in SERVER or STANDALONE mode.
pub fn start_discovery_responder(api_port: u16) {
    ANSWERING.store(true, Ordering::SeqCst);
    // Started once; calling again (the owner switched network access off and on) just lets it answer again.
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let my_hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "FAIDA-Server".to_string());

    tokio::spawn(async move {
        let bind_addr = format!("0.0.0.0:{}", DISCOVERY_PORT);
        let socket = match UdpSocket::bind(&bind_addr).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[Discovery] Cannot bind UDP {}: {}", DISCOVERY_PORT, e);
                return;
            }
        };
        if let Err(e) = socket.set_broadcast(true) {
            eprintln!("[Discovery] Cannot enable broadcast: {}", e);
        }

        let response = format!("FAIDA_SERVER:{}:{}", api_port, my_hostname);
        let mut buf = [0u8; 512];

        eprintln!("[Discovery] Listening on UDP {} as '{}'", DISCOVERY_PORT, my_hostname);

        loop {
            match socket.recv_from(&mut buf).await {
                Ok((len, peer)) => {
                    let msg = String::from_utf8_lossy(&buf[..len]);
                    if msg.trim() == DISCOVERY_MAGIC && ANSWERING.load(Ordering::SeqCst) {
                        eprintln!("[Discovery] Got probe from {} → replying", peer);
                        socket.send_to(response.as_bytes(), peer).await.ok();
                    }
                }
                Err(e) => {
                    eprintln!("[Discovery] recv error: {}", e);
                    break;
                }
            }
        }
    });
}

/// Stop answering discovery probes (the responder keeps listening, silently, so it can be switched back on).
pub fn stop_discovery_responder() {
    ANSWERING.store(false, Ordering::SeqCst);
}
