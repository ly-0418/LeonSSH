//! `sessions` table: connection metadata only.
//!
//! Passwords/private-key passphrases never touch this table — `keyring_ref`
//! points at the Windows Credential Manager entry, and `private_key_path` is a
//! path (the key material itself is never copied).

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub auth_method: String,
    pub keyring_ref: Option<String>,
    pub private_key_path: Option<String>,
    pub color: Option<String>,
    pub group_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSession {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub auth_method: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub group_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPatch {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub auth_method: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub color: Option<String>,  #[serde(default)]
  pub group_name: Option<String>,
}

const SELECT: &str = "SELECT id, name, host, port, username, auth_method, keyring_ref, \
                      private_key_path, color, group_name, created_at, updated_at FROM sessions";

pub async fn list(pool: &SqlitePool) -> Result<Vec<SessionRecord>, AppError> {
    let rows = sqlx::query_as::<_, SessionRecord>(&format!(
        "{SELECT} ORDER BY lower(name), id"
    ))
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get(pool: &SqlitePool, id: i64) -> Result<SessionRecord, AppError> {
    sqlx::query_as::<_, SessionRecord>(&format!("{SELECT} WHERE id = ?"))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("会话 {id}")))
}

pub async fn create(pool: &SqlitePool, input: &NewSession) -> Result<SessionRecord, AppError> {
    validate(&input.name, &input.host, &input.username)?;
    let auth = input.auth_method.clone().unwrap_or_else(|| "password".into());
    let result = sqlx::query(
        "INSERT INTO sessions (name, host, port, username, auth_method, private_key_path, color, group_name) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(input.name.trim())
    .bind(input.host.trim())
    .bind(input.port as i64)
    .bind(input.username.trim())
    .bind(auth)
    .bind(input.private_key_path.as_deref())
    .bind(input.color.as_deref())
    .bind(input.group_name.as_deref())
    .execute(pool)
    .await?;

    get(pool, result.last_insert_rowid()).await
}

pub async fn update(
    pool: &SqlitePool,
    id: i64,
    input: &SessionPatch,
) -> Result<SessionRecord, AppError> {
    validate(&input.name, &input.host, &input.username)?;
    let auth = input.auth_method.clone().unwrap_or_else(|| "password".into());
    let changed = sqlx::query(
        "UPDATE sessions SET name = ?, host = ?, port = ?, username = ?, auth_method = ?, \
         private_key_path = ?, color = ?, group_name = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(input.name.trim())
    .bind(input.host.trim())
    .bind(input.port as i64)
    .bind(input.username.trim())
    .bind(auth)
    .bind(input.private_key_path.as_deref())
    .bind(input.color.as_deref())
    .bind(input.group_name.as_deref())
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();

    if changed == 0 {
        return Err(AppError::NotFound(format!("会话 {id}")));
    }
    get(pool, id).await
}

pub async fn delete(pool: &SqlitePool, id: i64) -> Result<(), AppError> {
    let changed = sqlx::query("DELETE FROM sessions WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();
    if changed == 0 {
        return Err(AppError::NotFound(format!("会话 {id}")));
    }
    Ok(())
}

pub async fn set_keyring_ref(
    pool: &SqlitePool,
    id: i64,
    reference: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query("UPDATE sessions SET keyring_ref = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(reference)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

fn validate(name: &str, host: &str, username: &str) -> Result<(), AppError> {
    if name.trim().is_empty() {
        return Err(AppError::InvalidArgument("名称不能为空".into()));
    }
    if host.trim().is_empty() {
        return Err(AppError::InvalidArgument("主机不能为空".into()));
    }
    if username.trim().is_empty() {
        return Err(AppError::InvalidArgument("用户名不能为空".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::test_db;

    fn new_session(name: &str) -> NewSession {
        NewSession {
            name: name.into(),
            host: "example.com".into(),
            port: 22,
            username: "root".into(),
            auth_method: None,
            private_key_path: None,
            color: None,
            group_name: None,
        }
    }

    #[tokio::test]
    async fn create_list_update_delete_roundtrip() {
        let pool = test_db::open().await;
        let created = create(&pool, &new_session("prod")).await.unwrap();
        assert_eq!(created.name, "prod");
        assert_eq!(created.auth_method, "password");
        assert!(created.keyring_ref.is_none(), "no secret reference on create");

        let listed = list(&pool).await.unwrap();
        assert_eq!(listed.len(), 1);

        let patch = SessionPatch {
            name: "prod-2".into(),
            host: "example.org".into(),
            port: 2222,
            username: "deploy".into(),
            auth_method: Some("key".into()),
            private_key_path: Some("C:/keys/id_ed25519".into()),
            color: Some("#4ade80".into()),
            group_name: None,
        };
        let updated = update(&pool, created.id, &patch).await.unwrap();
        assert_eq!(updated.name, "prod-2");
        assert_eq!(updated.port, 2222);
        assert_eq!(updated.auth_method, "key");

        delete(&pool, created.id).await.unwrap();
        assert!(list(&pool).await.unwrap().is_empty());
        assert!(get(&pool, created.id).await.is_err());
    }

    #[tokio::test]
    async fn empty_name_is_rejected() {
        let pool = test_db::open().await;
        let err = create(&pool, &new_session("   ")).await.unwrap_err();
        assert_eq!(err.code(), "invalid_argument");
    }

    #[tokio::test]
    async fn keyring_reference_can_be_attached() {
        let pool = test_db::open().await;
        let created = create(&pool, &new_session("with-secret")).await.unwrap();
        set_keyring_ref(&pool, created.id, Some("session:1"))
            .await
            .unwrap();
        let reloaded = get(&pool, created.id).await.unwrap();
        assert_eq!(reloaded.keyring_ref.as_deref(), Some("session:1"));
    }

    /// Development helper: seeds the *real* data directory and Credential
    /// Manager so the UI can be demonstrated/reviewed without typing into forms.
    ///
    /// ```text
    /// $env:LEONSSH_SEED_DATA_DIR='<install dir>\data'
    /// cargo test -- --ignored seed_demo_session --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "dev helper: needs LEONSSH_SEED_DATA_DIR"]
    async fn seed_demo_session() {
        let Ok(dir) = std::env::var("LEONSSH_SEED_DATA_DIR") else {
            return;
        };
        let pool = crate::storage::open(std::path::Path::new(&dir))
            .await
            .unwrap();

        let record = create(
            &pool,
            &NewSession {
                name: "Docker Alpine".into(),
                host: "127.0.0.1".into(),
                port: 2222,
                username: "test".into(),
                auth_method: Some("password".into()),
                private_key_path: None,
                color: Some("#38bdf8".into()),
                group_name: None,
            },
        )
        .await
        .unwrap();

        let reference = crate::secure::reference_for(record.id);
        crate::secure::store(&reference, "test").unwrap();
        set_keyring_ref(&pool, record.id, Some(&reference))
            .await
            .unwrap();
        println!("seeded session id={} ref={reference}", record.id);
    }
}
