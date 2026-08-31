// Uses Google's Interactions API (v1beta/interactions) with the built-in
// "computer_use" tool rather than hand-rolled function declarations against
// the classic generateContent endpoint — this is Google's own purpose-built
// primitive for exactly this use case (desktop mouse/keyboard control from
// screenshots), released alongside Gemini 3.7 Flash. It gives us: a
// well-defined action set, normalized 0-999 coordinates (denormalized below
// against the actual screen size), server-side conversation state via
// `previous_interaction_id` (no need to resend history/screenshots), and a
// built-in `safety_decision: require_confirmation` signal for sensitive
// categories (financial transactions, account creation, etc.) that we
// respect even though the user chose fully-autonomous mode — that flag is
// the model's own judgment call, not a general per-action approval gate.
use super::data_dir;
use super::ui_automation::read_foreground_ui_elements;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings as EnigoSettings};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;
use xcap::Monitor;

pub struct ControlMeCancelFlag(pub Arc<AtomicBool>);

// Holds the sender half of a one-shot channel while a require_confirmation
// pause is in effect — resolve_control_me_confirmation takes it and sends
// the user's answer, unblocking run_control_me's await without ending the
// command (unlike the original "just emit and return" behavior).
pub struct ControlMeConfirmation(pub Arc<Mutex<Option<oneshot::Sender<bool>>>>);

#[derive(Serialize, Deserialize, Clone)]
pub struct MemoryEntry {
    pub fact: String,
    pub category: Option<String>,
    pub created_at: f64,
}

const MAX_CONTROL_ME_ITERATIONS: u32 = 40;
// Fallback only (used if the frontend somehow sends an empty model string)
// — the real default lives in settings.rs's default_gemini_model().
const GEMINI_MODEL: &str = "gemini-3.5-flash-lite";
const GEMINI_ENDPOINT: &str = "https://generativelanguage.googleapis.com/v1beta/interactions";
const CANCELLED_MESSAGE: &str = "Annulé par l'utilisateur.";
// Normalized 0-999 coordinates map to a fraction of the screenshot
// regardless of its pixel resolution, so downscaling before encoding
// doesn't hurt click accuracy but meaningfully cuts encoding time, upload
// size, and Gemini's per-step vision latency — this was the main source of
// the per-step slowness reported after the first version.
const SCREENSHOT_MAX_WIDTH: u32 = 1280;
const SCREENSHOT_JPEG_QUALITY: u8 = 80;

// Adaptive settle wait (replaces a fixed post-action delay, see
// wait_for_settle below): starting values, not visually tuned (no GUI
// access in this environment) — adjust if real usage shows either the
// poll interval or the diff threshold needs work.
const SETTLE_POLL_INTERVAL_MS: u64 = 40;
const SETTLE_MAX_WAIT_MS: u64 = 900;
const SETTLE_STABLE_CHECKS: u32 = 2;
const SETTLE_THUMB_WIDTH: u32 = 64;
// Mean absolute per-pixel difference (0-255 scale) below which two
// grayscale thumbnails count as "the same frame".
const SETTLE_DIFF_THRESHOLD: f64 = 3.0;

// Same polling pattern as agent.rs's wait_for_cancel: the only await points
// here (the Gemini HTTP call) are short-lived enough that ~60ms of added
// cancel latency is imperceptible, and it avoids a lost-wakeup race.
async fn wait_for_cancel(flag: Arc<AtomicBool>) {
    loop {
        if flag.load(Ordering::SeqCst) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(60)).await;
    }
}

// Cheap capture for settle-comparison only — a tiny grayscale downscale,
// nowhere near the quality/size needed for the real screenshot sent to
// Gemini (capture_screenshot_base64 handles that once the screen has
// settled).
fn capture_grayscale_thumb() -> Result<Vec<u8>, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or_else(|| "Aucun écran détecté".to_string())?;
    let image = monitor.capture_image().map_err(|e| e.to_string())?;
    let width = image.width();
    let scaled_height = if width > SETTLE_THUMB_WIDTH {
        (((image.height() as f64) * (SETTLE_THUMB_WIDTH as f64) / (width as f64)).round() as u32).max(1)
    } else {
        image.height()
    };
    let resized = xcap::image::imageops::resize(
        &image,
        SETTLE_THUMB_WIDTH.min(width),
        scaled_height,
        xcap::image::imageops::FilterType::Nearest,
    );
    Ok(xcap::image::DynamicImage::ImageRgba8(resized).to_luma8().into_raw())
}

fn thumbs_differ(a: &[u8], b: &[u8]) -> bool {
    if a.is_empty() || a.len() != b.len() {
        return true;
    }
    let sum: u64 = a
        .iter()
        .zip(b.iter())
        .map(|(x, y)| (*x as i32 - *y as i32).unsigned_abs() as u64)
        .sum();
    (sum as f64 / a.len() as f64) > SETTLE_DIFF_THRESHOLD
}

// Replaces a fixed post-action delay: polls a cheap thumbnail every
// SETTLE_POLL_INTERVAL_MS and returns as soon as the screen has stopped
// visibly changing (two consecutive stable thumbnails) or SETTLE_MAX_WAIT_MS
// is reached — faster than a fixed wait once the UI has already reacted,
// more reliable than one when it's still animating/loading. Also returns
// promptly on cancellation (checked every poll) so Stop stays responsive
// during what would otherwise be up to ~900ms of waiting.
async fn wait_for_settle(flag: Arc<AtomicBool>) {
    let start = std::time::Instant::now();
    let mut previous: Option<Vec<u8>> = None;
    let mut stable_count: u32 = 0;
    loop {
        if flag.load(Ordering::SeqCst) || start.elapsed() >= Duration::from_millis(SETTLE_MAX_WAIT_MS) {
            return;
        }
        match capture_grayscale_thumb() {
            Ok(thumb) => {
                if let Some(prev) = &previous {
                    if thumbs_differ(prev, &thumb) {
                        stable_count = 0;
                    } else {
                        stable_count += 1;
                        if stable_count >= SETTLE_STABLE_CHECKS {
                            return;
                        }
                    }
                }
                previous = Some(thumb);
            }
            // Capture failed — bail rather than loop forever; the real
            // capture right after this call will surface the actual error.
            Err(_) => return,
        }
        tokio::time::sleep(Duration::from_millis(SETTLE_POLL_INTERVAL_MS)).await;
    }
}

#[derive(Serialize, Clone)]
struct StepPayload {
    intent: Option<String>,
    action: String,
    label: String,
}

fn memory_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(data_dir(app)?.join("controlme_memory.json"))
}

fn load_memory(app: &AppHandle) -> Result<Vec<MemoryEntry>, String> {
    let path = memory_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn save_memory(app: &AppHandle, entries: &[MemoryEntry]) -> Result<(), String> {
    let path = memory_path(app)?;
    let content = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

fn now_unix_secs() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

// Dispatches one function call to its handler and returns (transcript_label,
// result_text, error_text) — shared by both the direct-execution path and
// the require_confirmation path below, so the "emit step, screenshot, build
// the next request body" tail of the loop only has to exist once.
//
// transcript_label and result_text are the same short string for every
// action except read_ui_elements: that one needs a short label for the
// transcript ("Lecture de l'interface (N éléments)") but the full element
// dump as the text actually sent back to Gemini.
fn dispatch_action(app: &AppHandle, name: &str, args: &Value, width: u32, height: u32) -> (String, String, Option<String>) {
    if name == "remember_fact" {
        let fact = args["fact"].as_str().unwrap_or("").trim().to_string();
        let category = args["category"].as_str().map(|s| s.to_string());
        if fact.is_empty() {
            let msg = "Aucun fait fourni.".to_string();
            return (msg.clone(), msg.clone(), Some(msg));
        }
        return match load_memory(app) {
            Ok(mut entries) => {
                entries.push(MemoryEntry { fact: fact.clone(), category, created_at: now_unix_secs() });
                match save_memory(app, &entries) {
                    Ok(()) => {
                        let msg = format!("Fait enregistré : {fact}");
                        (msg.clone(), msg, None)
                    }
                    Err(e) => {
                        let msg = format!("Erreur : {e}");
                        (msg.clone(), msg, Some(e))
                    }
                }
            }
            Err(e) => {
                let msg = format!("Erreur : {e}");
                (msg.clone(), msg, Some(e))
            }
        };
    }
    if name == "take_screenshot" {
        let msg = "Capture d'écran".to_string();
        return (msg.clone(), msg, None);
    }
    if name == "read_ui_elements" {
        return match read_foreground_ui_elements(width, height) {
            Ok(text) => {
                let count = text.lines().count().saturating_sub(1);
                (format!("Lecture de l'interface ({count} éléments)"), text, None)
            }
            Err(e) => {
                let msg = format!("Erreur : {e}");
                (msg.clone(), msg, Some(e))
            }
        };
    }
    match execute_action(name, args, width, height) {
        Ok(l) => (l.clone(), l, None),
        Err(e) => {
            let msg = format!("Erreur : {e}");
            (msg.clone(), msg, Some(e))
        }
    }
}

// Returns (base64 JPEG, real screen width, real screen height). The real
// dimensions (not the downscaled ones) are what denormalize() uses, since a
// 0-999 coordinate is the same fraction of the screen either way.
pub(crate) fn capture_screenshot_base64() -> Result<(String, u32, u32), String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or_else(|| "Aucun écran détecté".to_string())?;
    let image = monitor.capture_image().map_err(|e| e.to_string())?;
    let (width, height) = (image.width(), image.height());

    let resized = if width > SCREENSHOT_MAX_WIDTH {
        let scaled_height = ((height as f64) * (SCREENSHOT_MAX_WIDTH as f64) / (width as f64)).round() as u32;
        xcap::image::imageops::resize(&image, SCREENSHOT_MAX_WIDTH, scaled_height, xcap::image::imageops::FilterType::Triangle)
    } else {
        image
    };
    // JPEG has no alpha channel; screenshots are always opaque anyway.
    let rgb = xcap::image::DynamicImage::ImageRgba8(resized).to_rgb8();

    let mut jpeg_bytes: Vec<u8> = Vec::new();
    xcap::image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_bytes, SCREENSHOT_JPEG_QUALITY)
        .encode(rgb.as_raw(), rgb.width(), rgb.height(), xcap::image::ExtendedColorType::Rgb8)
        .map_err(|e| e.to_string())?;

    Ok((STANDARD.encode(&jpeg_bytes), width, height))
}

fn denormalize(coord: f64, dimension: u32) -> i32 {
    ((coord / 999.0) * dimension as f64).round() as i32
}

fn key_from_name(name: &str) -> Key {
    match name.to_lowercase().as_str() {
        "enter" | "return" => Key::Return,
        "tab" => Key::Tab,
        "escape" | "esc" => Key::Escape,
        "backspace" => Key::Backspace,
        "delete" => Key::Delete,
        "space" => Key::Space,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" => Key::PageUp,
        "pagedown" => Key::PageDown,
        "control" | "ctrl" => Key::Control,
        "alt" => Key::Alt,
        "shift" => Key::Shift,
        "meta" | "win" | "windows" | "cmd" | "super" => Key::Meta,
        other => other.chars().next().map(Key::Unicode).unwrap_or(Key::Space),
    }
}

// Executes one action from the computer_use desktop action set and returns
// a short human-readable label for the transcript. `take_screenshot` is
// handled by the caller (every iteration captures a fresh screenshot for
// the feedback loop anyway) so it never reaches here.
fn execute_action(name: &str, args: &Value, width: u32, height: u32) -> Result<String, String> {
    let mut enigo = Enigo::new(&EnigoSettings::default()).map_err(|e| e.to_string())?;
    let x = denormalize(args["x"].as_f64().unwrap_or(0.0), width);
    let y = denormalize(args["y"].as_f64().unwrap_or(0.0), height);

    match name {
        "click" => {
            enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
            enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
            Ok(format!("Clic en ({x}, {y})"))
        }
        "double_click" => {
            enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
            enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
            enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
            Ok(format!("Double-clic en ({x}, {y})"))
        }
        "triple_click" => {
            enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
            for _ in 0..3 {
                enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
            }
            Ok(format!("Triple-clic en ({x}, {y})"))
        }
        "middle_click" => {
            enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
            enigo.button(Button::Middle, Direction::Click).map_err(|e| e.to_string())?;
            Ok(format!("Clic molette en ({x}, {y})"))
        }
        "right_click" => {
            enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
            enigo.button(Button::Right, Direction::Click).map_err(|e| e.to_string())?;
            Ok(format!("Clic droit en ({x}, {y})"))
        }
        "mouse_down" => {
            enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
            enigo.button(Button::Left, Direction::Press).map_err(|e| e.to_string())?;
            Ok("Bouton souris enfoncé".to_string())
        }
        "mouse_up" => {
            enigo.button(Button::Left, Direction::Release).map_err(|e| e.to_string())?;
            Ok("Bouton souris relâché".to_string())
        }
        "move" => {
            enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
            Ok(format!("Souris déplacée en ({x}, {y})"))
        }
        "type" => {
            let text = args["text"].as_str().unwrap_or("");
            enigo.text(text).map_err(|e| e.to_string())?;
            if args["press_enter"].as_bool().unwrap_or(false) {
                enigo.key(Key::Return, Direction::Click).map_err(|e| e.to_string())?;
            }
            Ok(format!("Texte tapé : {text}"))
        }
        "drag_and_drop" => {
            let sx = denormalize(args["start_x"].as_f64().unwrap_or(0.0), width);
            let sy = denormalize(args["start_y"].as_f64().unwrap_or(0.0), height);
            let ex = denormalize(args["end_x"].as_f64().unwrap_or(0.0), width);
            let ey = denormalize(args["end_y"].as_f64().unwrap_or(0.0), height);
            enigo.move_mouse(sx, sy, Coordinate::Abs).map_err(|e| e.to_string())?;
            enigo.button(Button::Left, Direction::Press).map_err(|e| e.to_string())?;
            enigo.move_mouse(ex, ey, Coordinate::Abs).map_err(|e| e.to_string())?;
            enigo.button(Button::Left, Direction::Release).map_err(|e| e.to_string())?;
            Ok(format!("Glisser de ({sx}, {sy}) à ({ex}, {ey})"))
        }
        "wait" => {
            let secs = args["seconds"].as_f64().unwrap_or(1.0).clamp(0.0, 10.0);
            std::thread::sleep(Duration::from_secs_f64(secs));
            Ok(format!("Attente de {secs:.1}s"))
        }
        "press_key" => {
            let key = args["key"].as_str().unwrap_or("");
            enigo.key(key_from_name(key), Direction::Click).map_err(|e| e.to_string())?;
            Ok(format!("Touche : {key}"))
        }
        "key_down" => {
            let key = args["key"].as_str().unwrap_or("");
            enigo.key(key_from_name(key), Direction::Press).map_err(|e| e.to_string())?;
            Ok(format!("Touche enfoncée : {key}"))
        }
        "key_up" => {
            let key = args["key"].as_str().unwrap_or("");
            enigo.key(key_from_name(key), Direction::Release).map_err(|e| e.to_string())?;
            Ok(format!("Touche relâchée : {key}"))
        }
        "hotkey" => {
            let keys: Vec<Key> = args["keys"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str()).map(key_from_name).collect())
                .unwrap_or_default();
            for k in &keys {
                enigo.key(*k, Direction::Press).map_err(|e| e.to_string())?;
            }
            for k in keys.iter().rev() {
                enigo.key(*k, Direction::Release).map_err(|e| e.to_string())?;
            }
            Ok("Raccourci clavier".to_string())
        }
        "scroll" => {
            let magnitude = args["magnitude_in_pixels"].as_i64().unwrap_or(200) as i32;
            let direction = args["direction"].as_str().unwrap_or("down");
            let (length, axis) = match direction {
                "up" => (-magnitude, Axis::Vertical),
                "left" => (-magnitude, Axis::Horizontal),
                "right" => (magnitude, Axis::Horizontal),
                _ => (magnitude, Axis::Vertical),
            };
            enigo.scroll(length, axis).map_err(|e| e.to_string())?;
            Ok(format!("Défilement {direction}"))
        }
        other => Err(format!("Action inconnue : {other}")),
    }
}

#[tauri::command]
pub async fn run_control_me(
    cancel: State<'_, ControlMeCancelFlag>,
    confirmation: State<'_, ControlMeConfirmation>,
    app: AppHandle,
    api_key: String,
    model: String,
    instruction: String,
) -> Result<(), String> {
    run_control_me_core(app, cancel.0.clone(), confirmation.0.clone(), api_key, model, instruction).await
}

// Extracted from the #[tauri::command] above so the remote-pairing task
// (remote.rs) can trigger the exact same Gemini loop from a broadcast
// instruction, without going through Tauri's IPC layer — it already has an
// AppHandle and can read the same managed ControlMeCancelFlag/
// ControlMeConfirmation state directly. Every event this emits
// (control-me-step/-message/-done/-error) is a normal Tauri app event
// regardless of caller, so the remote task mirrors sessions it triggers by
// just listening for those same events and re-broadcasting them — no
// broadcaster parameter needed here.
pub async fn run_control_me_core(
    app: AppHandle,
    cancel_flag: Arc<AtomicBool>,
    confirmation: Arc<Mutex<Option<oneshot::Sender<bool>>>>,
    api_key: String,
    model: String,
    instruction: String,
) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("Aucune clé API Gemini configurée. Ajoute-la dans Réglages.".to_string());
    }
    let model = if model.trim().is_empty() { GEMINI_MODEL.to_string() } else { model };

    cancel_flag.store(false, Ordering::SeqCst);
    let flag = cancel_flag;
    let client = reqwest::Client::new();

    let (initial_screenshot, width, height) = capture_screenshot_base64()?;
    let tools = json!([
        {
            "type": "computer_use",
            "environment": "desktop",
            "enable_prompt_injection_detection": true,
        },
        {
            "type": "function",
            "name": "remember_fact",
            "description": "Enregistre un fait durable appris sur l'utilisateur (son rôle, ses habitudes, les logiciels qu'il utilise...) pour s'en souvenir lors de futures sessions. Uniquement pour de l'information utile sur le long terme, pas des détails ponctuels sans intérêt futur.",
            "parameters": {
                "type": "object",
                "properties": {
                    "fact": { "type": "string", "description": "Le fait à retenir, formulé clairement et de façon autonome" },
                    "category": { "type": "string", "description": "Catégorie optionnelle (ex: rôle, logiciel, habitude)" }
                },
                "required": ["fact"]
            }
        },
        {
            "type": "function",
            "name": "read_ui_elements",
            "description": "Lit la structure d'accessibilité de la fenêtre actuellement au premier plan (titre + liste des contrôles visibles avec leur type, leur libellé exact, leur état activé/désactivé, et leur position déjà normalisée 0-999 — le même repère que les coordonnées de clic) sans prendre de capture d'écran. Plus rapide et plus fiable qu'une capture pour confirmer un texte exact ou trouver la position précise d'un élément avant d'agir dessus. À utiliser en complément du raisonnement visuel habituel, pas à sa place — ne fonctionne pas pour une interface dessinée directement (jeu, canvas), qui n'expose rien à l'accessibilité.",
            "parameters": { "type": "object", "properties": {} }
        }
    ]);

    // thinking_level "low" trades some reasoning depth for much faster
    // per-step responses — appropriate for a tight screenshot/act loop
    // rather than a one-shot hard problem.
    let generation_config = json!({ "thinking_level": "low" });

    // Pragmatic "retrieval": the whole memory file gets prepended as-is
    // rather than semantically searched — realistically a personal-profile
    // list stays small (tens of facts), so a vector store would be real
    // infrastructure for no practical benefit here. Revisit only if this
    // ever grows large enough to meaningfully bloat context.
    let memory = load_memory(&app).unwrap_or_default();
    let instruction_with_memory = if memory.is_empty() {
        instruction
    } else {
        let facts: Vec<String> = memory.iter().map(|m| format!("- {}", m.fact)).collect();
        format!(
            "Ce que tu sais déjà sur cette personne :\n{}\n\nInstruction actuelle : {}",
            facts.join("\n"),
            instruction
        )
    };

    let mut body = json!({
        "model": model,
        "input": [
            { "type": "text", "text": instruction_with_memory },
            { "type": "image", "data": initial_screenshot, "mime_type": "image/jpeg" },
        ],
        "tools": tools,
        "generation_config": generation_config,
    });

    let mut iterations: u32 = 0;

    loop {
        iterations += 1;
        if iterations > MAX_CONTROL_ME_ITERATIONS {
            let _ = app.emit("control-me-limit", ());
            return Ok(());
        }

        let resp = tokio::select! {
            result = client.post(GEMINI_ENDPOINT).header("x-goog-api-key", &api_key).json(&body).send() => {
                result.map_err(|e| format!("Impossible de contacter l'API Gemini : {e}"))?
            }
            _ = wait_for_cancel(flag.clone()) => {
                let _ = app.emit("control-me-cancelled", ());
                return Err(CANCELLED_MESSAGE.to_string());
            }
        };

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            let message = format!("Gemini a répondu {status} : {text}");
            let _ = app.emit("control-me-error", json!({ "message": message }));
            return Err(message);
        }

        let data: Value = resp
            .json()
            .await
            .map_err(|e| format!("Réponse Gemini invalide : {e}"))?;

        let interaction_id = data["id"].as_str().map(|s| s.to_string());
        let status = data["status"].as_str().unwrap_or("");
        let steps = data["steps"].as_array().cloned().unwrap_or_default();

        for step in &steps {
            if step["type"] == "model_output" {
                if let Some(content) = step["content"].as_array() {
                    for part in content {
                        if let Some(text) = part["text"].as_str() {
                            if !text.trim().is_empty() {
                                let _ = app.emit("control-me-message", json!({ "text": text }));
                            }
                        }
                    }
                }
            }
        }

        let function_calls: Vec<&Value> = steps.iter().filter(|s| s["type"] == "function_call").collect();

        if status == "completed" || function_calls.is_empty() {
            let summary = data["output_text"].as_str().unwrap_or("Terminé.").to_string();
            let _ = app.emit("control-me-done", json!({ "summary": summary }));
            return Ok(());
        }
        if status == "failed" || status == "cancelled" {
            let message = "L'interaction Gemini a échoué ou a été annulée côté serveur.".to_string();
            let _ = app.emit("control-me-error", json!({ "message": message.clone() }));
            return Err(message);
        }

        let call = function_calls[0];
        let call_id = call["id"].as_str().unwrap_or("").to_string();
        let action_name = call["name"].as_str().unwrap_or("").to_string();
        let mut args = call["arguments"].clone();
        let intent = args["intent"].as_str().map(|s| s.to_string());

        let (transcript_label, result_text, error_text) = if args["safety_decision"]["decision"] == "require_confirmation" {
            let explanation = args["safety_decision"]["explanation"]
                .as_str()
                .unwrap_or("Action jugée sensible par le modèle.")
                .to_string();
            let (tx, rx) = oneshot::channel::<bool>();
            {
                let mut guard = confirmation
                    .lock()
                    .map_err(|_| "État de confirmation corrompu".to_string())?;
                *guard = Some(tx);
            }
            let _ = app.emit(
                "control-me-confirmation-required",
                json!({ "action": action_name, "explanation": explanation }),
            );

            // Pauses this command in place rather than ending it — resolve_
            // control_me_confirmation sends into `rx` to resume the same
            // run, instead of the user having to send a whole new message.
            let accepted = tokio::select! {
                result = rx => result.unwrap_or(false),
                _ = wait_for_cancel(flag.clone()) => {
                    let _ = app.emit("control-me-cancelled", ());
                    return Err(CANCELLED_MESSAGE.to_string());
                }
            };

            if !accepted {
                let msg = "Action refusée par l'utilisateur.".to_string();
                (msg.clone(), msg, None)
            } else {
                // Google's documented protocol for this exact flag: mark it
                // acknowledged before re-attempting the action.
                if let Some(obj) = args.as_object_mut() {
                    obj.insert("safety_acknowledgement".to_string(), json!(true));
                }
                dispatch_action(&app, &action_name, &args, width, height)
            }
        } else {
            dispatch_action(&app, &action_name, &args, width, height)
        };

        let _ = app.emit(
            "control-me-step",
            StepPayload { intent, action: action_name.clone(), label: transcript_label },
        );

        if flag.load(Ordering::SeqCst) {
            let _ = app.emit("control-me-cancelled", ());
            return Err(CANCELLED_MESSAGE.to_string());
        }

        // Adaptive settle wait (see wait_for_settle) instead of a fixed
        // delay, so the next screenshot reflects the action's actual visual
        // effect without waiting longer than necessary.
        wait_for_settle(flag.clone()).await;
        if flag.load(Ordering::SeqCst) {
            let _ = app.emit("control-me-cancelled", ());
            return Err(CANCELLED_MESSAGE.to_string());
        }
        let (screenshot, _, _) = capture_screenshot_base64()?;

        let mut result_parts = vec![json!({ "type": "text", "text": error_text.unwrap_or(result_text) })];
        result_parts.push(json!({ "type": "image", "data": screenshot, "mime_type": "image/jpeg" }));

        body = json!({
            "model": model,
            "previous_interaction_id": interaction_id,
            "tools": tools,
            "generation_config": generation_config,
            "input": [{
                "type": "function_result",
                "call_id": call_id,
                "name": action_name,
                "result": result_parts,
            }],
        });
    }
}

#[tauri::command]
pub fn cancel_control_me(cancel: State<ControlMeCancelFlag>) {
    cancel.0.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn resolve_control_me_confirmation(confirmation: State<ControlMeConfirmation>, accept: bool) {
    if let Ok(mut guard) = confirmation.0.lock() {
        if let Some(tx) = guard.take() {
            let _ = tx.send(accept);
        }
    }
}

#[tauri::command]
pub fn list_control_me_memory(app: AppHandle) -> Result<Vec<MemoryEntry>, String> {
    load_memory(&app)
}

#[tauri::command]
pub fn clear_control_me_memory(app: AppHandle) -> Result<(), String> {
    save_memory(&app, &[])
}
