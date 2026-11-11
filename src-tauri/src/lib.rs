//! LeonSSH backend entry point.
//!
//! `commands` is the IPC surface, `ssh`/`sftp`/`forward` are domain modules,
//! `storage` owns SQLite, `secure` owns the Windows Credential Manager, and
//! `terminal` is the transport-agnostic byte pipeline.

mod commands;
mod editor;
mod error;
mod forward;
mod paths;
mod secure;
mod sftp;
mod ssh;
mod state;
mod storage;
mod terminal;
mod transfer;

#[cfg(feature = "test-server")]
pub use ssh::test_server as ssh_test_server;

use tauri::Manager;
use tauri_plugin_fs::FsExt;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::ssh::hostkey::KnownHosts;
use crate::state::AppState;

/// Minimal percent-encoding for the deep-link query string.
fn urlencode(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 3);
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Brings the already-running window to the front instead of starting a second
/// copy. Returns true when another instance owns the mutex.
#[cfg(windows)]
fn focus_existing_instance() -> bool {
    use windows_sys::Win32::Foundation::{ERROR_ALREADY_EXISTS, GetLastError};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe {
        let name = wide("Local\\LeonSSH.SingleInstance");
        // Keep the handle alive for the whole process lifetime on purpose.
        let handle = CreateMutexW(std::ptr::null(), 1, name.as_ptr());
        if handle.is_null() {
            return false;
        }
        if GetLastError() != ERROR_ALREADY_EXISTS {
            return false;
        }
        // Windows may need a moment before the first window exists.
        let title = wide("LeonSSH");
        for _ in 0..20 {
            let hwnd = FindWindowW(std::ptr::null(), title.as_ptr());
            if !hwnd.is_null() {
                ShowWindow(hwnd, SW_RESTORE);
                SetForegroundWindow(hwnd);
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
        true
    }
}

#[cfg(not(windows))]
fn focus_existing_instance() -> bool {
    false
}

pub fn run() {
    if focus_existing_instance() {
        return;
    }

    let paths = paths::Paths::resolve();
    paths::init_tracing(&paths);
    paths::record_boot_stamp();

    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        install_dir = %paths.install_dir.display(),
        data_dir = %paths.data_dir.display(),
        data_mode = paths.mode.as_str(),
        "LeonSSH starting"
    );

    // Database + host key pins are needed before the window exists.
    let (db, known_hosts) = tauri::async_runtime::block_on(async {
        let db = storage::open(&paths.data_dir).await?;
        let known = KnownHosts::load(db.clone()).await?;
        Ok::<_, error::AppError>((db, known))
    })
    .expect("failed to initialise local storage");

    // The WebView2 profile (cache, cookies, GPU cache) must live under the same
    // data root as everything else, so nothing escapes to %LOCALAPPDATA%.
    let webview_data_dir = paths.webview_dir.clone();
    let app_state = AppState::new(paths, db, std::sync::Arc::new(known_hosts));

    tauri::Builder::default()
        // Registered so the frontend may use `@tauri-apps/plugin-sql` against the
        // very same pool (see `storage` module docs for why the file lives here).
        .plugin(tauri_plugin_sql::Builder::default().build())
        // Local file manager: directory browsing/CRUD is done by the frontend
        // through this plugin, never through ad-hoc `std::fs` commands.
        .plugin(tauri_plugin_fs::init())
        .manage(app_state)
        .setup(move |app| {
            // The fs plugin defaults to app-specific directories only. The file
            // manager must browse the whole machine, so the runtime scope is
            // widened to the user profile and every drive root.
            {
                let scope = app.fs_scope();
                if let Some(home) = std::env::var_os("USERPROFILE") {
                    if let Err(err) = scope.allow_directory(std::path::PathBuf::from(home), true) {
                        tracing::warn!(%err, "cannot widen fs scope to the user profile");
                    }
                }
                for root in commands::local::drive_roots() {
                    if let Err(err) = scope.allow_directory(&root, true) {
                        tracing::warn!(%err, root = %root, "cannot widen fs scope to a drive");
                    }
                }
            }
            // Publish our pool into the plugin's state so `Database.get()` in the
            // frontend resolves to the database under the install directory
            // instead of the plugin's default `%APPDATA%` location.
            {
                let state = app.state::<AppState>();
                let pool = DbPool::Sqlite(state.db().clone());
                let instances = app.state::<DbInstances>();
                tauri::async_runtime::block_on(async {
                    instances
                        .0
                        .write()
                        .await
                        .insert(storage::DB_URL.to_string(), pool);
                });
            }

            // The window is created programmatically (instead of via
            // tauri.conf.json) purely so `data_directory` can be set.
            // `LEONSSH_START_VIEW=files` deep-links straight into the file
            // manager (handy for smoke tests / scripted screenshots).
            // Optional deep links (see README): `LEONSSH_START_VIEW=files`,
            // `LEONSSH_START_LOCAL=<path>`, `LEONSSH_AUTO_SESSION=<session id>`.
            let mut params: Vec<String> = Vec::new();
            if std::env::var("LEONSSH_START_VIEW")
                .map(|value| value.eq_ignore_ascii_case("files"))
                .unwrap_or(false)
            {
                params.push("view=files".to_string());
                let local = std::env::var("LEONSSH_START_LOCAL").unwrap_or_default();
                if !local.is_empty() {
                    params.push(format!("local={}", urlencode(&local)));
                }
            }
            if let Ok(session_id) = std::env::var("LEONSSH_AUTO_SESSION") {
                let session_id = session_id.trim();
                if !session_id.is_empty() {
                    params.push(format!("connect={}", urlencode(session_id)));
                }
            }
            let start_url = if params.is_empty() {
                tauri::WebviewUrl::App("index.html".into())
            } else {
                tauri::WebviewUrl::App(format!("index.html?{}", params.join("&")).into())
            };
            let window = tauri::WebviewWindowBuilder::new(app, "main", start_url)
            .title("LeonSSH")
            .inner_size(1200.0, 800.0)
            .min_inner_size(1080.0, 720.0)
            // Frameless: the app header doubles as the title bar and renders
            // its own minimize/maximize/close buttons.
            .decorations(false)
            .center()
            .data_directory(webview_data_dir.clone())
            .build()?;

            let handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Destroyed = event {
                    // Cooperative teardown: stop listeners/forwards first, then
                    // close every session. Handles are cloned so the borrow of
                    // `handle` ends before the async block.
                    let (registry, forwards, editors) = {
                        let state = handle.state::<AppState>();
                        (
                            state.sessions().clone(),
                            state.forward_manager().clone(),
                            state.editor_manager().clone(),
                        )
                    };
                    tauri::async_runtime::spawn(async move {
                        forwards.stop_all().await;
                        registry.close_all().await;
                        editors.cleanup_all();
                    });
                }
            });

            tracing::info!("main window created");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ssh::app_info,
            commands::ssh::ssh_open,
            commands::ssh::ssh_write,
            commands::ssh::ssh_resize,
            commands::ssh::ssh_close,
            commands::sessions::session_list,
            commands::usage::command_usage_list,
            commands::usage::command_usage_bump,
            commands::usage::command_snippet_list,
            commands::usage::command_snippet_bump,
            commands::usage::command_snippet_catalog,
            commands::usage::command_snippet_override_set,
            commands::usage::command_snippet_override_clear,
            commands::sessions::session_export_json,
            commands::sessions::session_import_json,
            commands::sessions::test_connection,
            commands::sessions::session_create,
            commands::sessions::session_update,
            commands::sessions::session_delete,
            commands::sessions::session_set_password,
            commands::sessions::session_has_password,
            commands::sessions::known_hosts_list,
            commands::sessions::known_hosts_forget,
            commands::sftp::sftp_open,
            commands::sftp::sftp_close,
            commands::sftp::sftp_list,
            commands::sftp::sftp_list_names,
            commands::sftp::sftp_list_stream,
            commands::sftp::sftp_mkdir,
            commands::sftp::sftp_remove,
            commands::sftp::sftp_rename,
            commands::sftp::sftp_chmod,
            commands::sftp::sftp_copy,
            commands::sftp::sftp_upload,
            commands::sftp::sftp_download,
            commands::sftp::sftp_stat,
            commands::sftp::sftp_create_file,
            commands::local::local_open_file,
            commands::forward::forward_list,
            commands::forward::forward_create,
            commands::forward::forward_delete,
            commands::forward::forward_start,
            commands::forward::forward_start_all,
            commands::forward::forward_stop,
            commands::local::local_roots,
            commands::local::app_version,
            commands::local::shell_icon,
            commands::local::quit_app,
            commands::local::apply_update,
            commands::local::logs_tail,
            commands::local::frontend_error,
            commands::local::open_external_url,
            commands::transfer::transfer_attach,
            commands::transfer::transfer_list,
            commands::transfer::transfer_cancel,
            commands::transfer::transfer_upload,
            commands::transfer::transfer_upload_dir,
            commands::transfer::transfer_download,
            commands::transfer::transfer_download_dir,
            commands::editor::editor_open,
            commands::editor::editor_open_external,
            commands::editor::editor_temp_stat,
            commands::editor::editor_process_alive,
            commands::editor::editor_save,
            commands::editor::editor_save_as,
            commands::editor::editor_close,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start LeonSSH");
}
