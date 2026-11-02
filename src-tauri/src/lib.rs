//! LeonSSH backend entry point.
//!
//! The module layout is deliberately flat at the top level: `commands` is the
//! IPC surface, `terminal` is the transport-agnostic session layer, and the
//! domain modules (`ssh`, `sftp`, `forward`, `storage`) are added in later
//! phases without changing this file.

mod commands;
mod error;
mod paths;
mod state;
mod terminal;

use tauri::Manager;

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

    // The WebView2 profile (cache, cookies, GPU cache) must live under the same
    // data root as everything else, so nothing escapes to %LOCALAPPDATA%.
    let webview_data_dir = paths.webview_dir.clone();
    let app_state = AppState::new(paths);

    tauri::Builder::default()
        .manage(app_state)
        .setup(move |app| {
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
                    // Cooperative teardown. The registry handle is cloned first
                    // so the borrow of `handle` ends before the async block.
                    let registry = handle.state::<AppState>().sessions().clone();
                    tauri::async_runtime::spawn(async move {
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
        ])
        .run(tauri::generate_context!())
        .expect("failed to start LeonSSH");
}
