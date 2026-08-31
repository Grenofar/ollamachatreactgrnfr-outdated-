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
use base64::{engine::general_purpose::STANDARD, Engine as _};
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings as EnigoSettings};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use xcap::Monitor;

pub struct ControlMeCancelFlag(pub Arc<AtomicBool>);

const MAX_CONTROL_ME_ITERATIONS: u32 = 40;
const GEMINI_MODEL: &str = "gemini-3.7-flash";
const GEMINI_ENDPOINT: &str = "https://generativelanguage.googleapis.com/v1beta/interactions";
const CANCELLED_MESSAGE: &str = "Annulé par l'utilisateur.";
// Normalized 0-999 coordinates map to a fraction of the screenshot
// regardless of its pixel resolution, so downscaling before encoding
// doesn't hurt click accuracy but meaningfully cuts encoding time, upload
// size, and Gemini's per-step vision latency — this was the main source of
// the per-step slowness reported after the first version.
const SCREENSHOT_MAX_WIDTH: u32 = 1280;
const SCREENSHOT_JPEG_QUALITY: u8 = 80;

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

#[derive(Serialize, Clone)]
struct StepPayload {
    intent: Option<String>,
    action: String,
    label: String,
}

// Returns (base64 JPEG, real screen width, real screen height). The real
// dimensions (not the downscaled ones) are what denormalize() uses, since a
// 0-999 coordinate is the same fraction of the screen either way.
fn capture_screenshot_base64() -> Result<(String, u32, u32), String> {
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
    app: AppHandle,
    api_key: String,
    model: String,
    instruction: String,
) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("Aucune clé API Gemini configurée. Ajoute-la dans Réglages.".to_string());
    }
    let model = if model.trim().is_empty() { GEMINI_MODEL.to_string() } else { model };

    cancel.0.store(false, Ordering::SeqCst);
    let flag = cancel.0.clone();
    let client = reqwest::Client::new();

    let (initial_screenshot, width, height) = capture_screenshot_base64()?;
    let tools = json!([{
        "type": "computer_use",
        "environment": "desktop",
        "enable_prompt_injection_detection": true,
    }]);

    // thinking_level "low" trades some reasoning depth for much faster
    // per-step responses — appropriate for a tight screenshot/act loop
    // rather than a one-shot hard problem.
    let generation_config = json!({ "thinking_level": "low" });

    let mut body = json!({
        "model": model,
        "input": [
            { "type": "text", "text": instruction },
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
        let args = call["arguments"].clone();
        let intent = args["intent"].as_str().map(|s| s.to_string());

        if args["safety_decision"]["decision"] == "require_confirmation" {
            let explanation = args["safety_decision"]["explanation"]
                .as_str()
                .unwrap_or("Action jugée sensible par le modèle.")
                .to_string();
            let _ = app.emit(
                "control-me-confirmation-required",
                json!({ "action": action_name, "explanation": explanation }),
            );
            return Ok(());
        }

        let (label, error_text) = if action_name == "take_screenshot" {
            ("Capture d'écran".to_string(), None)
        } else {
            match execute_action(&action_name, &args, width, height) {
                Ok(l) => (l, None),
                Err(e) => (format!("Erreur : {e}"), Some(e)),
            }
        };

        let _ = app.emit(
            "control-me-step",
            StepPayload { intent, action: action_name.clone(), label: label.clone() },
        );

        if flag.load(Ordering::SeqCst) {
            let _ = app.emit("control-me-cancelled", ());
            return Err(CANCELLED_MESSAGE.to_string());
        }

        // Brief settle delay so the next screenshot reflects the action's
        // visual effect (a click's UI update, a page finishing a scroll…).
        tokio::time::sleep(Duration::from_millis(120)).await;
        let (screenshot, _, _) = capture_screenshot_base64()?;

        let mut result_parts = vec![json!({ "type": "text", "text": error_text.unwrap_or(label) })];
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
