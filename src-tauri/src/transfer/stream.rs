//! The single streaming code path shared by upload and download.
//!
//! Both directions:
//! 1. compute a [`ResumePlan`] from source/target sizes,
//! 2. seek both ends to the resume offset,
//! 3. call [`copy_stream`], which copies fixed 256 KiB chunks and checks the
//!    cancellation flag between chunks.

use std::sync::atomic::{AtomicBool, Ordering};

use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::error::AppError;

/// Fixed block size. Memory use per transfer is one buffer of this size,
/// independent of the file length.
pub const CHUNK_SIZE: usize = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResumePlan {
    /// Start from byte 0 (no target, or the target is larger than the source).
    Fresh,
    /// Continue from this offset.
    Resume(u64),
    /// Target already has exactly as many bytes as the source.
    AlreadyComplete,
}

/// Decides how to transfer `src_size` bytes into a target of `dst_size` bytes.
///
/// A target that is longer than the source means the previous transfer was of a
/// different file: the resume premise does not hold, so we restart from 0.
pub fn plan(src_size: u64, dst_size: u64) -> ResumePlan {
    if dst_size == 0 {
        ResumePlan::Fresh
    } else if dst_size == src_size {
        ResumePlan::AlreadyComplete
    } else if dst_size < src_size {
        ResumePlan::Resume(dst_size)
    } else {
        ResumePlan::Fresh
    }
}

#[derive(Debug, Clone, Copy)]
pub struct CopyOutcome {
    pub transferred: u64,
    pub cancelled: bool,
}

/// Copies `reader` → `writer` in fixed chunks until EOF or cancellation.
///
/// `start_offset` is only used to report progress relative to the whole file.
pub async fn copy_stream<R, W>(
    reader: &mut R,
    writer: &mut W,
    start_offset: u64,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64),
) -> Result<CopyOutcome, AppError>
where
    R: AsyncReadExt + Unpin,
    W: AsyncWriteExt + Unpin,
{
    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut written = start_offset;

    loop {
        if cancel.load(Ordering::Relaxed) {
            writer.flush().await.map_err(io_err)?;
            return Ok(CopyOutcome {
                transferred: written,
                cancelled: true,
            });
        }

        let read = reader.read(&mut buffer).await.map_err(io_err)?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read]).await.map_err(io_err)?;
        written += read as u64;
        progress(written);
    }

    writer.flush().await.map_err(io_err)?;
    Ok(CopyOutcome {
        transferred: written,
        cancelled: false,
    })
}

fn io_err(err: std::io::Error) -> AppError {
    AppError::Transfer(format!("传输读写失败: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resume_plan_rules() {
        assert_eq!(plan(100, 0), ResumePlan::Fresh);
        assert_eq!(plan(100, 100), ResumePlan::AlreadyComplete);
        assert_eq!(plan(100, 40), ResumePlan::Resume(40));
        // Target longer than source: previous attempt was a different file.
        assert_eq!(plan(100, 140), ResumePlan::Fresh);
    }

    #[tokio::test]
    async fn copies_chunks_and_reports_progress() {
        let payload: Vec<u8> = (0..(CHUNK_SIZE * 2 + 123)).map(|i| (i % 251) as u8).collect();
        let mut reader = std::io::Cursor::new(payload.clone());
        let mut writer = Vec::new();
        let cancel = AtomicBool::new(false);
        let mut seen = Vec::new();

        let outcome = copy_stream(&mut reader, &mut writer, 0, &cancel, |written| seen.push(written))
            .await
            .unwrap();

        assert!(!outcome.cancelled);
        assert_eq!(outcome.transferred, payload.len() as u64);
        assert_eq!(writer, payload);
        assert_eq!(seen.len(), 3, "one progress event per chunk");
        assert_eq!(*seen.last().unwrap(), payload.len() as u64);
    }

    #[tokio::test]
    async fn stops_between_chunks_when_cancelled() {
        let payload = vec![7u8; CHUNK_SIZE * 4];
        let mut reader = std::io::Cursor::new(payload);
        let mut writer = Vec::new();
        let cancel = AtomicBool::new(false);

        let outcome = copy_stream(&mut reader, &mut writer, 0, &cancel, |written| {
            if written >= CHUNK_SIZE as u64 {
                cancel.store(true, Ordering::Relaxed);
            }
        })
        .await
        .unwrap();

        assert!(outcome.cancelled);
        assert_eq!(outcome.transferred, CHUNK_SIZE as u64);
        assert_eq!(writer.len(), CHUNK_SIZE);
    }
}
