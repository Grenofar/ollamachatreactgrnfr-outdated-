use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::State;

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

#[tauri::command]
pub async fn agent_chat(
    cancel: State<'_, AgentCancelFlag>,
    host: String,
    model: String,
    messages: Vec<AgentMessage>,
    tools: Vec<serde_json::Value>,
) -> Result<AgentChatResponse, String> {
    cancel.0.store(false, Ordering::SeqCst);
    let flag = cancel.0.clone();

    let url = format!("{}/api/chat", host.trim_end_matches('/'));
    let wire_messages: Vec<serde_json::Value> = messages.iter().map(to_ollama_message).collect();
    let body = serde_json::json!({
        "model": model,
        "messages": wire_messages,
        "tools": tools,
        "stream": false,
    });

    let client = reqwest::Client::new();
    let resp = tokio::select! {
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

    let data: serde_json::Value = tokio::select! {
        result = resp.json() => result.map_err(|e| e.to_string())?,
        _ = wait_for_cancel(flag.clone()) => return Err(CANCELLED_MESSAGE.to_string()),
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

    let content = data["message"]["content"].as_str().unwrap_or("").to_string();
    let tool_calls = parse_tool_calls(&data["message"]["tool_calls"]);

    Ok(AgentChatResponse { content, tool_calls })
}

#[tauri::command]
pub fn cancel_agent_chat(cancel: State<AgentCancelFlag>) {
    cancel.0.store(true, Ordering::SeqCst);
}
