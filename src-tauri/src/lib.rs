mod commands;

use commands::agent::{agent_chat, cancel_agent_chat, AgentCancelFlag};
use commands::chat::{cancel_chat, delete_model, install_model, list_models, send_chat, CancelFlag};
use commands::controlme::{
    cancel_control_me, clear_control_me_memory, list_control_me_memory, resolve_control_me_confirmation,
    run_control_me, ControlMeCancelFlag, ControlMeConfirmation,
};
use commands::controlme_sessions::{
    delete_control_me_session, list_control_me_sessions, load_control_me_session, save_control_me_session,
};
use commands::conversations::{
    delete_conversation, list_conversations, load_conversation, save_conversation, search_conversations,
};
use commands::fsops::{edit_file_text, list_dir, read_file_text, write_file_text};
use commands::hardware::get_system_ram_gb;
use commands::huggingface::search_hf_models;
use commands::settings::{load_settings, save_settings};
use commands::shell::{cancel_shell_command, run_powershell_command, ShellCancelFlag};
use commands::watchdog::{close_app, spawn_watchdog_thread, Watchdog};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};

// Anon key: meant to be public (Supabase's own design, gated by Row Level
// Security), same one committed in site/index.html and tauri.conf.json's
// updater pubkey field is a different, unrelated key. `tauri.conf.json`'s
// `plugins.updater` config has NO `headers` field (despite once assuming
// otherwise) — Supabase's gateway rejects any request without an `apikey`
// header (401) before it even reaches our RPC function, so these headers
// have to be set here, on the plugin's Rust builder, not in JSON config.
const SUPABASE_ANON_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpaHV3dWl5emlhcm5naGV0aGJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwNjM3OTQsImV4cCI6MjEwMzYzOTc5NH0.AkAe00Vzu4506nHSjh2bl99x5hZUSejZRm3pJwVuGtI";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_updater::Builder::new()
                .header("apikey", SUPABASE_ANON_KEY)
                .expect("valid apikey header")
                .header("Authorization", format!("Bearer {SUPABASE_ANON_KEY}"))
                .expect("valid Authorization header")
                .build(),
        )
        .manage(CancelFlag(Arc::new(AtomicBool::new(false))))
        .manage(ShellCancelFlag(Arc::new(AtomicBool::new(false))))
        .manage(AgentCancelFlag(Arc::new(AtomicBool::new(false))))
        .manage(ControlMeCancelFlag(Arc::new(AtomicBool::new(false))))
        .manage(ControlMeConfirmation(Arc::new(std::sync::Mutex::new(None))))
        .manage(Watchdog::new())
        .setup(|app| {
            let watchdog = app.state::<Watchdog>().0.clone();
            spawn_watchdog_thread(app.handle().clone(), watchdog);

            // Minimize-to-tray: closing the window (the X button) hides it
            // instead of quitting, since this is meant to stay open in the
            // background for a running chat. Actually quitting is only via
            // the tray menu's "Quitter" (or close_app / the freeze-watchdog).
            let show_item = MenuItem::with_id(app, "show", "Afficher", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } =
                        event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let window_to_hide = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_to_hide.hide();
                    }
                });

                // WebView2 intercepts Ctrl+S (and Ctrl+P/F/O/U, F5, F12, etc.)
                // as native "browser accelerator keys" by default, before the
                // keypress ever reaches the page's JS — so Monaco's own Ctrl+S
                // command (EditorPane.tsx) never fired and nothing was ever
                // saved. Disabling this at the WebView2 settings level (no
                // first-class Tauri config for it, has to go through the raw
                // COM controller) is required to make in-app keyboard
                // shortcuts work at all.
                #[cfg(windows)]
                {
                    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
                    use windows::core::Interface;
                    let _ = window.with_webview(|webview| unsafe {
                        if let Ok(core) = webview.controller().CoreWebView2() {
                            if let Ok(settings) = core.Settings() {
                                if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
                                    let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
                                }
                            }
                        }
                    });
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_models,
            send_chat,
            cancel_chat,
            install_model,
            delete_model,
            list_conversations,
            search_conversations,
            load_conversation,
            save_conversation,
            delete_conversation,
            load_settings,
            save_settings,
            list_dir,
            read_file_text,
            write_file_text,
            edit_file_text,
            run_powershell_command,
            cancel_shell_command,
            agent_chat,
            cancel_agent_chat,
            search_hf_models,
            get_system_ram_gb,
            close_app,
            run_control_me,
            cancel_control_me,
            resolve_control_me_confirmation,
            list_control_me_memory,
            clear_control_me_memory,
            list_control_me_sessions,
            load_control_me_session,
            save_control_me_session,
            delete_control_me_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
