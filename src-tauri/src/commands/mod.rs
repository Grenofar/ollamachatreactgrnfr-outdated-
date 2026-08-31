pub mod agent;
pub mod chat;
pub mod controlme;
pub mod controlme_sessions;
pub mod conversations;
pub mod fsops;
pub mod hardware;
pub mod huggingface;
pub mod knowledge_base;
pub mod remote;
pub mod settings;
pub mod shell;
pub mod ui_automation;
pub mod watchdog;

use tauri::{AppHandle, Manager};

// Shared across the updater plugin setup (lib.rs) and the Realtime remote
// client (remote.rs) — anon key is meant to be public (Supabase's own
// design, gated by Row Level Security / Realtime's public broadcast
// channels), same one committed in site/index.html.
pub const SUPABASE_URL: &str = "https://cihuwuiyziarnghethbi.supabase.co";
pub const SUPABASE_ANON_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpaHV3dWl5emlhcm5naGV0aGJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwNjM3OTQsImV4cCI6MjEwMzYzOTc5NH0.AkAe00Vzu4506nHSjh2bl99x5hZUSejZRm3pJwVuGtI";

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
