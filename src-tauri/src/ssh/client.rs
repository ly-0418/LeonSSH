//! russh client: connect, verify the host key, authenticate.

use std::sync::{Arc, Mutex};

use russh::client::{self, Handle};
use russh::keys::PublicKeyOrCertificate;
use russh::Channel;
use tokio::net::TcpStream;

use super::config::{AuthMethod, SshConfig};
use super::hostkey::{fingerprint, HostKeyVerdict, KnownHosts};
use super::SshError;
use crate::forward::RemoteRoutes;

pub type ClientHandle = Handle<ClientHandler>;
/// `russh::client::Handle` is not `Clone`, so sharing one connection between
/// the terminal task, SFTP and port forwarding goes through an `Arc`.
pub type SharedHandle = Arc<ClientHandle>;

/// Verifies the server key against the TOFU store. The verdict is published
/// through a shared slot because `client::connect` consumes the handler and
/// discards it on failure.
pub struct ClientHandler {
    endpoint: String,
    known: Arc<KnownHosts>,
    verdict: Arc<Mutex<Option<HostKeyVerdict>>>,
    actual: Arc<Mutex<String>>,
    /// `-R` routes: incoming forwarded-tcpip channels are bridged to these.
    routes: RemoteRoutes,
}

impl ClientHandler {
    fn new(
        endpoint: String,
        known: Arc<KnownHosts>,
        routes: RemoteRoutes,
    ) -> (Self, Arc<Mutex<Option<HostKeyVerdict>>>, Arc<Mutex<String>>) {
        let verdict = Arc::new(Mutex::new(None));
        let actual = Arc::new(Mutex::new(String::new()));
        (
            Self {
                endpoint,
                known,
                verdict: verdict.clone(),
                actual: actual.clone(),
                routes,
            },
            verdict,
            actual,
        )
    }
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let actual = fingerprint(server_public_key);
        let verdict = self.known.verify(&self.endpoint, &actual);
        let accept = !matches!(verdict, HostKeyVerdict::Mismatch { .. });

        tracing::info!(
            endpoint = %self.endpoint,
            fingerprint = %actual,
            verdict = ?verdict,
            accept,
            "server host key received"
        );

        *self.actual.lock().expect("host key slot poisoned") = actual;
        *self.verdict.lock().expect("host key slot poisoned") = Some(verdict);
        Ok(accept)
    }

    /// `-R`: the server accepted a connection on its forwarding port and hands
    /// us the matching channel.
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<russh::client::Msg>,
        connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: russh::ChannelOpenHandleInner<russh::client::Msg>,
        _session: &mut russh::client::Session,
    ) -> Result<(), Self::Error> {
        let target = {
            let routes = self.routes.lock().await;
            routes
                .get(&(connected_address.to_string(), connected_port as u16))
                .cloned()
        };

        let Some((host, port)) = target else {
            tracing::warn!(%connected_address, connected_port, "no route for forwarded channel");
            drop(reply);
            return Ok(());
        };

        reply.accept().await;
        tracing::debug!(%host, port, "remote forward accepted");

        tokio::spawn(async move {
            match TcpStream::connect((host.as_str(), port)).await {
                Ok(mut tcp) => {
                    let mut stream = channel.into_stream();
                    let _ = tokio::io::copy_bidirectional(&mut tcp, &mut stream).await;
                }
                Err(err) => {
                    tracing::warn!(%err, "remote forward target unreachable");
                    let _ = channel.close().await;
                }
            }
        });
        Ok(())
    }
}

pub struct Connection {
    pub handle: SharedHandle,
    pub fingerprint: String,
    pub verdict: HostKeyVerdict,
}

/// Connects and authenticates. Host-key pinning happens *after* a successful
/// authentication, which is the TOFU semantic we want: only a server we really
/// talked to gets remembered.
pub async fn connect(
    cfg: &SshConfig,
    known: Arc<KnownHosts>,
    routes: RemoteRoutes,
) -> Result<Connection, SshError> {
    let client_config = Arc::new(client::Config {
        inactivity_timeout: None,
        ..Default::default()
    });

    let (handler, verdict_slot, actual_slot) =
        ClientHandler::new(cfg.endpoint(), known.clone(), routes);

    let attempt = tokio::time::timeout(
        cfg.connect_timeout,
        client::connect(client_config, (cfg.host.as_str(), cfg.port), handler),
    )
    .await;

    let mut handle = match attempt {
        Err(_) => return Err(SshError::Timeout(cfg.connect_timeout.as_secs())),
        Ok(Err(err)) => {
            let verdict = verdict_slot.lock().expect("host key slot poisoned").clone();
            let actual = actual_slot.lock().expect("host key slot poisoned").clone();
            return Err(match verdict {
                Some(HostKeyVerdict::Mismatch { stored }) => SshError::HostKeyMismatch {
                    endpoint: cfg.endpoint(),
                    stored,
                    actual,
                },
                _ => SshError::Connect {
                    endpoint: cfg.endpoint(),
                    reason: err.to_string(),
                },
            });
        }
        Ok(Ok(handle)) => handle,
    };

    let verdict = verdict_slot
        .lock()
        .expect("host key slot poisoned")
        .clone()
        .unwrap_or(HostKeyVerdict::FirstUse);
    let actual = actual_slot.lock().expect("host key slot poisoned").clone();

    match &cfg.auth {
        AuthMethod::Key { path, passphrase } => {
            let key = russh::keys::load_secret_key(path, passphrase.as_deref()).map_err(|err| {
                SshError::Handshake(format!("读取私钥 {} 失败: {err}", path.display()))
            })?;
            let key = russh::keys::PrivateKeyWithHashAlg::new(std::sync::Arc::new(key), None);
            let result = handle
                .authenticate_publickey(cfg.username.clone(), key)
                .await
                .map_err(|err| SshError::Handshake(err.to_string()))?;
            if !result.success() {
                return Err(SshError::AuthRejected);
            }
        }
        AuthMethod::Password(password) => {
            let result = handle
                .authenticate_password(cfg.username.clone(), password.clone())
                .await
                .map_err(|err| SshError::Handshake(err.to_string()))?;
            if !result.success() {
                return Err(SshError::AuthRejected);
            }
        }
    }

    if verdict == HostKeyVerdict::FirstUse {
        if let Err(err) = known.record(&cfg.endpoint(), &actual).await {
            tracing::warn!(%err, "failed to persist the host key pin");
        }
    }

    tracing::info!(target = %cfg.display_target(), "SSH authentication succeeded");

    Ok(Connection {
        handle: Arc::new(handle),
        fingerprint: actual,
        verdict,
    })
}
