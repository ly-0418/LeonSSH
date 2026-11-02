//! SSH transport (russh).
//!
//! Phase 2 scope: password authentication, PTY negotiation, interactive shell,
//! and TOFU host-key pinning backed by a small JSON file. Phase 3 replaces the
//! JSON store with SQLite and moves credentials into the Windows keyring.

pub mod client;
pub mod config;
pub mod hostkey;
pub mod session;

#[cfg(any(test, feature = "test-server"))]
pub mod test_server;

use crate::error::AppError;

#[derive(Debug, thiserror::Error)]
pub enum SshError {
    #[error("连接超时：{0} 秒内未完成 SSH 握手")]
    Timeout(u64),

    #[error("无法连接 {endpoint}：{reason}")]
    Connect { endpoint: String, reason: String },

    #[error("SSH 握手失败：{0}")]
    Handshake(String),

    #[error("认证失败：用户名或密码错误")]
    AuthRejected,

    #[error(
        "主机密钥不匹配！{endpoint} 记录的是 {stored}，本次服务器提供的是 {actual}。\
         连接已拒绝，可能是中间人攻击或服务器重装。"
    )]
    HostKeyMismatch {
        endpoint: String,
        stored: String,
        actual: String,
    },

    #[error("通道错误：{0}")]
    Channel(String),
}

impl From<SshError> for AppError {
    fn from(value: SshError) -> Self {
        match value {
            SshError::HostKeyMismatch {
                endpoint,
                stored,
                actual,
            } => AppError::HostKeyMismatch(format!(
                "{endpoint} 已记录 {stored}，本次为 {actual}"
            )),
            other => AppError::Ssh(other.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_key_mismatch_maps_to_a_dedicated_error_code() {
        let err: AppError = SshError::HostKeyMismatch {
            endpoint: "127.0.0.1:2222".into(),
            stored: "SHA256:aaa".into(),
            actual: "SHA256:bbb".into(),
        }
        .into();
        assert_eq!(err.code(), "host_key_mismatch");
        assert!(err.to_string().contains("SHA256:bbb"));
    }

    #[test]
    fn other_ssh_errors_map_to_ssh_error() {
        let err: AppError = SshError::AuthRejected.into();
        assert_eq!(err.code(), "ssh_error");
    }
}

/// End-to-end tests: the real client against the bundled russh test server.
#[cfg(test)]
mod integration {
    use std::future::Future;
    use std::net::SocketAddr;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::Duration;

    use russh::server::Server as _;
    use russh::ChannelMsg;
    use tokio::net::TcpListener;

    use super::config::SshConfig;
    use super::hostkey::{HostKeyVerdict, KnownHosts};
    use super::session;
    use super::test_server::{self, TestServer};
    use super::SshError;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "leonssh-it-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Runs the test server and the given client future concurrently.
    async fn with_server<F, Fut, T>(client: F) -> T
    where
        F: FnOnce(SocketAddr) -> Fut,
        Fut: Future<Output = T>,
    {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let addr = listener.local_addr().unwrap();
        let mut server = TestServer::new();
        let mut server_fut = std::pin::pin!(server.run_on_socket(test_server::config(), &listener));

        tokio::select! {
            out = client(addr) => out,
            _ = &mut server_fut => panic!("test server stopped before the client finished"),
        }
    }

    fn cfg_for(addr: SocketAddr) -> SshConfig {
        SshConfig::new(addr.ip().to_string(), addr.port(), test_server::TEST_USER, test_server::TEST_PASSWORD)
    }

    async fn read_until(
        read: &mut russh::ChannelReadHalf,
        needle: &str,
        timeout: Duration,
    ) -> String {
        let mut acc = String::new();
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            match tokio::time::timeout(remaining, read.wait()).await {
                Err(_) => panic!("timeout waiting for {needle:?}; received: {acc:?}"),
                Ok(None) => panic!("channel closed waiting for {needle:?}; received: {acc:?}"),
                Ok(Some(ChannelMsg::Data { data })) => {
                    acc.push_str(&String::from_utf8_lossy(&data));
                    if acc.contains(needle) {
                        return acc;
                    }
                }
                Ok(Some(_)) => {}
            }
        }
    }

    #[tokio::test]
    async fn connects_authenticates_and_pins_the_host_key() {
        with_server(|addr| async move {
            let dir = temp_dir("pin");
            let known = Arc::new(KnownHosts::load(&dir));
            let cfg = cfg_for(addr);

            let opened = session::open(&cfg, known.clone(), 100, 30).await.unwrap();
            assert_eq!(opened.fingerprint, test_server::HOST_KEY_FINGERPRINT);
            assert_eq!(opened.verdict, HostKeyVerdict::FirstUse);

            // The pin is only written after a successful authentication.
            assert_eq!(
                known.verify(&cfg.endpoint(), test_server::HOST_KEY_FINGERPRINT),
                HostKeyVerdict::Match
            );

            let _ = std::fs::remove_dir_all(&dir);
        })
        .await;
    }

    #[tokio::test]
    async fn rejects_a_changed_host_key() {
        with_server(|addr| async move {
            let dir = temp_dir("mismatch");
            let known = KnownHosts::load(&dir);
            let cfg = cfg_for(addr);
            // Pretend we talked to a different server before.
            known
                .record(&cfg.endpoint(), "SHA256:definitely-not-the-server")
                .unwrap();
            let known = Arc::new(known);

            let err = match session::open(&cfg, known, 80, 24).await {
                Ok(_) => panic!("expected a host key mismatch"),
                Err(err) => err,
            };
            match err {
                SshError::HostKeyMismatch { stored, actual, .. } => {
                    assert_eq!(stored, "SHA256:definitely-not-the-server");
                    assert_eq!(actual, test_server::HOST_KEY_FINGERPRINT);
                }
                other => panic!("expected HostKeyMismatch, got {other:?}"),
            }

            let _ = std::fs::remove_dir_all(&dir);
        })
        .await;
    }

    #[tokio::test]
    async fn rejects_a_wrong_password() {
        with_server(|addr| async move {
            let dir = temp_dir("auth");
            let known = Arc::new(KnownHosts::load(&dir));
            let cfg = SshConfig::new(addr.ip().to_string(), addr.port(), "test", "wrong-password");

            let err = match session::open(&cfg, known, 80, 24).await {
                Ok(_) => panic!("expected authentication to fail"),
                Err(err) => err,
            };
            assert!(matches!(err, SshError::AuthRejected), "{err:?}");

            let _ = std::fs::remove_dir_all(&dir);
        })
        .await;
    }

    #[tokio::test]
    async fn shell_echoes_commands_and_follows_the_pty_size() {
        with_server(|addr| async move {
            let dir = temp_dir("shell");
            let known = Arc::new(KnownHosts::load(&dir));
            let cfg = cfg_for(addr);

            let opened = session::open(&cfg, known, 100, 30).await.unwrap();
            let (mut read, write) = opened.channel.split();

            let banner = read_until(&mut read, "Test SSH Server", Duration::from_secs(5)).await;
            assert!(banner.contains("100×30"), "banner: {banner:?}");

            write.data_bytes(b"size\r".to_vec()).await.unwrap();
            let out = read_until(&mut read, "pty = 100×30", Duration::from_secs(5)).await;
            assert!(out.contains("pty = 100×30"), "output: {out:?}");

            write.window_change(120, 40, 0, 0).await.unwrap();
            let resized = read_until(&mut read, "pty resized to 120×40", Duration::from_secs(5)).await;
            assert!(resized.contains("pty resized to 120×40"), "output: {resized:?}");

            let _ = std::fs::remove_dir_all(&dir);
        })
        .await;
    }
}
