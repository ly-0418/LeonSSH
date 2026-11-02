//! Remote online editing: download to an app-managed temp file, edit there,
//! stream the result back over the same SFTP session.
//!
//! The temp workspace lives under `<install>/data/edit/<editId>/` and is wiped
//! on app exit. Nothing is ever written to the user's desktop or project dirs.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use russh_sftp::client::SftpSession;
use serde::Serialize;

use crate::error::AppError;
use crate::sftp::path as remote_path;
use crate::transfer::download;
use crate::transfer::upload;

/// Editors are for text files: refuse anything bigger than this.
const MAX_EDIT_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFile {
    pub edit_id: String,
    pub remote_path: String,
    pub temp_path: String,
    pub name: String,
    pub size: u64,
    pub modified: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSaved {
    pub remote_path: String,
    pub size: u64,
    pub modified: Option<i64>,
    /// Verification result against the pre-save metadata.
    pub consistent: bool,
    pub warning: Option<String>,
}

struct EditSession {
    file: EditorFile,
    terminal_id: String,
}

pub struct EditorManager {
    root: PathBuf,
    sessions: Mutex<HashMap<String, EditSession>>,
    counter: AtomicU64,
}

impl EditorManager {
    pub fn new(root: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&root);
        Self {
            root,
            sessions: Mutex::new(HashMap::new()),
            counter: AtomicU64::new(0),
        }
    }

    /// Removes every temp directory (called on window close).
    pub fn cleanup_all(&self) {
        let sessions = {
            let mut sessions = self.sessions.lock().expect("editor sessions poisoned");
            sessions.drain().map(|(_, session)| session).collect::<Vec<_>>()
        };
        for session in sessions {
            if let Some(parent) = Path::new(&session.file.temp_path).parent() {
                let _ = std::fs::remove_dir_all(parent);
            }
        }
        if let Ok(entries) = std::fs::read_dir(&self.root) {
            for entry in entries.flatten() {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
        tracing::debug!("editor temp workspace cleaned");
    }

    pub async fn open(
        &self,
        sftp: &SftpSession,
        terminal_id: &str,
        remote_file: &str,
    ) -> Result<EditorFile, AppError> {
        let remote = remote_path::normalize_remote(remote_file);
        let meta = sftp
            .metadata(remote.clone())
            .await
            .map_err(|err| AppError::Sftp(format!("读取远程文件 {remote} 失败: {err}")))?;
        if meta.is_dir() {
            return Err(AppError::InvalidArgument(format!("{remote} 是目录，无法编辑")));
        }
        let size = meta.size.unwrap_or(0);
        if size > MAX_EDIT_BYTES {
            return Err(AppError::InvalidArgument(format!(
                "文件 {size} 字节，超过在线编辑上限 {} 字节",
                MAX_EDIT_BYTES
            )));
        }

        let id = format!("e{}", self.counter.fetch_add(1, Ordering::Relaxed) + 1);
        let name = remote
            .rsplit('/')
            .next()
            .filter(|value| !value.is_empty() && *value != "/")
            .unwrap_or("unnamed")
            .to_string();
        let safe_name = name.replace(['/', '\\', ':'], "_");
        let dir = self.root.join(&id);
        std::fs::create_dir_all(&dir)
            .map_err(|err| AppError::Internal(format!("创建临时目录失败: {err}")))?;
        let temp_path = dir.join(&safe_name);

        let cancel = AtomicBool::new(false);
        let outcome = download::download(sftp, &remote, &temp_path, &cancel, |_, _| {}).await?;
        tracing::info!(remote = %remote, bytes = outcome.transferred, "editor opened");

        let file = EditorFile {
            edit_id: id.clone(),
            remote_path: remote,
            temp_path: temp_path.to_string_lossy().to_string(),
            name,
            size,
            modified: meta.mtime.map(|value| value as i64),
        };
        self.sessions
            .lock()
            .expect("editor sessions poisoned")
            .insert(
                id,
                EditSession {
                    file: file.clone(),
                    terminal_id: terminal_id.to_string(),
                },
            );
        Ok(file)
    }

    fn session_for(&self, edit_id: &str) -> Result<(String, EditorFile), AppError> {
        let sessions = self.sessions.lock().expect("editor sessions poisoned");
        let session = sessions
            .get(edit_id)
            .ok_or_else(|| AppError::NotFound(format!("编辑会话 {edit_id}")))?;
        Ok((session.terminal_id.clone(), session.file.clone()))
    }

    /// Terminal that owns this edit session (needed to fetch its SFTP session).
    pub fn terminal_for(&self, edit_id: &str) -> Result<String, AppError> {
        self.session_for(edit_id).map(|(terminal, _)| terminal)
    }

    pub async fn save(
        &self,
        edit_id: &str,
        sftp: &SftpSession,
        target: Option<&str>,
    ) -> Result<EditorSaved, AppError> {
        let (_, file) = self.session_for(edit_id)?;
        let remote = match target {
            Some(path) => remote_path::normalize_remote(path),
            None => file.remote_path.clone(),
        };

        let temp = PathBuf::from(&file.temp_path);
        if !temp.is_file() {
            return Err(AppError::NotFound(format!("临时文件 {}", file.temp_path)));
        }
        let local_size = std::fs::metadata(&temp)
            .map_err(|err| AppError::Internal(format!("读取临时文件失败: {err}")))?
            .len();

        // Editing must overwrite: resume semantics would append stale bytes.
        let cancel = AtomicBool::new(false);
        let outcome = upload::upload_overwrite(sftp, &temp, &remote, &cancel, |_, _| {}).await?;
        tracing::info!(remote = %remote, bytes = outcome.transferred, "editor saved");

        let after = sftp
            .metadata(remote.clone())
            .await
            .map_err(|err| AppError::Sftp(format!("保存后读取元数据失败: {err}")))?;
        let size = after.size.unwrap_or(0);
        let modified = after.mtime.map(|value| value as i64);

        let mut consistent = size == local_size;
        let mut warning = None;
        if !consistent {
            warning = Some(format!("保存后远端大小为 {size} 字节，本地为 {local_size} 字节"));
        } else if let (Some(before), Some(after_mtime)) = (file.modified, modified) {
            if after_mtime < before {
                consistent = false;
                warning = Some("保存后远程修改时间早于保存前，可能被其他进程覆盖".to_string());
            }
        }

        // Remember the new metadata and path for the next save.
        {
            let mut sessions = self.sessions.lock().expect("editor sessions poisoned");
            if let Some(session) = sessions.get_mut(edit_id) {
                session.file.remote_path = remote.clone();
                session.file.size = size;
                session.file.modified = modified;
            }
        }

        Ok(EditorSaved {
            remote_path: remote,
            size,
            modified,
            consistent,
            warning,
        })
    }

    pub fn close(&self, edit_id: &str) {
        let session = self
            .sessions
            .lock()
            .expect("editor sessions poisoned")
            .remove(edit_id);
        if let Some(session) = session {
            if let Some(parent) = Path::new(&session.file.temp_path).parent() {
                let _ = std::fs::remove_dir_all(parent);
            }
        }
    }

    pub fn cleanup_terminal(&self, terminal_id: &str) {
        let ids: Vec<String> = {
            let sessions = self.sessions.lock().expect("editor sessions poisoned");
            sessions
                .iter()
                .filter(|(_, session)| session.terminal_id == terminal_id)
                .map(|(id, _)| id.clone())
                .collect()
        };
        for id in ids {
            self.close(&id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sftp::{self, open_subsystem};
    use crate::ssh::config::SshConfig;
    use crate::ssh::hostkey::KnownHosts;
    use crate::ssh::session;
    use tokio::io::AsyncWriteExt;

    #[tokio::test]
    #[ignore = "requires: docker run -d -p 2222:22 leonssh-sshd:test"]
    async fn real_ssh_editor_roundtrip() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let pool = crate::storage::test_db::open().await;
        let known = std::sync::Arc::new(KnownHosts::load(pool).await.unwrap());
        let cfg = SshConfig::new("127.0.0.1", 2222, "test", "test");
        let opened = session::open(&cfg, known, 120, 40, Default::default())
            .await
            .unwrap();
        let sftp = open_subsystem(&opened.handle).await.unwrap();

        let base = format!("/tmp/leonssh-editor-{stamp}");
        sftp::mkdir(&sftp, &base).await.unwrap();
        let remote = format!("{base}/hello.sh");

        let mut file = sftp.create(remote.clone()).await.unwrap();
        file.write_all(b"echo original\n").await.unwrap();
        file.flush().await.unwrap();
        drop(file);

        let temp_root = std::env::temp_dir().join(format!("leonssh-editor-temp-{stamp}"));
        let manager = EditorManager::new(temp_root.clone());

        let opened_file = manager.open(&sftp, "t1", &remote).await.unwrap();
        assert_eq!(opened_file.name, "hello.sh");
        let original = std::fs::read_to_string(&opened_file.temp_path).unwrap();
        assert_eq!(original, "echo original\n");

        std::fs::write(&opened_file.temp_path, "echo edited\n# trailing\n").unwrap();
        let saved = manager.save(&opened_file.edit_id, &sftp, None).await.unwrap();
        assert!(saved.consistent, "warning: {:?}", saved.warning);
        assert_eq!(saved.size, b"echo edited\n# trailing\n".len() as u64);

        let remote_content = sftp.read(remote.clone()).await.unwrap();
        assert_eq!(remote_content, b"echo edited\n# trailing\n");

        // Save-as writes a second remote file and repoints the session.
        let copy_path = format!("{base}/copy.sh");
        let saved_as = manager
            .save(&opened_file.edit_id, &sftp, Some(&copy_path))
            .await
            .unwrap();
        assert_eq!(saved_as.remote_path, copy_path);
        assert_eq!(sftp.read(copy_path.clone()).await.unwrap(), b"echo edited\n# trailing\n");

        manager.close(&opened_file.edit_id);
        assert!(!Path::new(&opened_file.temp_path).exists(), "temp file must be removed");

        manager.cleanup_all();
        sftp::remove(&sftp, &remote, false).await.unwrap();
        sftp::remove(&sftp, &copy_path, false).await.unwrap();
        sftp::remove(&sftp, &base, true).await.unwrap();
        let _ = std::fs::remove_dir_all(&temp_root);
    }
}
