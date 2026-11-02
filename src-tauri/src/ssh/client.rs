//! russh client: connect, verify the host key, authenticate.

use std::sync::{Arc, Mutex};

use russh::client::{self, Handle};
use russh::keys::PublicKeyOrCertificate;

use super::config::{AuthMethod, SshConfig};
use super::hostkey::{fingerprint, HostKeyVerdict, KnownHosts};
use super::SshError;

pub type ClientHandle = Handle<ClientHandler>;

/// Verifies the server key against the TOFU store. The verdict is published
/// through a shared slot because `client::connect` consumes the handler and
/// discards it on failure.
pub struct ClientHandler {
    endpoint: String,
    known: Arc<KnownHosts>,
    verdict: Arc<Mutex<Option<HostKeyVerdict>>>,
    actual: Arc<Mutex<String>>,
}

impl ClientHandler {
    fn new(
        endpoint: String,
        known: Arc<KnownHosts>,
    ) -> (Self, Arc<Mutex<Option<HostKeyVerdict>>>, Arc<Mutex<String>>) {
        let verdict = Arc::new(Mutex::new(None));
        let actual = Arc::new(Mutex::new(String::new()));
        (
            Self {
                endpoint,
                known,
                verdict: verdict.clone(),
                actual: actual.clone(),
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
}

pub struct Connection {
    pub handle: ClientHandle,
    pub fingerprint: String,
    pub verdict: HostKeyVerdict,
}

/// Connects and authenticates. Host-key pinning happens *after* a successful
/// authentication, which is the TOFU semantic we want: only a server we really
/// talked to gets remembered.
pub async fn connect(cfg: &SshConfig, known: Arc<KnownHosts>) -> Result<Connection, SshError> {
    let client_config = Arc::new(client::Config {
        inactivity_timeout: None,
        ..Default::default()
    });

    let (handler, verdict_slot, actual_slot) = ClientHandler::new(cfg.endpoint(), known.clone());

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

    if verdict == HostKeyVerdict::FirstUse
        && let Err(err) = known.record(&cfg.endpoint(), &actual)
    {
        tracing::warn!(%err, "failed to persist the host key pin");
    }

    tracing::info!(target = %cfg.display_target(), "SSH authentication succeeded");

    Ok(Connection {
        handle,
        fingerprint: actual,
        verdict,
    })
}
