//! Online editing commands: open a remote text file in a temp workspace, save
//! it back over the same SFTP session.

use tauri::State;

use super::transfer::ensure_sftp;
use crate::editor::{EditorFile, EditorSaved};
use crate::error::AppError;
use crate::state::AppState;

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
pub async fn editor_save(state: State<'_, AppState>, edit_id: String) -> Result<EditorSaved, AppError> {
    let terminal_id = state.editor_manager().terminal_for(&edit_id)?;
    let sftp = ensure_sftp(&state, &terminal_id).await?;
    state.editor_manager().save(&edit_id, &sftp, None).await
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
        .save(&edit_id, &sftp, Some(&remote_path))
        .await
}

#[tauri::command]
pub fn editor_close(state: State<'_, AppState>, edit_id: String) -> Result<(), AppError> {
    state.editor_manager().close(&edit_id);
    Ok(())
}
