//! Connection profile.
//!
//! Phase 2 deliberately uses a *fixed* profile so the transport can be proven
//! before any UI exists. Every field can be overridden with an environment
//! variable, which is enough for manual acceptance and for integration tests:
//!
//! ```text
//! LEONSSH_SSH_HOST=127.0.0.1
//! LEONSSH_SSH_PORT=2222
//! LEONSSH_SSH_USER=test
//! LEONSSH_SSH_PASSWORD=test
//! ```

use std::env;
use std::fmt;
use std::time::Duration;

/// How to authenticate. Phase 2 only ships password auth; the enum exists so
/// adding `PublicKey` in a later phase does not change any call site.
#[derive(Clone)]
pub enum AuthMethod {
    Password(String),
}

// Hand-written so a stray `{:?}` can never leak the credential into the logs.
impl fmt::Debug for AuthMethod {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Password(_) => f.write_str("Password(<redacted>)"),
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
}

impl SshConfig {
    pub const DEFAULT_HOST: &'static str = "127.0.0.1";
    pub const DEFAULT_PORT: u16 = 2222;
    pub const DEFAULT_USER: &'static str = "test";
    pub const DEFAULT_PASSWORD: &'static str = "test";

    /// The fixed phase-2 profile.
    pub fn fixed() -> Self {
        let host = env::var("LEONSSH_SSH_HOST").unwrap_or_else(|_| Self::DEFAULT_HOST.to_string());
        let port = env::var("LEONSSH_SSH_PORT")
            .ok()
            .and_then(|raw| raw.parse().ok())
            .unwrap_or(Self::DEFAULT_PORT);
        let username =
            env::var("LEONSSH_SSH_USER").unwrap_or_else(|_| Self::DEFAULT_USER.to_string());
        let password = env::var("LEONSSH_SSH_PASSWORD")
            .unwrap_or_else(|_| Self::DEFAULT_PASSWORD.to_string());
        Self::new(host, port, username, password)
    }

    /// Explicit profile, used by tests.
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
