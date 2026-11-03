//! Port forwarding commands (-L / -R / -D).

use serde::Serialize;
use tauri::State;

use crate::error::AppError;
use crate::forward::ForwardKind;
use crate::state::AppState;
use crate::storage::forwards::{self, ForwardRecord, NewForward};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardView {
    pub id: i64,
    pub session_id: i64,
    pub kind: String,
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: Option<String>,
    pub target_port: Option<u16>,
    pub running: bool,
}

async fn to_view(state: &AppState, record: ForwardRecord) -> ForwardView {
    let running = state.forward_manager().running_ids().await.contains(&record.id);
    ForwardView {
        id: record.id,
        session_id: record.session_id,
        kind: record.kind,
        bind_host: record.bind_host,
        bind_port: record.bind_port as u16,
        target_host: record.target_host,
        target_port: record.target_port.map(|port| port as u16),
        running,
    }
}

#[tauri::command]
pub async fn forward_list(
    state: State<'_, AppState>,
    session_id: i64,
) -> Result<Vec<ForwardView>, AppError> {
    let records = forwards::list_for_session(state.db(), session_id).await?;
    let mut views = Vec::with_capacity(records.len());
    for record in records {
        views.push(to_view(&state, record).await);
    }
    Ok(views)
}

#[tauri::command]
pub async fn forward_create(
    state: State<'_, AppState>,
    input: NewForward,
) -> Result<ForwardView, AppError> {
    let record = forwards::create(state.db(), &input).await?;
    Ok(to_view(&state, record).await)
}

#[tauri::command]
pub async fn forward_delete(state: State<'_, AppState>, id: i64) -> Result<(), AppError> {
    state.forward_manager().stop(id).await;
    forwards::delete(state.db(), id).await
}

#[tauri::command]
pub async fn forward_start(
    state: State<'_, AppState>,
    terminal_id: String,
    id: i64,
) -> Result<ForwardView, AppError> {
    let record = forwards::get(state.db(), id).await?;
    let handle = state.connection(&terminal_id).await?;
    let manager = state.forward_manager().clone();
    let kind = ForwardKind::parse(&record.kind)?;
    let bind = (record.bind_host.clone(), record.bind_port as u16);

    match kind {
        ForwardKind::Local => {
            let target = (
                record.target_host.clone().unwrap_or_default(),
                record.target_port.unwrap_or(0) as u16,
            );
            manager
                .start_local(id, terminal_id.clone(), handle, bind, target)
                .await?;
        }
        ForwardKind::Dynamic => {
            manager
                .start_dynamic(id, terminal_id.clone(), handle, bind)
                .await?;
        }
        ForwardKind::Remote => {
            let target = (
                record.target_host.clone().unwrap_or_default(),
                record.target_port.unwrap_or(0) as u16,
            );
            manager
                .start_remote(id, terminal_id.clone(), handle, bind, target)
                .await?;
        }
    }

    tracing::info!(rule = id, terminal = %terminal_id, kind = %record.kind, "forward started");
    Ok(to_view(&state, record).await)
}

/// Starts every saved rule of a session (called once the terminal is ready).
#[tauri::command]
pub async fn forward_start_all(
    state: State<'_, AppState>,
    terminal_id: String,
    session_id: i64,
) -> Result<usize, AppError> {
    let records = forwards::list_for_session(state.db(), session_id).await?;
    let mut started = 0usize;
    for record in records {
        if state.forward_manager().running_ids().await.contains(&record.id) {
            continue;
        }
        let Ok(handle) = state.connection(&terminal_id).await else {
            break;
        };
        let manager = state.forward_manager().clone();
        let kind = ForwardKind::parse(&record.kind)?;
        let bind = (record.bind_host.clone(), record.bind_port as u16);
        let target = (
            record.target_host.clone().unwrap_or_default(),
            record.target_port.unwrap_or(0) as u16,
        );
        let result = match kind {
            ForwardKind::Local => {
                manager
                    .start_local(record.id, terminal_id.clone(), handle, bind, target)
                    .await
            }
            ForwardKind::Dynamic => {
                manager
                    .start_dynamic(record.id, terminal_id.clone(), handle, bind)
                    .await
            }
            ForwardKind::Remote => {
                manager
                    .start_remote(record.id, terminal_id.clone(), handle, bind, target)
                    .await
            }
        };
        if result.is_ok() {
            started += 1;
        } else if let Err(err) = result {
            tracing::warn!(rule = record.id, error = %err, "auto-start forward failed");
        }
    }
    tracing::info!(session = session_id, started, "forward auto-start finished");
    Ok(started)
}

#[tauri::command]
pub async fn forward_stop(state: State<'_, AppState>, id: i64) -> Result<ForwardView, AppError> {
    state.forward_manager().stop(id).await;
    let record = forwards::get(state.db(), id).await?;
    tracing::info!(rule = id, "forward stopped");
    Ok(to_view(&state, record).await)
}
