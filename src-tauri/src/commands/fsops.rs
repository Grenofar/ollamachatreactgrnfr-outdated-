use serde::Serialize;

const MAX_READ_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Serialize, Clone)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Serialize, Clone)]
pub struct EditResult {
    pub new_content: String,
    pub replaced_count: usize,
}

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| format!("Impossible de lister {} : {}", path, e))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

#[tauri::command]
pub fn read_file_text(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("Fichier introuvable {} : {}", path, e))?;
    if meta.len() > MAX_READ_BYTES {
        return Err(format!(
            "Fichier trop volumineux ({} Mo, limite 5 Mo) : {}",
            meta.len() / (1024 * 1024),
            path
        ));
    }
    std::fs::read_to_string(&path).map_err(|e| format!("Impossible de lire {} : {}", path, e))
}

#[tauri::command]
pub fn write_file_text(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| format!("Impossible d'écrire {} : {}", path, e))
}

#[tauri::command]
pub fn edit_file_text(
    path: String,
    old_string: String,
    new_string: String,
    replace_all: bool,
) -> Result<EditResult, String> {
    let current = std::fs::read_to_string(&path).map_err(|e| format!("Impossible de lire {} : {}", path, e))?;
    let occurrences = current.matches(&old_string).count();
    if occurrences == 0 {
        return Err(format!("Le texte à remplacer est introuvable dans {}", path));
    }
    if occurrences > 1 && !replace_all {
        return Err(format!(
            "Le texte à remplacer apparaît {} fois dans {} ; précise replace_all=true ou un texte plus spécifique",
            occurrences, path
        ));
    }
    let new_content = if replace_all {
        current.replace(&old_string, &new_string)
    } else {
        current.replacen(&old_string, &new_string, 1)
    };
    std::fs::write(&path, &new_content).map_err(|e| format!("Impossible d'écrire {} : {}", path, e))?;
    Ok(EditResult {
        new_content,
        replaced_count: occurrences,
    })
}
