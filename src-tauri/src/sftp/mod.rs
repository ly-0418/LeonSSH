//! SFTP file access.
//!
//! The SFTP subsystem runs on a **new channel of the existing SSH connection**
//! (`Handle::channel_open_session` + `request_subsystem("sftp")`), never on a
//! second TCP/SSH connection.

use std::path::{Path, PathBuf};

use russh_sftp::client::SftpSession;
use serde::Serialize;

use crate::error::AppError;

pub mod path;

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

pub fn join_path(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

pub fn normalize(path: &str) -> String {
    let absolute = path.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    let joined = parts.join("/");
    if absolute {
        format!("/{joined}")
    } else if joined.is_empty() {
        ".".to_string()
    } else {
        joined
    }
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
    let dir = normalize(path);
    let mut entries = Vec::new();
    let mut reader = sftp
        .read_dir(dir.clone())
        .await
        .map_err(|err| AppError::Sftp(format!("读取目录 {dir} 失败: {err}")))?;

    while let Some(entry) = reader.next() {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let metadata = entry.metadata();
        entries.push(FileEntry {
            path: join_path(&dir, &name),
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
    Ok(entries)
}

pub async fn mkdir(sftp: &SftpSession, path: &str) -> Result<(), AppError> {
    sftp.create_dir(normalize(path))
        .await
        .map_err(|err| AppError::Sftp(format!("创建目录失败: {err}")))
}

pub async fn remove(sftp: &SftpSession, path: &str, is_dir: bool) -> Result<(), AppError> {
    let path = normalize(path);
    let result = if is_dir {
        sftp.remove_dir(path).await
    } else {
        sftp.remove_file(path).await
    };
    result.map_err(|err| AppError::Sftp(format!("删除失败: {err}")))
}

pub async fn rename(sftp: &SftpSession, from: &str, to: &str) -> Result<(), AppError> {
    sftp.rename(normalize(from), normalize(to))
        .await
        .map_err(|err| AppError::Sftp(format!("重命名失败: {err}")))
}

/// `mode` is the Unix permission bits, e.g. `0o755`.
pub async fn chmod(sftp: &SftpSession, path: &str, mode: u32) -> Result<(), AppError> {
    let metadata = russh_sftp::protocol::FileAttributes {
        permissions: Some(mode & 0o7777),
        ..Default::default()
    };
    sftp.set_metadata(normalize(path), metadata)
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

pub fn local_home() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("C:/"))
}

pub fn local_list(path: &Path) -> Result<Vec<FileEntry>, AppError> {
    let mut entries = Vec::new();
    let dir = std::fs::read_dir(path)
        .map_err(|err| AppError::Sftp(format!("读取本地目录失败: {err}")))?;

    for entry in dir.flatten() {
        let metadata = match std::fs::metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64);
        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().replace('\\', "/"),
            is_dir: metadata.is_dir(),
            is_symlink: metadata.file_type().is_symlink(),
            size: metadata.len(),
            modified,
            permissions: None,
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_paths_without_double_slashes() {
        assert_eq!(join_path("/etc", "hosts"), "/etc/hosts");
        assert_eq!(join_path("/etc/", "hosts"), "/etc/hosts");
        assert_eq!(join_path("/", "root"), "/root");
    }

    #[test]
    fn normalizes_dots() {
        assert_eq!(normalize("/var/./log/../log/syslog"), "/var/log/syslog");
        assert_eq!(normalize("/.."), "/");
        assert_eq!(normalize("/var/../.."), "/");
    }

    #[test]
    fn local_listing_reports_directories_first() {
        let dir = std::env::temp_dir().join(format!(
            "leonssh-sftp-local-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("a.txt"), b"hello").unwrap();

        let entries = local_list(&dir).unwrap();
        assert_eq!(entries[0].name, "sub");
        assert!(entries[0].is_dir);
        assert_eq!(entries[1].name, "a.txt");
        assert_eq!(entries[1].size, 5);

        let _ = std::fs::remove_dir_all(&dir);
    }

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

        let remote_file = join_path(&base, "payload.bin");
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

        let renamed = join_path(&base, "renamed.bin");
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
