//! LeonSSH backend entry point.
//!
//! `commands` is the IPC surface, `ssh`/`sftp`/`forward` are domain modules,
//! `storage` owns SQLite, `secure` owns the Windows Credential Manager, and
//! `terminal` is the transport-agnostic byte pipeline.

mod commands;
mod error;
mod forward;
mod paths;
mod secure;
mod sftp;
mod ssh;
mod state;
mod storage;
mod terminal;

#[cfg(feature = "test-server")]
pub use ssh::test_server as ssh_test_server;

use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::ssh::hostkey::KnownHosts;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let paths = paths::Paths::resolve();
    paths::init_tracing(&paths);

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
        .manage(app_state)
        .setup(move |app| {
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
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("LeonSSH")
            .inner_size(1180.0, 760.0)
            .min_inner_size(760.0, 480.0)
            .center()
            .data_directory(webview_data_dir.clone())
            .build()?;

            let handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Destroyed = event {
                    // Cooperative teardown: stop listeners/forwards first, then
                    // close every session. Handles are cloned so the borrow of
                    // `handle` ends before the async block.
                    let (registry, forwards) = {
                        let state = handle.state::<AppState>();
                        (
                            state.sessions().clone(),
                            state.forward_manager().clone(),
                        )
                    };
                    tauri::async_runtime::spawn(async move {
                        forwards.stop_all().await;
                        registry.close_all().await;
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
            commands::sftp::sftp_mkdir,
            commands::sftp::sftp_remove,
            commands::sftp::sftp_rename,
            commands::sftp::sftp_chmod,
            commands::sftp::sftp_upload,
            commands::sftp::sftp_download,
            commands::sftp::local_home,
            commands::sftp::local_list,
            commands::forward::forward_list,
            commands::forward::forward_create,
            commands::forward::forward_delete,
            commands::forward::forward_start,
            commands::forward::forward_stop,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start LeonSSH");
}
