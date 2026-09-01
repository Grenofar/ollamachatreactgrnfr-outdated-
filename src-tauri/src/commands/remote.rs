// Hand-rolled Phoenix Channels client for Supabase Realtime, powering
// Control Me's remote pairing (site <-> app). No official/community Rust
// Realtime SDK is trustworthy enough to depend on blindly (see Cargo.toml),
// so this speaks the protocol directly — verified against
// https://supabase.com/docs/guides/realtime/protocol before writing this,
// not guessed.
//
// Deliberately no Postgres table anywhere in here: the pairing "code" IS
// the channel topic name (`realtime:remote:{code}`), "who's connected" is
// native channel Presence (the app tracks itself as "host", the site
// tracks itself under its own random key — anything that isn't "host" is
// treated as a viewer), and the screen/chat all ride on ephemeral
// Broadcast events, never persisted anywhere. This keeps the project's
// existing "Supabase Postgres stays read-only" posture almost entirely
// intact — only the Realtime *service* (a WebSocket relay), not the
// Postgres REST API, carries this feature.
use super::controlme::{
    capture_screenshot_base64, load_memory, run_control_me_core, save_memory, ControlMeCancelFlag,
    ControlMeConfirmation,
};
use super::settings::{load_settings, save_settings};
use super::{SUPABASE_ANON_KEY, SUPABASE_URL};
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Listener, Manager};
use tokio::net::TcpStream;
use tokio::sync::mpsc::UnboundedSender;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

const CODE_LEN: usize = 12;
const HEARTBEAT_INTERVAL_SECS: u64 = 25;
const FRAME_INTERVAL_SECS: u64 = 1;
const RECONNECT_DELAY_SECS: u64 = 5;
// Any presence key other than this one is treated as a remote viewer —
// simplest possible distinction given there's only ever one host per topic.
const HOST_PRESENCE_KEY: &str = "host";

type WsWriter = SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;

pub struct RemoteHandle {
    task: tauri::async_runtime::JoinHandle<()>,
}

pub struct RemoteState(pub Mutex<Option<RemoteHandle>>);

impl RemoteState {
    pub fn new() -> Self {
        RemoteState(Mutex::new(None))
    }
}

fn generate_code() -> String {
    let mut rng = rand::thread_rng();
    (0..CODE_LEN).map(|_| rng.gen_range(0..10).to_string()).collect()
}

#[tauri::command]
pub fn generate_remote_code(app: AppHandle) -> Result<String, String> {
    let mut settings = load_settings(app.clone())?;
    let code = generate_code();
    settings.remote_code = Some(code.clone());
    save_settings(app.clone(), settings)?;
    start_remote_task(app, code.clone());
    Ok(code)
}

#[tauri::command]
pub fn clear_remote_code(app: AppHandle) -> Result<(), String> {
    let mut settings = load_settings(app.clone())?;
    settings.remote_code = None;
    save_settings(app.clone(), settings)?;
    stop_remote_task(&app);
    Ok(())
}

// Called once at startup (lib.rs setup hook) — if a code survived from a
// previous session, start listening again immediately without requiring
// the user to reopen Settings, since the whole point of persisting it is
// that the site reconnects on its own.
pub fn resume_remote_on_startup(app: AppHandle) {
    if let Ok(settings) = load_settings(app.clone()) {
        if let Some(code) = settings.remote_code {
            start_remote_task(app, code);
        }
    }
}

fn stop_remote_task(app: &AppHandle) {
    let state = app.state::<RemoteState>();
    let existing = state.0.lock().unwrap().take();
    if let Some(handle) = existing {
        handle.task.abort();
    }
}

fn start_remote_task(app: AppHandle, code: String) {
    stop_remote_task(&app);
    let app_for_task = app.clone();
    // tauri::async_runtime::spawn, not bare tokio::spawn: this is called
    // from resume_remote_on_startup, itself invoked from lib.rs's `setup`
    // hook on the main thread — a thread that never `.enter()`s the tokio
    // runtime, so bare tokio::spawn panics there ("there is no reactor
    // running"). That panic on the main thread took the whole process down
    // on every single launch once a remote_code was persisted (real
    // incident, not hypothetical — reported by the user testing v0.5.7).
    // tauri::async_runtime::spawn uses Tauri's own stored runtime Handle
    // instead of thread-local ambient context, so it's safe from any
    // thread, including this one.
    let task = tauri::async_runtime::spawn(async move {
        remote_loop(app_for_task, code).await;
    });
    let state = app.state::<RemoteState>();
    *state.0.lock().unwrap() = Some(RemoteHandle { task });
}

async fn remote_loop(app: AppHandle, code: String) {
    let topic = format!("realtime:remote:{code}");
    loop {
        if let Err(e) = run_connection(&app, &topic).await {
            eprintln!("[remote] connexion Realtime perdue, nouvelle tentative dans {RECONNECT_DELAY_SECS}s : {e}");
        }
        tokio::time::sleep(Duration::from_secs(RECONNECT_DELAY_SECS)).await;
    }
}

fn build_frame(join_ref: &str, msg_ref: &str, topic: &str, event: &str, payload: Value) -> Message {
    Message::Text(json!([join_ref, msg_ref, topic, event, payload]).to_string().into())
}

fn build_heartbeat(msg_ref: &str) -> Message {
    Message::Text(json!([Value::Null, msg_ref, "phoenix", "heartbeat", {}]).to_string().into())
}

fn build_broadcast(join_ref: &str, msg_ref: &str, topic: &str, event: &str, payload: Value) -> Message {
    build_frame(
        join_ref,
        msg_ref,
        topic,
        "broadcast",
        json!({ "event": event, "type": "broadcast", "payload": payload }),
    )
}

fn extract_viewer_keys(payload: &Value) -> HashSet<String> {
    payload
        .as_object()
        .map(|obj| obj.keys().filter(|k| k.as_str() != HOST_PRESENCE_KEY).cloned().collect())
        .unwrap_or_default()
}

fn apply_presence_diff(viewers: &mut HashSet<String>, payload: &Value) {
    if let Some(joins) = payload["joins"].as_object() {
        for key in joins.keys().filter(|k| k.as_str() != HOST_PRESENCE_KEY) {
            viewers.insert(key.clone());
        }
    }
    if let Some(leaves) = payload["leaves"].as_object() {
        for key in leaves.keys() {
            viewers.remove(key);
        }
    }
}

fn emit_viewer_status(app: &AppHandle, connected: bool) {
    let _ = app.emit("remote-viewer-changed", json!({ "connected": connected }));
}

fn push_memory(app: &AppHandle, out_tx: &UnboundedSender<Message>, join_ref: &str, ref_counter: &Arc<AtomicU64>, topic: &str) {
    let entries = load_memory(app).unwrap_or_default();
    let r = ref_counter.fetch_add(1, Ordering::SeqCst).to_string();
    let _ = out_tx.send(build_broadcast(join_ref, &r, topic, "memory", json!({ "entries": entries })));
}

// RAII cleanup for the listeners attached below — run_connection has
// several early-return points (via `?` and explicit `return Err(...)`),
// same reasoning as WatchdogGuard in watchdog.rs: every exit path
// unregisters the listeners without having to remember to do it at each
// return individually.
struct MirrorGuard<'a> {
    app: &'a AppHandle,
    ids: Vec<tauri::EventId>,
}

impl Drop for MirrorGuard<'_> {
    fn drop(&mut self) {
        for id in self.ids.drain(..) {
            self.app.unlisten(id);
        }
    }
}

async fn run_connection(app: &AppHandle, topic: &str) -> Result<(), String> {
    let host = SUPABASE_URL.trim_start_matches("https://").trim_start_matches("http://");
    let url = format!("wss://{host}/realtime/v1/websocket?apikey={SUPABASE_ANON_KEY}&vsn=1.0.0");
    let (ws_stream, _) = connect_async(&url).await.map_err(|e| e.to_string())?;
    let (mut write, mut read) = ws_stream.split();

    let ref_counter = Arc::new(AtomicU64::new(1));
    let join_ref = ref_counter.fetch_add(1, Ordering::SeqCst).to_string();

    let join_payload = json!({
        "config": {
            "broadcast": { "ack": false, "self": false },
            "presence": { "enabled": true, "key": HOST_PRESENCE_KEY }
        }
    });
    write
        .send(build_frame(&join_ref, &join_ref, topic, "phx_join", join_payload))
        .await
        .map_err(|e| e.to_string())?;

    // Instructions triggered by a remote broadcast run in their own task
    // (a Control Me session can take a while) but still need to push
    // broadcasts back out through this single WebSocket connection — this
    // channel lets them do that without needing `write` itself, which
    // isn't `Clone`.
    let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    // Mirrors the exact same local Tauri events run_control_me_core emits
    // — attached once for the whole connection's lifetime (not just while
    // a remote-triggered instruction is running) so a LOCAL Control Me
    // session, run by someone sitting at the PC, is also mirrored live to
    // a connected site viewer, matching a local-triggered run's own
    // ControlMeView display. Also refreshes the memory panel on the site
    // after any run finishes, in case remember_fact was called.
    let mirror_out_tx = out_tx.clone();
    let mirror_join_ref = join_ref.clone();
    let mirror_topic = topic.to_string();
    let mirror_ref_counter = ref_counter.clone();
    let mirror_app = app.clone();
    let mirror = move |event_name: &'static str, payload: Value| {
        let r = mirror_ref_counter.fetch_add(1, Ordering::SeqCst).to_string();
        let _ = mirror_out_tx.send(build_broadcast(&mirror_join_ref, &r, &mirror_topic, event_name, payload));
        if matches!(event_name, "done" | "error" | "cancelled") {
            push_memory(&mirror_app, &mirror_out_tx, &mirror_join_ref, &mirror_ref_counter, &mirror_topic);
        }
    };
    let _mirror_guard = MirrorGuard { app, ids: attach_mirrors(app, mirror) };

    let mut viewers: HashSet<String> = HashSet::new();
    let mut frame_ticker = tokio::time::interval(Duration::from_secs(FRAME_INTERVAL_SECS));
    let mut heartbeat_ticker = tokio::time::interval(Duration::from_secs(HEARTBEAT_INTERVAL_SECS));

    loop {
        tokio::select! {
            incoming = read.next() => {
                let msg = match incoming {
                    Some(Ok(m)) => m,
                    Some(Err(e)) => return Err(e.to_string()),
                    None => return Err("Connexion Realtime fermée par le serveur".to_string()),
                };
                handle_incoming(app, topic, msg, &mut viewers, &out_tx, &join_ref, &ref_counter);
            }
            outgoing = out_rx.recv() => {
                if let Some(m) = outgoing {
                    if write.send(m).await.is_err() {
                        return Err("Envoi Realtime échoué".to_string());
                    }
                }
            }
            _ = frame_ticker.tick() => {
                broadcast_frame_if_viewer(&mut write, &join_ref, &ref_counter, topic, &viewers).await;
            }
            _ = heartbeat_ticker.tick() => {
                let r = ref_counter.fetch_add(1, Ordering::SeqCst).to_string();
                let _ = write.send(build_heartbeat(&r)).await;
            }
        }
    }
}

async fn broadcast_frame_if_viewer(
    write: &mut WsWriter,
    join_ref: &str,
    ref_counter: &Arc<AtomicU64>,
    topic: &str,
    viewers: &HashSet<String>,
) {
    if viewers.is_empty() {
        return;
    }
    let Ok((jpeg, _, _)) = capture_screenshot_base64() else {
        return;
    };
    let r = ref_counter.fetch_add(1, Ordering::SeqCst).to_string();
    let frame = build_broadcast(join_ref, &r, topic, "frame", json!({ "jpeg_base64": jpeg }));
    let _ = write.send(frame).await;
}

fn handle_incoming(
    app: &AppHandle,
    topic: &str,
    msg: Message,
    viewers: &mut HashSet<String>,
    out_tx: &UnboundedSender<Message>,
    join_ref: &str,
    ref_counter: &Arc<AtomicU64>,
) {
    let Message::Text(text) = msg else { return };
    let Ok(parsed) = serde_json::from_str::<Value>(text.as_str()) else { return };
    let Some(arr) = parsed.as_array() else { return };
    if arr.len() != 5 {
        return;
    }
    let event = arr[3].as_str().unwrap_or("");
    let payload = &arr[4];

    match event {
        "presence_state" => {
            *viewers = extract_viewer_keys(payload);
            emit_viewer_status(app, !viewers.is_empty());
        }
        "presence_diff" => {
            let has_new_viewer = payload["joins"]
                .as_object()
                .map(|j| j.keys().any(|k| k.as_str() != HOST_PRESENCE_KEY))
                .unwrap_or(false);
            apply_presence_diff(viewers, payload);
            emit_viewer_status(app, !viewers.is_empty());
            // A viewer freshly joining has no idea what's already been
            // remembered — send them the current memory list right away,
            // same as ControlMeView's own memory panel would show locally.
            if has_new_viewer {
                push_memory(app, out_tx, join_ref, ref_counter, topic);
            }
        }
        "broadcast" => {
            let inner_event = payload["event"].as_str().unwrap_or("");
            match inner_event {
                "instruction" => {
                    let text = payload["payload"]["text"].as_str().unwrap_or("").trim().to_string();
                    if !text.is_empty() {
                        spawn_remote_instruction(
                            app.clone(),
                            topic.to_string(),
                            join_ref.to_string(),
                            ref_counter.clone(),
                            out_tx.clone(),
                            text,
                        );
                    }
                }
                "stop" => {
                    app.state::<ControlMeCancelFlag>().0.store(true, Ordering::SeqCst);
                }
                "clear_memory" => {
                    let _ = save_memory(app, &[]);
                    push_memory(app, out_tx, join_ref, ref_counter, topic);
                }
                _ => {}
            }
        }
        _ => {}
    }
}

// The mirror listeners are attached once for the whole connection
// (run_connection), not here — a remote instruction just needs to call the
// shared Gemini loop; mirroring happens automatically for whatever it
// emits, the same way it would for a local run.
//
// Known gap: control-me-confirmation-required is NOT mirrored — a
// safety_decision pause triggered by a remote instruction can currently
// only be resolved from the local app (ControlMeView/Settings), not from
// the site itself. Flagged as a real limitation, not silently glossed
// over; a full fix needs the site to send its own approve/refuse broadcast
// routed into resolve_control_me_confirmation, not built in this pass.
fn spawn_remote_instruction(
    app: AppHandle,
    topic: String,
    join_ref: String,
    ref_counter: Arc<AtomicU64>,
    out_tx: UnboundedSender<Message>,
    text: String,
) {
    tauri::async_runtime::spawn(async move {
        let settings = match load_settings(app.clone()) {
            Ok(s) => s,
            Err(e) => {
                send_error(&out_tx, &join_ref, &ref_counter, &topic, &e);
                return;
            }
        };
        let api_key = settings.gemini_api_key.unwrap_or_default();
        if api_key.trim().is_empty() {
            send_error(
                &out_tx,
                &join_ref,
                &ref_counter,
                &topic,
                "Aucune clé API Gemini configurée dans l'app.",
            );
            return;
        }

        let cancel = app.state::<ControlMeCancelFlag>().0.clone();
        let confirmation = app.state::<ControlMeConfirmation>().0.clone();
        let _ = run_control_me_core(app, cancel, confirmation, api_key, settings.gemini_model, text).await;
    });
}

fn send_error(out_tx: &UnboundedSender<Message>, join_ref: &str, ref_counter: &Arc<AtomicU64>, topic: &str, message: &str) {
    let r = ref_counter.fetch_add(1, Ordering::SeqCst).to_string();
    let _ = out_tx.send(build_broadcast(join_ref, &r, topic, "error", json!({ "message": message })));
}

fn attach_mirrors(
    app: &AppHandle,
    mirror: impl Fn(&'static str, Value) + Send + Sync + Clone + 'static,
) -> Vec<tauri::EventId> {
    let events: [(&'static str, &'static str); 6] = [
        ("control-me-step", "step"),
        ("control-me-message", "message"),
        ("control-me-done", "done"),
        ("control-me-error", "error"),
        ("control-me-cancelled", "cancelled"),
        ("control-me-limit", "limit"),
    ];
    events
        .into_iter()
        .map(|(tauri_event, remote_event)| {
            let m = mirror.clone();
            app.listen(tauri_event, move |event| {
                let payload = serde_json::from_str::<Value>(event.payload()).unwrap_or(Value::Null);
                m(remote_event, payload);
            })
        })
        .collect()
}
