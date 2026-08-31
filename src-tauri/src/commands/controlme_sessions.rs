// Session history for Control Me — mirrors conversations.rs exactly (same
// JSON-file-per-item persistence, same list/load/save/delete shape) so
// past instructions and their transcripts survive closing the app, the
// same way base chat conversations already do.
use super::control_me_sessions_dir;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::AppHandle;

#[derive(Serialize, Deserialize, Clone)]
pub struct ControlMeSessionEntry {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ControlMeSession {
    pub id: String,
    pub title: String,
    pub created_at: f64,
    pub entries: Vec<ControlMeSessionEntry>,
}

#[derive(Serialize, Clone)]
pub struct ControlMeSessionMeta {
    pub id: String,
    pub title: String,
    pub created_at: f64,
}

fn read_all_sessions(dir: &Path) -> Result<Vec<ControlMeSession>, String> {
    let mut items = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if let Ok(session) = serde_json::from_str::<ControlMeSession>(&content) {
            items.push(session);
        }
    }
    Ok(items)
}

#[tauri::command]
pub fn list_control_me_sessions(app: AppHandle) -> Result<Vec<ControlMeSessionMeta>, String> {
    let dir = control_me_sessions_dir(&app)?;
    let mut items: Vec<ControlMeSessionMeta> = read_all_sessions(&dir)?
        .iter()
        .map(|s| ControlMeSessionMeta { id: s.id.clone(), title: s.title.clone(), created_at: s.created_at })
        .collect();
    items.sort_by(|a, b| b.created_at.partial_cmp(&a.created_at).unwrap());
    Ok(items)
}

// Searches title AND entry content (unlike list above) — same rationale as
// conversations.rs's search_conversations: titles are auto-generated from
// the first message, so a title-only search misses most of an older
// session's actual content.
#[tauri::command]
pub fn search_control_me_sessions(app: AppHandle, query: String) -> Result<Vec<ControlMeSessionMeta>, String> {
    let dir = control_me_sessions_dir(&app)?;
    let q = query.to_lowercase();
    let mut items: Vec<ControlMeSessionMeta> = read_all_sessions(&dir)?
        .iter()
        .filter(|s| {
            s.title.to_lowercase().contains(&q) || s.entries.iter().any(|e| e.content.to_lowercase().contains(&q))
        })
        .map(|s| ControlMeSessionMeta { id: s.id.clone(), title: s.title.clone(), created_at: s.created_at })
        .collect();
    items.sort_by(|a, b| b.created_at.partial_cmp(&a.created_at).unwrap());
    Ok(items)
}

#[tauri::command]
pub fn load_control_me_session(app: AppHandle, id: String) -> Result<ControlMeSession, String> {
    let path = control_me_sessions_dir(&app)?.join(format!("{}.json", id));
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_control_me_session(app: AppHandle, session: ControlMeSession) -> Result<(), String> {
    let path = control_me_sessions_dir(&app)?.join(format!("{}.json", session.id));
    let content = serde_json::to_string_pretty(&session).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_control_me_session(app: AppHandle, id: String) -> Result<(), String> {
    let path = control_me_sessions_dir(&app)?.join(format!("{}.json", id));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
