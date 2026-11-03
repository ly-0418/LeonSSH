//! Resume-aware streaming upload: local file -> remote SFTP file.

use std::path::Path;
use std::sync::atomic::AtomicBool;

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use tokio::io::AsyncSeekExt;

use super::stream::{self, ResumePlan};
use super::TransferOutcome;
use crate::error::AppError;

fn parent_of(path: &str) -> String {
    match path.rfind('/') {
        Some(0) | None => "/".to_string(),
        Some(index) => path[..index].to_string(),
    }
}

pub async fn upload(
    sftp: &SftpSession,
    local: &Path,
    remote: &str,
    cancel: &AtomicBool,
    progress: impl FnMut(u64, u64),
) -> Result<TransferOutcome, AppError> {
    upload_inner(sftp, local, remote, cancel, progress, false).await
}

/// Overwrites the remote file from offset 0 (used by the online editor:
/// resume semantics would keep stale bytes when the text got shorter).
pub async fn upload_overwrite(
    sftp: &SftpSession,
    local: &Path,
    remote: &str,
    cancel: &AtomicBool,
    progress: impl FnMut(u64, u64),
) -> Result<TransferOutcome, AppError> {
    upload_inner(sftp, local, remote, cancel, progress, true).await
}

async fn upload_inner(
    sftp: &SftpSession,
    local: &Path,
    remote: &str,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64, u64),
    overwrite: bool,
) -> Result<TransferOutcome, AppError> {
    let meta = tokio::fs::metadata(local).await.map_err(|err| {
        AppError::Transfer(format!("读取本地文件 {} 失败: {err}", local.display()))
    })?;
    if !meta.is_file() {
        return Err(AppError::InvalidArgument(format!(
            "{} 不是普通文件",
            local.display()
        )));
    }
    let total = meta.len();

    // Existing remote file size decides whether we resume.
    let remote_meta = if overwrite {
        None
    } else {
        sftp.metadata(remote.to_string()).await.ok()
    };

    // A directory is never a valid upload target. Without this the SFTP server
    // only answers with a generic "Failure", which reads like a network error.
    if let Some(metadata) = &remote_meta {
        if metadata.is_dir() {
            return Err(AppError::InvalidArgument(format!(
                "远程目标 {remote} 是目录，请指定文件名（例如 {remote}/{}）",
                local
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| "file".into())
            )));
        }
    }

    let remote_size = if overwrite {
        0
    } else {
        remote_meta
            .as_ref()
            .and_then(|metadata| metadata.size)
            .unwrap_or(0)
    };

    let plan = stream::plan(total, remote_size);
    if plan == ResumePlan::AlreadyComplete {
        progress(total, total);
        return Ok(TransferOutcome {
            transferred: total,
            resumed_from: 0,
            skipped: true,
            cancelled: false,
        });
    }

    let offset = match plan {
        ResumePlan::Resume(offset) => offset,
        _ => 0,
    };

    let mut local_file = tokio::fs::File::open(local).await.map_err(|err| {
        AppError::Transfer(format!("打开本地文件 {} 失败: {err}", local.display()))
    })?;
    if offset > 0 {
        local_file
            .seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|err| AppError::Transfer(format!("本地文件定位失败: {err}")))?;
        tracing::info!(remote = %remote, offset, "resuming upload");
    }

    // Never truncate when resuming, otherwise the already transferred prefix
    // would be lost.
    let flags = if offset == 0 {
        OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE
    } else {
        OpenFlags::WRITE | OpenFlags::CREATE
    };

    // Fail with a precise message instead of the server's generic "Failure".
    let parent = parent_of(remote);
    match sftp.metadata(parent.clone()).await {
        Ok(metadata) if !metadata.is_dir() => {
            return Err(AppError::InvalidArgument(format!(
                "远程父路径 {parent} 不是目录"
            )));
        }
        Ok(_) => {}
        Err(err) => {
            return Err(AppError::InvalidArgument(format!(
                "远程目录不存在或无权访问: {parent}（{err}）"
            )));
        }
    }

    let mut remote_file = sftp
        .open_with_flags(remote.to_string(), flags)
        .await
        .map_err(|err| {
            let text = err.to_string();
            let hint = if text.to_lowercase().contains("permission") {
                "（没有写入权限，检查目标目录的属主与权限）"
            } else {
                ""
            };
            AppError::Sftp(format!("打开远程文件 {remote} 失败{hint}: {text}"))
        })?;
    if offset > 0 {
        remote_file
            .seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|err| AppError::Transfer(format!("远程文件定位失败: {err}")))?;
    }

    let outcome = stream::copy_stream(
        &mut local_file,
        &mut remote_file,
        offset,
        cancel,
        |written| progress(written, total),
    )
    .await?;

    Ok(TransferOutcome {
        transferred: outcome.transferred,
        resumed_from: offset,
        skipped: false,
        cancelled: outcome.cancelled,
    })
}
