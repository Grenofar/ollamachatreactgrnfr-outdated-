use super::watchdog::{report_progress, Watchdog, WatchdogGuard};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, State};

pub struct AgentCancelFlag(pub Arc<AtomicBool>);

// Polls the shared flag instead of using a proper async notifier: agent_chat's
// only two await points (send + json parsing) are short-lived, so ~60ms of
// added cancel latency is not perceptible and this avoids a lost-wakeup race
// (cancel arriving between flag creation and first poll).
async fn wait_for_cancel(flag: Arc<AtomicBool>) {
    loop {
        if flag.load(Ordering::SeqCst) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(60)).await;
    }
}

#[derive(Deserialize, Serialize, Clone)]
pub struct AgentToolCall {
    pub id: Option<String>,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Deserialize, Clone)]
pub struct AgentMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub tool_calls: Option<Vec<AgentToolCall>>,
}

#[derive(Serialize, Clone)]
pub struct AgentChatResponse {
    pub content: String,
    pub tool_calls: Vec<AgentToolCall>,
}

// Ollama does not assign an id to tool_calls, so we synthesize a positional
// one purely for the frontend to correlate approval-modal promises; it is
// never sent back to Ollama.
fn parse_tool_calls(value: &serde_json::Value) -> Vec<AgentToolCall> {
    value
        .as_array()
        .map(|arr| {
            arr.iter()
                .enumerate()
                .map(|(i, tc)| {
                    let func = &tc["function"];
                    AgentToolCall {
                        id: Some(
                            tc.get("id")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| format!("call_{}", i)),
                        ),
                        name: func["name"].as_str().unwrap_or("").to_string(),
                        arguments: func["arguments"].clone(),
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn to_ollama_message(m: &AgentMessage) -> serde_json::Value {
    let mut obj = serde_json::json!({
        "role": m.role,
        "content": m.content,
    });
    if let Some(tool_calls) = &m.tool_calls {
        obj["tool_calls"] = serde_json::json!(tool_calls
            .iter()
            .map(|tc| serde_json::json!({ "function": { "name": tc.name, "arguments": tc.arguments } }))
            .collect::<Vec<_>>());
    }
    obj
}

const CANCELLED_MESSAGE: &str = "Annulé par l'utilisateur.";

// Streams internally (stream: true against Ollama) purely to get a
// per-chunk progress signal for the freeze watchdog — the external contract
// is unchanged, this still resolves once with the complete
// AgentChatResponse, so useAgentLoop.ts needed no changes at all. Ollama
// sends the tool_calls array whole (not built up incrementally token by
// token) in whichever chunk carries it, so "last non-empty tool_calls array
// seen wins" is the correct way to accumulate it across chunks.
#[tauri::command]
pub async fn agent_chat(
    cancel: State<'_, AgentCancelFlag>,
    watchdog: State<'_, Watchdog>,
    app: AppHandle,
    host: String,
    model: String,
    messages: Vec<AgentMessage>,
    tools: Vec<serde_json::Value>,
) -> Result<AgentChatResponse, String> {
    cancel.0.store(false, Ordering::SeqCst);
    let flag = cancel.0.clone();
    let watchdog = watchdog.0.clone();
    let _watchdog_guard = WatchdogGuard::start(&watchdog);

    let url = format!("{}/api/chat", host.trim_end_matches('/'));
    let wire_messages: Vec<serde_json::Value> = messages.iter().map(to_ollama_message).collect();
    let body = serde_json::json!({
        "model": model,
        "messages": wire_messages,
        "tools": tools,
        "stream": true,
    });

    let client = reqwest::Client::new();
    let mut resp = tokio::select! {
        result = client.post(&url).json(&body).send() => {
            result.map_err(|e| format!("Impossible de contacter Ollama sur {} : {}", host, e))?
        }
        _ = wait_for_cancel(flag.clone()) => return Err(CANCELLED_MESSAGE.to_string()),
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if text.contains("does not support tools") {
            return Err(format!(
                "Le modèle « {} » ne supporte pas les outils. Choisis un modèle compatible (ex. qwen2.5, llama3.1, mistral-nemo).",
                model
            ));
        }
        return Err(format!("Ollama a répondu avec le statut {} : {}", status, text));
    }

    let mut content = String::new();
    let mut tool_calls: Vec<AgentToolCall> = Vec::new();
    let mut buffer = String::new();

    loop {
        let chunk = tokio::select! {
            c = resp.chunk() => c.map_err(|e| format!("Erreur pendant la réception de la réponse : {}", e))?,
            _ = wait_for_cancel(flag.clone()) => return Err(CANCELLED_MESSAGE.to_string()),
        };
        let Some(bytes) = chunk else { break };
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer.drain(..=pos);
            if line.is_empty() {
                continue;
            }
            let data: serde_json::Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Some(err) = data.get("error").and_then(|e| e.as_str()) {
                if err.contains("does not support tools") {
                    return Err(format!(
                        "Le modèle « {} » ne supporte pas les outils. Choisis un modèle compatible (ex. qwen2.5, llama3.1, mistral-nemo).",
                        model
                    ));
                }
                return Err(err.to_string());
            }

            if let Some(c) = data["message"]["content"].as_str() {
                if !c.is_empty() {
                    content.push_str(c);
                    report_progress(&watchdog, &app);
                }
            }
            let parsed = parse_tool_calls(&data["message"]["tool_calls"]);
            if !parsed.is_empty() {
                tool_calls = parsed;
                report_progress(&watchdog, &app);
            }
        }
    }

    Ok(AgentChatResponse { content, tool_calls })
}

#[tauri::command]
pub fn cancel_agent_chat(cancel: State<AgentCancelFlag>) {
    cancel.0.store(true, Ordering::SeqCst);
}
