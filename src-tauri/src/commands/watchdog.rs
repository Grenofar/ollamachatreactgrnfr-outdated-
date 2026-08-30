use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

// Watches both send_chat's streaming and agent_chat's internally-streamed
// call (see agent.rs) — each reports a chunk as real forward progress via
// report_progress. Scoped tightly to the Ollama HTTP call itself in both
// cases: Codex's tool EXECUTION (write_file/edit_file/run_powershell_command)
// happens afterward, in separate commands entirely, once agent_chat has
// already returned and its WatchdogGuard already dropped — so this never
// fires while a file write or shell command is actually in flight.
const STALL_TIMEOUT: Duration = Duration::from_secs(120);
const TICK: Duration = Duration::from_secs(5);

pub struct WatchdogInner {
    // A count rather than a bool: the basic chat and Codex can technically
    // both be generating at once (nothing stops switching views mid-reply),
    // and a plain bool would have one finishing early wrongly clear
    // "active" out from under the other still-running one.
    active_count: u32,
    last_progress: Instant,
    warned: bool,
}

pub struct Watchdog(pub Arc<Mutex<WatchdogInner>>);

impl Watchdog {
    pub fn new() -> Self {
        Watchdog(Arc::new(Mutex::new(WatchdogInner {
            active_count: 0,
            last_progress: Instant::now(),
            warned: false,
        })))
    }
}

// RAII guard: registers one generation as active on creation, unregisters on
// drop — so every exit path of the call it wraps (early return on error,
// cancel, normal completion) clears its share correctly without having to
// remember to call something at each of them individually.
pub struct WatchdogGuard(Arc<Mutex<WatchdogInner>>);

impl WatchdogGuard {
    pub fn start(watchdog: &Arc<Mutex<WatchdogInner>>) -> Self {
        let mut w = watchdog.lock().unwrap();
        w.active_count += 1;
        w.last_progress = Instant::now();
        w.warned = false;
        WatchdogGuard(watchdog.clone())
    }
}

impl Drop for WatchdogGuard {
    fn drop(&mut self) {
        let mut w = self.0.lock().unwrap();
        w.active_count = w.active_count.saturating_sub(1);
        if w.active_count == 0 {
            w.warned = false;
        }
    }
}

// Call on every streamed chunk from either send_chat or agent_chat. Also
// auto-resolves a warning already shown to the frontend, since a resumed
// stream means it wasn't actually frozen — no need to make the user click
// anything for the common case.
pub fn report_progress(watchdog: &Arc<Mutex<WatchdogInner>>, app: &AppHandle) {
    let mut w = watchdog.lock().unwrap();
    w.last_progress = Instant::now();
    if w.warned {
        w.warned = false;
        drop(w);
        let _ = app.emit("freeze-resolved", ());
    }
}

#[derive(Serialize, Clone)]
struct FreezeWarningPayload {
    stalled_secs: u64,
}

pub fn spawn_watchdog_thread(app: AppHandle, watchdog: Arc<Mutex<WatchdogInner>>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(TICK);
        let mut w = watchdog.lock().unwrap();
        if w.active_count == 0 || w.warned {
            continue;
        }
        let stalled = w.last_progress.elapsed();
        if stalled > STALL_TIMEOUT {
            w.warned = true;
            let stalled_secs = stalled.as_secs();
            drop(w);
            let _ = app.emit("freeze-warning", FreezeWarningPayload { stalled_secs });
        }
    });
}

// The frontend owns the actual grace-period countdown (see App.tsx) and
// calls this once it decides to actually close — kept as a separate command
// rather than closing automatically from the watchdog thread so the user
// always gets a chance to say "no, it's fine, keep waiting" first.
#[tauri::command]
pub fn close_app(app: AppHandle) {
    app.exit(0);
}
