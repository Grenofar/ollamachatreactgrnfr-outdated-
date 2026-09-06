mod commands;

use commands::agent::{agent_chat, cancel_agent_chat, AgentCancelFlag};
use commands::chat::{cancel_chat, delete_model, install_model, list_models, send_chat, CancelFlag};
use commands::controlme::{
    cancel_control_me, clear_control_me_memory, list_control_me_memory, resolve_control_me_confirmation,
    run_control_me, ControlMeCancelFlag, ControlMeConfirmation,
};
use commands::controlme_sessions::{
    delete_control_me_session, list_control_me_sessions, load_control_me_session, save_control_me_session,
    search_control_me_sessions,
};
use commands::conversations::{
    delete_conversation, list_conversations, load_conversation, save_conversation, search_conversations,
};
use commands::fsops::{edit_file_text, list_dir, read_file_text, write_file_text};
use commands::hardware::get_system_ram_gb;
use commands::huggingface::search_hf_models;
use commands::remote::{clear_remote_code, generate_remote_code, resume_remote_on_startup, RemoteState};
use commands::settings::{load_settings, save_settings};
use commands::shell::{cancel_shell_command, run_powershell_command, ShellCancelFlag};
use commands::skills::{
    delete_skill, download_skill, extract_skill_from_transcript, import_marketplace_extension, list_public_skills,
    list_skills, load_skill, open_skills_folder, open_windows_settings, publish_skill, save_new_skill,
    transcribe_audio, unpublish_skill, update_skill,
};
use commands::watchdog::{close_app, spawn_watchdog_thread, Watchdog};
use commands::SUPABASE_ANON_KEY;
use global_hotkey::{
    hotkey::{Code, HotKey, Modifiers},
    GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState,
};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};

// `tauri.conf.json`'s `plugins.updater` config has NO `headers` field
// (despite once assuming otherwise) — Supabase's gateway rejects any
// request without an `apikey` header (401) before it even reaches our RPC
// function, so these headers have to be set here, on the plugin's Rust
// builder, not in JSON config.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered FIRST (per the plugin's own README) — one-click
        // "Ajouter" from the site's extension marketplace page opens an
        // `ollamachat://install-extension/<id>` link. On Windows/Linux the OS
        // spawns a brand-new process with that URL as its only CLI arg rather
        // than emitting an event to an already-running instance (verified in
        // tauri-plugin-deep-link's own README before writing any of this) —
        // this plugin is what intercepts that second launch, kills it, and
        // forwards its argv back here so we can hand it to the deep-link
        // plugin ourselves and bring the (possibly tray-hidden) window
        // forward. The very first launch (app not running yet, OS starts it
        // fresh with the URL as argv) needs no code here at all: the
        // deep-link plugin's own `init()` already parses `std::env::args()`
        // on setup (confirmed by reading its source, not assumed).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
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
        .manage(RemoteState::new())
        .setup(|app| {
            let watchdog = app.state::<Watchdog>().0.clone();
            spawn_watchdog_thread(app.handle().clone(), watchdog);

            // If a remote pairing code was already set from a previous
            // session, start listening again right away — the whole point
            // of persisting it is that the site reconnects on its own,
            // which only works if the app is also already listening.
            resume_remote_on_startup(app.handle().clone());

            // Global shortcut (Ctrl+Alt+O) to summon the app from anywhere,
            // even while it's tray-only/minimized/behind other windows —
            // requested alongside voice input/output. Deliberately the
            // `global-hotkey` crate directly (Cargo-only) rather than
            // tauri-plugin-global-shortcut, whose JS side would need
            // `npm install @tauri-apps/plugin-global-shortcut` — explicitly
            // off-limits this session over a reported npm supply-chain
            // security concern. This crate is what that plugin uses
            // internally anyway, just without its JS wrapper: the manager
            // must be created on this thread (the one running the Win32
            // event loop, per the crate's own README — true of Tauri's main
            // thread), so it's registered here in setup() rather than from
            // a spawned task. The manager is kept in managed state for the
            // app's whole lifetime — dropping it would unregister the hotkey
            // (its Drop impl tears down the hidden window it uses to
            // receive WM_HOTKEY).
            if let Ok(hotkey_manager) = GlobalHotKeyManager::new() {
                let summon_hotkey = HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyO);
                if hotkey_manager.register(summon_hotkey).is_ok() {
                    let summon_id = summon_hotkey.id();
                    let app_handle = app.handle().clone();
                    // GlobalHotKeyEvent::receiver() is a plain channel, safe
                    // to block-receive from any thread — only creating the
                    // manager itself was thread-sensitive.
                    std::thread::spawn(move || {
                        while let Ok(event) = GlobalHotKeyEvent::receiver().recv() {
                            if event.id() == summon_id && event.state() == HotKeyState::Pressed {
                                if let Some(window) = app_handle.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    });
                }
                // GlobalHotKeyManager wraps a raw HWND (*mut c_void), which
                // Rust never auto-derives Send/Sync for regardless of
                // whether it's actually safe to move around — Tauri's
                // .manage() requires both. This is genuinely fine here: the
                // handle is only ever read by the crate's own Windows API
                // calls (never dereferenced as a real pointer by us), it's
                // never touched again after this line, and the only reason
                // to keep it in managed state at all is to defer its Drop
                // (which unregisters the hotkey) until the app itself exits
                // — not to share or synchronize access to it.
                struct HotkeyManagerHolder(#[allow(dead_code)] GlobalHotKeyManager);
                unsafe impl Send for HotkeyManagerHolder {}
                unsafe impl Sync for HotkeyManagerHolder {}
                app.manage(HotkeyManagerHolder(hotkey_manager));
            }

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
                    use webview2_com::Microsoft::Web::WebView2::Win32::{
                        ICoreWebView2Settings3, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
                        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                    };
                    use webview2_com::PermissionRequestedEventHandler;
                    use windows::core::Interface;
                    let _ = window.with_webview(|webview| unsafe {
                        if let Ok(core) = webview.controller().CoreWebView2() {
                            if let Ok(settings) = core.Settings() {
                                if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
                                    let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
                                }
                            }

                            // Voice input (the mic button and voice mode) was
                            // reported as simply never hearing anything. Root
                            // cause is here, not in the JS: WebView2 gates
                            // microphone access behind its own permission
                            // prompt, and once that prompt has been dismissed
                            // or denied there is no way for the page to ask
                            // again — the mic stays silently blocked forever,
                            // which is exactly the "even when I enable the mic
                            // it doesn't hear me" symptom. Granting it here
                            // means the request never reaches that prompt at
                            // all. Scoped deliberately to the microphone: any
                            // other permission kind is left to WebView2's
                            // default handling rather than blanket-approved.
                            let mut token = 0i64;
                            let _ = core.add_PermissionRequested(
                                &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                                    if let Some(args) = args {
                                        let mut kind = Default::default();
                                        args.PermissionKind(&mut kind)?;
                                        if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                                            args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                                        }
                                    }
                                    Ok(())
                                })),
                                &mut token,
                            );
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
            search_control_me_sessions,
            load_control_me_session,
            save_control_me_session,
            delete_control_me_session,
            generate_remote_code,
            clear_remote_code,
            open_skills_folder,
            transcribe_audio,
            open_windows_settings,
            list_skills,
            load_skill,
            save_new_skill,
            update_skill,
            delete_skill,
            publish_skill,
            unpublish_skill,
            download_skill,
            list_public_skills,
            extract_skill_from_transcript,
            import_marketplace_extension,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
