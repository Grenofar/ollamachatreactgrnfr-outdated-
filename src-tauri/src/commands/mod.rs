pub mod agent;
pub mod chat;
pub mod controlme;
pub mod controlme_sessions;
pub mod conversations;
pub mod fsops;
pub mod hardware;
pub mod huggingface;
pub mod settings;
pub mod shell;
pub mod watchdog;

use tauri::{AppHandle, Manager};

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
