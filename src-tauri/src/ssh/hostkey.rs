//! Trust-on-first-use host key pinning, backed by the SQLite `known_hosts` table.
//!
//! Policy (unchanged since phase 2): a pin is written after the first
//! *successful* authentication, and any later mismatch refuses the connection.
//! Pins are cached in memory so `check_server_key` (which must answer
//! synchronously inside the SSH handshake) never touches the database.

use std::collections::HashMap;
use std::sync::RwLock;

use russh::keys::{HashAlg, PublicKeyOrCertificate};
use serde::Serialize;
use sqlx::SqlitePool;

use crate::error::AppError;

/// OpenSSH style `SHA256:...` fingerprint (no padding), identical to what
/// `ssh-keygen -lf` prints.
pub fn fingerprint(key: &PublicKeyOrCertificate) -> String {
    match key {
        PublicKeyOrCertificate::PublicKey { key, .. } => {
            key.fingerprint(HashAlg::Sha256).to_string()
        }
        PublicKeyOrCertificate::Certificate(cert) => {
            cert.public_key().fingerprint(HashAlg::Sha256).to_string()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyVerdict {
    /// No pin yet: record it if the connection succeeds.
    FirstUse,
    /// The server presented the pinned key.
    Match,
    /// The server presented a different key: refuse.
    Mismatch { stored: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostEntry {
    pub endpoint: String,
    pub fingerprint: String,
    pub added_at: String,
}

pub struct KnownHosts {
    entries: RwLock<HashMap<String, String>>,
    pool: SqlitePool,
}

impl KnownHosts {
    pub async fn load(pool: SqlitePool) -> Result<Self, AppError> {
        let rows: Vec<(String, String)> =
            sqlx::query_as("SELECT endpoint, fingerprint FROM known_hosts")
                .fetch_all(&pool)
                .await?;
        let entries = rows.into_iter().collect::<HashMap<_, _>>();
        tracing::debug!(pins = entries.len(), "known_hosts loaded");
        Ok(Self {
            entries: RwLock::new(entries),
            pool,
        })
    }

    pub fn verify(&self, endpoint: &str, actual: &str) -> HostKeyVerdict {
        let entries = self.entries.read().expect("known_hosts poisoned");
        match entries.get(endpoint) {
            None => HostKeyVerdict::FirstUse,
            Some(stored) if stored == actual => HostKeyVerdict::Match,
            Some(stored) => HostKeyVerdict::Mismatch {
                stored: stored.clone(),
            },
        }
    }

    /// Persists a newly pinned fingerprint (first successful connection).
    pub async fn record(&self, endpoint: &str, actual: &str) -> Result<(), AppError> {
        sqlx::query(
            "INSERT INTO known_hosts (endpoint, fingerprint) VALUES (?, ?) \
             ON CONFLICT(endpoint) DO UPDATE SET fingerprint = excluded.fingerprint",
        )
        .bind(endpoint)
        .bind(actual)
        .execute(&self.pool)
        .await?;

        self.entries
            .write()
            .expect("known_hosts poisoned")
            .insert(endpoint.to_string(), actual.to_string());
        tracing::info!(endpoint, fingerprint = actual, "host key pinned");
        Ok(())
    }

    /// Removes a pin — used when the user explicitly accepts a new key.
    pub async fn forget(&self, endpoint: &str) -> Result<(), AppError> {
        sqlx::query("DELETE FROM known_hosts WHERE endpoint = ?")
            .bind(endpoint)
            .execute(&self.pool)
            .await?;
        self.entries
            .write()
            .expect("known_hosts poisoned")
            .remove(endpoint);
        Ok(())
    }

    pub async fn list(&self) -> Result<Vec<KnownHostEntry>, AppError> {
        let rows: Vec<(String, String, String)> =
            sqlx::query_as("SELECT endpoint, fingerprint, added_at FROM known_hosts ORDER BY endpoint")
                .fetch_all(&self.pool)
                .await?;
        Ok(rows
            .into_iter()
            .map(|(endpoint, fingerprint, added_at)| KnownHostEntry {
                endpoint,
                fingerprint,
                added_at,
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::test_db;

    #[tokio::test]
    async fn first_use_then_match_then_mismatch() {
        let pool = test_db::open().await;
        let store = KnownHosts::load(pool).await.unwrap();

        assert_eq!(store.verify("h:22", "SHA256:aaa"), HostKeyVerdict::FirstUse);
        store.record("h:22", "SHA256:aaa").await.unwrap();
        assert_eq!(store.verify("h:22", "SHA256:aaa"), HostKeyVerdict::Match);
        assert_eq!(
            store.verify("h:22", "SHA256:bbb"),
            HostKeyVerdict::Mismatch {
                stored: "SHA256:aaa".into()
            }
        );
    }

    #[tokio::test]
    async fn pin_survives_a_reload() {
        let pool = test_db::open().await;
        {
            let store = KnownHosts::load(pool.clone()).await.unwrap();
            store.record("h:22", "SHA256:ccc").await.unwrap();
        }
        let reloaded = KnownHosts::load(pool).await.unwrap();
        assert_eq!(reloaded.verify("h:22", "SHA256:ccc"), HostKeyVerdict::Match);
        assert_eq!(reloaded.list().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn forget_removes_the_pin() {
        let pool = test_db::open().await;
        let store = KnownHosts::load(pool).await.unwrap();
        store.record("h:22", "SHA256:ddd").await.unwrap();
        store.forget("h:22").await.unwrap();
        assert_eq!(store.verify("h:22", "SHA256:ddd"), HostKeyVerdict::FirstUse);
        assert!(store.list().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn re_recording_updates_the_pin() {
        let pool = test_db::open().await;
        let store = KnownHosts::load(pool).await.unwrap();
        store.record("h:22", "SHA256:old").await.unwrap();
        store.record("h:22", "SHA256:new").await.unwrap();
        assert_eq!(store.verify("h:22", "SHA256:new"), HostKeyVerdict::Match);
        assert_eq!(store.list().await.unwrap().len(), 1);
    }
}
