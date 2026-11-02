//! Password storage boundary.
//!
//! **Only the Windows Credential Manager (via DPAPI) ever holds a secret.**
//! SQLite stores nothing but a *reference* (`session:<id>`), and the passphrase
//! is never logged, formatted or serialized on the way through.

use crate::error::AppError;

const SERVICE: &str = "com.leonssh.app";

/// The reference stored in `sessions.keyring_ref`.
pub fn reference_for(session_id: i64) -> String {
    format!("session:{session_id}")
}

fn entry(reference: &str) -> Result<keyring::Entry, AppError> {
    keyring::Entry::new(SERVICE, reference)
        .map_err(|err| AppError::Secret(format!("无法访问 Windows 凭据管理器: {err}")))
}

pub fn store(reference: &str, password: &str) -> Result<(), AppError> {
    entry(reference)?
        .set_password(password)
        .map_err(|err| AppError::Secret(format!("写入凭据失败: {err}")))
}

/// `Ok(None)` means "no password saved for this session".
pub fn load(reference: &str) -> Result<Option<String>, AppError> {
    match entry(reference)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(AppError::Secret(format!("读取凭据失败: {err}"))),
    }
}

pub fn delete(reference: &str) -> Result<(), AppError> {
    match entry(reference)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(AppError::Secret(format!("删除凭据失败: {err}"))),
    }
}

pub fn exists(reference: &str) -> bool {
    matches!(load(reference), Ok(Some(_)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_is_stable_and_readable() {
        assert_eq!(reference_for(7), "session:7");
    }

    // The round-trip test below writes to the app's own Credential Manager
    // namespace ("com.leonssh.app") and removes the entry afterwards.
    #[test]
    fn missing_credential_is_not_an_error() {
        assert!(matches!(load("session:definitely-missing"), Ok(None)));
    }

    #[test]
    fn password_roundtrip_through_the_credential_manager() {
        let reference = "test:roundtrip";
        let _ = delete(reference);

        store(reference, "s3cr3t-不要泄露").expect("store");
        assert_eq!(load(reference).unwrap().as_deref(), Some("s3cr3t-不要泄露"));
        assert!(exists(reference));

        delete(reference).expect("delete");
        assert!(matches!(load(reference), Ok(None)));
        assert!(!exists(reference));
    }
}
