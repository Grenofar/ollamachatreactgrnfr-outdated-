// RAM only, not GPU/VRAM: VRAM as reported by Windows drivers (WMI
// AdapterRAM, DXGI) is notoriously unreliable — often capped at 4GB or
// simply wrong for modern cards. Total system RAM is the one number
// Windows reports accurately, so model-size recommendations are based on
// that alone rather than guessing at a GPU budget that might be wrong.
#[tauri::command]
pub async fn get_system_ram_gb() -> Result<f64, String> {
    #[allow(unused_mut)]
    let mut cmd = tokio::process::Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory",
    ]);
    // tokio::process::Command exposes creation_flags directly on Windows
    // (no CommandExt trait import needed, unlike std::process::Command).
    #[cfg(windows)]
    cmd.creation_flags(super::CREATE_NO_WINDOW);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Impossible de lire la RAM système : {}", e))?;

    if !output.status.success() {
        return Err("Impossible de lire la RAM système".to_string());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let bytes: u64 = text
        .trim()
        .parse()
        .map_err(|_| "Réponse inattendue de PowerShell".to_string())?;

    Ok(bytes as f64 / (1024.0 * 1024.0 * 1024.0))
}
