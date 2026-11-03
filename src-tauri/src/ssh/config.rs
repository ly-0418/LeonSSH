//! Connection profile.
//!
//! Phase 3 builds this from a stored session row plus the password fetched from
//! the Windows Credential Manager. The password never lives in the profile for
//! longer than one connect call, and `Debug` redacts it.

use std::fmt;
use std::time::Duration;

/// How to authenticate. Phase 2 only ships password auth; the enum exists so
/// adding `PublicKey` in a later phase does not change any call site.
#[derive(Clone)]
pub enum AuthMethod {
    Password(String),
    /// Private key file on disk; `passphrase` decrypts it (kept in the keyring).
    Key { path: std::path::PathBuf, passphrase: Option<String> },
}

// Hand-written so a stray `{:?}` can never leak the credential into the logs.
impl fmt::Debug for AuthMethod {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Password(_) => f.write_str("Password(<redacted>)"),
            Self::Key { .. } => f.write_str("Key(<redacted>)"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
    pub term: String,
    pub connect_timeout: Duration,
    /// Optional jump host (ProxyJump): the target is reached through it.
    pub jump: Option<Box<SshConfig>>,
}

impl SshConfig {
    /// Builds a profile from a stored session plus its keyring password.
    pub fn from_session(
        record: &crate::storage::sessions::SessionRecord,
        password: Option<String>,
    ) -> Self {
        Self {
            host: record.host.clone(),
            port: record.port.clamp(1, u16::MAX as i64) as u16,
            username: record.username.clone(),
            auth: match (record.auth_method.as_str(), record.private_key_path.as_deref()) {
                ("key", Some(path)) => AuthMethod::Key {
                    path: std::path::PathBuf::from(path),
                    passphrase: password,
                },
                _ => AuthMethod::Password(password.unwrap_or_default()),
            },
            term: "xterm-256color".to_string(),
            jump: None,
            connect_timeout: Duration::from_secs(12),
        }
    }

    /// Explicit profile. Production code goes through [`SshConfig::from_session`];
    /// tests and the docker acceptance suite build profiles directly.
    #[cfg(test)]
    pub fn new(
        host: impl Into<String>,
        port: u16,
        username: impl Into<String>,
        password: impl Into<String>,
    ) -> Self {
        Self {
            host: host.into(),
            port,
            username: username.into(),
            auth: AuthMethod::Password(password.into()),
            term: "xterm-256color".to_string(),
            jump: None,
            connect_timeout: Duration::from_secs(12),
        }
    }

    /// `host:port`, also used as the TOFU key.
    pub fn endpoint(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    pub fn display_target(&self) -> String {
        format!("{}@{}", self.username, self.endpoint())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_and_target_are_readable() {
        let cfg = SshConfig::new("example.com", 22, "root", "secret");
        assert_eq!(cfg.endpoint(), "example.com:22");
        assert_eq!(cfg.display_target(), "root@example.com:22");
    }

    #[test]
    fn debug_never_contains_the_password() {
        let cfg = SshConfig::new("h", 1, "u", "super-secret-password");
        let rendered = format!("{cfg:?}");
        assert!(!rendered.contains("super-secret-password"), "{rendered}");
        assert!(rendered.contains("<redacted>"), "{rendered}");
    }
}
