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
    #[serde(default = "default_control_me_action_mode")]
    pub control_me_action_mode: String,
    // Preferred microphone (MediaDeviceInfo.deviceId). Only the paths this
    // app controls honour it — recording for Gemini transcription and the
    // level meter. The browser's own speech recognition always uses the
    // Windows default device and exposes no way to pick another.
    #[serde(default)]
    pub preferred_microphone: Option<String>,
    // Voix Gemini pour la sortie vocale. Vide = voix du systeme Windows,
    // nettement plus robotique.
    #[serde(default)]
    pub gemini_voice: Option<String>,
    // Extension ids ("codex" | "controlme") the user toggled off from the
    // Extensions view. Purely a show/hide switch — nothing is actually
    // uninstalled (everything ships in the same binary), see
    // ExtensionsView.tsx.
    #[serde(default)]
    pub disabled_extensions: Vec<String>,
    // Toggle for the "new version available" toast (App.tsx) — separate
    // from the update mechanism itself, which always keeps working
    // regardless (Réglages > Extensions still lets you check/install
    // manually). Requested explicitly: the popup itself should be
    // silenceable without disabling updates.
    #[serde(default = "default_true")]
    pub update_popup_enabled: bool,
}

fn default_true() -> bool {
    true
}

fn default_codex_mode() -> String {
    "approve".to_string()
}

fn default_gemini_model() -> String {
    "gemini-3.5-flash-lite".to_string()
}

// "capture" (screenshots via computer_use) or "windows_ui" (Windows UI
// Automation only, no screenshots at all — see controlme.rs). Defaulted to
// "capture" originally (the only mode carrying Gemini's own
// require_confirmation safety signal, part of computer_use's own
// protocol) — flipped to "windows_ui" on explicit request: faster, and no
// screenshot ever leaves the machine by default now. The toggle in
// Réglages > Extensions > Control Me still lets anyone switch back to
// "capture" (and its require_confirmation safety net) at any time — this
// only changes what a fresh install starts with.
fn default_control_me_perception_mode() -> String {
    "windows_ui".to_string()
}

// "live" (one action per Gemini turn, screen re-observed between each —
// the original, safest behavior) or "predefined" (Gemini may return
// several actions in the same turn, executed as a batch with only one
// fresh observation at the end — fewer round-trips to Gemini, the actual
// latency bottleneck, at the cost of a later action in the batch possibly
// missing its target if the screen didn't react as expected). Defaulted
// to "live": the speed/reliability trade-off is real enough that it
// should be an explicit opt-in, not something a fresh install is silently
// exposed to.
fn default_control_me_action_mode() -> String {
    "live".to_string()
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
        control_me_action_mode: default_control_me_action_mode(),
        preferred_microphone: None,
        gemini_voice: None,
        disabled_extensions: Vec::new(),
        update_popup_enabled: true,
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
