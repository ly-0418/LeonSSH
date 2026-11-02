//! Transfer task model shared with the frontend.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Upload,
    Download,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferStatus {
    Queued,
    Running,
    Completed,
    Cancelled,
    Failed,
    /// Destination already had the full file; nothing to do.
    Skipped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferTask {
    pub id: String,
    pub terminal_id: String,
    pub direction: Direction,
    pub src: String,
    pub dst: String,
    pub total: u64,
    pub transferred: u64,
    /// Byte offset the transfer resumed from (0 when it started fresh).
    pub resumed_from: u64,
    pub status: TransferStatus,
    pub error: Option<String>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}



