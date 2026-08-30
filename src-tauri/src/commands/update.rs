use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::AppHandle;

// Anon key: meant to be public (Supabase's own design, gated by Row Level
// Security on the table), same as embedding it in the public site's JS.
// Never give this project's service_role key the same treatment.
const SUPABASE_URL: &str = "https://cihuwuiyziarnghethbi.supabase.co";
const SUPABASE_ANON_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpaHV3dWl5emlhcm5naGV0aGJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwNjM3OTQsImV4cCI6MjEwMzYzOTc5NH0.AkAe00Vzu4506nHSjh2bl99x5hZUSejZRm3pJwVuGtI";

#[derive(Deserialize, Serialize, Clone)]
pub struct AppRelease {
    pub version: String,
    pub download_url: Option<String>,
    pub notes: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct UpdateStatus {
    pub current_version: String,
    pub latest: Option<AppRelease>,
    pub update_available: bool,
    pub error: Option<String>,
}

// Never fails the invoke() call: network/parse errors are reported in
// `error` instead, so a visitor offline or with Supabase unreachable gets a
// quiet "can't check right now" rather than a scary error dialog.
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> UpdateStatus {
    let current_version = app.package_info().version.to_string();
    let url = format!(
        "{}/rest/v1/app_releases?select=version,download_url,notes,published_at&order=published_at.desc&limit=1",
        SUPABASE_URL
    );

    let result = reqwest::Client::new()
        .get(&url)
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {}", SUPABASE_ANON_KEY))
        .timeout(Duration::from_secs(8))
        .send()
        .await;

    let resp = match result {
        Ok(r) => r,
        Err(e) => {
            return UpdateStatus {
                current_version,
                latest: None,
                update_available: false,
                error: Some(format!("Impossible de contacter Supabase : {}", e)),
            }
        }
    };

    if !resp.status().is_success() {
        let status = resp.status();
        return UpdateStatus {
            current_version,
            latest: None,
            update_available: false,
            error: Some(format!("Supabase a répondu avec le statut {}", status)),
        };
    }

    let rows: Vec<AppRelease> = match resp.json().await {
        Ok(v) => v,
        Err(e) => {
            return UpdateStatus {
                current_version,
                latest: None,
                update_available: false,
                error: Some(format!("Réponse Supabase inattendue : {}", e)),
            }
        }
    };

    let latest = rows.into_iter().next();
    let update_available = latest.as_ref().map(|r| r.version != current_version).unwrap_or(false);

    UpdateStatus {
        current_version,
        latest,
        update_available,
        error: None,
    }
}
