//! Terminal IPC commands.
//!
//! Contract with the frontend (phase 1, unchanged in later phases):
//!
//! | command        | direction        | payload                          |
//! |----------------|------------------|----------------------------------|
//! | `ssh_open`     | JS -> Rust       | `Channel<ArrayBuffer>` + size    |
//! | `ssh_write`    | JS -> Rust       | `sessionId`, `data: number[]`    |
//! | `ssh_resize`   | JS -> Rust       | `sessionId`, `cols`, `rows`      |
//! | `ssh_close`    | JS -> Rust       | `sessionId`                      |
//!
//! Output never travels through `invoke`: it is written to the `Channel` with
//! `InvokeResponseBody::Raw`, so the webview receives an `ArrayBuffer`.

use std::sync::Arc;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;
use tokio::sync::{mpsc, watch};

use crate::error::AppError;
use crate::state::{AppState, SessionId};
use crate::terminal::fake_source::{self, FakeSourceConfig};
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
    pub session_id: SessionId,
    pub title: String,
    pub cols: u16,
    pub rows: u16,
    pub transport: &'static str,
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

/// Opens a terminal session. Phase 1 backs it with the fake byte source;
/// phase 2 swaps in `ssh::session::spawn` without changing this signature.
#[tauri::command]
pub async fn ssh_open(
    state: State<'_, AppState>,
    channel: Channel<InvokeResponseBody>,
    cols: Option<u16>,
    rows: Option<u16>,
    title: Option<String>,
) -> Result<OpenSessionResult, AppError> {
    let cols = resolve_size(cols, DEFAULT_COLS, MIN_COLS, MAX_COLS, "cols")?;
    let rows = resolve_size(rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS, "rows")?;
    let session_id = state.allocate_session_id();
    let title = title.unwrap_or_else(|| "LeonSSH 会话".to_string());
    let data_dir = state.paths().data_dir.display().to_string();

    let sink: Arc<dyn OutputSink> = Arc::new(ChannelSink::new(channel));
    let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>(INPUT_QUEUE_CAPACITY);
    let (resize_tx, resize_rx) = watch::channel((cols, rows));
    let (close_tx, close_rx) = watch::channel(false);
    let (out_tx, out_rx) = mpsc::channel::<bytes::Bytes>(OUTPUT_QUEUE_CAPACITY);

    let pump_close = close_rx.clone();
    let source_close = close_rx.clone();
    let source_session = session_id.clone();

    // A single task owns the producer *and* the pump: aborting it cancels both,
    // so `SessionHandle::close` can never leak a zombie task.
    let join = tokio::spawn(async move {
        let pump_fut = pump::run(out_rx, sink, pump_close);
        let source_fut = fake_source::run(
            FakeSourceConfig {
                session_id: source_session,
                data_dir,
                cols,
                rows,
            },
            input_rx,
            resize_rx,
            source_close,
            out_tx,
        );
        tokio::join!(source_fut, pump_fut);
    });

    state
        .insert_session(
            session_id.clone(),
            SessionHandle::new(session_id.clone(), input_tx, resize_tx, close_tx, join),
        )
        .await;

    tracing::info!(session = %session_id, cols, rows, "terminal session opened (fake transport)");

    Ok(OpenSessionResult {
        session_id,
        title,
        cols,
        rows,
        transport: "fake",
    })
}

/// Keyboard input. Small payloads, so JSON encoding is acceptable here — the
/// *output* path is the one that must stay binary.
#[tauri::command]
pub async fn ssh_write(
    state: State<'_, AppState>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), AppError> {
    if data.is_empty() {
        return Ok(());
    }

    tracing::info!(
        session = %session_id,
        bytes = data.len(),
        preview = %escape_preview(&data),
        "terminal input"
    );

    let tx = state.input_sender(&session_id).await?;
    tx.send(data)
        .await
        .map_err(|_| AppError::SessionClosed(session_id.clone()))?;
    Ok(())
}

/// PTY size negotiation. This is a control signal: it never enters the byte
/// stream and is coalesced by a `watch` channel (only the latest size matters).
#[tauri::command]
pub async fn ssh_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    let cols = resolve_size(Some(cols), DEFAULT_COLS, MIN_COLS, MAX_COLS, "cols")?;
    let rows = resolve_size(Some(rows), DEFAULT_ROWS, MIN_ROWS, MAX_ROWS, "rows")?;

    state.request_resize(&session_id, cols, rows).await?;
    tracing::info!(session = %session_id, cols, rows, "terminal resize");
    Ok(())
}

#[tauri::command]
pub async fn ssh_close(state: State<'_, AppState>, session_id: String) -> Result<(), AppError> {
    let handle = state
        .remove_session(&session_id)
        .await
        .ok_or_else(|| AppError::SessionNotFound(session_id.clone()))?;

    let outcome = handle.close(DEFAULT_CLOSE_TIMEOUT).await;
    tracing::info!(session = %session_id, ?outcome, "terminal session closed");
    Ok(())
}
