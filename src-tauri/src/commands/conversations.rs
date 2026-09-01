use super::{conversations_dir, safe_item_id};
use serde::{Deserialize, Serialize};
use std::path::Path;
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
    pub total_tokens: u64,
}

fn read_all_conversations(dir: &Path) -> Result<Vec<Conversation>, String> {
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
        if let Ok(conv) = serde_json::from_str::<Conversation>(&content) {
            items.push(conv);
        }
    }
    Ok(items)
}

fn to_meta(conv: &Conversation) -> ConversationMeta {
    ConversationMeta {
        id: conv.id.clone(),
        title: conv.title.clone(),
        model: conv.model.clone(),
        created_at: conv.created_at,
        total_tokens: conv.messages.iter().filter_map(|m| m.tokens).sum(),
    }
}

#[tauri::command]
pub fn list_conversations(app: AppHandle) -> Result<Vec<ConversationMeta>, String> {
    let dir = conversations_dir(&app)?;
    let mut items: Vec<ConversationMeta> = read_all_conversations(&dir)?.iter().map(to_meta).collect();
    items.sort_by(|a, b| b.created_at.partial_cmp(&a.created_at).unwrap());
    Ok(items)
}

// Searches title AND message content (unlike the plain list above) — titles
// are auto-generated from the first ~40 characters of the first message, so
// title-only search misses most of what's actually in an older conversation.
#[tauri::command]
pub fn search_conversations(app: AppHandle, query: String) -> Result<Vec<ConversationMeta>, String> {
    let dir = conversations_dir(&app)?;
    let q = query.to_lowercase();
    let mut items: Vec<ConversationMeta> = read_all_conversations(&dir)?
        .iter()
        .filter(|c| {
            c.title.to_lowercase().contains(&q) || c.messages.iter().any(|m| m.content.to_lowercase().contains(&q))
        })
        .map(to_meta)
        .collect();
    items.sort_by(|a, b| b.created_at.partial_cmp(&a.created_at).unwrap());
    Ok(items)
}

#[tauri::command]
pub fn load_conversation(app: AppHandle, id: String) -> Result<Conversation, String> {
    let path = conversations_dir(&app)?.join(format!("{}.json", safe_item_id(&id)?));
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_conversation(app: AppHandle, conversation: Conversation) -> Result<(), String> {
    let path = conversations_dir(&app)?.join(format!("{}.json", safe_item_id(&conversation.id)?));
    let content = serde_json::to_string_pretty(&conversation).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_conversation(app: AppHandle, id: String) -> Result<(), String> {
    let path = conversations_dir(&app)?.join(format!("{}.json", safe_item_id(&id)?));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
