use super::conversations_dir;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Serialize, Deserialize, Clone)]
pub struct StoredMessage {
    pub role: String,
    pub content: String,
    pub tokens: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub model: String,
    pub created_at: f64,
    pub messages: Vec<StoredMessage>,
}

#[derive(Serialize, Clone)]
pub struct ConversationMeta {
    pub id: String,
    pub title: String,
    pub model: String,
    pub created_at: f64,
}

#[tauri::command]
pub fn list_conversations(app: AppHandle) -> Result<Vec<ConversationMeta>, String> {
    let dir = conversations_dir(&app)?;
    let mut items = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let conv: Conversation = match serde_json::from_str(&content) {
            Ok(c) => c,
            Err(_) => continue,
        };
        items.push(ConversationMeta {
            id: conv.id,
            title: conv.title,
            model: conv.model,
            created_at: conv.created_at,
        });
    }
    items.sort_by(|a, b| b.created_at.partial_cmp(&a.created_at).unwrap());
    Ok(items)
}

#[tauri::command]
pub fn load_conversation(app: AppHandle, id: String) -> Result<Conversation, String> {
    let path = conversations_dir(&app)?.join(format!("{}.json", id));
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_conversation(app: AppHandle, conversation: Conversation) -> Result<(), String> {
    let path = conversations_dir(&app)?.join(format!("{}.json", conversation.id));
    let content = serde_json::to_string_pretty(&conversation).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_conversation(app: AppHandle, id: String) -> Result<(), String> {
    let path = conversations_dir(&app)?.join(format!("{}.json", id));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
