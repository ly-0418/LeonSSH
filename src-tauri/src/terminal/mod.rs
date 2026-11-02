//! Transport-agnostic terminal session layer.
//!
//! * `sink`     – where bytes go (phase 1: Tauri binary channel)
//! * `pump`     – bounded queue -> coalesced frames -> sink
//! * `fake_source` – phase-1 producer (replaced by the russh read loop in phase 2)
//! * `registry` – session handle + cooperative shutdown
//! * `input`    – keystroke formatting for logs / echo

pub mod fake_source;
pub mod input;
pub mod pump;
pub mod registry;
pub mod sink;
