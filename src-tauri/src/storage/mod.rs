//! Local persistence (SQLite via sqlx, the engine behind `tauri-plugin-sql`).
//!
//! **Why the pool is created here and not by the plugin's `load` command:** the
//! plugin maps `sqlite:<file>` to `app_config_dir()` (i.e. `%APPDATA%`), while
//! this application must keep every file under the install directory. The
//! plugin is still registered and the pool is published into its `DbInstances`
//! state, so the `@tauri-apps/plugin-sql` JS API can query the same database —
//! we only take over *where* the file lives and *when* migrations run.

use std::path::Path;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

use crate::error::AppError;

pub mod forwards;
pub mod sessions;

pub const DB_FILE: &str = "leonssh.db";
/// Key used both in `DbInstances` and by the frontend `Database.load` call.
pub const DB_URL: &str = "sqlite:leonssh.db";

/// Opens (and creates) the database inside the app data directory and applies
/// the schema. Migrations are idempotent `CREATE ... IF NOT EXISTS` statements
/// plus a `PRAGMA user_version` bump.
pub async fn open(data_dir: &Path) -> Result<SqlitePool, AppError> {
    let path = data_dir.join(DB_FILE);
    let options = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(std::time::Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await?;

    migrate(&pool).await?;
    tracing::info!(path = %path.display(), "sqlite ready");
    Ok(pool)
}

async fn migrate(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sessions (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            name             TEXT NOT NULL,
            host             TEXT NOT NULL,
            port             INTEGER NOT NULL DEFAULT 22,
            username         TEXT NOT NULL,
            auth_method      TEXT NOT NULL DEFAULT 'password'
                             CHECK (auth_method IN ('password', 'key')),
            keyring_ref      TEXT,
            private_key_path TEXT,
            color            TEXT,
            created_at       TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS known_hosts (
            endpoint    TEXT PRIMARY KEY,
            fingerprint TEXT NOT NULL,
            added_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS forwards (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            kind        TEXT NOT NULL CHECK (kind IN ('local', 'remote', 'dynamic')),
            bind_host   TEXT NOT NULL DEFAULT '127.0.0.1',
            bind_port   INTEGER NOT NULL,
            target_host TEXT,
            target_port INTEGER,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_forwards_session ON forwards(session_id)")
        .execute(pool)
        .await?;

    // Migration: per-session group label (ignored when it already exists).
    let _ = sqlx::query("ALTER TABLE sessions ADD COLUMN group_name TEXT")
        .execute(pool)
        .await;

    // Migration: optional jump host (ProxyJump) for a session.
    let _ = sqlx::query("ALTER TABLE sessions ADD COLUMN jump_session_id INTEGER")
        .execute(pool)
        .await;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS command_usage (
            name  TEXT PRIMARY KEY,
            count INTEGER NOT NULL DEFAULT 0
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS command_snippets (
            line  TEXT PRIMARY KEY,
            count INTEGER NOT NULL DEFAULT 0
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("PRAGMA user_version = 5").execute(pool).await?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod test_db {
    use super::*;

    /// In-memory database with the production schema, for unit tests.
    pub async fn open() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        migrate(&pool).await.expect("migrate");
        pool
    }
}
