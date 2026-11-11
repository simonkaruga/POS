use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VscuSaleData {
    pub sale_id: String,
    pub receipt_number: String,
    pub total_cents: i64,
    pub vat_cents: i64,
    pub tin: String,
    pub bhf_id: String,
    pub items: Vec<VscuItem>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VscuItem {
    pub name: String,
    pub qty: i32,
    pub price_cents: i64,
}

fn get_db_path() -> PathBuf {
    let mut path = dirs_next::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    path.push("faida-pos");
    std::fs::create_dir_all(&path).ok();
    path.push("vscu.db");
    path
}

fn open_db() -> Result<Connection, String> {
    let path = get_db_path();
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS vscu_queue (
            id TEXT PRIMARY KEY,
            sale_id TEXT NOT NULL,
            receipt_number TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'PENDING',
            attempts INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            submitted_at TEXT
        );"
    ).map_err(|e| e.to_string())?;
    Ok(conn)
}

#[tauri::command]
pub async fn vscu_get_pending_count() -> Result<u32, String> {
    let conn = open_db()?;
    let count: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM vscu_queue WHERE status='PENDING'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
pub async fn vscu_queue_submit(sale_data: String) -> Result<bool, String> {
    let data: VscuSaleData = serde_json::from_str(&sale_data)
        .map_err(|e| format!("Invalid sale data: {}", e))?;

    let conn = open_db()?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string();

    // Use sale_id as the unique queue id (INSERT OR IGNORE for idempotency)
    let id = data.sale_id.clone();

    conn.execute(
        "INSERT OR IGNORE INTO vscu_queue \
         (id, sale_id, receipt_number, payload, status, attempts, created_at) \
         VALUES (?1, ?2, ?3, ?4, 'PENDING', 0, ?5)",
        params![id, data.sale_id, data.receipt_number, sale_data, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn vscu_process_queue(
    tin: String,
    bhf_id: String,
    cmcKey: String,
) -> Result<serde_json::Value, String> {
    // Step 1: Fetch pending items from DB
    let pending: Vec<(String, String, String, String)> = {
        let conn = open_db()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, sale_id, receipt_number, payload \
                 FROM vscu_queue \
                 WHERE status='PENDING' AND attempts < 3 \
                 LIMIT 50",
            )
            .map_err(|e| e.to_string())?;

        let results: Vec<(String, String, String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        
        results
    }; // conn is dropped here

    let total = pending.len();
    let mut submitted = 0u32;
    let mut failed = 0u32;

    let kra_url = "https://etims-api-sbx.kra.go.ke/etims-api/insertSalesData";

    // Step 2: Process each item (with async operations)
    for (id, _sale_id, receipt_number, payload) in pending {
        // Increment attempt count
        {
            let conn = open_db()?;
            conn.execute(
                "UPDATE vscu_queue SET attempts = attempts + 1 WHERE id = ?1",
                params![id],
            )
            .ok();
        } // conn dropped

        // Deserialise payload
        let data: VscuSaleData = match serde_json::from_str(&payload) {
            Ok(d) => d,
            Err(_) => {
                let conn = open_db()?;
                conn.execute(
                    "UPDATE vscu_queue SET status='FAILED' WHERE id=?1",
                    params![id],
                )
                .ok();
                failed += 1;
                continue;
            }
        };

        let kra_payload = serde_json::json!({
            "tin": tin,
            "bhfId": bhf_id,
            "cisInvcNo": receipt_number,
            "taxblAmt": data.total_cents as f64 / 100.0,
            "taxAmt": data.vat_cents as f64 / 100.0,
            "totAmt": data.total_cents as f64 / 100.0,
            "itemList": data.items.iter().enumerate().map(|(i, item)| serde_json::json!({
                "itemSeq": i + 1,
                "itemNm": item.name,
                "qty": item.qty,
                "prc": item.price_cents as f64 / 100.0,
                "splyAmt": item.price_cents as f64 * item.qty as f64 / 100.0,
            })).collect::<Vec<_>>()
        });

        let success = submit_to_kra(kra_url, &cmcKey, &kra_payload)
            .await
            .unwrap_or(false);

        // Update status in DB
        {
            let conn = open_db()?;
            if success {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs()
                    .to_string();
                conn.execute(
                    "UPDATE vscu_queue SET status='SUBMITTED', submitted_at=?1 WHERE id=?2",
                    params![now, id],
                )
                .ok();
                submitted += 1;
            } else {
                conn.execute(
                    "UPDATE vscu_queue SET status='FAILED' WHERE id=?1",
                    params![id],
                )
                .ok();
                failed += 1;
            }
        } // conn dropped
    }

    Ok(serde_json::json!({
        "submitted": submitted,
        "failed": failed,
        "total": total
    }))
}

/// Submit sale data to KRA eTIMS API.
async fn submit_to_kra(
    url: &str,
    cmc_key: &str,
    payload: &serde_json::Value,
) -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(url)
        .header("cmcKey", cmc_key)
        .header("Content-Type", "application/json")
        .json(payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    Ok(resp.status().is_success())
}
