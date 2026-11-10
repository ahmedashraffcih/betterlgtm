//! Review sessions on disk: one JSON file per pull request in the app's data folder.
//! They used to live in the webview's localStorage, which is capped at a few megabytes.

use std::fs;
use std::path::PathBuf;

use serde_json::{Map, Value, json};
use tauri::{AppHandle, Manager};

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("sessions"))
}

/// The file for a session key such as `owner/repo#12`. The key itself is stored inside the file;
/// the name only has to be safe on every platform and different for every key.
fn file_name(key: &str) -> String {
    let safe: String = key
        .chars()
        .take(80)
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_') { c } else { '_' })
        .collect();
    // FNV-1a, so `a/b#1` and `a_b#1` don't share a file.
    let hash = key.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ u64::from(b)).wrapping_mul(0x100000001b3));
    format!("{safe}-{hash:016x}.json")
}

/// Every saved session by key. Files that can't be read are skipped, so one bad file doesn't hide the rest.
#[tauri::command]
pub async fn sessions_load(app: AppHandle) -> Result<Map<String, Value>, String> {
    let mut all = Map::new();
    let entries = match fs::read_dir(dir(&app)?) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(all),
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let Ok(Value::Object(mut file)) = serde_json::from_str::<Value>(&text) else { continue };
        if let (Some(Value::String(key)), Some(session)) = (file.remove("key"), file.remove("session")) {
            all.insert(key, session);
        }
    }
    Ok(all)
}

/// Saves one session. Written to a temporary file first, so a crash mid-write keeps the old copy.
#[tauri::command]
pub async fn session_save(app: AppHandle, key: String, session: Value) -> Result<(), String> {
    let dir = dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(file_name(&key));
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string(&json!({ "key": key, "session": session })).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn session_delete(app: AppHandle, key: String) -> Result<(), String> {
    match fs::remove_file(dir(&app)?.join(file_name(&key))) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// Removes every saved session ("Clear data" in Settings).
#[tauri::command]
pub async fn sessions_clear(app: AppHandle) -> Result<(), String> {
    match fs::remove_dir_all(dir(&app)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}
