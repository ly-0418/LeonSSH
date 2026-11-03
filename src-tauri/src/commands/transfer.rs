//! Transfer commands: queue, cancel, and the two directions.

use std::path::{Component, PathBuf};
use std::sync::Arc;

use russh_sftp::client::SftpSession;
use tauri::ipc::Channel;
use tauri::State;

use crate::error::AppError;
use crate::sftp;
use crate::state::AppState;
use crate::transfer::task::TransferTask;

/// The SFTP subsystem for this terminal, opened on demand on the *existing*
/// SSH connection (never a new one).
pub(crate) async fn ensure_sftp(
    state: &AppState,
    terminal_id: &str,
) -> Result<Arc<SftpSession>, AppError> {
    if let Ok(session) = state.sftp(terminal_id).await {
        return Ok(session);
    }
    let handle = state.connection(terminal_id).await?;
    let session = Arc::new(sftp::open_subsystem(&handle).await?);
    state
        .register_sftp(terminal_id.to_string(), session.clone())
        .await;
    Ok(session)
}

/// Local paths come from the panes/dialog, but are still validated: absolute,
/// normalized, and free of `..` components (no traversal from a crafted path).
fn check_local(raw: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(raw);
    if raw.trim().is_empty() {
        return Err(AppError::InvalidArgument("本地路径为空".into()));
    }
    if !path.is_absolute() {
        return Err(AppError::InvalidArgument(format!("本地路径必须是绝对路径: {raw}")));
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(AppError::InvalidArgument(format!(
            "本地路径不允许包含 ..: {raw}"
        )));
    }
    Ok(path)
}

fn local_source(raw: &str) -> Result<PathBuf, AppError> {
    let path = check_local(raw)?;
    if !path.is_file() {
        return Err(AppError::InvalidArgument(format!(
            "本地文件不存在: {}",
            path.display()
        )));
    }
    Ok(path)
}

/// `check_local` is referenced from tests on all platforms.
fn local_target(raw: &str) -> Result<PathBuf, AppError> {
    let path = check_local(raw)?;
    if path.is_dir() {
        return Err(AppError::InvalidArgument(format!(
            "本地目标是目录而不是文件: {}",
            path.display()
        )));
    }
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err(AppError::InvalidArgument(format!(
                "本地目录不存在: {}",
                parent.display()
            )));
        }
    }
    Ok(path)
}

#[tauri::command]
pub fn transfer_attach(state: State<'_, AppState>, channel: Channel<TransferTask>) -> Result<(), AppError> {
    state.transfer_manager().attach(channel);
    Ok(())
}

#[tauri::command]
pub fn transfer_list(state: State<'_, AppState>) -> Result<Vec<TransferTask>, AppError> {
    Ok(state.transfer_manager().snapshot())
}

#[tauri::command]
pub fn transfer_cancel(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    state.transfer_manager().cancel(&id);
    Ok(())
}

#[tauri::command]
pub async fn transfer_upload(
    state: State<'_, AppState>,
    terminal_id: String,
    local_path: String,
    remote_path: String,
    overwrite: bool,
) -> Result<TransferTask, AppError> {
    let local = local_source(&local_path)?;
    let remote = sftp::path::normalize_remote(&remote_path);
    if remote == "/" {
        return Err(AppError::InvalidArgument(
            "不能上传到远程根目录，请进入某个目录后再试".into(),
        ));
    }
    tracing::info!(%remote, overwrite, local = %local.display(), "upload requested");
    let session = ensure_sftp(&state, &terminal_id).await?;
    state
        .transfer_manager()
        .start_upload(session, terminal_id, local, remote, overwrite)
}

#[tauri::command]
pub async fn transfer_download(
    state: State<'_, AppState>,
    terminal_id: String,
    remote_path: String,
    local_path: String,
) -> Result<TransferTask, AppError> {
    let local = local_target(&local_path)?;
    let remote = sftp::path::normalize_remote(&remote_path);
    let session = ensure_sftp(&state, &terminal_id).await?;
    state
        .transfer_manager()
        .start_download(session, terminal_id, remote, local)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_relative_and_traversal_paths() {
        assert!(check_local("relative/file.txt").is_err());
        assert!(check_local(r"C:\Windows\..\..\etc\hosts").is_err());
        assert!(check_local("").is_err());
    }

    #[test]
    fn accepts_an_absolute_file() {
        let file = std::env::temp_dir().join("leonssh-transfer-check.txt");
        std::fs::write(&file, b"x").unwrap();
        assert!(local_source(file.to_str().unwrap()).is_ok());
        assert!(local_source("C:\\definitely\\missing\\file.bin").is_err());
        let _ = std::fs::remove_file(&file);
    }
}
