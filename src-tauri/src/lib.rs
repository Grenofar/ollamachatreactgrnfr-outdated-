mod commands;

use commands::agent::{agent_chat, cancel_agent_chat, AgentCancelFlag};
use commands::chat::{cancel_chat, delete_model, install_model, list_models, send_chat, CancelFlag};
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(CancelFlag(Arc::new(AtomicBool::new(false))))
        .manage(ShellCancelFlag(Arc::new(AtomicBool::new(false))))
        .manage(AgentCancelFlag(Arc::new(AtomicBool::new(false))))
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
