use super::watchdog::{report_progress, Watchdog, WatchdogGuard};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Clone)]
pub struct ChatDonePayload {
    pub content: String,
    pub eval_count: u64,
    pub prompt_eval_count: u64,
}

#[derive(Serialize, Clone)]
pub struct ErrorPayload {
    pub message: String,
}

#[derive(Serialize, Clone)]
pub struct InstallProgressPayload {
    pub status: String,
    pub completed: u64,
    pub total: u64,
}

pub struct CancelFlag(pub Arc<AtomicBool>);

#[derive(Serialize, Clone)]
pub struct OllamaModel {
    pub name: String,
    pub size: u64,
    pub parameter_size: Option<String>,
    pub quantization_level: Option<String>,
}

#[tauri::command]
pub fn list_models(host: String) -> Result<Vec<OllamaModel>, String> {
    let url = format!("{}/api/tags", host.trim_end_matches('/'));
    let resp = reqwest::blocking::get(&url)
        .map_err(|e| format!("Impossible de contacter Ollama sur {} : {}", host, e))?;
    let data: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let models = data["models"].as_array().cloned().unwrap_or_default();
    Ok(models
        .iter()
        .filter_map(|m| {
            let name = m["name"].as_str()?.to_string();
            Some(OllamaModel {
                name,
                size: m["size"].as_u64().unwrap_or(0),
                parameter_size: m["details"]["parameter_size"].as_str().map(|s| s.to_string()),
                quantization_level: m["details"]["quantization_level"].as_str().map(|s| s.to_string()),
            })
        })
        .collect())
}

#[tauri::command]
pub fn send_chat(
    app: AppHandle,
    cancel: State<CancelFlag>,
    watchdog: State<Watchdog>,
    host: String,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    cancel.0.store(false, Ordering::SeqCst);
    let flag = cancel.0.clone();
    let watchdog = watchdog.0.clone();

    std::thread::spawn(move || {
        let _watchdog_guard = WatchdogGuard::start(&watchdog);
        let url = format!("{}/api/chat", host.trim_end_matches('/'));
        let body = serde_json::json!({ "model": model, "messages": messages, "stream": true });
        let client = reqwest::blocking::Client::new();

        let resp = match client.post(&url).json(&body).send() {
            Ok(r) => r,
            Err(e) => {
                let _ = app.emit(
                    "chat-error",
                    ErrorPayload {
                        message: format!("Erreur pendant la discussion avec {} : {}", model, e),
                    },
                );
                return;
            }
        };

        if !resp.status().is_success() {
            let status = resp.status();
            let _ = app.emit(
                "chat-error",
                ErrorPayload {
                    message: format!("Ollama a répondu avec le statut {}", status),
                },
            );
            return;
        }

        let reader = BufReader::new(resp);
        let mut assembled = String::new();
        let mut eval_count = 0u64;
        let mut prompt_eval_count = 0u64;

        for line in reader.lines() {
            if flag.load(Ordering::SeqCst) {
                let _ = app.emit(
                    "chat-cancelled",
                    ChatDonePayload {
                        content: assembled,
                        eval_count,
                        prompt_eval_count,
                    },
                );
                return;
            }

            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };
            if line.trim().is_empty() {
                continue;
            }
            let chunk: serde_json::Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };

            if let Some(err) = chunk.get("error").and_then(|e| e.as_str()) {
                let _ = app.emit(
                    "chat-error",
                    ErrorPayload {
                        message: err.to_string(),
                    },
                );
                return;
            }

            let content = chunk["message"]["content"].as_str().unwrap_or("").to_string();
            if !content.is_empty() {
                assembled.push_str(&content);
                report_progress(&watchdog, &app);
                let _ = app.emit("chat-chunk", serde_json::json!({ "content": content }));
            }
            if chunk["done"].as_bool().unwrap_or(false) {
                eval_count = chunk["eval_count"].as_u64().unwrap_or(0);
                prompt_eval_count = chunk["prompt_eval_count"].as_u64().unwrap_or(0);
            }
        }

        let _ = app.emit(
            "chat-done",
            ChatDonePayload {
                content: assembled,
                eval_count,
                prompt_eval_count,
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_chat(cancel: State<CancelFlag>) {
    cancel.0.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn delete_model(host: String, name: String) -> Result<(), String> {
    let url = format!("{}/api/delete", host.trim_end_matches('/'));
    let client = reqwest::blocking::Client::new();
    let resp = client
        .delete(&url)
        .json(&serde_json::json!({ "model": name }))
        .send()
        .map_err(|e| format!("Impossible de contacter Ollama sur {} : {}", host, e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().unwrap_or_default();
        return Err(format!("Ollama a répondu avec le statut {} : {}", status, text));
    }
    Ok(())
}

#[tauri::command]
pub fn install_model(app: AppHandle, host: String, reference: String) -> Result<(), String> {
    std::thread::spawn(move || {
        let url = format!("{}/api/pull", host.trim_end_matches('/'));
        let body = serde_json::json!({ "model": reference, "stream": true });
        let client = reqwest::blocking::Client::new();

        let resp = match client.post(&url).json(&body).send() {
            Ok(r) => r,
            Err(e) => {
                let _ = app.emit(
                    "install-error",
                    ErrorPayload {
                        message: format!("Erreur de connexion à Ollama : {}", e),
                    },
                );
                return;
            }
        };

        if !resp.status().is_success() {
            let status = resp.status();
            let _ = app.emit(
                "install-error",
                ErrorPayload {
                    message: format!("Ollama a répondu avec le statut {}", status),
                },
            );
            return;
        }

        let reader = BufReader::new(resp);
        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };
            if line.trim().is_empty() {
                continue;
            }
            let chunk: serde_json::Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };

            if let Some(err) = chunk.get("error").and_then(|e| e.as_str()) {
                let _ = app.emit(
                    "install-error",
                    ErrorPayload {
                        message: err.to_string(),
                    },
                );
                return;
            }

            let status = chunk["status"].as_str().unwrap_or("").to_string();
            let completed = chunk["completed"].as_u64().unwrap_or(0);
            let total = chunk["total"].as_u64().unwrap_or(0);
            let finished = status == "success";
            let _ = app.emit(
                "install-progress",
                InstallProgressPayload {
                    status,
                    completed,
                    total,
                },
            );
            if finished {
                let _ = app.emit("install-done", ());
                return;
            }
        }
        let _ = app.emit("install-done", ());
    });

    Ok(())
}
