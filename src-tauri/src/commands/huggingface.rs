use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
pub struct HfModel {
    pub id: String,
    pub downloads: u64,
    pub likes: u64,
    pub tags: Vec<String>,
}

#[derive(Deserialize)]
struct HfModelRaw {
    id: String,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    likes: u64,
    #[serde(default)]
    tags: Vec<String>,
}

#[tauri::command]
pub fn search_hf_models(query: String) -> Result<Vec<HfModel>, String> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get("https://huggingface.co/api/models")
        .query(&[
            ("search", query.as_str()),
            ("filter", "gguf"),
            ("limit", "25"),
            ("sort", "downloads"),
            ("direction", "-1"),
        ])
        .send()
        .map_err(|e| format!("Impossible de contacter Hugging Face : {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Hugging Face a répondu avec le statut {}", resp.status()));
    }

    let raw: Vec<HfModelRaw> = resp.json().map_err(|e| e.to_string())?;
    Ok(raw
        .into_iter()
        .map(|m| HfModel {
            id: m.id,
            downloads: m.downloads,
            likes: m.likes,
            tags: m.tags,
        })
        .collect())
}
