// "DB skill for Control Me" — successor to the original flat "DB ready"
// knowledge base (v0.5.7): instead of a single pile of loosely-typed files,
// each skill is its own named+described unit the user (or the AI itself,
// via extract_skill_from_transcript) can create, pick from before a
// session, and optionally publish. Distinct from remember_fact's
// auto-learned memory: a skill is something explicitly authored/curated,
// not inferred fact-by-fact during a run.
//
// Security model, same posture as the old knowledge base it replaces:
// - The hidden Windows attribute on the storage folder is a soft, cosmetic
//   deterrent, not real access control.
// - Skill content is never executed or interpreted, only read as text and
//   forwarded to Gemini as part of the instruction context.
// - Publishing writes with the `anon` Supabase key (first anon-write table
//   in this project, see supabase/skills_migration.sql) — public, and, per
//   the existing RLS (no update/delete policy for anon), immutable and
//   permanent once published. "Rendre privé" (unpublish_skill) only stops
//   the LOCAL app from treating/offering it as published — it cannot
//   retract the row already sitting on Supabase. Documented, not hidden.
use super::data_dir;
use super::{SUPABASE_ANON_KEY, SUPABASE_URL};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use windows::core::HSTRING;
use windows::Win32::Storage::FileSystem::{SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN};

const SHARE_CODE_LEN: usize = 10;
const ID_LEN: usize = 20;
// Keeps a session's context from being dominated by skill content, same
// reasoning as the old knowledge base's cap / read_ui_elements' element cap.
const MAX_ACTIVE_SKILLS_BYTES: usize = 50_000;

#[derive(Serialize, Deserialize, Clone)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub content: String,
    #[serde(default)]
    pub is_public: bool,
    #[serde(default)]
    pub share_code: Option<String>,
    pub created_at: f64,
}

#[derive(Serialize, Clone)]
pub struct SkillMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub is_public: bool,
    pub share_code: Option<String>,
    pub created_at: f64,
}

impl From<&Skill> for SkillMeta {
    fn from(s: &Skill) -> Self {
        SkillMeta {
            id: s.id.clone(),
            name: s.name.clone(),
            description: s.description.clone(),
            is_public: s.is_public,
            share_code: s.share_code.clone(),
            created_at: s.created_at,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PublicSkillMeta {
    pub name: String,
    pub description: String,
    pub share_code: String,
}

fn now_unix_secs() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn random_id(len: usize) -> String {
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..len).map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char).collect()
}

fn generate_share_code() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
    let mut rng = rand::thread_rng();
    (0..SHARE_CODE_LEN).map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char).collect()
}

pub(crate) fn skills_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = data_dir(app)?.join("controlme_skills");
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

// Central choke point for every id -> file path in this module — even
// though today's callers (load/save/update/delete_skill) are only reachable
// via local Tauri IPC from the app's own bundled frontend, not the network,
// validating here once means no future caller can reintroduce the path
// traversal that read_active_skills below had to be fixed for (PathBuf::join
// does not sanitize ".." components; every real id is exactly ID_LEN
// lowercase-alphanumeric characters, see random_id above).
fn skill_path(app: &AppHandle, id: &str) -> Result<std::path::PathBuf, String> {
    if id.len() != ID_LEN || !id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()) {
        return Err("Identifiant de skill invalide.".to_string());
    }
    Ok(skills_dir(app)?.join(format!("{id}.json")))
}

fn read_skill(path: &std::path::Path) -> Option<Skill> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

#[tauri::command]
pub async fn open_skills_folder(app: AppHandle) -> Result<(), String> {
    let dir = skills_dir(&app)?;
    tokio::process::Command::new("explorer.exe")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_skills(app: AppHandle) -> Result<Vec<SkillMeta>, String> {
    let dir = skills_dir(&app)?;
    let mut skills: Vec<SkillMeta> = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Some(skill) = read_skill(&path) {
            skills.push(SkillMeta::from(&skill));
        }
    }
    skills.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(skills)
}

#[tauri::command]
pub fn load_skill(app: AppHandle, id: String) -> Result<Skill, String> {
    let path = skill_path(&app, &id)?;
    read_skill(&path).ok_or_else(|| "Skill introuvable.".to_string())
}

fn validate(name: &str, description: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Un nom est obligatoire pour un skill.".to_string());
    }
    if description.trim().is_empty() {
        return Err("Une description est obligatoire pour un skill.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn save_new_skill(app: AppHandle, name: String, description: String, content: String) -> Result<Skill, String> {
    validate(&name, &description)?;
    let skill = Skill {
        id: random_id(ID_LEN),
        name,
        description,
        content,
        is_public: false,
        share_code: None,
        created_at: now_unix_secs(),
    };
    write_skill(&app, &skill)?;
    Ok(skill)
}

#[tauri::command]
pub fn update_skill(app: AppHandle, skill: Skill) -> Result<(), String> {
    validate(&skill.name, &skill.description)?;
    write_skill(&app, &skill)
}

fn write_skill(app: &AppHandle, skill: &Skill) -> Result<(), String> {
    let path = skill_path(app, &skill.id)?;
    let content = serde_json::to_string_pretty(skill).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_skill(app: AppHandle, id: String) -> Result<(), String> {
    let path = skill_path(&app, &id)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Appends one note to a skill while a Control Me session is recording into
// it. Distinct from extract_skill_from_transcript (which rewrites a whole
// skill from a finished transcript in one Gemini call): here the model
// decides, mid-conversation, that something is worth keeping and writes it
// down immediately — so nothing is lost if the session is never extracted
// from afterwards. id goes through skill_path, which is what rejects a
// traversal attempt (see its comment above); the size cap keeps a long or
// looping session from growing a skill without bound.
const MAX_SKILL_CONTENT_BYTES: usize = 40_000;

pub(crate) fn append_to_skill(app: &AppHandle, id: &str, note: &str) -> Result<String, String> {
    let note = note.trim();
    if note.is_empty() {
        return Err("Note vide.".to_string());
    }
    let path = skill_path(app, id)?;
    let mut skill = read_skill(&path).ok_or_else(|| "Skill introuvable.".to_string())?;
    if skill.content.len() + note.len() > MAX_SKILL_CONTENT_BYTES {
        return Err("Ce skill a atteint sa taille maximale.".to_string());
    }
    if !skill.content.is_empty() && !skill.content.ends_with('\n') {
        skill.content.push('\n');
    }
    skill.content.push_str("- ");
    skill.content.push_str(note);
    skill.content.push('\n');
    let name = skill.name.clone();
    write_skill(app, &skill)?;
    Ok(name)
}

// Concatenates the content of exactly the skills the user picked before
// starting this Control Me session — see the call site in controlme.rs.
// `ids` isn't always locally trusted input: a remote-triggered instruction
// (remote.rs) forwards active_skill_ids straight from a WebSocket broadcast
// sent by anyone holding the pairing code, so an id like "../../../../some/
// other/file" reaching a raw dir.join() would read outside skills_dir
// entirely (PathBuf::join does not sanitize ".." components) — every real
// id is exactly ID_LEN lowercase-alphanumeric characters (see random_id
// above), so anything else is rejected outright rather than joined.
pub(crate) fn read_active_skills(app: &AppHandle, ids: &[String]) -> String {
    let Ok(dir) = skills_dir(app) else { return String::new() };
    let mut out = String::new();
    for id in ids {
        if id.len() != ID_LEN || !id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()) {
            continue;
        }
        let path = dir.join(format!("{id}.json"));
        let Some(skill) = read_skill(&path) else { continue };
        out.push_str(&format!("[{}]\n{}\n\n", skill.name, skill.content));
        if out.len() >= MAX_ACTIVE_SKILLS_BYTES {
            out.truncate(MAX_ACTIVE_SKILLS_BYTES);
            out.push_str("\n\n(tronqué — les skills sélectionnés dépassent la taille prise en charge)");
            break;
        }
    }
    out
}

#[tauri::command]
pub async fn publish_skill(app: AppHandle, id: String) -> Result<String, String> {
    let mut skill = load_skill(app.clone(), id)?;
    validate(&skill.name, &skill.description)?;
    let code = generate_share_code();
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{SUPABASE_URL}/rest/v1/controlme_knowledge_shares"))
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {SUPABASE_ANON_KEY}"))
        .header("Content-Type", "application/json")
        .header("Prefer", "return=minimal")
        .json(&json!({
            "share_code": code,
            "name": skill.name,
            "description": skill.description,
            "content": skill.content,
        }))
        .send()
        .await
        .map_err(|e| format!("Impossible de contacter Supabase : {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Échec de la publication ({status}) : {text}"));
    }
    skill.is_public = true;
    skill.share_code = Some(code.clone());
    write_skill(&app, &skill)?;
    Ok(code)
}

// Local-only: does NOT retract the row already published on Supabase (no
// anon update/delete policy exists for controlme_knowledge_shares, by
// deliberate design — see the module doc comment). This just stops the
// local app from showing/offering the skill as currently published.
#[tauri::command]
pub fn unpublish_skill(app: AppHandle, id: String) -> Result<(), String> {
    let mut skill = load_skill(app.clone(), id)?;
    skill.is_public = false;
    skill.share_code = None;
    write_skill(&app, &skill)
}

#[tauri::command]
pub async fn download_skill(app: AppHandle, share_code: String) -> Result<Skill, String> {
    let client = reqwest::Client::new();
    // share_code is free-text typed by whoever's importing — building the
    // URL with format! would let a code containing "&" or "," smuggle in
    // extra PostgREST query parameters (e.g. its own "&select=..." or a
    // "," to widen the eq. filter into an "in." list) instead of being
    // treated as a literal value to match. reqwest's .query() percent-
    // encodes each value through the same `url` crate the rest of this
    // project already depends on transitively, so it's just a literal
    // string to Postgres either way.
    let resp = client
        .get(format!("{SUPABASE_URL}/rest/v1/controlme_knowledge_shares"))
        .query(&[
            ("select", "name,description,content"),
            ("share_code", &format!("eq.{}", share_code.trim())),
        ])
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {SUPABASE_ANON_KEY}"))
        .send()
        .await
        .map_err(|e| format!("Impossible de contacter Supabase : {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Code introuvable ou Supabase injoignable ({})", resp.status()));
    }
    let rows: Vec<Value> = resp.json().await.map_err(|e| e.to_string())?;
    let row = rows.first().ok_or_else(|| "Aucun skill ne correspond à ce code.".to_string())?;
    let skill = Skill {
        id: random_id(ID_LEN),
        name: row["name"].as_str().unwrap_or("Skill importé").to_string(),
        description: row["description"].as_str().unwrap_or("").to_string(),
        content: row["content"].as_str().unwrap_or("").to_string(),
        is_public: true,
        share_code: Some(share_code),
        created_at: now_unix_secs(),
    };
    write_skill(&app, &skill)?;
    Ok(skill)
}

// Browsing works purely because the existing RLS already grants
// `select to anon using (true)` on the whole table (set up for
// per-share_code lookups) — no schema/policy change needed to also list
// everything, so this is a genuinely low-cost addition on top of what
// download_skill already relied on.
#[tauri::command]
pub async fn list_public_skills() -> Result<Vec<PublicSkillMeta>, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!(
            "{SUPABASE_URL}/rest/v1/controlme_knowledge_shares?select=name,description,share_code&order=created_at.desc&limit=100"
        ))
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {SUPABASE_ANON_KEY}"))
        .send()
        .await
        .map_err(|e| format!("Impossible de contacter Supabase : {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Supabase a répondu {}", resp.status()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

// One-shot, no tools, no loop — just asks Gemini to fold the given
// transcript into an update of the skill's existing content. Deliberately
// separate from Control Me's own tool-calling loop in controlme.rs: this
// is a plain text-generation call the user triggers explicitly with the
// "Extraire les informations" button, reviewed before being saved (never
// auto-applied).
#[tauri::command]
pub async fn extract_skill_from_transcript(
    api_key: String,
    model: String,
    existing_content: String,
    transcript: String,
) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("Aucune clé API Gemini configurée. Ajoute-la dans Réglages.".to_string());
    }
    let model = if model.trim().is_empty() { super::controlme::GEMINI_MODEL.to_string() } else { model };
    let prompt = format!(
        "Voici le contenu actuel d'un skill (peut être vide) :\n\n{existing_content}\n\n\
        Voici le déroulé d'une session récente :\n\n{transcript}\n\n\
        Réécris le contenu complet et à jour de ce skill en intégrant ce qui a été appris pendant \
        cette session (garde ce qui est encore pertinent de l'ancien contenu, ajoute les nouvelles \
        informations utiles, reformule si besoin pour que ce soit clair et réutilisable). Réponds \
        uniquement avec le nouveau contenu du skill, sans commentaire ni explication autour."
    );
    let client = reqwest::Client::new();
    let resp = client
        .post(super::controlme::GEMINI_ENDPOINT)
        .header("x-goog-api-key", &api_key)
        .json(&json!({
            "model": model,
            "input": [{ "type": "text", "text": prompt }],
            "generation_config": { "thinking_level": "low" },
        }))
        .send()
        .await
        .map_err(|e| format!("Impossible de contacter l'API Gemini : {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Gemini a répondu {status} : {text}"));
    }
    let data: Value = resp.json().await.map_err(|e| format!("Réponse Gemini invalide : {e}"))?;
    let steps = data["steps"].as_array().cloned().unwrap_or_default();
    let mut out = String::new();
    for step in &steps {
        if step["type"] == "model_output" {
            if let Some(content) = step["content"].as_array() {
                for part in content {
                    if let Some(text) = part["text"].as_str() {
                        out.push_str(text);
                    }
                }
            }
        }
    }
    if out.trim().is_empty() {
        return Err("Gemini n'a renvoyé aucun texte.".to_string());
    }
    Ok(out)
}

// Bridges the new accounts/marketplace system (extensions/extension_versions,
// see supabase/accounts_marketplace_migration.sql — a real Postgres table
// with RLS, unlike skills' own controlme_knowledge_shares) into the
// already-working local skill infrastructure, rather than building a
// second, separate "installed extension" concept from scratch. Only
// "controlme"-targeted extensions materialize as a skill right now — a
// "chat"-targeted one would need to alter the base chat's own system
// prompt, which isn't safe to do silently on import without the user
// reviewing it first; not built this pass, scoped out deliberately.
// extension_id doubles as the "code" a user copies from the site's
// marketplace page and pastes here — no separate share_code needed since
// this table's id is already a public, anon-readable UUID.
#[tauri::command]
pub async fn import_marketplace_extension(app: AppHandle, extension_id: String) -> Result<Skill, String> {
    let client = reqwest::Client::new();
    let extension_id = extension_id.trim().to_string();

    // extension_id reaches this command straight from a URL someone clicked
    // (ollamachat://install-extension/<id>, see App.tsx) — a link an
    // attacker fully controls the text of, unlike a code someone types by
    // hand. Building the request URL with format! would let a crafted id
    // containing "&"/"," inject extra PostgREST query parameters (widen the
    // eq. filter, add its own "&select=..."); .query() percent-encodes
    // each value instead, same fix as download_skill above.
    let ext_resp = client
        .get(format!("{SUPABASE_URL}/rest/v1/extensions"))
        .query(&[("select", "name,description"), ("id", &format!("eq.{extension_id}"))])
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {SUPABASE_ANON_KEY}"))
        .send()
        .await
        .map_err(|e| format!("Impossible de contacter Supabase : {e}"))?;
    if !ext_resp.status().is_success() {
        return Err(format!("Extension introuvable ({})", ext_resp.status()));
    }
    let ext_rows: Vec<Value> = ext_resp.json().await.map_err(|e| e.to_string())?;
    let ext_row = ext_rows.first().ok_or_else(|| "Aucune extension ne correspond à cet identifiant.".to_string())?;
    let name = ext_row["name"].as_str().unwrap_or("Extension importée").to_string();
    let description = ext_row["description"].as_str().unwrap_or("").to_string();

    let version_resp = client
        .get(format!("{SUPABASE_URL}/rest/v1/extension_versions"))
        .query(&[
            ("select", "manifest"),
            ("extension_id", &format!("eq.{extension_id}")),
            ("order", &"created_at.desc".to_string()),
            ("limit", &"1".to_string()),
        ])
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {SUPABASE_ANON_KEY}"))
        .send()
        .await
        .map_err(|e| format!("Impossible de contacter Supabase : {e}"))?;
    if !version_resp.status().is_success() {
        return Err(format!("Impossible de récupérer la version ({})", version_resp.status()));
    }
    let version_rows: Vec<Value> = version_resp.json().await.map_err(|e| e.to_string())?;
    let version_row = version_rows.first().ok_or_else(|| "Cette extension n'a aucune version publiée.".to_string())?;
    let manifest = &version_row["manifest"];
    let target = manifest["target"].as_str().unwrap_or("controlme");
    if target != "controlme" {
        return Err(
            "Cette extension cible le chat de base — pas encore installable automatiquement, seules les extensions Control Me le sont pour l'instant.".to_string(),
        );
    }
    let content = manifest["system_prompt_addition"].as_str().unwrap_or("").to_string();
    if content.trim().is_empty() {
        return Err("Cette extension n'a aucun contenu.".to_string());
    }

    save_new_skill(app, name, description, content)
}
