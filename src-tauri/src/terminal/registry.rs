//! Session handle and cooperative shutdown.
//!
//! Every session owns exactly one tokio task (the producer and the output pump
//! are joined inside it, so aborting the task cancels both). Shutdown is
//! cooperative first and forceful only as a last resort:
//!
//! 1. broadcast the close signal,
//! 2. drop the input/resize senders so blocked producers wake up,
//! 3. wait up to `timeout`,
//! 4. `abort()` the task if it is still alive.

use std::time::Duration;

use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use crate::state::SessionId;

/// Bounded input queue: keystrokes are tiny, 256 slots cap a stuck consumer.
pub const INPUT_QUEUE_CAPACITY: usize = 256;

/// Bounded output queue between the producer and the IPC pump. This is the
/// memory ceiling for `tail -f` style floods (256 chunks, <= 64 KiB per batch
/// on the way out).
pub const OUTPUT_QUEUE_CAPACITY: usize = 256;

pub const DEFAULT_CLOSE_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseOutcome {
    /// The task observed the signal and returned on its own.
    Graceful,
    /// The timeout expired and the task had to be aborted.
    ForcedAbort,
}

pub struct SessionHandle {
    pub id: SessionId,
    pub input_tx: mpsc::Sender<Vec<u8>>,
    pub resize_tx: watch::Sender<(u16, u16)>,
    close_tx: watch::Sender<bool>,
    join: JoinHandle<()>,
}

impl SessionHandle {
    pub fn new(
        id: SessionId,
        input_tx: mpsc::Sender<Vec<u8>>,
        resize_tx: watch::Sender<(u16, u16)>,
        close_tx: watch::Sender<bool>,
        join: JoinHandle<()>,
    ) -> Self {
        Self {
            id,
            input_tx,
            resize_tx,
            close_tx,
            join,
        }
    }

    pub async fn close(self, timeout: Duration) -> CloseOutcome {
        let id = self.id.clone();
        let _ = self.close_tx.send(true);
        // Dropping the senders wakes any producer blocked on `recv()`.
        drop(self.input_tx);
        drop(self.resize_tx);

        let mut join = self.join;
        match tokio::time::timeout(timeout, &mut join).await {
            Ok(_) => CloseOutcome::Graceful,
            Err(_) => {
                tracing::warn!(session = %id, "session did not stop in time; aborting task");
                join.abort();
                CloseOutcome::ForcedAbort
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn handle_of(task: JoinHandle<()>, close_tx: watch::Sender<bool>) -> SessionHandle {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>(4);
        let (resize_tx, _resize_rx) = watch::channel((80u16, 24u16));
        SessionHandle::new("s1".into(), input_tx, resize_tx, close_tx, task)
    }

    #[tokio::test]
    async fn cooperative_close_is_graceful() {
        let (close_tx, mut close_rx) = watch::channel(false);
        let task = tokio::spawn(async move {
            let _ = close_rx.changed().await;
        });
        let outcome = handle_of(task, close_tx)
            .close(Duration::from_secs(1))
            .await;
        assert_eq!(outcome, CloseOutcome::Graceful);
    }

    #[tokio::test]
    async fn unresponsive_session_is_aborted() {
        let (close_tx, _close_rx) = watch::channel(false);
        let task = tokio::spawn(async {
            tokio::time::sleep(Duration::from_secs(30)).await;
        });
        let outcome = handle_of(task, close_tx)
            .close(Duration::from_millis(50))
            .await;
        assert_eq!(outcome, CloseOutcome::ForcedAbort);
    }

    #[tokio::test]
    async fn close_releases_the_input_channel() {
        let (close_tx, mut close_rx) = watch::channel(false);
        let (input_tx, mut input_rx) = mpsc::channel::<Vec<u8>>(4);
        let (resize_tx, _resize_rx) = watch::channel((80u16, 24u16));
        let task = tokio::spawn(async move {
            let _ = close_rx.changed().await;
        });
        let handle = SessionHandle::new("s3".into(), input_tx, resize_tx, close_tx, task);

        // Keep one sender on our side so the channel is not already closed.
        let probe = handle.input_tx.clone();
        drop(probe);
        handle.close(Duration::from_secs(1)).await;

        assert!(
            input_rx.recv().await.is_none(),
            "input receiver must observe closure after close()"
        );
    }
}
