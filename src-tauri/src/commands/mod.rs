pub mod agent;
pub mod chat;
pub mod conversations;
pub mod fsops;
pub mod huggingface;
pub mod settings;
pub mod shell;

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
