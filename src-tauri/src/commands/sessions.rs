//! Session CRUD + credential management commands.
//!
//! Passwords only ever cross this boundary in one direction at a time: they are
//! written to the Credential Manager by `session_set_password`, and read back
//! inside `ssh_open` (never returned to the frontend).

use tauri::State;

use crate::error::AppError;
use crate::secure;
use crate::ssh::hostkey::KnownHostEntry;
use crate::state::AppState;
use crate::storage::sessions::{self, NewSession, SessionPatch, SessionRecord};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: String,
    pub private_key_path: Option<String>,
    pub color: Option<String>,
    pub group_name: Option<String>,
    /// Whether a password is currently stored in the Credential Manager.
    pub has_password: bool,
}

impl SessionView {
    fn new(record: SessionRecord, has_password: bool) -> Self {
        Self {
            id: record.id,
            name: record.name,
            host: record.host,
            port: record.port.clamp(1, u16::MAX as i64) as u16,
            username: record.username,
            auth_method: record.auth_method,
            private_key_path: record.private_key_path,
            color: record.color,
            group_name: record.group_name,
            has_password,
        }
    }
}

#[tauri::command]
pub async fn session_list(state: State<'_, AppState>) -> Result<Vec<SessionView>, AppError> {
    let records = sessions::list(state.db()).await?;
    let views = records
        .into_iter()
        .map(|record| {
            let has_password = record.keyring_ref.is_some();
            SessionView::new(record, has_password)
        })
        .collect();
    Ok(views)
}

#[tauri::command]
pub async fn session_create(
    state: State<'_, AppState>,
    input: NewSession,
) -> Result<SessionView, AppError> {
    let record = sessions::create(state.db(), &input).await?;
    tracing::info!(id = record.id, name = %record.name, host = %record.host, "session created");
    Ok(SessionView::new(record, false))
}

#[tauri::command]
pub async fn session_update(
    state: State<'_, AppState>,
    id: i64,
    input: SessionPatch,
) -> Result<SessionView, AppError> {
    let record = sessions::update(state.db(), id, &input).await?;
    let has_password = record.keyring_ref.is_some();
    Ok(SessionView::new(record, has_password))
}

#[tauri::command]
pub async fn session_delete(state: State<'_, AppState>, id: i64) -> Result<(), AppError> {
    let record = sessions::get(state.db(), id).await?;
    if let Some(reference) = record.keyring_ref.as_deref() {
        secure::delete(reference)?;
    }
    sessions::delete(state.db(), id).await?;
    tracing::info!(id, "session deleted");
    Ok(())
}

/// Stores the password in the Windows Credential Manager and records only the
/// reference in SQLite.
#[tauri::command]
pub async fn session_set_password(
    state: State<'_, AppState>,
    id: i64,
    password: String,
) -> Result<(), AppError> {
    if password.is_empty() {
        return Err(AppError::InvalidArgument("密码不能为空".into()));
    }
    // Ensures the session exists before touching the credential store.
    sessions::get(state.db(), id).await?;

    let reference = secure::reference_for(id);
    secure::store(&reference, &password)?;
    sessions::set_keyring_ref(state.db(), id, Some(&reference)).await?;
    tracing::info!(id, "password stored in Windows Credential Manager");
    Ok(())
}

#[tauri::command]
pub async fn session_has_password(
    state: State<'_, AppState>,
    id: i64,
) -> Result<bool, AppError> {
    let record = sessions::get(state.db(), id).await?;
    Ok(record
        .keyring_ref
        .as_deref()
        .map(secure::exists)
        .unwrap_or(false))
}

#[tauri::command]
pub async fn known_hosts_list(
    state: State<'_, AppState>,
) -> Result<Vec<KnownHostEntry>, AppError> {
    state.known_hosts().list().await
}

#[tauri::command]
pub async fn known_hosts_forget(
    state: State<'_, AppState>,
    endpoint: String,
) -> Result<(), AppError> {
    state.known_hosts().forget(&endpoint).await?;
    tracing::info!(endpoint = %endpoint, "host key pin removed by user");
    Ok(())
}

/// Plain TCP reachability check for the connection dialog.
#[tauri::command]
pub async fn test_connection(host: String, port: u16) -> Result<u64, AppError> {
    let target = format!("{host}:{port}");
    let started = std::time::Instant::now();
    let attempt = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        tokio::net::TcpStream::connect(&target),
    )
    .await;
    match attempt {
        Ok(Ok(_)) => Ok(started.elapsed().as_millis() as u64),
        Ok(Err(err)) => Err(AppError::Ssh(format!("无法连接 {target}: {err}"))),
        Err(_) => Err(AppError::Ssh(format!("连接 {target} 超时（3 秒）"))),
    }
}
/// Portable profile (no secrets: passwords stay in the Credential Manager).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionExport {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub auth_method: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub group_name: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

#[tauri::command]
pub async fn session_export_json(state: State<'_, AppState>) -> Result<String, AppError> {
    let records = sessions::list(state.db()).await?;
    let items: Vec<SessionExport> = records
        .into_iter()
        .map(|record| SessionExport {
            name: record.name,
            host: record.host,
            port: record.port.clamp(1, u16::MAX as i64) as u16,
            username: record.username,
            auth_method: Some(record.auth_method),
            private_key_path: record.private_key_path,
            group_name: record.group_name,
            color: record.color,
        })
        .collect();
    serde_json::to_string_pretty(&items)
        .map_err(|err| AppError::Internal(format!("序列化会话失败: {err}")))
}

#[tauri::command]
pub async fn session_import_json(
    state: State<'_, AppState>,
    json: String,
) -> Result<usize, AppError> {
    let items: Vec<SessionExport> = serde_json::from_str(&json)
        .map_err(|err| AppError::InvalidArgument(format!("会话 JSON 格式不正确: {err}")))?;
    let mut imported = 0usize;
    for item in items {
        if item.name.trim().is_empty() || item.host.trim().is_empty() {
            continue;
        }
        let input = sessions::NewSession {
            name: item.name,
            host: item.host,
            port: item.port,
            username: item.username,
            auth_method: item.auth_method,
            private_key_path: item.private_key_path,
            color: item.color,
            group_name: item.group_name,
        };
        sessions::create(state.db(), &input).await?;
        imported += 1;
    }
    tracing::info!(imported, "sessions imported");
    Ok(imported)
}