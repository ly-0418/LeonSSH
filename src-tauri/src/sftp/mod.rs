//! SFTP file access.
//!
//! The SFTP subsystem runs on a **new channel of the existing SSH connection**
//! (`Handle::channel_open_session` + `request_subsystem("sftp")`), never on a
//! second TCP/SSH connection.

use std::path::Path;

use russh_sftp::client::SftpSession;
use serde::Serialize;

use crate::error::AppError;

pub mod path;

use path::{join_remote, normalize_remote};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    /// Unix seconds, when the server reports it.
    pub modified: Option<i64>,
    /// Unix permission bits, when the server reports them.
    pub permissions: Option<u32>,
}

// ------------------------------------------------------------------- remote

/// Opens the SFTP subsystem on an existing connection.
pub async fn open_subsystem(
    handle: &crate::ssh::client::SharedHandle,
) -> Result<SftpSession, AppError> {
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|err| AppError::Sftp(format!("打开 SFTP 通道失败: {err}")))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|err| AppError::Sftp(format!("请求 sftp 子系统失败: {err}")))?;
    SftpSession::new(channel.into_stream())
        .await
        .map_err(|err| AppError::Sftp(format!("SFTP 初始化失败: {err}")))
}

pub async fn list(sftp: &SftpSession, path: &str) -> Result<Vec<FileEntry>, AppError> {
    let dir = normalize_remote(path);
    let started = std::time::Instant::now();
    let mut entries = Vec::new();
    let mut reader = sftp
        .read_dir(dir.clone())
        .await
        .map_err(|err| AppError::Sftp(format!("读取目录 {dir} 失败: {err}")))?;
    let read_all_ms = started.elapsed().as_millis() as u64;

    while let Some(entry) = reader.next() {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        // Names from the server are not trusted either: a server could hand us
        // `../` as an entry name.
        let Ok(child) = join_remote(&dir, &name) else {
            tracing::warn!(dir = %dir, name = %name, "skipping unsafe remote entry name");
            continue;
        };
        let metadata = entry.metadata();
        entries.push(FileEntry {
            path: child,
            name,
            is_dir: metadata.is_dir(),
            is_symlink: metadata.is_symlink(),
            size: metadata.size.unwrap_or(0),
            modified: metadata.mtime.map(|value| value as i64),
            permissions: metadata.permissions,
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    tracing::info!(
        dir = %dir,
        entries = entries.len(),
        read_all_ms,
        total_ms = started.elapsed().as_millis() as u64,
        "remote listing"
    );
    Ok(entries)
}

/// Metadata for a single remote path (used by refresh / editor / transfer).
pub async fn stat(sftp: &SftpSession, path: &str) -> Result<FileEntry, AppError> {
    let target = normalize_remote(path);
    let metadata = sftp
        .symlink_metadata(target.clone())
        .await
        .map_err(|err| AppError::Sftp(format!("读取 {target} 元数据失败: {err}")))?;
    let name = target
        .rsplit('/')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("/")
        .to_string();
    Ok(FileEntry {
        name,
        path: target,
        is_dir: metadata.is_dir(),
        is_symlink: metadata.is_symlink(),
        size: metadata.size.unwrap_or(0),
        modified: metadata.mtime.map(|value| value as i64),
        permissions: metadata.permissions,
    })
}

pub async fn mkdir(sftp: &SftpSession, path: &str) -> Result<(), AppError> {
    sftp.create_dir(normalize_remote(path))
        .await
        .map_err(|err| AppError::Sftp(format!("创建目录失败: {err}")))
}

pub async fn remove(sftp: &SftpSession, path: &str, is_dir: bool) -> Result<(), AppError> {
    let path = normalize_remote(path);
    let result = if is_dir {
        sftp.remove_dir(path).await
    } else {
        sftp.remove_file(path).await
    };
    result.map_err(|err| AppError::Sftp(format!("删除失败: {err}")))
}

pub async fn rename(sftp: &SftpSession, from: &str, to: &str) -> Result<(), AppError> {
    sftp.rename(normalize_remote(from), normalize_remote(to))
        .await
        .map_err(|err| AppError::Sftp(format!("重命名失败: {err}")))
}

/// Creates an empty remote file (used by "新建文件").
pub async fn create_file(sftp: &SftpSession, path: &str) -> Result<(), AppError> {
    let target = normalize_remote(path);
    let file = sftp
        .create(target.clone())
        .await
        .map_err(|err| AppError::Sftp(format!("创建远程文件 {target} 失败: {err}")))?;
    drop(file);
    Ok(())
}

/// `mode` is the Unix permission bits, e.g. `0o755`.
pub async fn chmod(sftp: &SftpSession, path: &str, mode: u32) -> Result<(), AppError> {
    let metadata = russh_sftp::protocol::FileAttributes {
        permissions: Some(mode & 0o7777),
        ..Default::default()
    };
    sftp.set_metadata(normalize_remote(path), metadata)
        .await
        .map_err(|err| AppError::Sftp(format!("修改权限失败: {err}")))
}

// ----------------------------------------------------------------- transfer

/// Chunk size for both directions: bounds memory and keeps progress smooth.
pub const CHUNK_SIZE: usize = 32 * 1024;

/// Uploads `local` to `remote`, calling `on_progress(transferred, total)`.
pub async fn upload_file(
    sftp: &SftpSession,
    local: &Path,
    remote: &str,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<u64, AppError> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut source = tokio::fs::File::open(local)
        .await
        .map_err(|err| AppError::Sftp(format!("打开本地文件失败: {err}")))?;
    let total = source
        .metadata()
        .await
        .map(|meta| meta.len())
        .unwrap_or_default();

    let mut target = sftp
        .create(remote.to_string())
        .await
        .map_err(|err| AppError::Sftp(format!("创建远端文件失败: {err}")))?;

    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut transferred = 0u64;
    loop {
        let read = source
            .read(&mut buffer)
            .await
            .map_err(|err| AppError::Sftp(format!("读取本地文件失败: {err}")))?;
        if read == 0 {
            break;
        }
        target
            .write_all(&buffer[..read])
            .await
            .map_err(|err| AppError::Sftp(format!("写入远端失败: {err}")))?;
        transferred += read as u64;
        on_progress(transferred, total);
    }
    target
        .flush()
        .await
        .map_err(|err| AppError::Sftp(format!("刷新远端文件失败: {err}")))?;
    target
        .shutdown()
        .await
        .map_err(|err| AppError::Sftp(format!("关闭远端文件失败: {err}")))?;
    Ok(transferred)
}

/// Downloads `remote` into `local`, calling `on_progress(transferred, total)`.
pub async fn download_file(
    sftp: &SftpSession,
    remote: &str,
    local: &Path,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<u64, AppError> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut source = sftp
        .open(remote.to_string())
        .await
        .map_err(|err| AppError::Sftp(format!("打开远端文件失败: {err}")))?;
    let total = sftp
        .metadata(remote.to_string())
        .await
        .ok()
        .and_then(|meta| meta.size)
        .unwrap_or_default();

    let mut target = tokio::fs::File::create(local)
        .await
        .map_err(|err| AppError::Sftp(format!("创建本地文件失败: {err}")))?;

    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut transferred = 0u64;
    loop {
        let read = source
            .read(&mut buffer)
            .await
            .map_err(|err| AppError::Sftp(format!("读取远端失败: {err}")))?;
        if read == 0 {
            break;
        }
        target
            .write_all(&buffer[..read])
            .await
            .map_err(|err| AppError::Sftp(format!("写入本地文件失败: {err}")))?;
        transferred += read as u64;
        on_progress(transferred, total);
    }
    target
        .flush()
        .await
        .map_err(|err| AppError::Sftp(format!("刷新本地文件失败: {err}")))?;
    Ok(transferred)
}

// -------------------------------------------------------------------- local
// Local filesystem access lives in the frontend (`@tauri-apps/plugin-fs`).
// The former `local_home` / `local_list` Rust commands were removed on purpose:
// the fs plugin owns local path validation and scope enforcement.

#[cfg(test)]
mod tests {
    use super::*;

    /// End-to-end SFTP against the docker sshd, reusing one SSH connection.
    #[tokio::test]
    #[ignore = "requires: docker run -d -p 2222:22 leonssh-sshd:test"]
    async fn real_ssh_sftp_roundtrip() {
        use std::sync::Arc;

        use crate::ssh::config::SshConfig;
        use crate::ssh::hostkey::KnownHosts;
        use crate::ssh::session;

        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let pool = crate::storage::test_db::open().await;
        let known = Arc::new(KnownHosts::load(pool).await.unwrap());
        let cfg = SshConfig::new("127.0.0.1", 2222, "test", "test");

        let opened = session::open(&cfg, known, 120, 40, Default::default())
            .await
            .unwrap();
        // The SFTP subsystem shares the connection opened for the shell.
        let sftp = open_subsystem(&opened.handle).await.unwrap();

        let base = format!("/tmp/leonssh-sftp-{stamp}");
        mkdir(&sftp, &base).await.unwrap();

        let local_dir = std::env::temp_dir().join(format!("leonssh-sftp-local-{stamp}"));
        std::fs::create_dir_all(&local_dir).unwrap();
        let payload: Vec<u8> = (0..70_000u32).map(|i| (i % 251) as u8).collect();
        let local_file = local_dir.join("payload.bin");
        std::fs::write(&local_file, &payload).unwrap();

        let remote_file = join_remote(&base, "payload.bin").unwrap();
        let uploaded = upload_file(&sftp, &local_file, &remote_file, |_, _| {})
            .await
            .unwrap();
        assert_eq!(uploaded, payload.len() as u64);

        let entries = list(&sftp, &base).await.unwrap();
        assert!(
            entries
                .iter()
                .any(|entry| entry.name == "payload.bin"
                    && !entry.is_dir
                    && entry.size == payload.len() as u64),
            "listing: {entries:?}"
        );

        chmod(&sftp, &remote_file, 0o600).await.unwrap();
        let metadata = sftp.metadata(remote_file.clone()).await.unwrap();
        assert_eq!(
            metadata.permissions.map(|mode| mode & 0o777),
            Some(0o600),
            "chmod should be visible over SFTP"
        );

        let downloaded = local_dir.join("downloaded.bin");
        let bytes = download_file(&sftp, &remote_file, &downloaded, |_, _| {})
            .await
            .unwrap();
        assert_eq!(bytes, payload.len() as u64);
        assert_eq!(std::fs::read(&downloaded).unwrap(), payload);

        let renamed = join_remote(&base, "renamed.bin").unwrap();
        rename(&sftp, &remote_file, &renamed).await.unwrap();
        let after_rename = list(&sftp, &base).await.unwrap();
        assert!(after_rename.iter().any(|entry| entry.name == "renamed.bin"));

        remove(&sftp, &renamed, false).await.unwrap();
        remove(&sftp, &base, true).await.unwrap();
        assert!(
            list(&sftp, "/tmp")
                .await
                .unwrap()
                .iter()
                .all(|entry| !entry.name.contains("leonssh-sftp")),
            "temp dirs must be cleaned up"
        );

        let _ = std::fs::remove_dir_all(&local_dir);
    }
}


/// Streams a directory listing in `readdir` batches.
///
/// SFTP returns ~100 entries per round trip, so a 8000-entry folder costs ~80
/// sequential round trips. Handing each batch to the caller lets the UI paint
/// the first entries after a single round trip instead of waiting for the end.
pub async fn list_stream(
    handle: &crate::ssh::client::SharedHandle,
    path: &str,
    mut on_batch: impl FnMut(Vec<FileEntry>) -> bool,
) -> Result<usize, AppError> {
    let dir = normalize_remote(path);
    let started = std::time::Instant::now();
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|err| AppError::Ssh(format!("打开 SFTP 通道失败: {err}")))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|err| AppError::Ssh(format!("启动 SFTP 子系统失败: {err}")))?;

    let raw = russh_sftp::client::rawsession::RawSftpSession::new(channel.into_stream());
    let opened = raw
        .opendir(dir.clone())
        .await
        .map_err(|err| AppError::Sftp(format!("读取目录 {dir} 失败: {err}")))?;

    let mut total = 0usize;
    let mut first_batch_ms: Option<u64> = None;
    loop {
        let name = match raw.readdir(opened.handle.as_str()).await {
            Ok(name) => name,
            Err(err) => {
                let _ = raw.close(opened.handle.as_str()).await;
                return Err(AppError::Sftp(format!("读取目录 {dir} 失败: {err}")));
            }
        };
        if name.files.is_empty() {
            break;
        }

        let mut batch = Vec::with_capacity(name.files.len());
        for entry in name.files {
            if entry.filename == "." || entry.filename == ".." {
                continue;
            }
            let Ok(child) = join_remote(&dir, &entry.filename) else {
                continue;
            };
            let attrs = entry.attrs;
            batch.push(FileEntry {
                path: child,
                name: entry.filename,
                is_dir: attrs.is_dir(),
                is_symlink: attrs.is_symlink(),
                size: attrs.size.unwrap_or(0),
                modified: attrs.mtime.map(|value| value as i64),
                permissions: attrs.permissions,
            });
        }
        if batch.is_empty() {
            continue;
        }

        total += batch.len();
        if first_batch_ms.is_none() {
            first_batch_ms = Some(started.elapsed().as_millis() as u64);
            tracing::info!(dir = %dir, first_batch_ms = first_batch_ms.unwrap_or(0), "remote listing first batch");
        }
        if !on_batch(batch) {
            break;
        }
    }

    let _ = raw.close(opened.handle.as_str()).await;
    tracing::info!(
        dir = %dir,
        entries = total,
        first_batch_ms = first_batch_ms.unwrap_or(0),
        elapsed_ms = started.elapsed().as_millis() as u64,
        "remote listing streamed"
    );
    Ok(total)
}