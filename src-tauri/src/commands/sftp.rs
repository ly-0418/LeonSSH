//! SFTP + local filesystem commands.
//!
//! Transfers are chunked (32 KiB per syscall) and report progress through a
//! small JSON `Channel`; terminal bytes never travel this way.

use std::sync::Arc;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::error::AppError;
use crate::sftp::{self, FileEntry};
use crate::state::AppState;

const PROGRESS_STEP_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub transferred: u64,
    pub total: u64,
    pub done: bool,
    pub message: Option<String>,
}

/// Opens the SFTP subsystem on the terminal's existing SSH connection and
/// returns the remote home directory.
/// Turns a raw permission denial into an actionable Chinese explanation.
fn zh_permission(err: AppError) -> AppError {
    let text = err.to_string().to_lowercase();
    if text.contains("permission denied") || text.contains("access denied") {
        return AppError::InvalidArgument(
            "没有权限执行该操作：服务器拒绝了写入/修改请求（Permission denied）。请检查目标文件或目录的属主与权限位（例如 chmod / chown），或改用有权限的账号。"
                .into(),
        );
    }
    err
}
#[tauri::command]
pub async fn sftp_open(state: State<'_, AppState>, terminal_id: String) -> Result<String, AppError> {
    let handle = state.connection(&terminal_id).await?;
    // Reuse the subsystem that is already open: re-entering the panel while
    // a transfer is running used to close it and abort every in-flight task
    // ("sender dropped"). Only open a fresh one when none exists.
    if let Ok(existing) = state.sftp(&terminal_id).await {
        tracing::info!(terminal = %terminal_id, "reusing open sftp subsystem");
        let home = existing
            .canonicalize(".")
            .await
            .unwrap_or_else(|_| "/".to_string());
        return Ok(home);
    }
    let session = sftp::open_subsystem(&handle).await?;
    let home = session
        .canonicalize(".")
        .await
        .unwrap_or_else(|_| "/".to_string());
    state
        .register_sftp(terminal_id.clone(), Arc::new(session))
        .await;
    tracing::info!(terminal = %terminal_id, home = %home, "sftp subsystem opened");
    Ok(home)
}

#[tauri::command]
pub async fn sftp_close(state: State<'_, AppState>, terminal_id: String) -> Result<(), AppError> {
    tracing::info!(terminal = %terminal_id, "sftp_close called");
    // Never tear the subsystem down under a running transfer.
    if state.transfer_manager().has_active_for(&terminal_id) {
        tracing::warn!(terminal = %terminal_id, "refusing to close sftp: transfers active");
        return Ok(());
    }
    if let Ok(session) = state.sftp(&terminal_id).await {
        let _ = session.close().await;
    }
    state.drop_sftp(&terminal_id).await;
    Ok(())
}

#[tauri::command]
pub async fn sftp_list(
    state: State<'_, AppState>,
    terminal_id: String,
    path: String,
) -> Result<Vec<FileEntry>, AppError> {
    let session = state.sftp(&terminal_id).await?;
    sftp::list(&session, &path).await
}

/// Streams a directory listing: the first `readdir` batch arrives after one
/// round trip, so large folders appear immediately.
#[tauri::command]
pub async fn sftp_list_stream(
    state: State<'_, AppState>,
    terminal_id: String,
    path: String,
    batch: Channel<Vec<sftp::FileEntry>>,
) -> Result<usize, AppError> {
    let handle = state.connection(&terminal_id).await?;
    sftp::list_stream(&handle, &path, move |entries| batch.send(entries).is_ok()).await
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    terminal_id: String,
    path: String,
) -> Result<(), AppError> {
    let session = state.sftp(&terminal_id).await?;
    sftp::mkdir(&session, &path).await.map_err(zh_permission)
}

#[tauri::command]
pub async fn sftp_remove(
    state: State<'_, AppState>,
    terminal_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), AppError> {
    let session = state.sftp(&terminal_id).await?;
    sftp::remove(&session, &path, is_dir).await.map_err(zh_permission)
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    terminal_id: String,
    from: String,
    to: String,
) -> Result<(), AppError> {
    let session = state.sftp(&terminal_id).await?;
    sftp::rename(&session, &from, &to).await.map_err(zh_permission)
}

#[tauri::command]
pub async fn sftp_chmod(
    state: State<'_, AppState>,
    terminal_id: String,
    path: String,
    mode: u32,
) -> Result<(), AppError> {
    let session = state.sftp(&terminal_id).await?;
    sftp::chmod(&session, &path, mode).await.map_err(zh_permission)
}

#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    terminal_id: String,
    local_path: String,
    remote_path: String,
    progress: Channel<TransferProgress>,
) -> Result<(), AppError> {
    let session = state.sftp(&terminal_id).await?;
    let mut last_reported = 0u64;

    let transferred = sftp::upload_file(
        &session,
        std::path::Path::new(&local_path),
        &remote_path,
        |done, total| {
            if done - last_reported >= PROGRESS_STEP_BYTES {
                last_reported = done;
                let _ = progress.send(TransferProgress {
                    transferred: done,
                    total,
                    done: false,
                    message: None,
                });
            }
        },
    )
    .await?;

    let _ = progress.send(TransferProgress {
        transferred,
        total: transferred,
        done: true,
        message: Some(format!("已上传 {transferred} 字节")),
    });
    tracing::info!(terminal = %terminal_id, %local_path, %remote_path, bytes = transferred, "sftp upload finished");
    Ok(())
}

#[tauri::command]
pub async fn sftp_download(
    state: State<'_, AppState>,
    terminal_id: String,
    remote_path: String,
    local_path: String,
    progress: Channel<TransferProgress>,
) -> Result<(), AppError> {
    let session = state.sftp(&terminal_id).await?;
    let mut last_reported = 0u64;

    let transferred = sftp::download_file(
        &session,
        &remote_path,
        std::path::Path::new(&local_path),
        |done, total| {
            if done - last_reported >= PROGRESS_STEP_BYTES {
                last_reported = done;
                let _ = progress.send(TransferProgress {
                    transferred: done,
                    total,
                    done: false,
                    message: None,
                });
            }
        },
    )
    .await?;

    let _ = progress.send(TransferProgress {
        transferred,
        total: transferred,
        done: true,
        message: Some(format!("已下载 {transferred} 字节")),
    });
    tracing::info!(terminal = %terminal_id, %remote_path, %local_path, bytes = transferred, "sftp download finished");
    Ok(())
}

#[tauri::command]
pub async fn sftp_create_file(
    state: State<'_, AppState>,
    terminal_id: String,
    path: String,
) -> Result<(), AppError> {
    let session = state.sftp(&terminal_id).await?;
    sftp::create_file(&session, &path).await.map_err(zh_permission)
}

/// Metadata for one remote path.
#[tauri::command]
pub async fn sftp_stat(
    state: State<'_, AppState>,
    terminal_id: String,
    path: String,
) -> Result<FileEntry, AppError> {
    let session = state.sftp(&terminal_id).await?;
    sftp::stat(&session, &path).await
}

#[tauri::command]
pub async fn sftp_copy(
    state: State<'_, AppState>,
    terminal_id: String,
    from: String,
    to: String,
) -> Result<u64, AppError> {
    let session = state.sftp(&terminal_id).await?;
    let bytes = sftp::copy_path(&session, &from, &to).await?;
    tracing::info!(%from, %to, bytes, "remote copy finished");
    Ok(bytes)
}
#[tauri::command]
pub async fn sftp_list_names(
    state: State<'_, AppState>,
    terminal_id: String,
    path: String,
    limit: Option<usize>,
) -> Result<Vec<sftp::FileEntry>, AppError> {
    // Completion may be the first SFTP user of the connection: open lazily.
    let session = super::transfer::ensure_sftp(&state, &terminal_id).await?;
    sftp::list_names(&session, &path, limit.unwrap_or(400)).await
}
