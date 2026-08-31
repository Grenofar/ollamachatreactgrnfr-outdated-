// "DB ready for Control Me" — a hidden local folder where the user can
// drop reference material (.txt/.json/.sql only) that Control Me can read
// as a lightweight knowledge base during a session, plus an optional
// publish-to-Supabase flow for sharing one publicly.
//
// Security model, stated plainly (not oversold):
// - The hidden Windows attribute is a soft, cosmetic deterrent (discourages
//   casual/accidental drops into the folder) — NOT real access control.
//   Any process running with the user's own privileges can see a hidden
//   folder just as easily as a normal one.
// - The real mitigation is the extension allowlist (.txt/.json/.sql only,
//   validated as an all-or-nothing gate — see validate_and_read below) plus
//   the fact that file content is NEVER executed or interpreted, only read
//   as raw text and forwarded to Gemini. Even a .sql file here is just text
//   — there is no database engine anywhere that runs it.
// - What this does NOT protect against: prompt injection (malicious text
//   inside an otherwise-allowed file, aimed at manipulating Gemini) — no
//   file-type filter can catch that; it's a different risk category,
//   already covered for Control Me by enable_prompt_injection_detection.
use super::data_dir;
use super::{SUPABASE_ANON_KEY, SUPABASE_URL};
use rand::Rng;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use windows::core::HSTRING;
use windows::Win32::Storage::FileSystem::{SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN};

const ALLOWED_EXTENSIONS: [&str; 3] = ["txt", "json", "sql"];
// Keeps a single instruction's context from being dominated by knowledge
// base content — same reasoning as read_ui_elements' element/depth caps.
const MAX_TOTAL_BYTES: usize = 50_000;
const SHARE_CODE_LEN: usize = 10;

#[derive(Serialize, Clone)]
pub struct KnowledgeBaseStatus {
    pub valid_files: Vec<String>,
    pub invalid_files: Vec<String>,
    pub total_bytes: u64,
}

pub(crate) fn knowledge_base_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = data_dir(app)?.join("controlme_knowledge");
    let already_existed = dir.exists();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if !already_existed {
        hide_folder(&dir);
    }
    Ok(dir)
}

fn hide_folder(path: &std::path::Path) {
    let wide = HSTRING::from(path.to_string_lossy().as_ref());
    unsafe {
        let _ = SetFileAttributesW(&wide, FILE_ATTRIBUTE_HIDDEN);
    }
}

fn is_allowed(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| ALLOWED_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn scan(dir: &std::path::Path) -> Result<(Vec<std::path::PathBuf>, Vec<String>), String> {
    let mut valid = Vec::new();
    let mut invalid = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            continue;
        }
        if is_allowed(&path) {
            valid.push(path);
        } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            invalid.push(name.to_string());
        }
    }
    Ok((valid, invalid))
}

#[tauri::command]
pub fn get_knowledge_base_status(app: AppHandle) -> Result<KnowledgeBaseStatus, String> {
    let dir = knowledge_base_dir(&app)?;
    let (valid, invalid) = scan(&dir)?;
    let mut total_bytes = 0u64;
    let mut valid_names = Vec::new();
    for path in &valid {
        if let Ok(meta) = std::fs::metadata(path) {
            total_bytes += meta.len();
        }
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            valid_names.push(name.to_string());
        }
    }
    Ok(KnowledgeBaseStatus { valid_files: valid_names, invalid_files: invalid, total_bytes })
}

#[tauri::command]
pub async fn open_knowledge_base_folder(app: AppHandle) -> Result<(), String> {
    let dir = knowledge_base_dir(&app)?;
    tokio::process::Command::new("explorer.exe")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// All-or-nothing gate: a single disallowed file blocks the whole read
// (rather than silently skipping it) — matches what was asked explicitly
// ("si y'a que la db et pas autre chose"), forces cleanup instead of
// leaving an ambiguous partial state.
pub(crate) fn validate_and_read_knowledge_base(app: &AppHandle) -> Result<String, String> {
    let dir = knowledge_base_dir(app)?;
    let (valid, invalid) = scan(&dir)?;
    if !invalid.is_empty() {
        return Err(format!(
            "Le dossier de base de connaissances contient des fichiers non autorisés ({}) — seuls .txt/.json/.sql sont acceptés. Retire-les ou déplace-les ailleurs.",
            invalid.join(", ")
        ));
    }
    if valid.is_empty() {
        return Ok("Aucune base de connaissances configurée (dossier vide).".to_string());
    }
    let mut out = String::new();
    for path in &valid {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("?");
        let content = std::fs::read_to_string(path).unwrap_or_else(|e| format!("(illisible : {e})"));
        out.push_str(&format!("[{name}]\n{content}\n\n"));
        if out.len() >= MAX_TOTAL_BYTES {
            out.truncate(MAX_TOTAL_BYTES);
            out.push_str("\n\n(tronqué — la base de connaissances dépasse la taille prise en charge)");
            break;
        }
    }
    Ok(out)
}

fn generate_share_code() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
    let mut rng = rand::thread_rng();
    (0..SHARE_CODE_LEN)
        .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
        .collect()
}

#[tauri::command]
pub async fn publish_knowledge_base(app: AppHandle, title: String) -> Result<String, String> {
    let content = validate_and_read_knowledge_base(&app)?;
    if content.trim().is_empty() || content.starts_with("Aucune base") {
        return Err("Rien à publier — ajoute au moins un fichier .txt/.json/.sql d'abord.".to_string());
    }
    let code = generate_share_code();
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{SUPABASE_URL}/rest/v1/controlme_knowledge_shares"))
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {SUPABASE_ANON_KEY}"))
        .header("Content-Type", "application/json")
        .header("Prefer", "return=minimal")
        .json(&json!({ "share_code": code, "title": title, "content": content }))
        .send()
        .await
        .map_err(|e| format!("Impossible de contacter Supabase : {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Échec de la publication ({status}) : {text}"));
    }
    Ok(code)
}

#[tauri::command]
pub async fn import_knowledge_base(app: AppHandle, share_code: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!(
            "{SUPABASE_URL}/rest/v1/controlme_knowledge_shares?select=title,content&share_code=eq.{}",
            share_code.trim()
        ))
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {SUPABASE_ANON_KEY}"))
        .send()
        .await
        .map_err(|e| format!("Impossible de contacter Supabase : {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Code introuvable ou Supabase injoignable ({})", resp.status()));
    }
    let rows: Vec<Value> = resp.json().await.map_err(|e| e.to_string())?;
    let row = rows.first().ok_or_else(|| "Aucune base de connaissances ne correspond à ce code.".to_string())?;
    let title = row["title"].as_str().unwrap_or("import").to_string();
    let content = row["content"].as_str().unwrap_or("").to_string();

    let dir = knowledge_base_dir(&app)?;
    let safe_name = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    let file_name = if safe_name.trim().is_empty() { format!("import-{share_code}.txt") } else { format!("{safe_name}.txt") };
    std::fs::write(dir.join(file_name), content).map_err(|e| e.to_string())
}
