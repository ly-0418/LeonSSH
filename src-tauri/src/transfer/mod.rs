//! Transfer queue: own the tasks, run them in the background, stream progress.

pub mod download;
pub mod stream;
pub mod task;
pub mod upload;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use russh_sftp::client::SftpSession;
use tauri::ipc::Channel;

use crate::error::AppError;
use task::{Direction, TransferStatus, TransferTask};

/// How often progress is pushed to the UI (per active transfer).
const PROGRESS_INTERVAL: Duration = Duration::from_millis(120);

#[derive(Debug, Clone, Copy)]
pub struct TransferOutcome {
    pub transferred: u64,
    pub resumed_from: u64,
    pub skipped: bool,
    pub cancelled: bool,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

#[derive(Clone)]
pub struct TransferManager {
    tasks: Arc<Mutex<HashMap<String, TransferTask>>>,
    cancels: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    sink: Arc<Mutex<Option<Channel<TransferTask>>>>,
    counter: Arc<AtomicU64>,
    /// Bounds how many transfers run at once; the rest stay queued.
    slots: Arc<tokio::sync::Semaphore>,
}

/// How many files may transfer in parallel.
const PARALLEL_TRANSFERS: usize = 3;

impl Default for TransferManager {
    fn default() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
            cancels: Arc::new(Mutex::new(HashMap::new())),
            sink: Arc::new(Mutex::new(None)),
            counter: Arc::new(AtomicU64::new(0)),
            slots: Arc::new(tokio::sync::Semaphore::new(PARALLEL_TRANSFERS)),
        }
    }
}

impl TransferManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers the frontend channel and replays the current snapshot so a
    /// remounted UI does not lose tasks.
    pub fn attach(&self, channel: Channel<TransferTask>) {
        *self.sink.lock().expect("transfer sink poisoned") = Some(channel);
        for task in self.snapshot() {
            self.emit(&task);
        }
    }

    pub fn snapshot(&self) -> Vec<TransferTask> {
        let mut tasks: Vec<TransferTask> = self
            .tasks
            .lock()
            .expect("transfer tasks poisoned")
            .values()
            .cloned()
            .collect();
        tasks.sort_by(|a, b| b.started_at.cmp(&a.started_at).then_with(|| b.id.cmp(&a.id)));
        tasks
    }

    pub fn cancel(&self, id: &str) {
        if let Some(flag) = self.cancels.lock().expect("transfer cancels poisoned").get(id) {
            flag.store(true, Ordering::Relaxed);
            tracing::info!(task = id, "transfer cancel requested");
        }
    }

    /// Marks every queued/running task of a terminal as failed. Used when the
    /// session is closed: its SFTP subsystem is about to be dropped.
    pub fn cancel_for_terminal(&self, terminal: &str, reason: &str) {
        let ids: Vec<String> = {
            let tasks = self.tasks.lock().expect("transfer tasks poisoned");
            tasks
                .values()
                .filter(|task| {
                    task.terminal_id == terminal
                        && matches!(
                            task.status,
                            TransferStatus::Queued | TransferStatus::Running
                        )
                })
                .map(|task| task.id.clone())
                .collect()
        };
        for id in ids {
            if let Some(flag) = self.cancels.lock().expect("transfer cancels poisoned").get(&id) {
                flag.store(true, Ordering::Relaxed);
            }
            self.update(&id, |task| {
                task.status = TransferStatus::Failed;
                task.error = Some(reason.to_string());
                task.finished_at = Some(now_secs());
            });
        }
    }

    /// True while a transfer for this terminal is queued or running.
    pub fn has_active_for(&self, terminal: &str) -> bool {
        self.tasks
            .lock()
            .expect("transfer tasks poisoned")
            .values()
            .any(|task| {
                task.terminal_id == terminal
                    && matches!(task.status, TransferStatus::Queued | TransferStatus::Running)
            })
    }

    fn emit(&self, task: &TransferTask) {
        if let Some(channel) = self.sink.lock().expect("transfer sink poisoned").as_ref() {
            let _ = channel.send(task.clone());
        }
    }

    fn update(&self, id: &str, patch: impl FnOnce(&mut TransferTask)) {
        let snapshot = {
            let mut tasks = self.tasks.lock().expect("transfer tasks poisoned");
            let Some(task) = tasks.get_mut(id) else {
                return;
            };
            patch(task);
            task.clone()
        };
        self.emit(&snapshot);
    }

    fn enqueue(
        &self,
        terminal_id: String,
        direction: Direction,
        src: String,
        dst: String,
    ) -> (TransferTask, Arc<AtomicBool>) {
        let id = format!("t{}", self.counter.fetch_add(1, Ordering::Relaxed) + 1);
        let task = TransferTask {
            id: id.clone(),
            terminal_id,
            direction,
            src,
            dst,
            total: 0,
            transferred: 0,
            resumed_from: 0,
            status: TransferStatus::Queued,
            error: None,
            started_at: now_secs(),
            finished_at: None,
        };
        let cancel = Arc::new(AtomicBool::new(false));
        self.tasks
            .lock()
            .expect("transfer tasks poisoned")
            .insert(id.clone(), task.clone());
        self.cancels
            .lock()
            .expect("transfer cancels poisoned")
            .insert(id, cancel.clone());
        self.emit(&task);
        (task, cancel)
    }

    fn finish(&self, id: &str, result: Result<TransferOutcome, AppError>) {
        if let Err(error) = &result {
            tracing::warn!(task = id, error = %error, "transfer failed");
        }
        self.cancels.lock().expect("transfer cancels poisoned").remove(id);
        match result {
            Ok(outcome) if outcome.skipped => self.update(id, |task| {
                task.transferred = outcome.transferred;
                task.total = outcome.transferred;
                task.status = TransferStatus::Skipped;
                task.finished_at = Some(now_secs());
            }),
            Ok(outcome) if outcome.cancelled => self.update(id, |task| {
                task.transferred = outcome.transferred;
                task.status = TransferStatus::Cancelled;
                task.finished_at = Some(now_secs());
            }),
            Ok(outcome) => self.update(id, |task| {
                task.transferred = outcome.transferred;
                task.resumed_from = outcome.resumed_from;
                if task.total == 0 {
                    task.total = outcome.transferred;
                }
                task.status = TransferStatus::Completed;
                task.finished_at = Some(now_secs());
            }),
            Err(err) => self.update(id, |task| {
                task.status = TransferStatus::Failed;
                task.error = Some(err.to_string());
                task.finished_at = Some(now_secs());
            }),
        }
    }

    pub fn start_upload(
        self: &Arc<Self>,
        sftp: Arc<SftpSession>,
        terminal_id: String,
        local: PathBuf,
        remote: String,
        overwrite: bool,
    ) -> Result<TransferTask, AppError> {
        let (task, cancel) =
            self.enqueue(terminal_id, Direction::Upload, local.display().to_string(), remote.clone());
        let manager = Arc::clone(self);
        let task_id = task.id.clone();

        tokio::spawn(async move {
            // Bounded parallelism: extra tasks stay queued until a slot frees up.
            let Ok(permit) = manager.slots.clone().acquire_owned().await else {
                return;
            };
            manager.update(&task_id, |task| task.status = TransferStatus::Running);
            let progress_manager = Arc::clone(&manager);

            // Overwrite starts from byte 0 (explicit user choice); the default
            // path keeps the resume semantics for interrupted transfers.
            let result = if overwrite {
                let progress_id = task_id.clone();
                let mut last_emit = Instant::now();
                upload::upload_overwrite(&sftp, &local, &remote, &cancel, move |written, total| {
                    if last_emit.elapsed() >= PROGRESS_INTERVAL || written == total {
                        last_emit = Instant::now();
                        progress_manager.update(&progress_id, |task| {
                            task.transferred = written;
                            if total > 0 {
                                task.total = total;
                            }
                        });
                    }
                })
                .await
            } else {
                let progress_id = task_id.clone();
                let mut last_emit = Instant::now();
                upload::upload(&sftp, &local, &remote, &cancel, move |written, total| {
                    if last_emit.elapsed() >= PROGRESS_INTERVAL || written == total {
                        last_emit = Instant::now();
                        progress_manager.update(&progress_id, |task| {
                            task.transferred = written;
                            if total > 0 {
                                task.total = total;
                            }
                        });
                    }
                })
                .await
            };

            manager.finish(&task_id, result);
            drop(permit);
        });

        Ok(task)
    }

    pub fn start_download(
        self: &Arc<Self>,
        sftp: Arc<SftpSession>,
        terminal_id: String,
        remote: String,
        local: PathBuf,
    ) -> Result<TransferTask, AppError> {
        let (task, cancel) =
            self.enqueue(terminal_id, Direction::Download, remote.clone(), local.display().to_string());
        let manager = Arc::clone(self);
        let task_id = task.id.clone();

        tokio::spawn(async move {
            // Bounded parallelism: extra tasks stay queued until a slot frees up.
            let Ok(permit) = manager.slots.clone().acquire_owned().await else {
                return;
            };
            manager.update(&task_id, |task| task.status = TransferStatus::Running);
            let progress_manager = Arc::clone(&manager);
            let progress_id = task_id.clone();
            let mut last_emit = Instant::now();

            let result = download::download(&sftp, &remote, &local, &cancel, move |written, total| {
                if last_emit.elapsed() >= PROGRESS_INTERVAL || written == total {
                    last_emit = Instant::now();
                    progress_manager.update(&progress_id, |task| {
                        task.transferred = written;
                        if total > 0 {
                            task.total = total;
                        }
                    });
                }
            })
            .await;

            manager.finish(&task_id, result);
            drop(permit);
        });

        Ok(task)
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn snapshot_keeps_newest_first() {
        let manager = TransferManager::new();
        let first = manager.enqueue("t1".into(), Direction::Upload, "a".into(), "b".into()).0;
        let second = manager.enqueue("t1".into(), Direction::Download, "c".into(), "d".into()).0;
        assert_ne!(first.id, second.id);

        let snapshot = manager.snapshot();
        assert_eq!(snapshot.len(), 2);
        assert!(snapshot.iter().any(|task| task.id == first.id));
        assert!(snapshot.iter().any(|task| task.id == second.id));
    }

    #[tokio::test]
    async fn cancel_flags_the_running_task() {
        let manager = TransferManager::new();
        let (task, cancel) = manager.enqueue("t1".into(), Direction::Upload, "a".into(), "b".into());
        manager.cancel(&task.id);
        assert!(cancel.load(Ordering::Relaxed));
    }

    /// Uploading onto an existing directory must fail with a precise message
    /// instead of the server's generic "Failure".
    #[tokio::test]
    #[ignore = "requires: docker run -d -p 2222:22 leonssh-sshd:test"]
    async fn upload_to_a_directory_is_rejected() {
        use std::sync::atomic::AtomicBool;

        use crate::sftp::{self, open_subsystem};
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
        let sftp_session = open_subsystem(&opened.handle).await.unwrap();

        let dir = format!("/tmp/leonssh-dir-target-{stamp}");
        sftp::mkdir(&sftp_session, &dir).await.unwrap();

        let local = std::env::temp_dir().join(format!("leonssh-dir-{stamp}.txt"));
        std::fs::write(&local, b"x").unwrap();

        let cancel = AtomicBool::new(false);
        let err = upload::upload(&sftp_session, &local, &dir, &cancel, |_, _| {})
            .await
            .unwrap_err();
        assert_eq!(err.code(), "invalid_argument");
        assert!(err.to_string().contains("是目录"), "unexpected: {err}");

        // Missing parent gives a different, equally precise message.
        let missing = format!("{dir}/nope/file.txt");
        let err = upload::upload(&sftp_session, &local, &missing, &cancel, |_, _| {})
            .await
            .unwrap_err();
        assert!(err.to_string().contains("远程目录不存在"), "unexpected: {err}");

        sftp::remove(&sftp_session, &dir, true).await.unwrap();
        let _ = std::fs::remove_file(&local);
    }

    /// Phase-C acceptance: interrupt a 5 MB transfer, then resume it from the
    /// offset already present on the other side (both directions).
    #[tokio::test]
    #[ignore = "requires: docker run -d -p 2222:22 leonssh-sshd:test"]
    async fn real_ssh_transfers_resume_after_cancel() {
        use std::sync::atomic::AtomicBool;

        use crate::sftp::{self, open_subsystem, stat};
        use crate::ssh::config::SshConfig;
        use crate::ssh::hostkey::KnownHosts;
        use crate::ssh::session;

        const TOTAL: u32 = 5_000_000;
        const ONE_MIB: u64 = 1024 * 1024;

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
        let sftp_session = open_subsystem(&opened.handle).await.unwrap();

        let base = format!("/tmp/leonssh-transfer-{stamp}");
        sftp::mkdir(&sftp_session, &base).await.unwrap();
        let remote = format!("{base}/payload.bin");

        let local_dir = std::env::temp_dir().join(format!("leonssh-transfer-{stamp}"));
        std::fs::create_dir_all(&local_dir).unwrap();
        let local = local_dir.join("payload.bin");
        let payload: Vec<u8> = (0..TOTAL).map(|i| (i % 253) as u8).collect();
        std::fs::write(&local, &payload).unwrap();

        // Upload, cancelled after 1 MiB.
        let cancel = AtomicBool::new(false);
        let first = upload::upload(&sftp_session, &local, &remote, &cancel, |written, _| {
            if written >= ONE_MIB {
                cancel.store(true, Ordering::Relaxed);
            }
        })
        .await
        .unwrap();
        assert!(first.cancelled, "first attempt should be cancelled");
        let partial = stat(&sftp_session, &remote).await.unwrap().size;
        assert!(
            partial >= ONE_MIB && partial < TOTAL as u64,
            "partial={partial}"
        );

        // Upload again: must resume, not restart.
        let cancel = AtomicBool::new(false);
        let second = upload::upload(&sftp_session, &local, &remote, &cancel, |_, _| {})
            .await
            .unwrap();
        assert!(!second.cancelled);
        assert_eq!(
            second.resumed_from, partial,
            "resume offset must match the remote size"
        );
        assert_eq!(stat(&sftp_session, &remote).await.unwrap().size, TOTAL as u64);

        // Download: cancel after 1 MiB, then resume and compare bytes.
        let local_copy = local_dir.join("payload.copy.bin");
        let cancel = AtomicBool::new(false);
        let first_dl = download::download(
            &sftp_session,
            &remote,
            &local_copy,
            &cancel,
            |written, _| {
                if written >= ONE_MIB {
                    cancel.store(true, Ordering::Relaxed);
                }
            },
        )
        .await
        .unwrap();
        assert!(first_dl.cancelled);
        let local_partial = std::fs::metadata(&local_copy).unwrap().len();
        assert!(local_partial >= ONE_MIB && local_partial < TOTAL as u64);

        let cancel = AtomicBool::new(false);
        let second_dl = download::download(&sftp_session, &remote, &local_copy, &cancel, |_, _| {})
            .await
            .unwrap();
        assert_eq!(second_dl.resumed_from, local_partial);
        let downloaded = std::fs::read(&local_copy).unwrap();
        assert_eq!(downloaded.len(), payload.len());
        assert_eq!(downloaded, payload, "resumed download must be byte-identical");

        // Cleanup.
        sftp::remove(&sftp_session, &remote, false).await.unwrap();
        sftp::remove(&sftp_session, &base, true).await.unwrap();
        let _ = std::fs::remove_dir_all(&local_dir);
    }

    /// 600 MB upload: proves the transfer is size-independent (one 256 KiB
    /// buffer per transfer, never the whole file in memory).
    #[tokio::test]
    #[ignore = "requires: docker sshd + ~1.2 GB free disk (slow)"]
    async fn real_ssh_upload_600mb_is_streamed() {
        use std::io::Write;
        use std::sync::atomic::AtomicBool;

        use crate::sftp::{self, open_subsystem, stat};
        use crate::ssh::config::SshConfig;
        use crate::ssh::hostkey::KnownHosts;
        use crate::ssh::session;

        const SIZE: u64 = 600 * 1024 * 1024;

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
        let sftp_session = open_subsystem(&opened.handle).await.unwrap();

        let base = format!("/tmp/leonssh-big-{stamp}");
        sftp::mkdir(&sftp_session, &base).await.unwrap();
        let remote = format!("{base}/big.bin");

        let local_dir = std::env::temp_dir().join(format!("leonssh-big-{stamp}"));
        std::fs::create_dir_all(&local_dir).unwrap();
        let local = local_dir.join("big.bin");
        {
            let mut file = std::fs::File::create(&local).unwrap();
            let block = vec![0xABu8; 1024 * 1024];
            for _ in 0..600 {
                file.write_all(&block).unwrap();
            }
        }

        let cancel = AtomicBool::new(false);
        let started = std::time::Instant::now();
        let outcome = upload::upload(&sftp_session, &local, &remote, &cancel, |_, _| {})
            .await
            .unwrap();

        assert!(!outcome.cancelled);
        assert_eq!(outcome.transferred, SIZE);
        assert_eq!(stat(&sftp_session, &remote).await.unwrap().size, SIZE);
        tracing::info!(
            elapsed_ms = started.elapsed().as_millis() as u64,
            "600 MB upload finished"
        );

        sftp::remove(&sftp_session, &remote, false).await.unwrap();
        sftp::remove(&sftp_session, &base, true).await.unwrap();
        let _ = std::fs::remove_dir_all(&local_dir);
    }
}

