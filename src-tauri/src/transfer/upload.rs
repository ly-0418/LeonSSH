//! Resume-aware streaming upload: local file -> remote SFTP file.

use std::path::Path;
use std::sync::atomic::AtomicBool;

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use tokio::io::AsyncSeekExt;

use super::stream::{self, ResumePlan};
use super::TransferOutcome;
use crate::error::AppError;

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
    let remote_size = if overwrite {
        0
    } else {
        match sftp.metadata(remote.to_string()).await {
            Ok(metadata) => metadata.size.unwrap_or(0),
            Err(_) => 0,
        }
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
    let mut remote_file = sftp
        .open_with_flags(remote.to_string(), flags)
        .await
        .map_err(|err| AppError::Sftp(format!("打开远程文件 {remote} 失败: {err}")))?;
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
