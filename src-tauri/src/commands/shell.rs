use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

pub struct ShellCancelFlag(pub Arc<AtomicBool>);

const DEFAULT_TIMEOUT_SECS: u64 = 120;

#[derive(Serialize, Clone)]
struct ShellOutputPayload {
    stream: String,
    line: String,
}

#[derive(Serialize, Clone)]
struct ShellDonePayload {
    exit_code: Option<i32>,
}

#[derive(Serialize, Clone)]
struct ShellErrorPayload {
    message: String,
}

#[tauri::command]
pub fn run_powershell_command(
    app: AppHandle,
    cancel: State<ShellCancelFlag>,
    command: String,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
) -> Result<(), String> {
    cancel.0.store(false, Ordering::SeqCst);
    let flag = cancel.0.clone();
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS));

    std::thread::spawn(move || {
        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", &command])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(dir) = &cwd {
            cmd.current_dir(dir);
        }
        // Output is already captured via the piped stdout/stderr above and
        // streamed into the transcript panel — the console window itself
        // was never meant to be seen, just a leftover default.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(super::CREATE_NO_WINDOW);
        }

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit(
                    "shell-error",
                    ShellErrorPayload {
                        message: format!("Impossible de lancer PowerShell : {}", e),
                    },
                );
                return;
            }
        };

        let (tx, rx) = mpsc::channel::<(String, String)>();

        if let Some(stdout) = child.stdout.take() {
            let tx = tx.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines().flatten() {
                    let _ = tx.send(("stdout".to_string(), line));
                }
            });
        }
        if let Some(stderr) = child.stderr.take() {
            let tx = tx.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines().flatten() {
                    let _ = tx.send(("stderr".to_string(), line));
                }
            });
        }
        drop(tx);

        let start = Instant::now();
        let mut exit_code: Option<i32> = None;
        let mut timed_out = false;
        let mut killed = false;

        loop {
            while let Ok((stream, line)) = rx.try_recv() {
                let _ = app.emit("shell-output", ShellOutputPayload { stream, line });
            }

            if flag.load(Ordering::SeqCst) {
                let _ = child.kill();
                let _ = child.wait();
                killed = true;
                break;
            }
            if start.elapsed() > timeout {
                let _ = child.kill();
                let _ = child.wait();
                timed_out = true;
                break;
            }
            match child.try_wait() {
                Ok(Some(status)) => {
                    exit_code = status.code();
                    break;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(80)),
                Err(_) => break,
            }
        }

        std::thread::sleep(Duration::from_millis(50));
        while let Ok((stream, line)) = rx.try_recv() {
            let _ = app.emit("shell-output", ShellOutputPayload { stream, line });
        }

        if timed_out {
            let _ = app.emit(
                "shell-timeout",
                ShellErrorPayload {
                    message: format!("Commande interrompue après {}s (timeout)", timeout.as_secs()),
                },
            );
            return;
        }
        if killed {
            let _ = app.emit("shell-done", ShellDonePayload { exit_code: None });
            return;
        }
        let _ = app.emit("shell-done", ShellDonePayload { exit_code });
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_shell_command(cancel: State<ShellCancelFlag>) {
    cancel.0.store(true, Ordering::SeqCst);
}
