//! Output pump.
//!
//! The producer writes `Bytes` chunks into a bounded `mpsc`; this task drains
//! that queue, coalesces whatever is already buffered (up to 64 KiB) into one
//! binary frame, and hands it to the `OutputSink`.
//!
//! Coalescing only happens while data is already queued, so a quiet terminal
//! still gets sub-millisecond latency for echo, while a burst (e.g. `cat` of a
//! large file) costs far fewer IPC round-trips.

use std::sync::Arc;

use bytes::Bytes;
use tokio::sync::{mpsc, watch};

use super::sink::OutputSink;

const MAX_BATCH_BYTES: usize = 64 * 1024;
const STATS_EVERY_BATCHES: u64 = 40;

pub async fn run(
    mut rx: mpsc::Receiver<Bytes>,
    sink: Arc<dyn OutputSink>,
    mut close_rx: watch::Receiver<bool>,
) {
    let mut batches: u64 = 0;
    let mut total_bytes: u64 = 0;

    loop {
        let first = tokio::select! {
            biased;
            _ = close_rx.changed() => break,
            item = rx.recv() => match item {
                Some(chunk) => chunk,
                None => break,
            },
        };

        let mut batch = Vec::with_capacity(first.len().clamp(1024, MAX_BATCH_BYTES));
        batch.extend_from_slice(&first);
        while batch.len() < MAX_BATCH_BYTES {
            match rx.try_recv() {
                Ok(chunk) => batch.extend_from_slice(&chunk),
                Err(_) => break,
            }
        }

        let size = batch.len();
        if sink.send(Bytes::from(batch)).is_err() {
            tracing::warn!("output sink closed; stopping pump");
            break;
        }

        batches += 1;
        total_bytes += size as u64;
        if batches % STATS_EVERY_BATCHES == 0 {
            tracing::debug!(
                batches,
                total_bytes,
                last_batch = size,
                sink = sink.kind(),
                "terminal output flowing"
            );
        }
    }

    tracing::debug!(batches, total_bytes, "output pump stopped");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::registry::OUTPUT_QUEUE_CAPACITY;
    use std::sync::Mutex;

    #[derive(Default)]
    struct CollectSink {
        frames: Mutex<Vec<Vec<u8>>>,
    }

    impl OutputSink for CollectSink {
        fn send(&self, bytes: Bytes) -> Result<(), super::super::sink::SinkError> {
            self.frames.lock().unwrap().push(bytes.to_vec());
            Ok(())
        }
        fn kind(&self) -> &'static str {
            "test-collector"
        }
    }

    #[tokio::test]
    async fn pump_coalesces_queued_chunks_and_preserves_order() {
        let sink = Arc::new(CollectSink::default());
        let (tx, rx) = mpsc::channel::<Bytes>(OUTPUT_QUEUE_CAPACITY);
        let (close_tx, close_rx) = watch::channel(false);

        let pump = tokio::spawn(run(rx, sink.clone(), close_rx));

        for i in 0..50u8 {
            tx.send(Bytes::from(vec![i; 4])).await.unwrap();
        }
        drop(tx);
        let _ = tokio::time::timeout(std::time::Duration::from_secs(2), pump)
            .await
            .expect("pump should stop when the producer is gone");

        let frames = sink.frames.lock().unwrap();
        assert!(!frames.is_empty(), "pump must emit at least one frame");
        // Coalescing is best effort: the invariant that matters is byte order
        // and no duplication/loss across the concatenated frames.
        let flat: Vec<u8> = frames.iter().flat_map(|f| f.iter().copied()).collect();
        let expected: Vec<u8> = (0..50u8).flat_map(|i| vec![i; 4]).collect();
        assert_eq!(flat, expected);
        drop(close_tx);
    }

    #[tokio::test]
    async fn pump_stops_on_close_signal() {
        let sink = Arc::new(CollectSink::default());
        let (tx, rx) = mpsc::channel::<Bytes>(4);
        let (close_tx, close_rx) = watch::channel(false);
        let pump = tokio::spawn(run(rx, sink, close_rx));

        tx.send(Bytes::from_static(b"hi")).await.unwrap();
        close_tx.send(true).unwrap();

        let finished = tokio::time::timeout(std::time::Duration::from_secs(2), pump).await;
        assert!(finished.is_ok(), "pump must stop promptly on close");
    }
}
