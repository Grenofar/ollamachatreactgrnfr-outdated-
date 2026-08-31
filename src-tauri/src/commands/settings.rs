use super::data_dir;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings {
    pub ollama_host: String,
    pub max_context_tokens: u64,
    pub system_prompt: String,
    pub default_model: Option<String>,
    #[serde(default = "default_codex_mode")]
    pub codex_mode: String,
    #[serde(default)]
    pub codex_last_folder: Option<String>,
    #[serde(default)]
    pub gemini_api_key: Option<String>,
    #[serde(default = "default_gemini_model")]
    pub gemini_model: String,
    #[serde(default)]
    pub remote_code: Option<String>,
    #[serde(default = "default_control_me_perception_mode")]
    pub control_me_perception_mode: String,
}

fn default_codex_mode() -> String {
    "approve".to_string()
}

fn default_gemini_model() -> String {
    "gemini-3.5-flash-lite".to_string()
}

// "capture" (screenshots via computer_use, current default) or
// "windows_ui" (Windows UI Automation only, no screenshots at all — see
// controlme.rs). Defaults to "capture": it's the only mode where Gemini's
// own require_confirmation safety signal exists at all (it's part of
// computer_use's own protocol, not something a custom tool carries), so
// switching to "windows_ui" should be an explicit opt-in, not a surprise.
fn default_control_me_perception_mode() -> String {
    "capture".to_string()
}

fn default_settings() -> Settings {
    Settings {
        ollama_host: "http://127.0.0.1:11434".to_string(),
        max_context_tokens: 8192,
        system_prompt: "Réponds toujours en français, quelle que soit la langue utilisée dans \
            la question, sauf si on te demande explicitement d'écrire ou de traduire dans une \
            autre langue."
            .to_string(),
        default_model: None,
        codex_mode: default_codex_mode(),
        codex_last_folder: None,
        gemini_api_key: None,
        gemini_model: default_gemini_model(),
        remote_code: None,
        control_me_perception_mode: default_control_me_perception_mode(),
    }
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Settings, String> {
    let path = data_dir(&app)?.join("settings.json");
    if !path.exists() {
        return Ok(default_settings());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let path = data_dir(&app)?.join("settings.json");
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}
