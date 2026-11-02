//! Resume-aware streaming download: remote SFTP file → local file.

use std::path::Path;
use std::sync::atomic::AtomicBool;

use russh_sftp::client::SftpSession;
use tokio::io::AsyncSeekExt;

use super::stream::{self, ResumePlan};
use super::TransferOutcome;
use crate::error::AppError;

pub async fn download(
    sftp: &SftpSession,
    remote: &str,
    local: &Path,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64, u64),
) -> Result<TransferOutcome, AppError> {
    let metadata = sftp
        .metadata(remote.to_string())
        .await
        .map_err(|err| AppError::Sftp(format!("读取远程文件 {remote} 失败: {err}")))?;
    if metadata.is_dir() {
        return Err(AppError::InvalidArgument(format!("{remote} 是目录")));
    }
    let total = metadata.size.unwrap_or(0);

    let local_size = match tokio::fs::metadata(local).await {
        Ok(meta) if meta.is_file() => meta.len(),
        _ => 0,
    };

    let plan = stream::plan(total, local_size);
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

    let mut remote_file = sftp
        .open(remote.to_string())
        .await
        .map_err(|err| AppError::Sftp(format!("打开远程文件 {remote} 失败: {err}")))?;
    if offset > 0 {
        remote_file
            .seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|err| AppError::Transfer(format!("远程文件定位失败: {err}")))?;
        tracing::info!(remote = %remote, offset, "resuming download");
    }

    let mut local_file = if offset > 0 {
        tokio::fs::OpenOptions::new()
            .append(true)
            .open(local)
            .await
            .map_err(|err| {
                AppError::Transfer(format!("打开本地文件 {} 失败: {err}", local.display()))
            })?
    } else {
        if let Some(parent) = local.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|err| {
                AppError::Transfer(format!("创建目录 {} 失败: {err}", parent.display()))
            })?;
        }
        tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(local)
            .await
            .map_err(|err| {
                AppError::Transfer(format!("创建本地文件 {} 失败: {err}", local.display()))
            })?
    };

    let outcome = stream::copy_stream(
        &mut remote_file,
        &mut local_file,
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
