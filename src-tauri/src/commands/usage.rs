//! Per-installation command usage counters (they survive restarts, sessions and
//! upgrades because they live in the SQLite database, not in the webview store).

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub async fn command_usage_list(state: State<'_, AppState>) -> Result<Vec<(String, i64)>, AppError> {
    let rows = sqlx::query_as::<_, (String, i64)>("SELECT name, count FROM command_usage")
        .fetch_all(state.db())
        .await?;
    Ok(rows)
}

#[tauri::command]
pub async fn command_usage_bump(state: State<'_, AppState>, name: String) -> Result<(), AppError> {
    if name.trim().is_empty() {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO command_usage (name, count) VALUES (?, 1) \
         ON CONFLICT(name) DO UPDATE SET count = count + 1",
    )
    .bind(name.trim())
    .execute(state.db())
    .await?;
    Ok(())
}
