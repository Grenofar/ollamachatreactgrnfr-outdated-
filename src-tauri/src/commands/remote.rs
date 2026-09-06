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
use super::chat::{list_models as list_ollama_models, send_chat, CancelFlag as ChatCancelFlag, ChatMessage};
use super::controlme::{
    capture_screenshot_base64_scaled, load_memory, run_control_me_core, save_memory, ControlMeCancelFlag,
    ControlMeConfirmation,
};
use super::settings::{load_settings, save_settings};
use super::watchdog::Watchdog;
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
// Literal 60fps was asked for but isn't a responsible default: at
// SCREENSHOT_MAX_WIDTH/quality, a sustained 60 frames/sec would mean
// ~30-70 Mbps of continuous upload plus 60 encode passes/sec on the host
// PC — most home connections can't sustain that, and it'd noticeably load
// the CPU for as long as anyone's watching. 10fps (10x smoother than the
// previous 1fps) plus a smaller/more compressed frame specifically for
// this live-preview stream (see FRAME_MAX_WIDTH/FRAME_JPEG_QUALITY below —
// Gemini's own vision capture is untouched, still the sharper original)
// keeps bandwidth in a plausible range while still being a real,
// noticeable smoothness improvement.
const FRAME_INTERVAL_MS: u64 = 100;
const FRAME_MAX_WIDTH: u32 = 960;
const FRAME_JPEG_QUALITY: u8 = 55;
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

// Broadcast pushes use a dedicated BINARY frame format ("userBroadcastPush",
// kind 3), not a plain JSON text push like every other message type here —
// a real thing discovered only by reading @supabase/realtime-js's actual
// serializer.ts source and diffing it against a hand-rolled JSON attempt
// that the server silently swallowed (no error, just never delivered).
// Layout: kind(1) + joinRef_len(1) + ref_len(1) + topic_len(1) +
// event_len(1) + metadata_len(1) + encoding(1) = 7-byte header, then the
// raw bytes of joinRef/ref/topic/event/metadata back to back, then the
// JSON-encoded payload. Metadata is always empty here (we never configure
// allowedMetadataKeys, matching the client's own default of `[]`).
fn build_broadcast(join_ref: &str, msg_ref: &str, topic: &str, event: &str, payload: &Value) -> Message {
    let join_ref_b = join_ref.as_bytes();
    let ref_b = msg_ref.as_bytes();
    let topic_b = topic.as_bytes();
    let event_b = event.as_bytes();
    let payload_json = serde_json::to_vec(payload).unwrap_or_default();

    let mut bytes = Vec::with_capacity(7 + join_ref_b.len() + ref_b.len() + topic_b.len() + event_b.len() + payload_json.len());
    bytes.push(3u8); // KINDS.userBroadcastPush
    bytes.push(join_ref_b.len() as u8);
    bytes.push(ref_b.len() as u8);
    bytes.push(topic_b.len() as u8);
    bytes.push(event_b.len() as u8);
    bytes.push(0u8); // metadata length — always empty
    bytes.push(1u8); // JSON_ENCODING
    bytes.extend_from_slice(join_ref_b);
    bytes.extend_from_slice(ref_b);
    bytes.extend_from_slice(topic_b);
    bytes.extend_from_slice(event_b);
    bytes.extend_from_slice(&payload_json);
    Message::Binary(bytes.into())
}

// The server's own outgoing broadcast frames use a DIFFERENT binary layout
// (kind 4, "userBroadcast") — no joinRef/ref fields at all, since a
// delivered broadcast doesn't need them. Layout: kind(1) + topic_len(1) +
// event_len(1) + metadata_len(1) + encoding(1) = 5-byte header, then
// topic/event/metadata bytes, then the JSON payload.
fn decode_broadcast_binary(bytes: &[u8]) -> Option<(String, Value)> {
    if bytes.first() != Some(&4u8) || bytes.len() < 5 {
        return None;
    }
    let topic_len = bytes[1] as usize;
    let event_len = bytes[2] as usize;
    let metadata_len = bytes[3] as usize;
    // topic is always our own single channel's own topic here — skipped
    // over rather than decoded, callers don't need it.
    let mut offset = 5usize.checked_add(topic_len)?;
    let event_end = offset.checked_add(event_len)?;
    let event = String::from_utf8(bytes.get(offset..event_end)?.to_vec()).ok()?;
    offset = event_end.checked_add(metadata_len)?;
    let payload_bytes = bytes.get(offset..)?;
    let payload: Value =
        if payload_bytes.is_empty() { Value::Null } else { serde_json::from_slice(payload_bytes).unwrap_or(Value::Null) };
    Some((event, payload))
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
    let _ = out_tx.send(build_broadcast(join_ref, &r, topic, "memory", &json!({ "entries": entries })));
}

// Tells a freshly-joined site viewer which tabs it can actually offer —
// Chat (Ollama) is always available, Control Me only if not disabled
// locally (ExtensionsView). Codex has no remote equivalent (a code editor
// makes no sense driven from a phone/browser), so it's never advertised
// here regardless of its own toggle.
fn push_capabilities(app: &AppHandle, out_tx: &UnboundedSender<Message>, join_ref: &str, ref_counter: &Arc<AtomicU64>, topic: &str) {
    let controlme_enabled = load_settings(app.clone())
        .map(|s| !s.disabled_extensions.iter().any(|e| e == "controlme"))
        .unwrap_or(true);
    let r = ref_counter.fetch_add(1, Ordering::SeqCst).to_string();
    let _ = out_tx.send(build_broadcast(
        join_ref,
        &r,
        topic,
        "capabilities",
        &json!({ "chat": true, "controlme": controlme_enabled }),
    ));
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
    // vsn=2.0.0, not 1.0.0 — the real bug behind "code correct mais dit
    // incorrect" (v0.6.0 hotfix). Confirmed empirically, not from docs: a
    // vsn=1.0.0 join to this Supabase Realtime instance gets connected but
    // never receives a single reply frame for phx_join (no error, no
    // timeout close, just silence) — so the host side never actually
    // joins, presence never shows "host", and every viewer join times out
    // looking like a wrong code. A raw WebSocket join with the exact same
    // payload succeeds instantly once vsn=2.0.0 is used instead — verified
    // by connecting a hand-rolled client alongside the real
    // @supabase/supabase-js library and diffing what each actually sends
    // on the wire, not assumed from documentation this time.
    let url = format!("wss://{host}/realtime/v1/websocket?apikey={SUPABASE_ANON_KEY}&vsn=2.0.0");
    let (ws_stream, _) = connect_async(&url).await.map_err(|e| e.to_string())?;
    let (mut write, mut read) = ws_stream.split();

    let ref_counter = Arc::new(AtomicU64::new(1));
    let join_ref = ref_counter.fetch_add(1, Ordering::SeqCst).to_string();

    // postgres_changes/private, and presence.enabled: false, are not
    // optional extras — a join payload missing them (as this one originally
    // did) gets silently dropped by the server with zero reply, same
    // failure mode as the wrong vsn above. Matched byte-for-byte against
    // what the real client actually sends (sniffed on the wire), not
    // assumed from the protocol docs.
    let join_payload = json!({
        "config": {
            "broadcast": { "ack": false, "self": false },
            "presence": { "enabled": false, "key": HOST_PRESENCE_KEY },
            "postgres_changes": [],
            "private": false
        }
    });
    write
        .send(build_frame(&join_ref, &join_ref, topic, "phx_join", join_payload))
        .await
        .map_err(|e| e.to_string())?;

    // The join payload's presence.key only reserves our identity for
    // presence — it does NOT itself make us show up in presence_state/
    // presence_diff. That requires a separate explicit "track" push after
    // the join succeeds, exactly like the real client's channel.track()
    // does — without this, the host joins fine but never actually appears
    // in presence, so every viewer times out waiting for it exactly as if
    // the code were wrong. Waits for the join's own phx_reply first (same
    // sequencing the real client uses) rather than sending track blind.
    let join_deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        let remaining = join_deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err("Timeout en attendant la confirmation de connexion Realtime (phx_join)".to_string());
        }
        let next = match tokio::time::timeout(remaining, read.next()).await {
            Ok(Some(Ok(m))) => m,
            Ok(Some(Err(e))) => return Err(e.to_string()),
            Ok(None) => return Err("Connexion Realtime fermée avant confirmation du join".to_string()),
            Err(_) => return Err("Timeout en attendant la confirmation de connexion Realtime (phx_join)".to_string()),
        };
        let Message::Text(text) = &next else { continue };
        let Ok(parsed) = serde_json::from_str::<Value>(text) else { continue };
        let Some(arr) = parsed.as_array() else { continue };
        if arr.len() == 5 && arr[1].as_str() == Some(join_ref.as_str()) && arr[3] == "phx_reply" {
            if arr[4]["status"] == "ok" {
                break;
            }
            return Err(format!("Le serveur Realtime a refusé la connexion : {}", arr[4]));
        }
    }
    let track_ref = ref_counter.fetch_add(1, Ordering::SeqCst).to_string();
    write
        .send(build_frame(
            &join_ref,
            &track_ref,
            topic,
            "presence",
            json!({ "type": "presence", "event": "track", "payload": { "role": "host" } }),
        ))
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
        let _ = mirror_out_tx.send(build_broadcast(&mirror_join_ref, &r, &mirror_topic, event_name, &payload));
        if matches!(event_name, "done" | "error" | "cancelled") {
            push_memory(&mirror_app, &mirror_out_tx, &mirror_join_ref, &mirror_ref_counter, &mirror_topic);
        }
    };
    let _mirror_guard = MirrorGuard { app, ids: attach_mirrors(app, mirror) };

    let mut viewers: HashSet<String> = HashSet::new();
    let mut frame_ticker = tokio::time::interval(Duration::from_millis(FRAME_INTERVAL_MS));
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
    let Ok((jpeg, _, _)) = capture_screenshot_base64_scaled(FRAME_MAX_WIDTH, FRAME_JPEG_QUALITY) else {
        return;
    };
    let r = ref_counter.fetch_add(1, Ordering::SeqCst).to_string();
    let frame = build_broadcast(join_ref, &r, topic, "frame", &json!({ "jpeg_base64": jpeg }));
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
    // Every broadcast the site sends (channel.send({type:"broadcast",...}))
    // goes out from @supabase/supabase-js as a BINARY "userBroadcastPush"
    // frame, not JSON text — see build_broadcast's doc comment. Every other
    // incoming message type (phx_reply, presence_state, presence_diff)
    // stays plain JSON text. Both paths converge on the same
    // handle_broadcast_event once unwrapped, so the six broadcast branches
    // below don't need to exist twice.
    if let Message::Binary(bytes) = &msg {
        if let Some((inner_event, inner_payload)) = decode_broadcast_binary(bytes) {
            handle_broadcast_event(app, topic, &inner_event, &inner_payload, out_tx, join_ref, ref_counter);
        }
        return;
    }
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
                push_capabilities(app, out_tx, join_ref, ref_counter, topic);
            }
        }
        // A JSON-text "broadcast" event would only ever arrive here from a
        // client not using @supabase/supabase-js's default encoding (none
        // do today) — kept as a harmless fallback rather than assumed dead.
        "broadcast" => {
            let inner_event = payload["event"].as_str().unwrap_or("").to_string();
            let inner_payload = payload["payload"].clone();
            handle_broadcast_event(app, topic, &inner_event, &inner_payload, out_tx, join_ref, ref_counter);
        }
        _ => {}
    }
}

fn handle_broadcast_event(
    app: &AppHandle,
    topic: &str,
    inner_event: &str,
    inner_payload: &Value,
    out_tx: &UnboundedSender<Message>,
    join_ref: &str,
    ref_counter: &Arc<AtomicU64>,
) {
    match inner_event {
        "instruction" => {
            let text = inner_payload["text"].as_str().unwrap_or("").trim().to_string();
            let active_skill_ids: Vec<String> = inner_payload["active_skill_ids"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            if !text.is_empty() {
                spawn_remote_instruction(
                    app.clone(),
                    topic.to_string(),
                    join_ref.to_string(),
                    ref_counter.clone(),
                    out_tx.clone(),
                    text,
                    active_skill_ids,
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
        "chat_message" => {
            let messages: Vec<ChatMessage> = serde_json::from_value(inner_payload["messages"].clone()).unwrap_or_default();
            let model = inner_payload["model"].as_str().unwrap_or("").trim().to_string();
            if !messages.is_empty() && !model.is_empty() {
                spawn_remote_chat(app.clone(), model, messages);
            }
        }
        "chat_stop" => {
            app.state::<ChatCancelFlag>().0.store(true, Ordering::SeqCst);
        }
        "list_models" => {
            spawn_remote_list_models(app.clone(), topic.to_string(), join_ref.to_string(), ref_counter.clone(), out_tx.clone());
        }
        "list_skills" => {
            let skills = super::skills::list_skills(app.clone()).unwrap_or_default();
            let r = ref_counter.fetch_add(1, Ordering::SeqCst).to_string();
            let _ = out_tx.send(build_broadcast(join_ref, &r, topic, "skills", &json!({ "skills": skills })));
        }
        _ => {}
    }
}

// send_chat is a plain sync command (spawns its own std::thread and emits
// chat-chunk/chat-done/chat-error/chat-cancelled Tauri events, mirrored to
// the site exactly like Control Me's events — see attach_mirrors) — it can
// be called directly with an AppHandle and the states it needs, no IPC
// round-trip required, same pattern as run_control_me_core.
fn spawn_remote_chat(app: AppHandle, model: String, messages: Vec<ChatMessage>) {
    let Ok(settings) = load_settings(app.clone()) else { return };
    let host = settings.ollama_host;
    let cancel = app.state::<ChatCancelFlag>();
    let watchdog = app.state::<Watchdog>();
    let _ = send_chat(app.clone(), cancel, watchdog, host, model, messages);
}

// list_models uses reqwest::blocking internally — spawn_blocking keeps that
// off the async runtime's worker threads instead of stalling this
// connection's own event loop (heartbeats, frame ticks) for however long a
// slow/unreachable Ollama host takes to respond.
fn spawn_remote_list_models(app: AppHandle, topic: String, join_ref: String, ref_counter: Arc<AtomicU64>, out_tx: UnboundedSender<Message>) {
    tauri::async_runtime::spawn(async move {
        let Ok(settings) = load_settings(app.clone()) else { return };
        let host = settings.ollama_host;
        let result = tokio::task::spawn_blocking(move || list_ollama_models(host)).await;
        let r = ref_counter.fetch_add(1, Ordering::SeqCst).to_string();
        let payload = match result {
            Ok(Ok(models)) => json!({ "models": models }),
            Ok(Err(e)) => json!({ "error": e }),
            Err(e) => json!({ "error": e.to_string() }),
        };
        let _ = out_tx.send(build_broadcast(&join_ref, &r, &topic, "models", &payload));
    });
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
    active_skill_ids: Vec<String>,
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
        // Skill selection now also works from the site (v0.6.0 hotfix) —
        // the site fetches the local skill list via a "list_skills"
        // broadcast and lets the user pick before sending an instruction,
        // exactly mirroring ControlMeView's own picker. windows_ui stays
        // forced on regardless of the local toggle — see the
        // force_windows_ui doc comment on run_control_me_core.
        let _ = run_control_me_core(
            app,
            cancel,
            confirmation,
            api_key,
            settings.gemini_model,
            text,
            active_skill_ids,
            // No skill recording for remote sessions: arming one is a
            // deliberate local gesture, and nobody is at the machine to stop
            // or cancel it.
            None,
            true,
        )
        .await;
    });
}

fn send_error(out_tx: &UnboundedSender<Message>, join_ref: &str, ref_counter: &Arc<AtomicU64>, topic: &str, message: &str) {
    let r = ref_counter.fetch_add(1, Ordering::SeqCst).to_string();
    let _ = out_tx.send(build_broadcast(join_ref, &r, topic, "error", &json!({ "message": message })));
}

fn attach_mirrors(
    app: &AppHandle,
    mirror: impl Fn(&'static str, Value) + Send + Sync + Clone + 'static,
) -> Vec<tauri::EventId> {
    // Chat's own mirror events are prefixed ("chat_done" not "done") since
    // Control Me and Chat run on the same channel and share this same
    // dispatch — an unprefixed "done" would be ambiguous between "a Control
    // Me session finished" and "a chat reply finished" on the site side.
    let events: [(&'static str, &'static str); 10] = [
        ("control-me-step", "step"),
        ("control-me-message", "message"),
        ("control-me-done", "done"),
        ("control-me-error", "error"),
        ("control-me-cancelled", "cancelled"),
        ("control-me-limit", "limit"),
        ("chat-chunk", "chat_chunk"),
        ("chat-done", "chat_done"),
        ("chat-error", "chat_error"),
        ("chat-cancelled", "chat_cancelled"),
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
