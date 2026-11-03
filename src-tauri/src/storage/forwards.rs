//! `forwards` table: forwarding rules bound to a stored session.

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ForwardRecord {
    pub id: i64,
    pub session_id: i64,
    pub kind: String,
    pub bind_host: String,
    pub bind_port: i64,
    pub target_host: Option<String>,
    pub target_port: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewForward {
    pub session_id: i64,
    /// `local` | `remote` | `dynamic`
    pub kind: String,
    pub bind_host: String,
    pub bind_port: u16,
    #[serde(default)]
    pub target_host: Option<String>,
    #[serde(default)]
    pub target_port: Option<u16>,
}

const SELECT: &str = "SELECT id, session_id, kind, bind_host, bind_port, target_host, \
                      target_port, created_at FROM forwards";

pub async fn list_for_session(
    pool: &SqlitePool,
    session_id: i64,
) -> Result<Vec<ForwardRecord>, AppError> {
    let rows = sqlx::query_as::<_, ForwardRecord>(&format!(
        "{SELECT} WHERE session_id = ? ORDER BY id"
    ))
    .bind(session_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get(pool: &SqlitePool, id: i64) -> Result<ForwardRecord, AppError> {
    sqlx::query_as::<_, ForwardRecord>(&format!("{SELECT} WHERE id = ?"))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("转发规则 {id}")))
}

pub async fn create(pool: &SqlitePool, input: &NewForward) -> Result<ForwardRecord, AppError> {
    if !matches!(input.kind.as_str(), "local" | "remote" | "dynamic") {
        return Err(AppError::InvalidArgument(format!(
            "未知的转发类型: {}",
            input.kind
        )));
    }
    if input.kind != "dynamic" && input.target_host.as_deref().unwrap_or("").trim().is_empty() {
        return Err(AppError::InvalidArgument("目标主机不能为空".into()));
    }
    if input.bind_port == 0 {
        return Err(AppError::InvalidArgument("绑定端口不能为 0".into()));
    }

    let result = sqlx::query(
        "INSERT INTO forwards (session_id, kind, bind_host, bind_port, target_host, target_port) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(input.session_id)
    .bind(&input.kind)
    .bind(input.bind_host.trim())
    .bind(input.bind_port as i64)
    .bind(input.target_host.as_deref())
    .bind(input.target_port.map(|port| port as i64))
    .execute(pool)
    .await?;

    get(pool, result.last_insert_rowid()).await
}

pub async fn delete(pool: &SqlitePool, id: i64) -> Result<(), AppError> {
    let changed = sqlx::query("DELETE FROM forwards WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();
    if changed == 0 {
        return Err(AppError::NotFound(format!("转发规则 {id}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::sessions::{self, NewSession};
    use crate::storage::test_db;

    async fn seed_session(pool: &SqlitePool) -> i64 {
        sessions::create(
            pool,
            &NewSession {
                name: "fwd".into(),
                host: "127.0.0.1".into(),
                port: 2222,
                username: "test".into(),
                auth_method: None,
                private_key_path: None,
                color: None,
                group_name: None,
                jump_session_id: None,
            },
        )
        .await
        .unwrap()
        .id
    }

    #[tokio::test]
    async fn create_list_delete_roundtrip() {
        let pool = test_db::open().await;
        let session_id = seed_session(&pool).await;

        let record = create(
            &pool,
            &NewForward {
                session_id,
                kind: "local".into(),
                bind_host: "127.0.0.1".into(),
                bind_port: 8080,
                target_host: Some("127.0.0.1".into()),
                target_port: Some(80),
            },
        )
        .await
        .unwrap();

        let listed = list_for_session(&pool, session_id).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].bind_port, 8080);
        assert_eq!(listed[0].target_port, Some(80));

        delete(&pool, record.id).await.unwrap();
        assert!(list_for_session(&pool, session_id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn rejects_unknown_kind_and_missing_target() {
        let pool = test_db::open().await;
        let session_id = seed_session(&pool).await;

        let bad_kind = create(
            &pool,
            &NewForward {
                session_id,
                kind: "udp".into(),
                bind_host: "127.0.0.1".into(),
                bind_port: 9000,
                target_host: Some("h".into()),
                target_port: Some(1),
            },
        )
        .await
        .unwrap_err();
        assert_eq!(bad_kind.code(), "invalid_argument");

        let no_target = create(
            &pool,
            &NewForward {
                session_id,
                kind: "local".into(),
                bind_host: "127.0.0.1".into(),
                bind_port: 9001,
                target_host: None,
                target_port: Some(1),
            },
        )
        .await
        .unwrap_err();
        assert_eq!(no_target.code(), "invalid_argument");
    }

    #[tokio::test]
    async fn deleting_a_session_cascades_to_forward_rules() {
        let pool = test_db::open().await;
        let session_id = seed_session(&pool).await;
        create(
            &pool,
            &NewForward {
                session_id,
                kind: "dynamic".into(),
                bind_host: "127.0.0.1".into(),
                bind_port: 1080,
                target_host: None,
                target_port: None,
            },
        )
        .await
        .unwrap();

        sessions::delete(&pool, session_id).await.unwrap();
        assert!(list_for_session(&pool, session_id).await.unwrap().is_empty());
    }
}
