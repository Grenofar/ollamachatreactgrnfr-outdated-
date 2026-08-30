use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

// Scope: only the basic chat's streaming generation (send_chat) reports
// progress here. Each token is real, verifiable forward progress, so a long
// gap between tokens is a trustworthy stall signal. Codex's agent_chat is
// deliberately excluded: it's one non-streaming call with no per-token
// signal (a legitimately slow big model looks identical to a genuine hang),
// and it can be in the middle of write_file/edit_file/run_powershell_command
// when this would fire — force-closing then risks a corrupted/partial file,
// which is worse than a slow response.
const STALL_TIMEOUT: Duration = Duration::from_secs(120);
const TICK: Duration = Duration::from_secs(5);

pub struct WatchdogInner {
    active: bool,
    last_progress: Instant,
    warned: bool,
}

pub struct Watchdog(pub Arc<Mutex<WatchdogInner>>);

impl Watchdog {
    pub fn new() -> Self {
        Watchdog(Arc::new(Mutex::new(WatchdogInner {
            active: false,
            last_progress: Instant::now(),
            warned: false,
        })))
    }
}

// RAII guard: marks generation active on creation, inactive on drop — so
// every exit path in send_chat's thread (early return on error, cancel,
// normal completion) clears it correctly without having to remember to call
// something at each of them individually.
pub struct WatchdogGuard(Arc<Mutex<WatchdogInner>>);

impl WatchdogGuard {
    pub fn start(watchdog: &Arc<Mutex<WatchdogInner>>) -> Self {
        let mut w = watchdog.lock().unwrap();
        w.active = true;
        w.last_progress = Instant::now();
        w.warned = false;
        WatchdogGuard(watchdog.clone())
    }
}

impl Drop for WatchdogGuard {
    fn drop(&mut self) {
        let mut w = self.0.lock().unwrap();
        w.active = false;
        w.warned = false;
    }
}

// Call on every streamed chunk. Also auto-resolves a warning already shown
// to the frontend, since a resumed token stream means it wasn't actually
// frozen — no need to make the user click anything for the common case.
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
        if !w.active || w.warned {
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
