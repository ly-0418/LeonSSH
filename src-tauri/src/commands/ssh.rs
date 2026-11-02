//! Terminal IPC commands.
//!
//! | command        | direction  | payload                                    |
//! |----------------|------------|--------------------------------------------|
//! | `ssh_open`     | JS -> Rust | `sessionId` (DB row) + `Channel` + size    |
//! | `ssh_write`    | JS -> Rust | `terminalId`, `data: number[]`             |
//! | `ssh_resize`   | JS -> Rust | `terminalId`, `cols`, `rows`               |
//! | `ssh_close`    | JS -> Rust | `terminalId`                               |
//!
//! Output never travels through `invoke`: it is written to the `Channel` with
//! `InvokeResponseBody::Raw`, so the webview receives an `ArrayBuffer`.

use std::sync::Arc;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;
use tokio::sync::{mpsc, watch};

use crate::error::AppError;
use crate::secure;
use crate::ssh::config::SshConfig;
use crate::ssh::hostkey::HostKeyVerdict;
use crate::ssh::session;
use crate::state::{AppState, SessionId};
use crate::storage::sessions;
use crate::terminal::input::escape_preview;
use crate::terminal::pump;
use crate::terminal::registry::{
    DEFAULT_CLOSE_TIMEOUT, INPUT_QUEUE_CAPACITY, OUTPUT_QUEUE_CAPACITY, SessionHandle,
};
use crate::terminal::sink::{ChannelSink, OutputSink};

const MIN_COLS: u16 = 20;
const MAX_COLS: u16 = 1000;
const MIN_ROWS: u16 = 5;
const MAX_ROWS: u16 = 500;
const DEFAULT_COLS: u16 = 120;
const DEFAULT_ROWS: u16 = 32;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSessionResult {
    /// Runtime handle used by the other terminal commands (`s1`, `s2`, …).
    pub terminal_id: SessionId,
    /// Row id of the stored connection profile.
    pub session_id: i64,
    pub title: String,
    pub cols: u16,
    pub rows: u16,
    pub endpoint: String,
    pub username: String,
    pub fingerprint: String,
    /// `match` | `first-use`
    pub host_key: &'static str,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub install_dir: String,
    pub data_dir: String,
    pub logs_dir: String,
    pub cache_dir: String,
    pub data_mode: &'static str,
    pub platform: String,
    pub arch: String,
    pub active_sessions: usize,
}

/// Static information rendered in the status bar, including the resolved data
/// root so the "everything lives next to the exe" rule is verifiable in the UI.
#[tauri::command]
pub async fn app_info(state: State<'_, AppState>) -> Result<AppInfo, AppError> {
    let paths = state.paths();
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        install_dir: paths.install_dir.display().to_string(),
        data_dir: paths.data_dir.display().to_string(),
        logs_dir: paths.logs_dir.display().to_string(),
        cache_dir: paths.cache_dir.display().to_string(),
        data_mode: paths.mode.as_str(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        active_sessions: state.session_count().await,
    })
}

/// Validates an optional PTY dimension instead of silently clamping it, so a
/// broken caller sees a real error rather than a surprising terminal size.
fn resolve_size(
    value: Option<u16>,
    default: u16,
    min: u16,
    max: u16,
    field: &str,
) -> Result<u16, AppError> {
    let value = value.unwrap_or(default);
    if value < min || value > max {
        return Err(AppError::InvalidArgument(format!(
            "{field} 超出范围 [{min}, {max}]：{value}"
        )));
    }
    Ok(value)
}

/// Opens a terminal for a stored session: loads the profile, pulls the password
/// from the Credential Manager, connects, then starts the byte pump.
#[tauri::command]
pub async fn ssh_open(
    state: State<'_, AppState>,
    session_id: i64,
    channel: Channel<InvokeResponseBody>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<OpenSessionResult, AppError> {
    let cols = resolve_size(cols, DEFAULT_COLS, MIN_COLS, MAX_COLS, "cols")?;
    let rows = resolve_size(rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS, "rows")?;

    let record = sessions::get(state.db(), session_id).await?;
    let password = match record.keyring_ref.as_deref() {
        Some(reference) => secure::load(reference)?,
        None => None,
    };
    if password.is_none() {
        return Err(AppError::InvalidArgument(
            "该会话还没有保存密码，请先在连接设置里填写".into(),
        ));
    }

    let cfg = SshConfig::from_session(&record, password);
    let terminal_id = state.allocate_session_id();

    let sink: Arc<dyn OutputSink> = Arc::new(ChannelSink::new(channel));
    let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>(INPUT_QUEUE_CAPACITY);
    let (resize_tx, resize_rx) = watch::channel((cols, rows));
    let (close_tx, close_rx) = watch::channel(false);
    let (out_tx, out_rx) = mpsc::channel::<bytes::Bytes>(OUTPUT_QUEUE_CAPACITY);

    // Connect *before* spawning so authentication errors surface as a command
    // error instead of a mysterious empty terminal.
    let opened = session::open(
        &cfg,
        state.known_hosts().clone(),
        cols,
        rows,
        state.forward_manager().remote_routes(),
    )
    .await?;
    let fingerprint = opened.fingerprint.clone();
    let host_key = match opened.verdict {
        HostKeyVerdict::Match => "match",
        HostKeyVerdict::FirstUse => "first-use",
        HostKeyVerdict::Mismatch { .. } => "mismatch",
    };

    let task_close = close_rx.clone();
    let task_terminal = terminal_id.clone();
    // SFTP / port forwarding reuse this exact connection, so keep a clone of
    // the handle before `opened` is moved into the io task.
    state
        .register_connection(terminal_id.clone(), opened.handle.clone())
        .await;
    let join = tokio::spawn(async move {
        let pump_fut = pump::run(out_rx, sink, task_close.clone());
        let io_fut = session::run_io(opened, input_rx, resize_rx, task_close, out_tx);
        tokio::join!(io_fut, pump_fut);
        tracing::debug!(terminal = %task_terminal, "ssh terminal task finished");
    });

    state
        .insert_session(
            terminal_id.clone(),
            SessionHandle::new(terminal_id.clone(), input_tx, resize_tx, close_tx, join),
        )
        .await;

    tracing::info!(
        terminal = %terminal_id,
        session = session_id,
        endpoint = %cfg.endpoint(),
        user = %cfg.username,
        fingerprint = %fingerprint,
        host_key,
        cols,
        rows,
        "terminal opened"
    );

    Ok(OpenSessionResult {
        terminal_id,
        session_id,
        title: record.name,
        cols,
        rows,
        endpoint: cfg.endpoint(),
        username: cfg.username,
        fingerprint,
        host_key,
    })
}

/// Keyboard input. Small payloads, so JSON encoding is acceptable here — the
/// *output* path is the one that must stay binary.
#[tauri::command]
pub async fn ssh_write(
    state: State<'_, AppState>,
    terminal_id: String,
    data: Vec<u8>,
) -> Result<(), AppError> {
    if data.is_empty() {
        return Ok(());
    }

    tracing::info!(
        terminal = %terminal_id,
        bytes = data.len(),
        preview = %escape_preview(&data),
        "terminal input"
    );

    let tx = state.input_sender(&terminal_id).await?;
    tx.send(data)
        .await
        .map_err(|_| AppError::SessionClosed(terminal_id.clone()))?;
    Ok(())
}

/// PTY size negotiation. This is a control signal: it never enters the byte
/// stream and is coalesced by a `watch` channel (only the latest size matters).
#[tauri::command]
pub async fn ssh_resize(
    state: State<'_, AppState>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    let cols = resolve_size(Some(cols), DEFAULT_COLS, MIN_COLS, MAX_COLS, "cols")?;
    let rows = resolve_size(Some(rows), DEFAULT_ROWS, MIN_ROWS, MAX_ROWS, "rows")?;

    state.request_resize(&terminal_id, cols, rows).await?;
    tracing::info!(terminal = %terminal_id, cols, rows, "terminal resize");
    Ok(())
}

#[tauri::command]
pub async fn ssh_close(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<(), AppError> {
    let handle = state
        .remove_session(&terminal_id)
        .await
        .ok_or_else(|| AppError::SessionNotFound(terminal_id.clone()))?;

    state.drop_sftp(&terminal_id).await;
    state.drop_connection(&terminal_id).await;
    state.forward_manager().stop_all_for_terminal(&terminal_id).await;

    let outcome = handle.close(DEFAULT_CLOSE_TIMEOUT).await;
    tracing::info!(terminal = %terminal_id, ?outcome, "terminal closed");
    Ok(())
}
