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

#[tauri::command]
pub async fn command_snippet_list(state: State<'_, AppState>) -> Result<Vec<(String, i64)>, AppError> {
    let rows = sqlx::query_as::<_, (String, i64)>("SELECT line, count FROM command_snippets")
        .fetch_all(state.db())
        .await?;
    Ok(rows)
}

#[tauri::command]
pub async fn command_snippet_bump(state: State<'_, AppState>, line: String) -> Result<(), AppError> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.len() > 300 {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO command_snippets (line, count) VALUES (?, 1) \
         ON CONFLICT(line) DO UPDATE SET count = count + 1",
    )
    .bind(trimmed)
    .execute(state.db())
    .await?;
    Ok(())
}
/// One learned snippet together with the user's override (edited text / hidden).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippetRow {
    pub original: String,
    pub template: String,
    pub count: i64,
    pub edited: bool,
    pub deleted: bool,
}

#[tauri::command]
pub async fn command_snippet_catalog(
    state: State<'_, AppState>,
) -> Result<Vec<SnippetRow>, AppError> {
    let rows = sqlx::query_as::<_, (String, String, i64, i64, i64)>(
        "SELECT s.line, COALESCE(o.template, s.line), s.count, \
                CASE WHEN o.original IS NULL THEN 0 ELSE 1 END, COALESCE(o.deleted, 0) \
         FROM command_snippets s \
         LEFT JOIN snippet_overrides o ON o.original = s.line \
         ORDER BY s.count DESC, s.line ASC",
    )
    .fetch_all(state.db())
    .await?;
    Ok(rows
        .into_iter()
        .map(|(original, template, count, overridden, deleted)| SnippetRow {
            original,
            template,
            count,
            edited: overridden == 1 && deleted == 0,
            deleted: deleted == 1,
        })
        .collect())
}

#[tauri::command]
pub async fn command_snippet_override_set(
    state: State<'_, AppState>,
    original: String,
    template: String,
    deleted: bool,
) -> Result<(), AppError> {
    let trimmed = template.trim();
    if trimmed.is_empty() || trimmed.len() > 300 {
        return Err(AppError::InvalidArgument("命令内容为空或过长".into()));
    }
    sqlx::query(
        "INSERT INTO snippet_overrides (original, template, deleted, updated_at) \
         VALUES (?, ?, ?, datetime('now')) \
         ON CONFLICT(original) DO UPDATE SET template = excluded.template, \
             deleted = excluded.deleted, updated_at = datetime('now')",
    )
    .bind(&original)
    .bind(trimmed)
    .bind(if deleted { 1 } else { 0 })
    .execute(state.db())
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn command_snippet_override_clear(
    state: State<'_, AppState>,
    original: String,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM snippet_overrides WHERE original = ?")
        .bind(original)
        .execute(state.db())
        .await?;
    Ok(())
}

/// Permanently forget a learned snippet (it may be learned again later).
#[tauri::command]
pub async fn command_snippet_delete(
    state: State<'_, AppState>,
    original: String,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM command_snippets WHERE line = ?")
        .bind(&original)
        .execute(state.db())
        .await?;
    sqlx::query("DELETE FROM snippet_overrides WHERE original = ?")
        .bind(original)
        .execute(state.db())
        .await?;
    Ok(())
}
