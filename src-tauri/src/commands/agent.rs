use serde::{Deserialize, Serialize};

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

#[tauri::command]
pub fn agent_chat(
    host: String,
    model: String,
    messages: Vec<AgentMessage>,
    tools: Vec<serde_json::Value>,
) -> Result<AgentChatResponse, String> {
    let url = format!("{}/api/chat", host.trim_end_matches('/'));
    let wire_messages: Vec<serde_json::Value> = messages.iter().map(to_ollama_message).collect();
    let body = serde_json::json!({
        "model": model,
        "messages": wire_messages,
        "tools": tools,
        "stream": false,
    });

    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .map_err(|e| format!("Impossible de contacter Ollama sur {} : {}", host, e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().unwrap_or_default();
        if text.contains("does not support tools") {
            return Err(format!(
                "Le modèle « {} » ne supporte pas les outils. Choisis un modèle compatible (ex. qwen2.5, llama3.1, mistral-nemo).",
                model
            ));
        }
        return Err(format!("Ollama a répondu avec le statut {} : {}", status, text));
    }

    let data: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
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
