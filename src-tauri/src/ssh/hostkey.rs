//! Trust-on-first-use host key pinning.
//!
//! Phase 2 keeps the pins in `<data_dir>/known_hosts.json`; phase 3 migrates
//! the same data into the SQLite `known_hosts` table. The *policy* lives here
//! and does not change: a pin is recorded on first successful connection, and
//! a later mismatch refuses the connection.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use russh::keys::{HashAlg, PublicKeyOrCertificate};

const FILE_NAME: &str = "known_hosts.json";

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

pub struct KnownHosts {
    path: PathBuf,
    entries: Mutex<BTreeMap<String, String>>,
}

impl KnownHosts {
    pub fn load(data_dir: &Path) -> Self {
        let path = data_dir.join(FILE_NAME);
        let entries = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<BTreeMap<String, String>>(&raw).ok())
            .unwrap_or_default();
        Self {
            path,
            entries: Mutex::new(entries),
        }
    }

    pub fn verify(&self, endpoint: &str, actual: &str) -> HostKeyVerdict {
        let entries = self.entries.lock().expect("known_hosts poisoned");
        match entries.get(endpoint) {
            None => HostKeyVerdict::FirstUse,
            Some(stored) if stored == actual => HostKeyVerdict::Match,
            Some(stored) => HostKeyVerdict::Mismatch {
                stored: stored.clone(),
            },
        }
    }

    /// Persists a newly pinned fingerprint (first successful connection).
    pub fn record(&self, endpoint: &str, actual: &str) -> io::Result<()> {
        {
            let mut entries = self.entries.lock().expect("known_hosts poisoned");
            if entries.get(endpoint).map(String::as_str) == Some(actual) {
                return Ok(());
            }
            entries.insert(endpoint.to_string(), actual.to_string());
        }
        self.persist()
    }

    /// Removes a pin — used when the user explicitly accepts a new key.
    /// Phase 2 only exercises this from tests; phase 3 wires it to the UI.
    #[cfg(test)]
    pub fn forget(&self, endpoint: &str) -> io::Result<()> {
        {
            let mut entries = self.entries.lock().expect("known_hosts poisoned");
            if entries.remove(endpoint).is_none() {
                return Ok(());
            }
        }
        self.persist()
    }

    fn persist(&self) -> io::Result<()> {
        let snapshot = {
            let entries = self.entries.lock().expect("known_hosts poisoned");
            entries.clone()
        };
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(&snapshot)
            .map_err(|err| io::Error::new(io::ErrorKind::Other, err))?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json)?;
        match fs::rename(&tmp, &self.path) {
            Ok(()) => Ok(()),
            Err(_) => {
                // Windows fails to rename onto an existing file in some cases.
                let _ = fs::remove_file(&self.path);
                fs::rename(&tmp, &self.path)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "leonssh-kh-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn first_use_then_match_then_mismatch() {
        let dir = temp_dir("basic");
        let store = KnownHosts::load(&dir);
        assert_eq!(store.verify("h:22", "SHA256:aaa"), HostKeyVerdict::FirstUse);

        store.record("h:22", "SHA256:aaa").unwrap();
        assert_eq!(store.verify("h:22", "SHA256:aaa"), HostKeyVerdict::Match);
        assert_eq!(
            store.verify("h:22", "SHA256:bbb"),
            HostKeyVerdict::Mismatch {
                stored: "SHA256:aaa".into()
            }
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pin_survives_a_reload() {
        let dir = temp_dir("reload");
        {
            let store = KnownHosts::load(&dir);
            store.record("h:22", "SHA256:ccc").unwrap();
        }
        let reloaded = KnownHosts::load(&dir);
        assert_eq!(reloaded.verify("h:22", "SHA256:ccc"), HostKeyVerdict::Match);
        assert!(dir.join("known_hosts.json").is_file());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn forget_removes_the_pin() {
        let dir = temp_dir("forget");
        let store = KnownHosts::load(&dir);
        store.record("h:22", "SHA256:ddd").unwrap();
        store.forget("h:22").unwrap();
        assert_eq!(store.verify("h:22", "SHA256:ddd"), HostKeyVerdict::FirstUse);
        let _ = fs::remove_dir_all(&dir);
    }
}
