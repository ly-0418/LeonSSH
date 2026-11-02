//! The single seam between the session layer and the webview.
//!
//! Terminal output must never travel through `invoke`/`event` JSON payloads.
//! `ChannelSink` wraps a `tauri::ipc::Channel` and always writes
//! `InvokeResponseBody::Raw`, which reaches the frontend as an `ArrayBuffer`.
//!
//! Phase 1 only ships this implementation. If multi-tab throughput ever
//! outgrows the IPC channel, an additional `UriSchemeSink` can be implemented
//! here and swapped in `commands::ssh` — producers and the pump stay untouched.

use bytes::Bytes;
use tauri::ipc::{Channel, InvokeResponseBody};

#[derive(Debug, thiserror::Error)]
pub enum SinkError {
    #[error("channel is closed")]
    Closed,
}

pub trait OutputSink: Send + Sync + 'static {
    fn send(&self, bytes: Bytes) -> Result<(), SinkError>;

    /// Reported in the UI / logs so a future transport swap is observable.
    fn kind(&self) -> &'static str {
        "tauri-channel"
    }
}

pub struct ChannelSink {
    channel: Channel<InvokeResponseBody>,
}

impl ChannelSink {
    pub fn new(channel: Channel<InvokeResponseBody>) -> Self {
        Self { channel }
    }
}

impl OutputSink for ChannelSink {
    fn send(&self, bytes: Bytes) -> Result<(), SinkError> {
        self.channel
            .send(InvokeResponseBody::Raw(bytes.to_vec()))
            .map_err(|_| SinkError::Closed)
    }
}
