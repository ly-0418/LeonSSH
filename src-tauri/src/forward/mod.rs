//! Port forwarding over the existing SSH connection.
//!
//! * `local`   (-L): listen locally, each connection opens a `direct-tcpip` channel
//! * `dynamic` (-D): SOCKS5 listener that opens `direct-tcpip` channels
//! * `remote`  (-R): `tcpip_forward` on the server; incoming `forwarded-tcpip`
//!   channels are bridged to a local target by [`ClientHandler`]

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use russh::client::Msg;
use russh::Channel;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{watch, Mutex};
use tokio::task::JoinHandle;

use crate::error::AppError;
use crate::ssh::client::SharedHandle;

/// `(bind_host, bind_port) -> (target_host, target_port)` for `-R` rules.
pub type RemoteRoutes = Arc<Mutex<HashMap<(String, u16), (String, u16)>>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ForwardKind {
    Local,
    Remote,
    Dynamic,
}

impl ForwardKind {
    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "local" => Ok(Self::Local),
            "remote" => Ok(Self::Remote),
            "dynamic" => Ok(Self::Dynamic),
            other => Err(AppError::InvalidArgument(format!("未知转发类型: {other}"))),
        }
    }
}

struct RunningForward {
    kind: ForwardKind,
    terminal_id: String,
    bind_host: String,
    bind_port: u16,
    handle: SharedHandle,
    stop: watch::Sender<bool>,
    join: JoinHandle<()>,
}

#[derive(Clone, Default)]
pub struct ForwardManager {
    running: Arc<Mutex<HashMap<i64, RunningForward>>>,
    remote_routes: RemoteRoutes,
}

impl ForwardManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn remote_routes(&self) -> RemoteRoutes {
        self.remote_routes.clone()
    }

    pub async fn running_ids(&self) -> Vec<i64> {
        self.running.lock().await.keys().copied().collect()
    }

    pub async fn start_local(
        &self,
        rule_id: i64,
        terminal_id: String,
        handle: SharedHandle,
        bind: (String, u16),
        target: (String, u16),
    ) -> Result<(), AppError> {
        let listener = TcpListener::bind((bind.0.as_str(), bind.1))
            .await
            .map_err(|err| AppError::Forward(format!("本地监听 {}:{} 失败: {err}", bind.0, bind.1)))?;
        let (stop_tx, mut stop_rx) = watch::channel(false);
        let accept_handle = handle.clone();

        let join = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = stop_rx.changed() => break,
                    accepted = listener.accept() => {
                        match accepted {
                            Ok((stream, peer)) => {
                                let handle = accept_handle.clone();
                                let target = target.clone();
                                tokio::spawn(async move {
                                    if let Err(err) = bridge_direct(handle, stream, target, peer).await {
                                        tracing::warn!(%err, "local forward connection failed");
                                    }
                                });
                            }
                            Err(err) => {
                                tracing::warn!(%err, "local forward accept failed");
                                break;
                            }
                        }
                    }
                }
            }
            tracing::debug!("local forward listener stopped");
        });

        self.running.lock().await.insert(
            rule_id,
            RunningForward {
                kind: ForwardKind::Local,
                terminal_id,
                bind_host: bind.0,
                bind_port: bind.1,
                handle,
                stop: stop_tx,
                join,
            },
        );
        Ok(())
    }

    pub async fn start_dynamic(
        &self,
        rule_id: i64,
        terminal_id: String,
        handle: SharedHandle,
        bind: (String, u16),
    ) -> Result<(), AppError> {
        let listener = TcpListener::bind((bind.0.as_str(), bind.1))
            .await
            .map_err(|err| AppError::Forward(format!("SOCKS5 监听 {}:{} 失败: {err}", bind.0, bind.1)))?;
        let (stop_tx, mut stop_rx) = watch::channel(false);
        let accept_handle = handle.clone();

        let join = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = stop_rx.changed() => break,
                    accepted = listener.accept() => {
                        match accepted {
                            Ok((stream, _peer)) => {
                                let handle = accept_handle.clone();
                                tokio::spawn(async move {
                                    if let Err(err) = handle_socks5(handle, stream).await {
                                        tracing::warn!(%err, "socks5 connection failed");
                                    }
                                });
                            }
                            Err(err) => {
                                tracing::warn!(%err, "socks5 accept failed");
                                break;
                            }
                        }
                    }
                }
            }
            tracing::debug!("socks5 listener stopped");
        });

        self.running.lock().await.insert(
            rule_id,
            RunningForward {
                kind: ForwardKind::Dynamic,
                terminal_id,
                bind_host: bind.0,
                bind_port: bind.1,
                handle,
                stop: stop_tx,
                join,
            },
        );
        Ok(())
    }

    pub async fn start_remote(
        &self,
        rule_id: i64,
        terminal_id: String,
        handle: SharedHandle,
        bind: (String, u16),
        target: (String, u16),
    ) -> Result<(), AppError> {
        let assigned = handle
            .tcpip_forward(bind.0.clone(), bind.1 as u32)
            .await
            .map_err(|err| AppError::Forward(format!("远端监听失败: {err}")))?;

        self.remote_routes
            .lock()
            .await
            .insert((bind.0.clone(), assigned as u16), target);

        // No local task to run: incoming channels arrive at the client handler.
        let (stop_tx, _stop_rx) = watch::channel(false);
        let join = tokio::spawn(async {});

        self.running.lock().await.insert(
            rule_id,
            RunningForward {
                kind: ForwardKind::Remote,
                terminal_id,
                bind_host: bind.0,
                bind_port: assigned as u16,
                handle,
                stop: stop_tx,
                join,
            },
        );
        Ok(())
    }

    pub async fn stop(&self, rule_id: i64) {
        let entry = self.running.lock().await.remove(&rule_id);
        let Some(entry) = entry else {
            return;
        };
        let _ = entry.stop.send(true);
        if entry.kind == ForwardKind::Remote {
            let _ = entry
                .handle
                .cancel_tcpip_forward(entry.bind_host.clone(), entry.bind_port as u32)
                .await;
            self.remote_routes
                .lock()
                .await
                .remove(&(entry.bind_host.clone(), entry.bind_port));
        }
        let _ = tokio::time::timeout(Duration::from_secs(2), entry.join).await;
    }

    pub async fn stop_all_for_terminal(&self, terminal_id: &str) {
        let ids: Vec<i64> = {
            let running = self.running.lock().await;
            running
                .iter()
                .filter(|(_, forward)| forward.terminal_id == terminal_id)
                .map(|(id, _)| *id)
                .collect()
        };
        for id in ids {
            self.stop(id).await;
        }
    }

    pub async fn stop_all(&self) {
        let ids = self.running_ids().await;
        for id in ids {
            self.stop(id).await;
        }
    }
}

async fn bridge_direct(
    handle: SharedHandle,
    mut tcp: TcpStream,
    target: (String, u16),
    peer: std::net::SocketAddr,
) -> Result<(), AppError> {
    let channel: Channel<Msg> = handle
        .channel_open_direct_tcpip(
            target.0.clone(),
            target.1 as u32,
            peer.ip().to_string(),
            peer.port() as u32,
        )
        .await
        .map_err(|err| AppError::Forward(format!("打开 direct-tcpip 失败: {err}")))?;

    let mut stream = channel.into_stream();
    tokio::io::copy_bidirectional(&mut tcp, &mut stream)
        .await
        .map_err(|err| AppError::Forward(format!("转发数据失败: {err}")))?;
    Ok(())
}

async fn handle_socks5(handle: SharedHandle, mut tcp: TcpStream) -> Result<(), AppError> {
    // Greeting: VER, NMETHODS, METHODS...
    let mut head = [0u8; 2];
    tcp.read_exact(&mut head).await.map_err(socks_err)?;
    if head[0] != 5 {
        return Err(AppError::Forward("不是 SOCKS5 请求".into()));
    }
    let mut methods = vec![0u8; head[1] as usize];
    tcp.read_exact(&mut methods).await.map_err(socks_err)?;
    // No authentication.
    tcp.write_all(&[5, 0]).await.map_err(socks_err)?;

    // Request: VER, CMD, RSV, ATYP, ADDR, PORT
    let mut request = [0u8; 4];
    tcp.read_exact(&mut request).await.map_err(socks_err)?;
    if request[0] != 5 || request[1] != 1 {
        let _ = tcp.write_all(&[5, 7, 0, 1, 0, 0, 0, 0, 0, 0]).await;
        return Err(AppError::Forward("仅支持 SOCKS5 CONNECT".into()));
    }

    let host = match request[3] {
        1 => {
            let mut addr = [0u8; 4];
            tcp.read_exact(&mut addr).await.map_err(socks_err)?;
            std::net::Ipv4Addr::from(addr).to_string()
        }
        3 => {
            let mut len = [0u8; 1];
            tcp.read_exact(&mut len).await.map_err(socks_err)?;
            let mut name = vec![0u8; len[0] as usize];
            tcp.read_exact(&mut name).await.map_err(socks_err)?;
            String::from_utf8_lossy(&name).to_string()
        }
        4 => {
            let mut addr = [0u8; 16];
            tcp.read_exact(&mut addr).await.map_err(socks_err)?;
            std::net::Ipv6Addr::from(addr).to_string()
        }
        _ => {
            let _ = tcp.write_all(&[5, 8, 0, 1, 0, 0, 0, 0, 0, 0]).await;
            return Err(AppError::Forward("不支持的地址类型".into()));
        }
    };

    let mut port_bytes = [0u8; 2];
    tcp.read_exact(&mut port_bytes).await.map_err(socks_err)?;
    let port = u16::from_be_bytes(port_bytes);

    match handle
        .channel_open_direct_tcpip(host.clone(), port as u32, "127.0.0.1", 0)
        .await
    {
        Ok(channel) => {
            tcp.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0])
                .await
                .map_err(socks_err)?;
            let mut stream = channel.into_stream();
            tokio::io::copy_bidirectional(&mut tcp, &mut stream)
                .await
                .map_err(socks_err)?;
            Ok(())
        }
        Err(err) => {
            let _ = tcp.write_all(&[5, 5, 0, 1, 0, 0, 0, 0, 0, 0]).await;
            Err(AppError::Forward(format!(
                "连接 {host}:{port} 失败: {err}"
            )))
        }
    }
}

fn socks_err(err: std::io::Error) -> AppError {
    AppError::Forward(format!("SOCKS5 读写失败: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::timeout;

    async fn free_port() -> u16 {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        listener.local_addr().unwrap().port()
    }

    /// `-L` and `-D` against the docker sshd: both must reach the container's
    /// SSH banner through the existing connection.
    #[tokio::test]
    #[ignore = "requires: docker run -d -p 2222:22 leonssh-sshd:test"]
    async fn real_ssh_local_and_socks_forwarding() {
        use crate::ssh::config::SshConfig;
        use crate::ssh::hostkey::KnownHosts;
        use crate::ssh::session;

        let pool = crate::storage::test_db::open().await;
        let known = Arc::new(KnownHosts::load(pool).await.unwrap());
        let cfg = SshConfig::new("127.0.0.1", 2222, "test", "test");
        let opened = session::open(&cfg, known, 120, 40, Default::default())
            .await
            .unwrap();

        let manager = ForwardManager::new();
        let handle = opened.handle.clone();

        // -L 127.0.0.1:<port> -> 127.0.0.1:22 (inside the container)
        let local_port = free_port().await;
        manager
            .start_local(
                1,
                "t1".into(),
                handle.clone(),
                ("127.0.0.1".into(), local_port),
                ("127.0.0.1".into(), 22),
            )
            .await
            .unwrap();

        let mut tcp = TcpStream::connect(("127.0.0.1", local_port))
            .await
            .expect("local forward should accept");
        let mut buffer = [0u8; 64];
        let read = timeout(Duration::from_secs(5), tcp.read(&mut buffer))
            .await
            .unwrap()
            .unwrap();
        let banner = String::from_utf8_lossy(&buffer[..read]).to_string();
        assert!(banner.starts_with("SSH-2.0-"), "banner: {banner:?}");

        manager.stop(1).await;
        assert!(manager.running_ids().await.is_empty());

        // -D SOCKS5
        let socks_port = free_port().await;
        manager
            .start_dynamic(2, "t1".into(), handle, ("127.0.0.1".into(), socks_port))
            .await
            .unwrap();

        let mut socks = TcpStream::connect(("127.0.0.1", socks_port)).await.unwrap();
        socks.write_all(&[5, 1, 0]).await.unwrap();
        let mut greeting = [0u8; 2];
        socks.read_exact(&mut greeting).await.unwrap();
        assert_eq!(greeting, [5, 0], "SOCKS5 no-auth greeting");

        // CONNECT 127.0.0.1:22
        socks
            .write_all(&[5, 1, 0, 1, 127, 0, 0, 1, 0, 22])
            .await
            .unwrap();
        let mut reply = [0u8; 10];
        socks.read_exact(&mut reply).await.unwrap();
        assert_eq!(reply[0], 5);
        assert_eq!(reply[1], 0, "SOCKS5 connect should succeed");

        let read = timeout(Duration::from_secs(5), socks.read(&mut buffer))
            .await
            .unwrap()
            .unwrap();
        let banner = String::from_utf8_lossy(&buffer[..read]).to_string();
        assert!(banner.starts_with("SSH-2.0-"), "banner via socks: {banner:?}");

        manager.stop(2).await;
        assert!(manager.running_ids().await.is_empty());
    }
}
