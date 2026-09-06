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
use super::settings::load_settings;
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
pub(crate) const GEMINI_MODEL: &str = "gemini-3.5-flash-lite";
pub(crate) const GEMINI_ENDPOINT: &str = "https://generativelanguage.googleapis.com/v1beta/interactions";
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
// Tools that never touch the screen — no settle wait, no screenshot
// attached to their result (see the main loop below).
const NO_VISUAL_EFFECT_TOOLS: [&str; 3] = ["read_ui_elements", "remember_fact", "add_to_skill"];
// Fixed settle delay used in "windows_ui" perception mode instead of the
// adaptive pixel-diff wait above — there's no screen to diff against, just
// a short buffer so a UI has time to actually update before the
// accessibility tree is re-read.
const UI_MODE_SETTLE_MS: u64 = 150;

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

// read_foreground_ui_elements is a synchronous walk of cross-process COM
// calls — measured at 65 ms on a light window but ~845 ms on a
// control-dense one (see src-tauri/examples/uia_bench.rs). Calling it
// straight from this async loop parked a Tokio worker thread for that whole
// time, which also stalls whatever else shares the runtime — most visibly
// the remote-control WebSocket's heartbeat and screen-frame ticks during a
// session being watched from the site. spawn_blocking moves it off the
// async workers; it doesn't make the read itself faster.
async fn read_ui_off_runtime(width: u32, height: u32) -> String {
    tokio::task::spawn_blocking(move || {
        read_foreground_ui_elements(width, height)
            .unwrap_or_else(|e| format!("Erreur de lecture de l'interface : {e}"))
    })
    .await
    .unwrap_or_else(|e| format!("Erreur de lecture de l'interface : {e}"))
}

fn primary_monitor() -> Result<Monitor, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .cloned()
        .ok_or_else(|| "Aucun écran détecté".to_string())
}

// Screen dimensions only, no pixel capture — used by "windows_ui"
// perception mode, which never needs an actual screenshot.
fn primary_screen_size() -> Result<(u32, u32), String> {
    let monitor = primary_monitor()?;
    Ok((monitor.width().map_err(|e| e.to_string())?, monitor.height().map_err(|e| e.to_string())?))
}

// Cheap capture for settle-comparison only — a tiny grayscale downscale,
// nowhere near the quality/size needed for the real screenshot sent to
// Gemini (capture_screenshot_base64 handles that once the screen has
// settled).
fn capture_grayscale_thumb() -> Result<Vec<u8>, String> {
    let monitor = primary_monitor()?;
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

pub(crate) fn load_memory(app: &AppHandle) -> Result<Vec<MemoryEntry>, String> {
    let path = memory_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

pub(crate) fn save_memory(app: &AppHandle, entries: &[MemoryEntry]) -> Result<(), String> {
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
async fn dispatch_action(
    app: &AppHandle,
    name: &str,
    args: &Value,
    width: u32,
    height: u32,
    recording_skill_id: Option<&str>,
) -> (String, String, Option<String>) {
    if name == "add_to_skill" {
        let note = args["note"].as_str().unwrap_or("").trim().to_string();
        // Only ever writes to the skill the user armed from the UI — the
        // model names no target, so it cannot reach a different skill.
        let Some(id) = recording_skill_id else {
            let msg = "Aucun skill en cours d'enregistrement.".to_string();
            return (msg.clone(), msg.clone(), Some(msg));
        };
        return match super::skills::append_to_skill(app, id, &note) {
            Ok(skill_name) => {
                let label = format!("Ajouté à « {skill_name} » : {note}");
                (label, format!("Note enregistrée dans le skill : {note}"), None)
            }
            Err(e) => {
                let msg = format!("Erreur : {e}");
                (msg.clone(), msg, Some(e))
            }
        };
    }
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
        // Off the async workers, same reason as the observation path: this
        // walk costs up to ~0.9s on a control-dense window, and parking a
        // runtime thread that long also stalls the remote-control heartbeat
        // and screen feed. Only the observation path had been moved in
        // v0.9.0; this explicit tool call was still blocking.
        let text = read_ui_off_runtime(width, height).await;
        let count = text.lines().count().saturating_sub(1);
        return (format!("Lecture de l'interface ({count} éléments)"), text, None);
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
    capture_screenshot_base64_scaled(SCREENSHOT_MAX_WIDTH, SCREENSHOT_JPEG_QUALITY)
}

// Parameterized version — remote.rs's live screen preview (broadcast at
// several frames/sec, see FRAME_INTERVAL_MS) uses smaller/more compressed
// frames than this (still fine for a human watching a live view, unlike
// Gemini's own vision input which stays at the higher quality above) to
// keep sustained upload bandwidth and per-frame encode cost reasonable at
// a much higher frame rate.
pub(crate) fn capture_screenshot_base64_scaled(max_width: u32, jpeg_quality: u8) -> Result<(String, u32, u32), String> {
    let monitor = primary_monitor()?;
    let image = monitor.capture_image().map_err(|e| e.to_string())?;
    let (width, height) = (image.width(), image.height());

    let resized = if width > max_width {
        let scaled_height = ((height as f64) * (max_width as f64) / (width as f64)).round() as u32;
        xcap::image::imageops::resize(&image, max_width, scaled_height, xcap::image::imageops::FilterType::Triangle)
    } else {
        image
    };
    // JPEG has no alpha channel; screenshots are always opaque anyway.
    let rgb = xcap::image::DynamicImage::ImageRgba8(resized).to_rgb8();

    let mut jpeg_bytes: Vec<u8> = Vec::new();
    xcap::image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_bytes, jpeg_quality)
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
        "capslock" | "caps" => Key::CapsLock,
        "insert" => Key::Insert,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        other => other.chars().next().map(Key::Unicode).unwrap_or(Key::Space),
    }
}

// Executes one action from the computer_use desktop action set and returns
// a short human-readable label for the transcript. `take_screenshot` is
// handled by the caller (every iteration captures a fresh screenshot for
// the feedback loop anyway) so it never reaches here.
fn execute_action(name: &str, args: &Value, width: u32, height: u32) -> Result<String, String> {
    // release_keys_when_dropped defaults to true in enigo — since a fresh
    // Enigo is created per action (see below), that default made key_down
    // silently useless: the key got pressed then immediately released
    // again the instant this function returned and the local `enigo`
    // dropped, before the next screenshot ever saw it held. Real Windows
    // key state is independent of which Enigo instance issued the
    // SendInput call, so disabling this doesn't change how press/release
    // themselves work — it just stops this instance from auto-undoing a
    // press on its way out. Trade-off, now real instead of moot: if the
    // app is killed while a key_down was never followed by key_up, that
    // key can stay physically stuck down — inherent to "hold" actually
    // working, not something a per-call Enigo instance can prevent.
    let mut enigo = Enigo::new(&EnigoSettings { release_keys_when_dropped: false, ..EnigoSettings::default() })
        .map_err(|e| e.to_string())?;
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
        // key_down + key_up in one call. Two separate calls each cost a full
        // Gemini round trip, so "hold Z for two seconds" used to be several
        // seconds of held key plus several seconds of model latency in the
        // middle — impossible to time in a game, which is exactly where
        // holding a key matters.
        "hold_key" => {
            let key = args["key"].as_str().unwrap_or("");
            let secs = args["seconds"].as_f64().unwrap_or(1.0).clamp(0.0, 10.0);
            let k = key_from_name(key);
            enigo.key(k, Direction::Press).map_err(|e| e.to_string())?;
            std::thread::sleep(Duration::from_secs_f64(secs));
            enigo.key(k, Direction::Release).map_err(|e| e.to_string())?;
            Ok(format!("Touche {key} maintenue {secs:.1}s"))
        }
        "press_key_repeat" => {
            let key = args["key"].as_str().unwrap_or("");
            let times = args["times"].as_u64().unwrap_or(1).clamp(1, 50);
            let k = key_from_name(key);
            for _ in 0..times {
                enigo.key(k, Direction::Click).map_err(|e| e.to_string())?;
                std::thread::sleep(Duration::from_millis(30));
            }
            Ok(format!("Touche {key} appuyée {times} fois"))
        }
        "hold_mouse" => {
            let secs = args["seconds"].as_f64().unwrap_or(1.0).clamp(0.0, 10.0);
            let button = match args["button"].as_str().unwrap_or("left") {
                "right" => Button::Right,
                "middle" => Button::Middle,
                _ => Button::Left,
            };
            enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
            enigo.button(button, Direction::Press).map_err(|e| e.to_string())?;
            std::thread::sleep(Duration::from_secs_f64(secs));
            enigo.button(button, Direction::Release).map_err(|e| e.to_string())?;
            Ok(format!("Bouton souris maintenu {secs:.1}s en ({x}, {y})"))
        }
        // Absolute positioning is meaningless in a game that captures the
        // cursor and reads raw movement deltas instead.
        "move_relative" => {
            let dx = args["dx"].as_i64().unwrap_or(0) as i32;
            let dy = args["dy"].as_i64().unwrap_or(0) as i32;
            enigo.move_mouse(dx, dy, Coordinate::Rel).map_err(|e| e.to_string())?;
            Ok(format!("Souris déplacée de ({dx}, {dy})"))
        }
        "scroll_at" => {
            let magnitude = args["magnitude_in_pixels"].as_i64().unwrap_or(200) as i32;
            let direction = args["direction"].as_str().unwrap_or("down");
            let (length, axis) = match direction {
                "up" => (-magnitude, Axis::Vertical),
                "left" => (-magnitude, Axis::Horizontal),
                "right" => (magnitude, Axis::Horizontal),
                _ => (magnitude, Axis::Vertical),
            };
            enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
            enigo.scroll(length, axis).map_err(|e| e.to_string())?;
            Ok(format!("Défilement {direction} en ({x}, {y})"))
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

fn remember_fact_tool() -> Value {
    json!({
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
    })
}

// Only declared while the user has armed a skill to record into (see
// run_control_me_core). remember_fact writes durable facts about the person
// to the global memory; this writes into one specific skill the user chose,
// which is what makes "teach it a game" or "build up a procedure" work —
// the notes land somewhere the user can then hand to a future session on
// purpose, instead of into one undifferentiated memory pile.
fn add_to_skill_tool(skill_name: &str) -> Value {
    json!({
        "type": "function",
        "name": "add_to_skill",
        "description": format!(
            "Ajoute une note au skill \"{skill_name}\", que l'utilisateur enregistre en ce moment. Utilise-le dès que tu apprends quelque chose qui mériterait d'être su au début d'une future session : une information sur la personne, une règle ou une commande d'un jeu, l'emplacement d'un bouton, une préférence, une procédure qui a marché (ou qui a échoué, et pourquoi). Écris une note courte, autonome et compréhensible hors contexte. N'attends pas la fin de la conversation et ne demande pas la permission à chaque fois : note au fil de l'eau, une note par chose apprise."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "note": { "type": "string", "description": "Ce qu'il faut retenir, formulé clairement et de façon autonome" }
            },
            "required": ["note"]
        }
    })
}

fn read_ui_elements_tool(preferred: bool) -> Value {
    let description = if preferred {
        "Lit la structure d'accessibilité de la fenêtre actuellement au premier plan (titre + liste des contrôles visibles avec leur type, leur libellé exact, leur état activé/désactivé, et leur position déjà normalisée 0-999 — le même repère que les coordonnées des autres outils). En mode Windows UI, c'est déjà rafraîchi automatiquement après chaque action — appelle-le toi-même seulement si tu veux revérifier sans agir. Ne fonctionne pas pour une interface dessinée directement (jeu, canvas, éditeur graphique)."
    } else {
        "Lit la structure d'accessibilité de la fenêtre actuellement au premier plan (titre + liste des contrôles visibles avec leur type, leur libellé exact, leur état activé/désactivé, et leur position déjà normalisée 0-999 — le même repère que les coordonnées de clic) sans prendre de capture d'écran, donc nettement plus rapide qu'une capture (pas d'analyse visuelle à faire, réponse quasi instantanée). PRÉFÈRE cet outil à computer_use dès que tu dois localiser ou vérifier un élément précis (bouton, champ, libellé exact) dans une fenêtre standard — appelle-le d'abord plutôt que de deviner une position sur une capture d'écran. Limite réelle à connaître : ne fonctionne pas pour une interface dessinée directement (jeu, canvas, éditeur graphique) qui n'expose rien à l'accessibilité — dans ce cas seulement, reviens à computer_use."
    };
    json!({
        "type": "function",
        "name": "read_ui_elements",
        "description": description,
        "parameters": { "type": "object", "properties": {} }
    })
}

// Held/repeated actions with a duration, offered in BOTH perception modes.
// computer_use has key_down/key_up but no "hold for N seconds" — and split
// across two model round trips a hold lasts however long Gemini takes to
// answer, which is useless for anything time-sensitive (games above all).
// These close that gap without replacing computer_use.
fn timed_action_tools() -> Vec<Value> {
    vec![
        json!({
            "type": "function",
            "name": "hold_key",
            "description": "Maintient une touche enfoncée pendant une durée précise, puis la relâche automatiquement — par exemple avancer dans un jeu en gardant \"z\" enfoncé 2 secondes. À préférer à key_down/key_up dès que la durée compte : entre deux appels séparés il s'écoule plusieurs secondes de latence, impossible à doser. Mêmes noms de touche que press_key (lettre simple incluse).",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": { "type": "string", "description": "Touche à maintenir (ex. \"z\", \"q\", \"shift\", \"space\")" },
                    "seconds": { "type": "number", "description": "Durée du maintien en secondes (max 10)" }
                },
                "required": ["key", "seconds"]
            }
        }),
        json!({
            "type": "function",
            "name": "press_key_repeat",
            "description": "Appuie plusieurs fois de suite sur la même touche (max 50), par exemple descendre de 5 crans dans une liste ou effacer plusieurs caractères. Évite d'enchaîner autant d'appels séparés.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": { "type": "string" },
                    "times": { "type": "number", "description": "Nombre d'appuis (max 50)" }
                },
                "required": ["key", "times"]
            }
        }),
        json!({
            "type": "function",
            "name": "hold_mouse",
            "description": "Maintient un bouton de la souris enfoncé à une position donnée pendant une durée précise, puis le relâche — appui long, tir continu dans un jeu, sélection prolongée.",
            "parameters": {
                "type": "object",
                "properties": {
                    "x": { "type": "number", "description": "Position X normalisée 0-999" },
                    "y": { "type": "number", "description": "Position Y normalisée 0-999" },
                    "seconds": { "type": "number", "description": "Durée du maintien en secondes (max 10)" },
                    "button": { "type": "string", "enum": ["left", "right", "middle"] }
                },
                "required": ["x", "y", "seconds"]
            }
        }),
        json!({
            "type": "function",
            "name": "move_relative",
            "description": "Déplace la souris d'un décalage en pixels par rapport à sa position actuelle, au lieu d'une position absolue. Nécessaire pour viser dans un jeu qui capture le curseur (les coordonnées absolues n'y ont aucun effet).",
            "parameters": {
                "type": "object",
                "properties": {
                    "dx": { "type": "number", "description": "Décalage horizontal en pixels (négatif = vers la gauche)" },
                    "dy": { "type": "number", "description": "Décalage vertical en pixels (négatif = vers le haut)" }
                },
                "required": ["dx", "dy"]
            }
        }),
        json!({
            "type": "function",
            "name": "scroll_at",
            "description": "Place la souris à une position normalisée 0-999 puis fait défiler à cet endroit précis — nécessaire quand la page contient plusieurs zones défilables (panneau latéral, liste interne) et que le défilement doit s'appliquer à l'une d'elles en particulier.",
            "parameters": {
                "type": "object",
                "properties": {
                    "x": { "type": "number" }, "y": { "type": "number" },
                    "direction": { "type": "string", "enum": ["up", "down", "left", "right"] },
                    "magnitude_in_pixels": { "type": "number" }
                },
                "required": ["x", "y", "direction"]
            }
        }),
    ]
}

fn build_capture_tools(recording_skill: Option<&str>) -> Value {
    let mut tools = vec![
        json!({
            "type": "computer_use",
            "environment": "desktop",
            "enable_prompt_injection_detection": true,
        }),
        remember_fact_tool(),
        read_ui_elements_tool(false),
    ];
    tools.extend(timed_action_tools());
    if let Some(name) = recording_skill {
        tools.push(add_to_skill_tool(name));
    }
    Value::Array(tools)
}

// "windows_ui" mode drops computer_use entirely (it's fundamentally a
// screenshot-driven tool — sending it a text-only observation isn't a
// supported combination) and exposes the same actions execute_action()
// already implements as plain custom function tools instead, using the
// exact same parameter names so dispatch_action/execute_action need zero
// changes to handle either mode. Coordinates use the same 0-999 space
// read_ui_elements already reports, so an element's reported position is
// directly usable here without conversion.
//
// Real trade-off, not hidden: Gemini's require_confirmation safety signal
// is part of computer_use's own protocol specifically — a custom function
// tool has no equivalent, so that safety net does not exist in this mode.
fn build_windows_ui_tools(recording_skill: Option<&str>) -> Value {
    let xy_params = |extra: Value| {
        let mut props = json!({
            "x": { "type": "number", "description": "Position X normalisée 0-999" },
            "y": { "type": "number", "description": "Position Y normalisée 0-999" }
        });
        if let (Some(props_obj), Some(extra_obj)) = (props.as_object_mut(), extra.as_object()) {
            for (k, v) in extra_obj {
                props_obj.insert(k.clone(), v.clone());
            }
        }
        json!({ "type": "object", "properties": props, "required": ["x", "y"] })
    };
    let click_tool = |name: &str, label: &str| {
        json!({
            "type": "function",
            "name": name,
            "description": format!("{label}, à la position normalisée 0-999 donnée (même repère que read_ui_elements)."),
            "parameters": xy_params(json!({}))
        })
    };

    let mut tools = vec![
        click_tool("click", "Clic gauche"),
        click_tool("double_click", "Double-clic gauche"),
        click_tool("triple_click", "Triple-clic gauche"),
        click_tool("middle_click", "Clic molette"),
        click_tool("right_click", "Clic droit"),
        click_tool("mouse_down", "Enfonce le bouton gauche de la souris (sans le relâcher)"),
        json!({
            "type": "function",
            "name": "mouse_up",
            "description": "Relâche le bouton gauche de la souris précédemment enfoncé avec mouse_down.",
            "parameters": { "type": "object", "properties": {} }
        }),
        click_tool("move", "Déplace la souris (sans cliquer)"),
        json!({
            "type": "function",
            "name": "type",
            "description": "Tape du texte à l'endroit où se trouve le curseur/focus actuel — accents et emoji inclus, envoyés comme de vrais caractères Unicode (pas besoin de les décrire, les inclure directement dans le texte).",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": { "type": "string", "description": "Le texte à taper" },
                    "press_enter": { "type": "boolean", "description": "Appuyer sur Entrée après avoir tapé le texte" }
                },
                "required": ["text"]
            }
        }),
        json!({
            "type": "function",
            "name": "drag_and_drop",
            "description": "Glisse-dépose depuis une position normalisée 0-999 vers une autre.",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_x": { "type": "number" }, "start_y": { "type": "number" },
                    "end_x": { "type": "number" }, "end_y": { "type": "number" }
                },
                "required": ["start_x", "start_y", "end_x", "end_y"]
            }
        }),
        json!({
            "type": "function",
            "name": "wait",
            "description": "Attend un court instant (ex. le temps qu'une interface charge) avant de continuer.",
            "parameters": {
                "type": "object",
                "properties": { "seconds": { "type": "number", "description": "Durée en secondes (max 10)" } },
                "required": ["seconds"]
            }
        }),
        json!({
            "type": "function",
            "name": "press_key",
            "description": "Appuie puis relâche une touche du clavier. Noms reconnus : \"enter\", \"tab\", \"escape\", \"backspace\", \"delete\", \"space\", \"up\"/\"down\"/\"left\"/\"right\", \"home\", \"end\", \"pageup\", \"pagedown\", \"insert\", \"capslock\", \"control\"/\"ctrl\", \"alt\", \"shift\", \"meta\"/\"windows\"/\"win\" (touche logo Windows), \"f1\" à \"f12\", ou une lettre/chiffre simple.",
            "parameters": {
                "type": "object",
                "properties": { "key": { "type": "string" } },
                "required": ["key"]
            }
        }),
        json!({
            "type": "function",
            "name": "key_down",
            "description": "Maintient une touche enfoncée (à relâcher plus tard avec key_up) — utile pour maintenir Shift/Ctrl/Alt/Windows pendant une autre action, ou pour un raccourci qui doit rester actif plusieurs secondes. Mêmes noms de touche que press_key.",
            "parameters": {
                "type": "object",
                "properties": { "key": { "type": "string" } },
                "required": ["key"]
            }
        }),
        json!({
            "type": "function",
            "name": "key_up",
            "description": "Relâche une touche précédemment maintenue avec key_down. Mêmes noms de touche que press_key.",
            "parameters": {
                "type": "object",
                "properties": { "key": { "type": "string" } },
                "required": ["key"]
            }
        }),
        json!({
            "type": "function",
            "name": "hotkey",
            "description": "Appuie sur une combinaison de touches simultanément (ex. [\"control\", \"s\"] pour Ctrl+S, [\"control\", \"shift\", \"s\"] pour Ctrl+Maj+S, [\"meta\"] seule pour ouvrir le menu Démarrer) puis les relâche dans l'ordre inverse. Mêmes noms de touche que press_key.",
            "parameters": {
                "type": "object",
                "properties": { "keys": { "type": "array", "items": { "type": "string" } } },
                "required": ["keys"]
            }
        }),
        json!({
            "type": "function",
            "name": "scroll",
            "description": "Fait défiler la fenêtre au premier plan.",
            "parameters": {
                "type": "object",
                "properties": {
                    "direction": { "type": "string", "enum": ["up", "down", "left", "right"] },
                    "magnitude_in_pixels": { "type": "number" }
                },
                "required": ["direction"]
            }
        }),
        remember_fact_tool(),
        read_ui_elements_tool(true),
    ];
    tools.extend(timed_action_tools());
    if let Some(name) = recording_skill {
        tools.push(add_to_skill_tool(name));
    }
    Value::Array(tools)
}

#[tauri::command]
pub async fn run_control_me(
    cancel: State<'_, ControlMeCancelFlag>,
    confirmation: State<'_, ControlMeConfirmation>,
    app: AppHandle,
    api_key: String,
    model: String,
    instruction: String,
    active_skill_ids: Vec<String>,
    recording_skill_id: Option<String>,
    teaching: bool,
) -> Result<(), String> {
    run_control_me_core(
        app,
        cancel.0.clone(),
        confirmation.0.clone(),
        api_key,
        model,
        instruction,
        active_skill_ids,
        recording_skill_id,
        teaching,
        false,
    )
    .await
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
    active_skill_ids: Vec<String>,
    // Some(id) while the user has armed a skill to record into from the
    // Control Me UI — gates the add_to_skill tool and is the only target it
    // can ever write to.
    recording_skill_id: Option<String>,
    // True when the user armed the skill from "Apprendre" rather than
    // "Enregistrer": the session is then a lesson, not a task — see the
    // brief added to the instruction below.
    teaching: bool,
    // Remote-triggered instructions (remote.rs) force windows_ui regardless
    // of the local toggle: the site already gets its own live screenshot
    // feed independently (broadcast_frame_if_viewer, unrelated to what
    // Gemini itself perceives), so there's no reason for Gemini to also
    // burn a screenshot round-trip through computer_use for a session
    // nobody is standing in front of locally to benefit from that mode's
    // visual reasoning — windows_ui is also strictly cheaper/faster and
    // sends no image data anywhere. Local sessions keep respecting the
    // user's own Réglages toggle, unchanged.
    force_windows_ui: bool,
) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("Aucune clé API Gemini configurée. Ajoute-la dans Réglages.".to_string());
    }
    let model = if model.trim().is_empty() { GEMINI_MODEL.to_string() } else { model };

    cancel_flag.store(false, Ordering::SeqCst);
    let flag = cancel_flag;
    let client = reqwest::Client::new();

    // "capture" (default) sends screenshots through computer_use, same as
    // always. "windows_ui" sends no screenshots at all — only the
    // accessibility tree as text, via custom function tools mirroring
    // execute_action's existing action set.
    let loaded_settings = load_settings(app.clone()).ok();
    let use_ui_mode = force_windows_ui
        || loaded_settings
            .as_ref()
            .map(|s| s.control_me_perception_mode == "windows_ui")
            .unwrap_or(false);

    let (width, height, initial_observation) = if use_ui_mode {
        let (w, h) = primary_screen_size()?;
        let text = read_ui_off_runtime(w, h).await;
        (w, h, json!({ "type": "text", "text": text }))
    } else {
        let (screenshot, w, h) = capture_screenshot_base64()?;
        (w, h, json!({ "type": "image", "data": screenshot, "mime_type": "image/jpeg" }))
    };
    let recording_skill_name = recording_skill_id
        .as_deref()
        .and_then(|id| super::skills::load_skill(app.clone(), id.to_string()).ok())
        .map(|s| s.name);
    let tools = if use_ui_mode {
        build_windows_ui_tools(recording_skill_name.as_deref())
    } else {
        build_capture_tools(recording_skill_name.as_deref())
    };

    // "live" (default) = one action per Gemini turn, screen re-observed
    // between each. "predefined" = Gemini may return several actions in
    // the same turn (see the batch-processing loop below), executed with
    // only one fresh observation at the very end — fewer round-trips to
    // Gemini (the actual latency bottleneck, already confirmed
    // incompressible otherwise: fastest Gemini tier already in use, other
    // providers ruled out for lacking computer_use, local LLM ruled out
    // for reliability) at the cost of a later action in the batch possibly
    // missing its target if the screen didn't react as Gemini assumed.
    // A toggle, not the only behavior, precisely because of that trade-off
    // — mirrors the existing capture/windows_ui perception toggle.
    let use_predefined_mode = loaded_settings.as_ref().map(|s| s.control_me_action_mode == "predefined").unwrap_or(false);

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
    let mut instruction_with_context = if memory.is_empty() {
        instruction
    } else {
        let facts: Vec<String> = memory.iter().map(|m| format!("- {}", m.fact)).collect();
        format!("Ce que tu sais déjà sur cette personne :\n{}\n\nInstruction actuelle : {}", facts.join("\n"), instruction)
    };
    // Skills chosen by the user before starting this session (ExtensionsView)
    // — prepended directly rather than exposed as a callable tool (the
    // earlier read_knowledge_base design): the user already picked exactly
    // which skill(s) apply here, so there's nothing left for Gemini to
    // decide by calling a tool, and a plain prepend can't be "forgotten"
    // the way a tool call sometimes is (same reasoning as remember_fact's
    // memory preload above, just applied to explicitly-selected skills
    // instead of the whole memory file).
    if !active_skill_ids.is_empty() {
        let skills_text = super::skills::read_active_skills(&app, &active_skill_ids);
        if !skills_text.is_empty() {
            instruction_with_context =
                format!("Compétence(s) fournie(s) pour cette session :\n{skills_text}\n\n{instruction_with_context}");
        }
    }
    // Teaching session: the user is explaining a procedure, not asking for
    // it to be carried out. Without this the model treats every sentence as
    // a task and starts clicking, which is the opposite of being taught.
    if teaching {
        instruction_with_context = format!(
            "CONTEXTE : ceci est une séance d'apprentissage. La personne t'apprend à faire quelque \n             chose (utiliser un site, un logiciel, enchaîner des étapes...). Ton rôle n'est PAS \n             d'exécuter la tâche maintenant, mais de l'apprendre pour savoir la refaire seule plus \n             tard.

\n             Comment te comporter :
\n             - N'agis pas sur l'ordinateur de toi-même. N'utilise la souris ou le clavier que si on \n             te demande explicitement d'essayer ou de vérifier quelque chose.
\n             - Écoute, reformule brièvement pour confirmer que tu as compris, et pose une question \n             quand un détail manque (quel bouton exactement, que faire si une fenêtre apparaît, \n             comment savoir que ça a marché).
\n             - Appelle add_to_skill au fur et à mesure, une note par étape ou par règle apprise. \n             Écris chaque note comme une consigne autonome, utilisable sans cette conversation : \n             ce qu'il faut faire, où, dans quel ordre, et comment reconnaître que c'est réussi. \n             N'attends pas la fin pour noter.
\n             - Ne note pas ce que tu supposes : seulement ce qui t'a été dit ou montré.

\n             Ce que la personne t'apprend : {instruction_with_context}"
        );
    }

    // Batching hint, "predefined" action mode + windows_ui perception mode
    // only: computer_use is Google's own protocol, not something a prompt
    // hint can reliably steer towards returning several actions per turn,
    // so this only applies where this app defines the tools itself.
    if use_predefined_mode && use_ui_mode {
        instruction_with_context = format!(
            "{instruction_with_context}\n\nPour aller plus vite : si tu es certain d'une courte séquence \
             d'actions qui n'a pas besoin d'être revérifiée à l'écran entre chaque étape (par exemple taper \
             du texte puis appuyer sur Entrée, ou cliquer un champ puis y taper directement), tu peux renvoyer \
             plusieurs actions dans le même tour au lieu d'une seule à la fois. Si tu n'es pas sûr du résultat \
             d'une action, préfère une seule action à la fois pour rester fiable."
        );
    }

    let mut body = json!({
        "model": model,
        "input": [
            { "type": "text", "text": instruction_with_context },
            initial_observation,
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

        // "live" mode only ever acts on the first function_call, exactly
        // like before this toggle existed — "predefined" mode processes
        // every function_call Gemini returned in this turn as a batch (see
        // use_predefined_mode above). A live-mode turn that somehow still
        // gets more than one call back (Gemini isn't instructed to expect
        // this here) simply ignores the extras, same as the original code.
        let calls_to_process: &[&Value] = if use_predefined_mode { &function_calls } else { &function_calls[..1] };

        let mut function_results: Vec<Value> = Vec::with_capacity(calls_to_process.len());
        let mut any_visual_effect = false;
        let mut last_action_name = String::new();

        for call in calls_to_process {
            let call_id = call["id"].as_str().unwrap_or("").to_string();
            let action_name = call["name"].as_str().unwrap_or("").to_string();
            let mut args = call["arguments"].clone();
            let intent = args["intent"].as_str().map(|s| s.to_string());

            let (transcript_label, result_text, error_text) = if args["safety_decision"]["decision"]
                == "require_confirmation"
            {
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

                // Pauses this command in place rather than ending it —
                // resolve_control_me_confirmation sends into `rx` to resume
                // the same run, instead of the user having to send a whole
                // new message.
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
                    // Google's documented protocol for this exact flag: mark
                    // it acknowledged before re-attempting the action.
                    if let Some(obj) = args.as_object_mut() {
                        obj.insert("safety_acknowledgement".to_string(), json!(true));
                    }
                    dispatch_action(&app, &action_name, &args, width, height, recording_skill_id.as_deref()).await
                }
            } else {
                dispatch_action(&app, &action_name, &args, width, height, recording_skill_id.as_deref()).await
            };

            let _ = app.emit(
                "control-me-step",
                StepPayload { intent, action: action_name.clone(), label: transcript_label },
            );

            if flag.load(Ordering::SeqCst) {
                let _ = app.emit("control-me-cancelled", ());
                return Err(CANCELLED_MESSAGE.to_string());
            }

            if !NO_VISUAL_EFFECT_TOOLS.contains(&action_name.as_str()) {
                any_visual_effect = true;
            }
            last_action_name = action_name.clone();

            function_results.push(json!({
                "type": "function_result",
                "call_id": call_id,
                "name": action_name,
                "result": [{ "type": "text", "text": error_text.clone().unwrap_or_else(|| result_text.clone()) }],
            }));
        }

        // One observation for the whole batch (a single action in "live"
        // mode), appended to the last processed action's own result — same
        // skip conditions this always had, just evaluated once for
        // whichever calls were actually processed above.
        if use_ui_mode {
            if last_action_name != "read_ui_elements" {
                tokio::time::sleep(Duration::from_millis(UI_MODE_SETTLE_MS)).await;
                if flag.load(Ordering::SeqCst) {
                    let _ = app.emit("control-me-cancelled", ());
                    return Err(CANCELLED_MESSAGE.to_string());
                }
                let refreshed = read_ui_off_runtime(width, height).await;
                if let Some(last) = function_results.last_mut() {
                    if let Some(parts) = last["result"].as_array_mut() {
                        parts.push(json!({ "type": "text", "text": refreshed }));
                    }
                }
            }
        } else if any_visual_effect {
            wait_for_settle(flag.clone()).await;
            if flag.load(Ordering::SeqCst) {
                let _ = app.emit("control-me-cancelled", ());
                return Err(CANCELLED_MESSAGE.to_string());
            }
            let (screenshot, _, _) = capture_screenshot_base64()?;
            if let Some(last) = function_results.last_mut() {
                if let Some(parts) = last["result"].as_array_mut() {
                    parts.push(json!({ "type": "image", "data": screenshot, "mime_type": "image/jpeg" }));
                }
            }
        }

        body = json!({
            "model": model,
            "previous_interaction_id": interaction_id,
            "tools": tools,
            "generation_config": generation_config,
            "input": function_results,
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
