//! Online editing commands: open a remote file (external app or temp workspace)
//! and upload changes back over the same SFTP session.

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use super::transfer::ensure_sftp;
use crate::editor::{EditorFile, EditorSaved};
use crate::error::AppError;
use crate::state::AppState;

/// Upload progress for the editor's auto-save bar.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorProgress {
    pub transferred: u64,
    pub total: u64,
}

#[tauri::command]
pub async fn editor_open(
    state: State<'_, AppState>,
    terminal_id: String,
    remote_path: String,
) -> Result<EditorFile, AppError> {
    let sftp = ensure_sftp(&state, &terminal_id).await?;
    state
        .editor_manager()
        .open(&sftp, &terminal_id, &remote_path)
        .await
}

#[tauri::command]
pub async fn editor_open_external(
    state: State<'_, AppState>,
    terminal_id: String,
    remote_path: String,
) -> Result<EditorFile, AppError> {
    let sftp = ensure_sftp(&state, &terminal_id).await?;
    state
        .editor_manager()
        .open_external(&sftp, &terminal_id, &remote_path)
        .await
}

#[tauri::command]
pub fn editor_temp_stat(
    state: State<'_, AppState>,
    edit_id: String,
) -> Result<crate::editor::TempStat, AppError> {
    state.editor_manager().temp_stat(&edit_id)
}

/// Whether the external editor process is still running (bar auto-closes when
/// the user closes the editor).
#[tauri::command]
pub fn editor_process_alive(
    state: State<'_, AppState>,
    edit_id: String,
) -> Result<bool, AppError> {
    state.editor_manager().process_alive(&edit_id)
}

#[tauri::command]
pub async fn editor_save(
    state: State<'_, AppState>,
    edit_id: String,
    progress: Channel<EditorProgress>,
) -> Result<EditorSaved, AppError> {
    let terminal_id = state.editor_manager().terminal_for(&edit_id)?;
    let sftp = ensure_sftp(&state, &terminal_id).await?;
    state
        .editor_manager()
        .save(&edit_id, &sftp, None, move |transferred, total| {
            let _ = progress.send(EditorProgress { transferred, total });
        })
        .await
}

#[tauri::command]
pub async fn editor_save_as(
    state: State<'_, AppState>,
    edit_id: String,
    remote_path: String,
) -> Result<EditorSaved, AppError> {
    let terminal_id = state.editor_manager().terminal_for(&edit_id)?;
    let sftp = ensure_sftp(&state, &terminal_id).await?;
    state
        .editor_manager()
        .save(&edit_id, &sftp, Some(&remote_path), |_, _| {})
        .await
}

#[tauri::command]
pub fn editor_close(state: State<'_, AppState>, edit_id: String) -> Result<(), AppError> {
    state.editor_manager().close(&edit_id);
    Ok(())
}
