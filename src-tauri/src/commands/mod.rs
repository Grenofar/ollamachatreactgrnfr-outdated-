pub mod agent;
pub mod chat;
pub mod controlme;
pub mod controlme_sessions;
pub mod conversations;
pub mod fsops;
pub mod hardware;
pub mod huggingface;
pub mod remote;
pub mod settings;
pub mod shell;
pub mod skills;
pub mod ui_automation;
pub mod watchdog;

use tauri::{AppHandle, Manager};

// Shared across the updater plugin setup (lib.rs) and the Realtime remote
// client (remote.rs) — anon key is meant to be public (Supabase's own
// design, gated by Row Level Security / Realtime's public broadcast
// channels), same one committed in site/index.html.
pub const SUPABASE_URL: &str = "https://cihuwuiyziarnghethbi.supabase.co";
pub const SUPABASE_ANON_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpaHV3dWl5emlhcm5naGV0aGJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwNjM3OTQsImV4cCI6MjEwMzYzOTc5NH0.AkAe00Vzu4506nHSjh2bl99x5hZUSejZRm3pJwVuGtI";

// Every spawned child process (PowerShell for RAM detection/Codex
// commands, explorer.exe for the knowledge base folder) inherits a
// console window by default on Windows — briefly visible even though its
// output is piped and captured, never meant to be shown to the user. This
// flag (CREATE_NO_WINDOW) suppresses that window entirely. get_system_ram_gb
// runs once at app startup, so without this it was the concrete cause of
// the console flash reported right when opening the app.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn conversations_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = data_dir(app)?.join("conversations");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn control_me_sessions_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = data_dir(app)?.join("controlme_sessions");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// Several list/load/save/delete command pairs (conversations.rs,
// controlme_sessions.rs) embed a per-item id directly into a filename
// (`{id}.json`) via `dir.join(...)`. `PathBuf::join` does not sanitize
// ".." components — an id like "../../../../whatever" would resolve
// outside the intended directory entirely, not just fail to find a file.
// Real ids are always a `crypto.randomUUID()` from the frontend, so this
// only needs to reject what one of those could never be, before it ever
// reaches a filesystem call — checked centrally here rather than
// per-caller so a future list/load/save/delete pair added the same way
// doesn't have to remember to re-derive this. skills.rs uses its own
// tighter check (fixed-length lowercase-alphanumeric ids), not this one.
pub fn safe_item_id(id: &str) -> Result<&str, String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if ok { Ok(id) } else { Err("Identifiant invalide.".to_string()) }
}
