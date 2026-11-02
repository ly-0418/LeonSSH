//! SSH transport (russh).
//!
//! Password authentication, PTY negotiation, interactive shell, and TOFU host
//! key pinning backed by the SQLite `known_hosts` table. Credentials live in the
//! Windows Credential Manager (see `crate::secure`).

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

    async fn test_known_hosts() -> KnownHosts {
        KnownHosts::load(crate::storage::test_db::open().await)
            .await
            .unwrap()
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
            let known = Arc::new(test_known_hosts().await);
            let cfg = cfg_for(addr);

            let opened = session::open(&cfg, known.clone(), 100, 30, Default::default()).await.unwrap();
            assert_eq!(opened.fingerprint, test_server::HOST_KEY_FINGERPRINT);
            assert_eq!(opened.verdict, HostKeyVerdict::FirstUse);

            // The pin is only written after a successful authentication.
            assert_eq!(
                known.verify(&cfg.endpoint(), test_server::HOST_KEY_FINGERPRINT),
                HostKeyVerdict::Match
            );

        })
        .await;
    }

    #[tokio::test]
    async fn rejects_a_changed_host_key() {
        with_server(|addr| async move {
            let known = test_known_hosts().await;
            let cfg = cfg_for(addr);
            // Pretend we talked to a different server before.
            known
                .record(&cfg.endpoint(), "SHA256:definitely-not-the-server")
                .await
                .unwrap();
            let known = Arc::new(known);

            let err = match session::open(&cfg, known, 80, 24, Default::default()).await {
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

        })
        .await;
    }

    #[tokio::test]
    async fn rejects_a_wrong_password() {
        with_server(|addr| async move {
            let known = Arc::new(test_known_hosts().await);
            let cfg = SshConfig::new(addr.ip().to_string(), addr.port(), "test", "wrong-password");

            let err = match session::open(&cfg, known, 80, 24, Default::default()).await {
                Ok(_) => panic!("expected authentication to fail"),
                Err(err) => err,
            };
            assert!(matches!(err, SshError::AuthRejected), "{err:?}");

        })
        .await;
    }

    #[tokio::test]
    async fn shell_echoes_commands_and_follows_the_pty_size() {
        with_server(|addr| async move {
            let known = Arc::new(test_known_hosts().await);
            let cfg = cfg_for(addr);

            let opened = session::open(&cfg, known, 100, 30, Default::default()).await.unwrap();
            let (mut read, write) = opened.channel.split();

            let banner = read_until(&mut read, "Test SSH Server", Duration::from_secs(5)).await;
            assert!(banner.contains("100×30"), "banner: {banner:?}");

            write.data_bytes(b"size\r".to_vec()).await.unwrap();
            let out = read_until(&mut read, "pty = 100×30", Duration::from_secs(5)).await;
            assert!(out.contains("pty = 100×30"), "output: {out:?}");

            write.window_change(120, 40, 0, 0).await.unwrap();
            let resized = read_until(&mut read, "pty resized to 120×40", Duration::from_secs(5)).await;
            assert!(resized.contains("pty resized to 120×40"), "output: {resized:?}");
        })
        .await;
    }
}

/// Acceptance against a **real** Linux sshd (the docker container described in
/// `docker/sshd/Dockerfile`). Ignored by default so the normal test run does not
/// require Docker:
///
/// ```text
/// docker run -d --name leonssh-sshd -p 2222:22 leonssh-sshd:test
/// cargo test -- --ignored docker_sshd
/// ```
#[cfg(test)]
mod docker_sshd {
    use std::sync::Arc;
    use std::time::Duration;

    use russh::ChannelMsg;

    use super::config::SshConfig;
    use super::hostkey::{HostKeyVerdict, KnownHosts};
    use super::session;

    /// Accumulates channel output for `window` (TUI programs never print a
    /// terminator).
    async fn collect_for(read: &mut russh::ChannelReadHalf, window: Duration) -> String {
        let mut acc = String::new();
        let deadline = tokio::time::Instant::now() + window;
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                return acc;
            }
            match tokio::time::timeout(remaining, read.wait()).await {
                Err(_) => return acc,
                Ok(None) => return acc,
                Ok(Some(ChannelMsg::Data { data })) => {
                    acc.push_str(&String::from_utf8_lossy(&data));
                }
                Ok(Some(_)) => {}
            }
        }
    }

    async fn run_cmd(
        read: &mut russh::ChannelReadHalf,
        write: &russh::ChannelWriteHalf<russh::client::Msg>,
        command: &str,
    ) -> String {
        // `__DON''E__` expands to `__DONE__` in the shell but the echoed command
        // line never contains the plain marker.
        let line = format!("{command}; echo __DON''E__\r");
        write.data_bytes(line.into_bytes()).await.unwrap();
        collect_for(read, Duration::from_secs(8)).await
    }

    #[tokio::test]
    #[ignore = "requires: docker run -d -p 2222:22 leonssh-sshd:test"]
    async fn real_sshd_supports_colors_tui_and_pty_resize() {
        let known = Arc::new(
            KnownHosts::load(crate::storage::test_db::open().await)
                .await
                .unwrap(),
        );
        let cfg = SshConfig::new("127.0.0.1", 2222, "test", "test");

        let opened = session::open(&cfg, known.clone(), 120, 40, Default::default()).await.unwrap();
        assert_eq!(opened.verdict, HostKeyVerdict::FirstUse);
        assert!(
            opened.fingerprint.starts_with("SHA256:"),
            "{}",
            opened.fingerprint
        );
        assert_eq!(
            known.verify(&cfg.endpoint(), &opened.fingerprint),
            HostKeyVerdict::Match,
            "TOFU pin must be persisted after a successful login"
        );

        let (mut read, write) = opened.channel.split();
        let _ = collect_for(&mut read, Duration::from_millis(800)).await;

        // 1. Pty size negotiated at open time.
        let out = run_cmd(&mut read, &write, "stty size").await;
        assert!(out.contains("40 120"), "stty size output: {out:?}");

        // 2. Colour output really is ANSI escaped.
        let out = run_cmd(&mut read, &write, "ls --color=always /etc | head -5").await;
        assert!(out.contains('\u{1b}'), "expected ANSI escapes, got: {out:?}");

        // 3. Resize is propagated to the remote pty.
        write.window_change(100, 30, 0, 0).await.unwrap();
        tokio::time::sleep(Duration::from_millis(400)).await;
        let out = run_cmd(&mut read, &write, "stty size").await;
        assert!(out.contains("30 100"), "after resize: {out:?}");
        write.window_change(120, 40, 0, 0).await.unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;

        // 4. htop: alternate screen + TUI drawing.
        write.data_bytes(b"htop\r".to_vec()).await.unwrap();
        let out = collect_for(&mut read, Duration::from_millis(2500)).await;
        assert!(
            out.contains("\u{1b}[?1049h"),
            "htop should use the alternate screen: {out:?}"
        );
        assert!(out.contains("CPU") || out.contains("Mem"), "htop UI: {out:?}");
        write.data_bytes(b"q".to_vec()).await.unwrap();
        let _ = collect_for(&mut read, Duration::from_millis(800)).await;

        // 5. vim: alternate screen + tildes on empty lines.
        write
            .data_bytes(b"vim /tmp/leon-accept.txt\r".to_vec())
            .await
            .unwrap();
        let out = collect_for(&mut read, Duration::from_millis(2500)).await;
        assert!(
            out.contains("\u{1b}[?1049h"),
            "vim should use the alternate screen: {out:?}"
        );
        assert!(out.contains('~'), "vim empty-buffer tildes: {out:?}");
        write.data_bytes(b":q!\r".to_vec()).await.unwrap();
        let _ = collect_for(&mut read, Duration::from_millis(800)).await;

        // 6. tmux: creates a detached session and lists it.
        write
            .data_bytes(b"tmux new-session -d -s demo\r".to_vec())
            .await
            .unwrap();
        let out = run_cmd(&mut read, &write, "tmux ls").await;
        assert!(out.contains("demo"), "tmux ls output: {out:?}");
        let _ = run_cmd(&mut read, &write, "tmux kill-server").await;

        // 7. Clean exit.
        write.data_bytes(b"exit\r".to_vec()).await.unwrap();
        let _ = collect_for(&mut read, Duration::from_millis(800)).await;

        let pins = known.list().await.unwrap();
        assert_eq!(pins.len(), 1);
        assert_eq!(pins[0].endpoint, "127.0.0.1:2222");
    }
}
