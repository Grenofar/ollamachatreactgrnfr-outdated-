mod commands;

use commands::agent::{agent_chat, cancel_agent_chat, AgentCancelFlag};
use commands::chat::{cancel_chat, delete_model, install_model, list_models, send_chat, CancelFlag};
use commands::conversations::{delete_conversation, list_conversations, load_conversation, save_conversation};
use commands::fsops::{edit_file_text, list_dir, read_file_text, write_file_text};
use commands::hardware::get_system_ram_gb;
use commands::huggingface::search_hf_models;
use commands::settings::{load_settings, save_settings};
use commands::shell::{cancel_shell_command, run_powershell_command, ShellCancelFlag};
use commands::update::check_for_update;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(CancelFlag(Arc::new(AtomicBool::new(false))))
        .manage(ShellCancelFlag(Arc::new(AtomicBool::new(false))))
        .manage(AgentCancelFlag(Arc::new(AtomicBool::new(false))))
        .invoke_handler(tauri::generate_handler![
            list_models,
            send_chat,
            cancel_chat,
            install_model,
            delete_model,
            list_conversations,
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
            check_for_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
